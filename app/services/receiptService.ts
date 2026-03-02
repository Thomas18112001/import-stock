import { buildMissingPrestaConfigMessage, getBoutiqueMappingByLocationName } from "../config/boutiques";
import { env } from "../env.server";
import { toShopifyDateTime, toShopifyNowDateTime } from "../utils/dateTime";
import { debugLog } from "../utils/debug";
import { assertReceiptLocationMatch } from "../utils/locationLock";
import {
  canAdjustSkuFromStatus,
  canApplyFromStatus,
  canRetirerStockFromStatus,
  skuAdjustLockedMessage,
} from "../utils/receiptStatus";
import { aggregateDeltas, canDeleteReceiptStatus, invertJournalDeltas } from "../utils/stockOps";
import { findExistingReceiptByOrder, isStrictDuplicateForOrder } from "../utils/receiptUniqueness";
import { selectApplicableStockLines } from "../utils/stockValidation";
import { isShopifyGid } from "../utils/validators";
import type { AdminClient } from "./auth.server";
import {
  getOrderById,
  getOrderDetails,
  listOrders,
  type PrestaOrder,
} from "./prestaClient";
import { PrestaParsingError } from "./prestaXmlParser";
import { getStockOnLocation, inventoryAdjustQuantities, listLocations, resolveSkus } from "./shopifyGraphql";
import {
  deleteMetaobject,
  ensureMetaobjectDefinitions,
  fieldValue,
  getDashboardBundle,
  getMetaTypes,
  getMetaobjectById,
  getSyncState,
  listMetaobjects,
  listMetaobjectsConnection,
  setSyncState,
  updateMetaobject,
  upsertMetaobjectByHandle,
  type MetaobjectNode,
} from "./shopifyMetaobjects";

type ReceiptStatus = "IMPORTED" | "READY" | "BLOCKED" | "APPLIED" | "ROLLED_BACK";
type LineStatus = "RESOLVED" | "MISSING" | "SKIPPED";
const inFlightReceiptOps = new Set<string>();

export type ReceiptView = {
  gid: string;
  handle: string;
  prestaOrderId: number;
  prestaReference: string;
  prestaDateAdd: string;
  prestaDateUpd: string;
  status: ReceiptStatus;
  locationId: string;
  skippedSkus: string[];
  errors: Record<string, string>;
  appliedAdjustmentGid: string;
  updatedAt: string;
};

export type ReceiptLineView = {
  gid: string;
  receiptGid: string;
  sku: string;
  qty: number;
  status: LineStatus;
  inventoryItemGid: string;
  error: string;
};

export type SkuDiagnostic = {
  sku: string;
  found: boolean;
  variantTitle: string;
  inventoryItemGid: string;
};

export type ReceiptListPage = {
  receipts: ReceiptView[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};

function receiptHandle(prestaOrderId: number) {
  return `receipt-${prestaOrderId}`;
}

function lineHandle(prestaOrderId: number, index: number, sku: string) {
  return `line-${prestaOrderId}-${index}-${sku.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`;
}

function toNumber(value: string, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function elapsedMs(startMs: number): number {
  return Date.now() - startMs;
}

function buildReceiptOpLockKey(shopDomain: string, receiptGid: string): string {
  return `${shopDomain}:${receiptGid}`;
}

async function withReceiptOpLock<T>(
  shopDomain: string,
  receiptGid: string,
  operation: "apply" | "rollback",
  handler: () => Promise<T>,
): Promise<T> {
  const key = buildReceiptOpLockKey(shopDomain, receiptGid);
  if (inFlightReceiptOps.has(key)) {
    throw new Error(`Action "${operation}" déjà en cours pour cette réception. Réessayez dans quelques secondes.`);
  }
  inFlightReceiptOps.add(key);
  try {
    return await handler();
  } finally {
    inFlightReceiptOps.delete(key);
  }
}

function parseJsonMap(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toReceipt(node: MetaobjectNode): ReceiptView {
  return {
    gid: node.id,
    handle: node.handle,
    prestaOrderId: toNumber(fieldValue(node, "presta_order_id")),
    prestaReference: fieldValue(node, "presta_reference"),
    prestaDateAdd: fieldValue(node, "presta_date_add"),
    prestaDateUpd: fieldValue(node, "presta_date_upd"),
    status: (fieldValue(node, "status") || "IMPORTED") as ReceiptStatus,
    locationId: fieldValue(node, "location_id"),
    skippedSkus: parseJsonArray(fieldValue(node, "skipped_skus")),
    errors: parseJsonMap(fieldValue(node, "errors")),
    appliedAdjustmentGid: fieldValue(node, "applied_adjustment_gid"),
    updatedAt: node.updatedAt,
  };
}

function toLine(node: MetaobjectNode): ReceiptLineView {
  return {
    gid: node.id,
    receiptGid: fieldValue(node, "receipt_gid"),
    sku: fieldValue(node, "sku"),
    qty: toNumber(fieldValue(node, "qty")),
    status: (fieldValue(node, "status") || "MISSING") as LineStatus,
    inventoryItemGid: fieldValue(node, "inventory_item_gid"),
    error: fieldValue(node, "error"),
  };
}

async function resolveBoutiqueContext(admin: AdminClient, locationId: string) {
  if (!locationId || !isShopifyGid(locationId)) {
    throw new Error("Sélection de la boutique invalide.");
  }
  const locations = await listLocations(admin);
  const location = locations.find((loc) => loc.id === locationId);
  if (!location) {
    throw new Error("Boutique introuvable.");
  }
  const mapping = getBoutiqueMappingByLocationName(location.name);
  if (!mapping || mapping.prestaCustomerId == null) {
    throw new Error(buildMissingPrestaConfigMessage(location.name));
  }
  return {
    locationId: location.id,
    locationName: location.name,
    prestaCustomerId: mapping.prestaCustomerId,
  };
}

async function getExistingReceiptForOrder(
  admin: AdminClient,
  shopDomain: string,
  order: { id: number; reference: string },
): Promise<{ receipt: ReceiptView; duplicateBy: "id" | "reference" } | null> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const nodes = await listMetaobjects(admin, types.receipt);
  const receipts = nodes.map(toReceipt);
  const existing = findExistingReceiptByOrder(receipts, order.id, order.reference);
  if (!existing) return null;
  return { receipt: existing.receipt, duplicateBy: existing.duplicateBy };
}

async function ensureReceiptImported(
  admin: AdminClient,
  shopDomain: string,
  order: PrestaOrder,
  locationId: string,
) {
  const types = await getMetaTypes(admin);
  const existing = await getExistingReceiptForOrder(admin, shopDomain, order);
  if (existing && isStrictDuplicateForOrder(existing, order.id)) {
    if (!existing.receipt.locationId) {
      await updateMetaobject(admin, existing.receipt.gid, [{ key: "location_id", value: locationId }]);
    }
    return existing.receipt.gid;
  }

  const addDate = toShopifyDateTime(order.dateAdd);
  const updDate = toShopifyDateTime(order.dateUpd);
  const importWarnings: Record<string, string> = {};
  if (!addDate && order.dateAdd) importWarnings.__warning_presta_date_add = `Date invalide ignorée: ${order.dateAdd}`;
  if (!updDate && order.dateUpd) importWarnings.__warning_presta_date_upd = `Date invalide ignorée: ${order.dateUpd}`;

  const receiptFields = [
    { key: "presta_order_id", value: String(order.id) },
    { key: "presta_reference", value: order.reference },
    { key: "status", value: "IMPORTED" },
    { key: "location_id", value: locationId },
    { key: "skipped_skus", value: "[]" },
    { key: "errors", value: JSON.stringify(importWarnings) },
    { key: "applied_adjustment_gid", value: "" },
  ];
  if (addDate) receiptFields.push({ key: "presta_date_add", value: addDate });
  if (updDate) receiptFields.push({ key: "presta_date_upd", value: updDate });

  const receiptId = await upsertMetaobjectByHandle(admin, types.receipt, receiptHandle(order.id), receiptFields);

  const lines = await getOrderDetails(order.id);
  await Promise.all(
    lines.map((line, idx) =>
      upsertMetaobjectByHandle(admin, types.receiptLine, lineHandle(order.id, idx, line.sku), [
        { key: "receipt_gid", value: receiptId },
        { key: "sku", value: line.sku },
        { key: "qty", value: String(line.qty) },
        { key: "status", value: "MISSING" },
        { key: "inventory_item_gid", value: "" },
        { key: "error", value: "" },
      ]),
    ),
  );
  return receiptId;
}

export async function getDashboardData(
  admin: AdminClient,
  shopDomain: string,
  options: { pageSize?: number; cursor?: string | null } = {},
) {
  const startedAt = Date.now();
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const pageSize = options.pageSize ?? 20;
  const bundle = await getDashboardBundle(admin, types.receipt, pageSize, options.cursor ?? null);
  const configuredLocations = bundle.locations.map((location) => {
    const mapping = getBoutiqueMappingByLocationName(location.name);
    return {
      ...location,
      prestaConfigured: Boolean(mapping?.prestaCustomerId),
    };
  });
  debugLog("dashboard data loaded", {
    shop: shopDomain,
    pageSize,
    receipts: bundle.receipts.length,
    elapsedMs: elapsedMs(startedAt),
  });
  return {
    locations: configuredLocations,
    syncState: bundle.syncState,
    receipts: bundle.receipts.map(toReceipt),
    pageInfo: bundle.pageInfo,
  };
}

export async function syncRun(
  admin: AdminClient,
  shopDomain: string,
  manual: boolean,
  locationId: string,
) {
  const startedAt = Date.now();
  void manual;
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const boutique = await resolveBoutiqueContext(admin, locationId);
  const syncState = await getSyncState(admin);
  const currentCursor = syncState.cursorByLocation[boutique.locationId] ?? 0;
  debugLog("sync start", { manual, locationId: boutique.locationId, prestaCustomerId: boutique.prestaCustomerId, currentCursor });
  let imported = 0;
  let offset = 0;
  let maxId = currentCursor;
  const pageSize = Math.min(env.syncBatchSize, 50);

  while (imported < env.syncMaxPerRun) {
    const orders = await listOrders({
      customerId: boutique.prestaCustomerId,
      sinceId: currentCursor,
      offset,
      limit: Math.min(pageSize, env.syncMaxPerRun - imported),
    });
    if (!orders.length) break;
    for (const order of orders) {
      await ensureReceiptImported(admin, shopDomain, order, boutique.locationId);
      imported += 1;
      maxId = Math.max(maxId, order.id);
      if (imported >= env.syncMaxPerRun) break;
    }
    offset += orders.length;
    if (orders.length < pageSize) break;
  }

  const nextCursorMap = { ...syncState.cursorByLocation };
  nextCursorMap[boutique.locationId] = Math.max(currentCursor, maxId);
  const nextLastSyncMap = {
    ...syncState.lastSyncAtByLocation,
    [boutique.locationId]: new Date().toISOString(),
  };
  await setSyncState(admin, {
    selectedLocationId: boutique.locationId,
    cursorByLocation: nextCursorMap,
    lastSyncAtByLocation: nextLastSyncMap,
  });
  debugLog("sync done", {
    imported,
    lastPrestaOrderId: nextCursorMap[boutique.locationId],
    locationId: boutique.locationId,
    elapsedMs: elapsedMs(startedAt),
  });
  return {
    imported,
    lastPrestaOrderId: nextCursorMap[boutique.locationId],
    locationId: boutique.locationId,
    lastSyncAt: nextLastSyncMap[boutique.locationId],
  };
}

export async function importById(
  admin: AdminClient,
  shopDomain: string,
  prestaOrderId: number,
  locationId: string,
) {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const boutique = await resolveBoutiqueContext(admin, locationId);
  let order: PrestaOrder | null = null;
  try {
    order = await getOrderById(prestaOrderId);
  } catch (error) {
    if (error instanceof PrestaParsingError) throw new Error("Erreur parsing Presta");
    const message = error instanceof Error ? error.message : "";
    if (message.includes("(404)")) throw new Error(`Commande Presta ${prestaOrderId} introuvable`);
    throw error;
  }
  if (!order) throw new Error(`Commande Presta ${prestaOrderId} introuvable`);
  if (order.customerId !== boutique.prestaCustomerId) {
    throw new Error("Commande trouvée mais n'appartient pas à Prestashop BtoB.");
  }
  const existing = await getExistingReceiptForOrder(admin, shopDomain, order);
  if (existing && isStrictDuplicateForOrder(existing, order.id)) {
    const syncState = await getSyncState(admin);
    const lastPrestaOrderId = syncState.cursorByLocation[boutique.locationId] ?? 0;
    debugLog("import by id duplicate", {
      prestaOrderId,
      duplicateBy: existing.duplicateBy,
      receiptGid: existing.receipt.gid,
      locationId: boutique.locationId,
      lastPrestaOrderId,
    });
    return { created: false, receiptGid: existing.receipt.gid, duplicateBy: existing.duplicateBy, lastPrestaOrderId };
  }
  if (existing?.duplicateBy === "reference" && existing.receipt.prestaOrderId !== order.id) {
    debugLog("import by id reference collision ignored", {
      prestaOrderId,
      collidingReceiptGid: existing.receipt.gid,
      collidingPrestaOrderId: existing.receipt.prestaOrderId,
      reference: order.reference,
    });
  }
  const receiptGid = await ensureReceiptImported(admin, shopDomain, order, boutique.locationId);
  const syncState = await getSyncState(admin);
  const currentCursor = syncState.cursorByLocation[boutique.locationId] ?? 0;
  const lastPrestaOrderId = Math.max(currentCursor, order.id);
  const nextCursorMap = { ...syncState.cursorByLocation, [boutique.locationId]: lastPrestaOrderId };
  const nextLastSyncMap = {
    ...syncState.lastSyncAtByLocation,
    [boutique.locationId]: new Date().toISOString(),
  };
  await setSyncState(admin, {
    selectedLocationId: boutique.locationId,
    cursorByLocation: nextCursorMap,
    lastSyncAtByLocation: nextLastSyncMap,
  });
  debugLog("import by id created", {
    prestaOrderId,
    receiptGid,
    locationId: boutique.locationId,
    currentCursor,
    lastPrestaOrderId,
  });
  return {
    created: true,
    receiptGid,
    duplicateBy: null,
    lastPrestaOrderId,
    locationId: boutique.locationId,
    lastSyncAt: nextLastSyncMap[boutique.locationId],
  };
}

export async function listReceipts(
  admin: AdminClient,
  shopDomain: string,
  options: { pageSize?: number; cursor?: string | null } = {},
): Promise<ReceiptListPage> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const first = options.pageSize ?? 20;
  const connection = await listMetaobjectsConnection(admin, types.receipt, first, options.cursor ?? null);
  return {
    receipts: connection.nodes.map(toReceipt),
    pageInfo: connection.pageInfo,
  };
}

export async function getReceiptDetail(admin: AdminClient, shopDomain: string, receiptGid: string) {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const receiptNode = await getMetaobjectById(admin, receiptGid);
  if (!receiptNode || receiptNode.type !== types.receipt) throw new Error("Commande introuvable");
  const receipt = toReceipt(receiptNode);

  const lineNodes = await listMetaobjects(admin, types.receiptLine);
  const lines = lineNodes.map(toLine).filter((line) => line.receiptGid === receiptGid);
  return { receipt, lines };
}

export async function getSkuDiagnostics(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
): Promise<SkuDiagnostic[]> {
  const { lines } = await getReceiptDetail(admin, shopDomain, receiptGid);
  const uniqueSkus = Array.from(new Set(lines.map((line) => line.sku).filter(Boolean)));
  const resolved = await resolveSkus(admin, uniqueSkus);
  return uniqueSkus.map((sku) => {
    const match = resolved.get(sku);
    return {
      sku,
      found: Boolean(match),
      variantTitle: match?.variantTitle ?? "",
      inventoryItemGid: match?.inventoryItemId ?? "",
    };
  });
}

export async function prepareReceipt(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
  locationId: string,
) {
  const startedAt = Date.now();
  if (!locationId || !isShopifyGid(locationId)) {
    throw new Error("Sélection de la boutique invalide.");
  }
  const boutique = await resolveBoutiqueContext(admin, locationId);
  const { receipt, lines } = await getReceiptDetail(admin, shopDomain, receiptGid);
  if (!canAdjustSkuFromStatus(receipt.status)) {
    throw new Error(skuAdjustLockedMessage());
  }
  assertReceiptLocationMatch(receipt.locationId, boutique.locationId);
  const skipped = new Set(receipt.skippedSkus);
  const skusToResolve = lines.filter((line) => !skipped.has(line.sku)).map((line) => line.sku);
  const resolved = await resolveSkus(admin, skusToResolve);
  const errors: Record<string, string> = Object.fromEntries(
    Object.entries(receipt.errors).filter(([key]) => key.startsWith("__warning")),
  );

  await Promise.all(
    lines.map(async (line) => {
      if (skipped.has(line.sku)) {
        await updateMetaobject(admin, line.gid, [
          { key: "status", value: "SKIPPED" },
          { key: "error", value: "" },
        ]);
        return;
      }
      if (line.qty <= 0) {
        errors[line.sku] = "Quantité invalide: valeur attendue strictement positive";
        await updateMetaobject(admin, line.gid, [
          { key: "status", value: "MISSING" },
          { key: "inventory_item_gid", value: "" },
          { key: "error", value: errors[line.sku] },
        ]);
        return;
      }
      const match = resolved.get(line.sku);
      if (!match) {
        errors[line.sku] = "SKU introuvable dans Shopify";
        await updateMetaobject(admin, line.gid, [
          { key: "status", value: "MISSING" },
          { key: "inventory_item_gid", value: "" },
          { key: "error", value: errors[line.sku] },
        ]);
        return;
      }
      await updateMetaobject(admin, line.gid, [
        { key: "status", value: "RESOLVED" },
        { key: "inventory_item_gid", value: match.inventoryItemId },
        { key: "error", value: "" },
      ]);
    }),
  );

  const hasBlockingMissing = Object.keys(errors).some((key) => !key.startsWith("__warning"));
  const finalStatus: ReceiptStatus = hasBlockingMissing ? "BLOCKED" : "READY";
  await updateMetaobject(admin, receipt.gid, [
    { key: "status", value: finalStatus },
    { key: "location_id", value: boutique.locationId },
    { key: "errors", value: JSON.stringify(errors) },
  ]);
  debugLog("prepare receipt done", {
    shop: shopDomain,
    receiptGid,
    lines: lines.length,
    finalStatus,
    elapsedMs: elapsedMs(startedAt),
  });
  return { status: finalStatus, errors };
}

export async function toggleSkip(admin: AdminClient, shopDomain: string, receiptGid: string, sku: string) {
  const { receipt, lines } = await getReceiptDetail(admin, shopDomain, receiptGid);
  if (!canAdjustSkuFromStatus(receipt.status)) {
    throw new Error(skuAdjustLockedMessage());
  }
  const next = new Set(receipt.skippedSkus);
  if (next.has(sku)) next.delete(sku);
  else next.add(sku);
  await updateMetaobject(admin, receipt.gid, [{ key: "skipped_skus", value: JSON.stringify([...next]) }]);

  const line = lines.find((l) => l.sku === sku);
  if (line) {
    const status: LineStatus = next.has(sku) ? "SKIPPED" : line.inventoryItemGid ? "RESOLVED" : "MISSING";
    await updateMetaobject(admin, line.gid, [{ key: "status", value: status }]);
  }
}

export async function applyReceipt(
  admin: AdminClient,
  shopDomain: string,
  input: {
    receiptGid: string;
    locationId: string;
    confirmed: boolean;
    skippedSkus: string[];
  },
) {
  return withReceiptOpLock(shopDomain, input.receiptGid, "apply", async () => {
    const startedAt = Date.now();
    const types = await getMetaTypes(admin);
    const boutique = await resolveBoutiqueContext(admin, input.locationId);
    if (!input.confirmed) {
      throw new Error("Confirmation obligatoire.");
    }
    const { receipt } = await getReceiptDetail(admin, shopDomain, input.receiptGid);
    if (receipt.status === "APPLIED") throw new Error("Cette réception a déjà été traitée.");
    if (!receipt.locationId) {
      throw new Error("La boutique de la réception est absente. Relancez la préparation de la réception.");
    }
    assertReceiptLocationMatch(receipt.locationId, boutique.locationId);
    if (!canApplyFromStatus(receipt.status)) {
      throw new Error("Diagnostic obligatoire: lancez 'Ajuster les SKU' pour passer la réception en statut prête.");
    }

    if (input.skippedSkus.length) {
      await updateMetaobject(admin, receipt.gid, [{ key: "skipped_skus", value: JSON.stringify(input.skippedSkus) }]);
    }
    const detail = await getReceiptDetail(admin, shopDomain, input.receiptGid);
    const skipped = new Set(detail.receipt.skippedSkus);
    const blocking = detail.lines.filter((line) => line.status === "MISSING" && !skipped.has(line.sku));
    if (blocking.length) throw new Error(`Lignes bloquantes: ${blocking.map((b) => b.sku).join(", ")}`);

    const applyLines = selectApplicableStockLines(detail.lines, detail.receipt.skippedSkus);
    if (!applyLines.length) {
      throw new Error("Aucune ligne applicable. Ajustez les SKU ou retirez les lignes ignorées.");
    }
    const invalidInventoryIds = applyLines.filter((line) => !isShopifyGid(line.inventoryItemGid));
    if (invalidInventoryIds.length) {
      throw new Error(`Identifiants inventaire invalides: ${invalidInventoryIds.map((line) => line.sku).join(", ")}`);
    }
    const invalidQtyLines = applyLines.filter((line) => line.qty <= 0);
    if (invalidQtyLines.length) {
      throw new Error(`Quantités invalides (<= 0): ${invalidQtyLines.map((line) => line.sku).join(", ")}`);
    }
    const aggregated = aggregateDeltas(
      applyLines.map((line) => ({
        sku: line.sku,
        inventoryItemId: line.inventoryItemGid,
        delta: line.qty,
      })),
    );
    if (!aggregated.length) {
      throw new Error("Aucune ligne valide à appliquer.");
    }

    debugLog("apply receipt validation", {
      receiptGid: detail.receipt.gid,
      locationId: boutique.locationId,
      applySkus: aggregated.map((line) => line.sku),
      applyCount: aggregated.length,
    });
    await inventoryAdjustQuantities(
      admin,
      boutique.locationId,
      aggregated.map((line) => ({ inventoryItemId: line.inventoryItemId, delta: line.delta })),
    );

    const adjustmentGid = await upsertMetaobjectByHandle(
      admin,
      types.adjustment,
      `adjustment-${detail.receipt.prestaOrderId}-${Date.now()}`,
      [
        { key: "receipt_gid", value: detail.receipt.gid },
        { key: "location_id", value: boutique.locationId },
        { key: "status", value: "APPLIED" },
        { key: "applied_at", value: toShopifyNowDateTime() },
      ],
    );

    await Promise.all(
      aggregated.map((line, idx) =>
        upsertMetaobjectByHandle(
          admin,
          types.adjustmentLine,
          `adjustment-line-${detail.receipt.prestaOrderId}-${idx}-${line.sku.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`,
          [
            { key: "adjustment_gid", value: adjustmentGid },
            { key: "sku", value: line.sku },
            { key: "qty_delta", value: String(line.delta) },
            { key: "inventory_item_gid", value: line.inventoryItemId },
          ],
        ),
      ),
    );

    await updateMetaobject(admin, detail.receipt.gid, [
      { key: "status", value: "APPLIED" },
      { key: "location_id", value: boutique.locationId },
      { key: "applied_adjustment_gid", value: adjustmentGid },
    ]);
    debugLog("apply receipt done", {
      shop: shopDomain,
      receiptGid: detail.receipt.gid,
      locationId: boutique.locationId,
      appliedLines: aggregated.length,
      elapsedMs: elapsedMs(startedAt),
    });
  });
}

export async function rollbackReceipt(admin: AdminClient, shopDomain: string, receiptGid: string) {
  return withReceiptOpLock(shopDomain, receiptGid, "rollback", async () => {
    const startedAt = Date.now();
    const types = await getMetaTypes(admin);
    const { receipt } = await getReceiptDetail(admin, shopDomain, receiptGid);
    if (!canRetirerStockFromStatus(receipt.status)) {
      throw new Error("Retrait impossible: la réception n'est pas en statut APPLIED.");
    }
    if (!receipt.appliedAdjustmentGid) throw new Error("Aucun ajustement appliqué pour cette réception.");

    const adjustmentNodes = await listMetaobjects(admin, types.adjustment);
    const adjustment = adjustmentNodes.find((node) => node.id === receipt.appliedAdjustmentGid);
    if (!adjustment) throw new Error("Ajustement introuvable.");
    if (fieldValue(adjustment, "status") === "ROLLED_BACK") {
      throw new Error("Le stock a déjà été retiré pour cette réception.");
    }
    if (fieldValue(adjustment, "receipt_gid") !== receipt.gid) {
      throw new Error("Ajustement incohérent pour cette réception.");
    }

    const locationId = fieldValue(adjustment, "location_id");
    if (!isShopifyGid(locationId)) {
      throw new Error("Identifiant de boutique invalide sur l'ajustement.");
    }
    assertReceiptLocationMatch(receipt.locationId, locationId);
    const journalLines = (await listMetaobjects(admin, types.adjustmentLine))
      .filter((node) => fieldValue(node, "adjustment_gid") === receipt.appliedAdjustmentGid)
      .map((node) => ({
        sku: fieldValue(node, "sku"),
        inventoryItemId: fieldValue(node, "inventory_item_gid"),
        qtyDelta: toNumber(fieldValue(node, "qty_delta")),
      }));
    if (!journalLines.length) {
      throw new Error("Aucune ligne d'ajustement à annuler.");
    }
    const adjustmentLines = invertJournalDeltas(journalLines);
    const invalidAdjustmentLines = adjustmentLines.filter(
      (line) => !isShopifyGid(line.inventoryItemId) || line.delta >= 0,
    );
    if (invalidAdjustmentLines.length) {
      throw new Error("Lignes d'ajustement invalides.");
    }

    debugLog("rollback receipt validation", {
      receiptGid: receipt.gid,
      locationId,
      rollbackSkus: adjustmentLines.map((line) => line.sku),
      rollbackCount: adjustmentLines.length,
    });

    await inventoryAdjustQuantities(
      admin,
      locationId,
      adjustmentLines.map((line) => ({ inventoryItemId: line.inventoryItemId, delta: line.delta })),
    );
    await updateMetaobject(admin, adjustment.id, [
      { key: "status", value: "ROLLED_BACK" },
      { key: "rolled_back_at", value: toShopifyNowDateTime() },
    ]);
    await updateMetaobject(admin, receipt.gid, [{ key: "status", value: "ROLLED_BACK" }]);
    debugLog("rollback receipt done", {
      shop: shopDomain,
      receiptGid: receipt.gid,
      locationId,
      lines: adjustmentLines.length,
      elapsedMs: elapsedMs(startedAt),
    });
  });
}

export async function getReceiptStocks(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
  locationId: string,
): Promise<Map<string, number>> {
  const { lines } = await getReceiptDetail(admin, shopDomain, receiptGid);
  const ids = lines.map((line) => line.inventoryItemGid).filter(Boolean);
  return getStockOnLocation(admin, ids, locationId);
}

export async function deleteReceipt(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
  confirmed: boolean,
) {
  if (!confirmed) {
    throw new Error("Confirmation obligatoire.");
  }
  const types = await getMetaTypes(admin);
  const { receipt } = await getReceiptDetail(admin, shopDomain, receiptGid);
  if (!canDeleteReceiptStatus(receipt.status)) {
    throw new Error("Impossible de supprimer une réception avec stock ajouté. Retirez le stock avant suppression.");
  }

  const lineNodes = await listMetaobjects(admin, types.receiptLine);
  const relatedLines = lineNodes.filter((line) => fieldValue(line, "receipt_gid") === receiptGid);
  for (const line of relatedLines) {
    await deleteMetaobject(admin, line.id);
  }

  await deleteMetaobject(admin, receiptGid);
  return { deleted: true };
}
