import { buildMissingPrestaConfigMessage, getBoutiqueMappingByLocationName } from "../config/boutiques";
import { env } from "../env.server";
import { toShopifyDateTime, toShopifyNowDateTime } from "../utils/dateTime";
import { debugLog } from "../utils/debug";
import { assertReceiptLocationMatch } from "../utils/locationLock";
import {
  canAdjustSkuFromStatus,
  canApplyFromStatus,
  canReceiveFromStatus,
  canRetirerStockFromStatus,
  skuAdjustLockedMessage,
} from "../utils/receiptStatus";
import { aggregateDeltas, canDeleteReceiptStatus, invertJournalDeltas } from "../utils/stockOps";
import { findExistingReceiptByOrder, isStrictDuplicateForOrder } from "../utils/receiptUniqueness";
import { selectApplicableStockLines } from "../utils/stockValidation";
import {
  buildOrderCheckpoint,
  comparePrestaCheckpoint,
  computeCheckpointLookbackStart,
  formatPrestaDateTime,
  isOrderAfterCheckpoint,
  maxPrestaCheckpoint,
  normalizePrestaCheckpoint,
  parsePrestaDateTimeToMs,
  type PrestaCheckpoint,
} from "../utils/prestaCheckpoint";
import { isShopifyGid } from "../utils/validators";
import type { AdminClient } from "./auth.server";
import { hasRestockLinkedToReceipt, upsertIncomingPurchaseOrderFromPrestaOrder } from "./purchaseOrderService";
import {
  getOrderById,
  getOrderDetails,
  listOrders,
  type ListOrdersInput,
  type PrestaOrderLine,
  type PrestaOrder,
} from "./prestaClient";
import { PrestaParsingError } from "./prestaXmlParser";
import { getStockOnLocation, inventoryAdjustQuantities, listLocations, resolveSkus } from "./shopifyGraphql";
import {
  deleteMetaobject,
  ensureMetaobjectDefinitions,
  fieldValue,
  getDashboardBundle,
  getLastPrestaOrderId,
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

type ReceiptStatus = "IMPORTED" | "READY" | "BLOCKED" | "INCOMING" | "APPLIED" | "ROLLED_BACK";
type LineStatus = "RESOLVED" | "MISSING" | "SKIPPED";
const inFlightReceiptOps = new Set<string>();
const PRESTA_DATE_LOOKBACK_MINUTES = 60;
const PRESTA_DATE_SCAN_RESERVE_MAX = 50;
const PRESTA_DATE_SCAN_RESERVE_RATIO = 0.25;
const PRESTA_BOOTSTRAP_LOOKBACK_MINUTES = 24 * 60;
const PRESTA_STALE_CHECKPOINT_MAX_AGE_DAYS = 30;
const PRESTA_ORDER_DETAILS_RETRY_ATTEMPTS = 3;
const PRESTA_ORDER_DETAILS_RETRY_DELAY_MS = 750;
const EMPTY_PRESTA_CHECKPOINT: PrestaCheckpoint = { dateUpd: "1970-01-01 00:00:00", orderId: 0 };
const RECEIPT_LINE_SCAN_PAGE_SIZE = 250;
const RECEIPT_LINE_SCAN_MAX_PAGES = 120;
const receiptLineQuerySupportedByType = new Map<string, boolean>();
export type CursorBootstrapSource = "none" | "legacy_global_cursor" | "existing_receipts" | "latest_presta_head";

type ImportDecision =
  | { action: "import"; reason: "new"; receiptGid: string }
  | { action: "skip"; reason: "duplicate_by_id"; receiptGid: string };

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveDateScanBudget(syncMaxPerRun: number): number {
  const computed = Math.floor(syncMaxPerRun * PRESTA_DATE_SCAN_RESERVE_RATIO);
  return Math.max(1, Math.min(PRESTA_DATE_SCAN_RESERVE_MAX, computed));
}

export function computeSyncScanBudgets(syncMaxPerRun: number): { idScanBudget: number; dateScanReserve: number } {
  const dateScanReserve = reserveDateScanBudget(syncMaxPerRun);
  return {
    dateScanReserve,
    idScanBudget: Math.max(1, syncMaxPerRun - dateScanReserve),
  };
}

function checkpointFromOrder(order: PrestaOrder): PrestaCheckpoint | null {
  return buildOrderCheckpoint(order.dateUpd, order.id);
}

function clampCheckpointToUpperBound(checkpoint: PrestaCheckpoint, upperBound: string): PrestaCheckpoint {
  const upperBoundCheckpoint: PrestaCheckpoint = {
    dateUpd: upperBound,
    orderId: Number.MAX_SAFE_INTEGER,
  };
  if (comparePrestaCheckpoint(checkpoint, upperBoundCheckpoint) <= 0) {
    return checkpoint;
  }
  return { dateUpd: upperBound, orderId: 0 };
}

function hasOwnRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isDefaultLocationName(locationName: string): boolean {
  return locationName.trim().toLowerCase() === env.shopifyDefaultLocationName.trim().toLowerCase();
}

function maxImportedOrderIdForLocation(receipts: ReceiptView[], locationId: string, locationName: string): number {
  const includeLegacyUnassigned = isDefaultLocationName(locationName);
  let maxOrderId = 0;
  for (const receipt of receipts) {
    if (receipt.locationId !== locationId && !(includeLegacyUnassigned && !receipt.locationId)) {
      continue;
    }
    if (receipt.prestaOrderId > maxOrderId) {
      maxOrderId = receipt.prestaOrderId;
    }
  }
  return maxOrderId;
}

export function resolveCursorBootstrap(input: {
  hasStoredCursor: boolean;
  currentCursor: number;
  legacyGlobalCursor: number;
  receiptsCursor: number;
  latestPrestaHeadCursor: number;
}): { cursor: number; source: CursorBootstrapSource } {
  if (input.hasStoredCursor && input.currentCursor > 0) {
    return { cursor: input.currentCursor, source: "none" };
  }
  if (input.legacyGlobalCursor > 0) {
    return { cursor: input.legacyGlobalCursor, source: "legacy_global_cursor" };
  }
  if (input.latestPrestaHeadCursor > 0) {
    return { cursor: input.latestPrestaHeadCursor, source: "latest_presta_head" };
  }
  if (input.receiptsCursor > 0) {
    return { cursor: input.receiptsCursor, source: "existing_receipts" };
  }
  return { cursor: Math.max(0, input.currentCursor), source: "none" };
}

export function shouldBootstrapCheckpoint(
  hasStoredCheckpoint: boolean,
  checkpoint: PrestaCheckpoint,
): boolean {
  return !hasStoredCheckpoint || comparePrestaCheckpoint(checkpoint, EMPTY_PRESTA_CHECKPOINT) === 0;
}

export function isCheckpointStaleForBootstrap(
  checkpoint: PrestaCheckpoint,
  runUpperBound: string,
  maxAgeDays = PRESTA_STALE_CHECKPOINT_MAX_AGE_DAYS,
): boolean {
  const checkpointMs = parsePrestaDateTimeToMs(checkpoint.dateUpd);
  const upperBoundMs = parsePrestaDateTimeToMs(runUpperBound);
  if (checkpointMs == null || upperBoundMs == null) return false;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return false;
  return upperBoundMs - checkpointMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

function buildReceiptOpLockKey(shopDomain: string, receiptGid: string): string {
  return `${shopDomain}:${receiptGid}`;
}

async function withReceiptOpLock<T>(
  shopDomain: string,
  receiptGid: string,
  operation: "apply" | "receive" | "rollback",
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

async function listReceiptLinesForReceipt(
  admin: AdminClient,
  receiptLineType: string,
  receiptGid: string,
  prestaOrderId = 0,
): Promise<ReceiptLineView[]> {
  const startedAt = Date.now();
  const querySupport = receiptLineQuerySupportedByType.get(receiptLineType);
  if (querySupport !== false) {
    try {
      const queried = await listReceiptLinesForReceiptViaQuery(admin, receiptLineType, receiptGid, prestaOrderId);
      if (queried.length > 0) {
        receiptLineQuerySupportedByType.set(receiptLineType, true);
        debugLog("receipt lines lookup", {
          receiptLineType,
          receiptGid,
          prestaOrderId,
          strategy: "query",
          lines: queried.length,
          elapsedMs: elapsedMs(startedAt),
        });
        return queried;
      }
      if (prestaOrderId > 0) {
        debugLog("receipt lines lookup", {
          receiptLineType,
          receiptGid,
          prestaOrderId,
          strategy: "query_empty",
          lines: 0,
          elapsedMs: elapsedMs(startedAt),
        });
        return [];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      debugLog("receipt lines query unsupported; fallback scan", {
        receiptLineType,
        receiptGid,
        prestaOrderId,
        reason: message,
      });
      receiptLineQuerySupportedByType.set(receiptLineType, false);
    }
  }

  const scanned = await listReceiptLinesForReceiptViaScan(admin, receiptLineType, receiptGid);
  if (querySupport !== false && scanned.length > 0) {
    receiptLineQuerySupportedByType.set(receiptLineType, false);
    debugLog("receipt lines query disabled after fallback", {
      receiptLineType,
      receiptGid,
      prestaOrderId,
      lines: scanned.length,
    });
  }
  debugLog("receipt lines lookup", {
    receiptLineType,
    receiptGid,
    prestaOrderId,
    strategy: "scan",
    lines: scanned.length,
    elapsedMs: elapsedMs(startedAt),
  });
  return scanned;
}

function escapeMetaobjectSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildReceiptLineSearchQueries(receiptGid: string, prestaOrderId: number): string[] {
  const queries: string[] = [];
  if (prestaOrderId > 0) {
    const handlePrefix = `line-${prestaOrderId}-`;
    const escapedPrefix = escapeMetaobjectSearchValue(handlePrefix);
    queries.push(`handle:${escapedPrefix}*`);
    queries.push(`"${escapedPrefix}"`);
  }
  queries.push(`fields.receipt_gid:"${escapeMetaobjectSearchValue(receiptGid)}"`);
  return queries;
}

async function listReceiptLinesForReceiptViaQuery(
  admin: AdminClient,
  receiptLineType: string,
  receiptGid: string,
  prestaOrderId: number,
): Promise<ReceiptLineView[]> {
  let lastQueryError: unknown = null;
  for (const query of buildReceiptLineSearchQueries(receiptGid, prestaOrderId)) {
    try {
      const lines: ReceiptLineView[] = [];
      let after: string | null = null;
      let pagesScanned = 0;
      while (pagesScanned < RECEIPT_LINE_SCAN_MAX_PAGES) {
        const connection = await listMetaobjectsConnection(
          admin,
          receiptLineType,
          RECEIPT_LINE_SCAN_PAGE_SIZE,
          after,
          query,
        );
        pagesScanned += 1;
        for (const node of connection.nodes) {
          const line = toLine(node);
          if (line.receiptGid === receiptGid) {
            lines.push(line);
          }
        }
        if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
          break;
        }
        after = connection.pageInfo.endCursor;
      }
      if (lines.length > 0) {
        return lines;
      }
    } catch (error) {
      lastQueryError = error;
      debugLog("receipt lines lookup query failed", {
        receiptLineType,
        receiptGid,
        prestaOrderId,
        query,
        reason: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }
  }
  if (lastQueryError) {
    throw lastQueryError;
  }
  return [];
}

async function listReceiptLinesForReceiptViaScan(
  admin: AdminClient,
  receiptLineType: string,
  receiptGid: string,
): Promise<ReceiptLineView[]> {
  const lines: ReceiptLineView[] = [];
  let after: string | null = null;
  let pagesScanned = 0;

  while (pagesScanned < RECEIPT_LINE_SCAN_MAX_PAGES) {
    const connection = await listMetaobjectsConnection(admin, receiptLineType, RECEIPT_LINE_SCAN_PAGE_SIZE, after);
    pagesScanned += 1;
    for (const node of connection.nodes) {
      const line = toLine(node);
      if (line.receiptGid === receiptGid) {
        lines.push(line);
      }
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  if (pagesScanned >= RECEIPT_LINE_SCAN_MAX_PAGES) {
    debugLog("receipt lines scan capped", {
      receiptGid,
      pagesScanned,
      maxPages: RECEIPT_LINE_SCAN_MAX_PAGES,
      matches: lines.length,
    });
  }

  return lines;
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

export function classifyExistingReceiptForImport(
  existing: { receipt: { prestaOrderId: number }; duplicateBy: "id" | "reference" } | null,
  incomingOrderId: number,
): "none" | "duplicate_by_id" | "reference_collision_non_blocking" {
  if (!existing) return "none";
  if (existing.receipt.prestaOrderId === incomingOrderId) return "duplicate_by_id";
  if (existing.duplicateBy === "reference" && existing.receipt.prestaOrderId !== incomingOrderId) {
    return "reference_collision_non_blocking";
  }
  return "none";
}

async function upsertReceiptLines(
  admin: AdminClient,
  receiptLineType: string,
  receiptGid: string,
  orderId: number,
  lines: Array<
    PrestaOrderLine & {
      status: LineStatus;
      inventoryItemGid: string;
      error: string;
    }
  >,
): Promise<ReceiptLineView[]> {
  const lineIds = await Promise.all(
    lines.map((line, idx) =>
      upsertMetaobjectByHandle(admin, receiptLineType, lineHandle(orderId, idx, line.sku), [
        { key: "receipt_gid", value: receiptGid },
        { key: "sku", value: line.sku },
        { key: "qty", value: String(line.qty) },
        { key: "status", value: line.status },
        { key: "inventory_item_gid", value: line.inventoryItemGid },
        { key: "error", value: line.error },
      ]),
    ),
  );
  return lines.map((line, idx) => ({
    gid: lineIds[idx] ?? "",
    receiptGid,
    sku: line.sku,
    qty: line.qty,
    status: line.status,
    inventoryItemGid: line.inventoryItemGid,
    error: line.error,
  }));
}

function hasBlockingErrors(errors: Record<string, string>): boolean {
  return Object.keys(errors).some((key) => !key.startsWith("__warning"));
}

async function resolveReceiptLinesForImport(
  admin: AdminClient,
  lines: PrestaOrderLine[],
  baseErrors: Record<string, string>,
): Promise<{
  status: ReceiptStatus;
  errors: Record<string, string>;
  resolvedLines: Array<
    PrestaOrderLine & {
      status: LineStatus;
      inventoryItemGid: string;
      error: string;
    }
  >;
}> {
  const errors: Record<string, string> = { ...baseErrors };
  const uniqueSkus = Array.from(new Set(lines.map((line) => line.sku).filter(Boolean)));
  const resolved = await resolveSkus(admin, uniqueSkus);

  const resolvedLines = lines.map((line) => {
    if (line.qty <= 0) {
      const message = "Quantité invalide: valeur attendue strictement positive";
      errors[line.sku] = message;
      return {
        ...line,
        status: "MISSING" as const,
        inventoryItemGid: "",
        error: message,
      };
    }

    const match = resolved.get(line.sku);
    if (!match) {
      const message = "SKU introuvable dans Shopify";
      errors[line.sku] = message;
      return {
        ...line,
        status: "MISSING" as const,
        inventoryItemGid: "",
        error: message,
      };
    }

    return {
      ...line,
      status: "RESOLVED" as const,
      inventoryItemGid: match.inventoryItemId,
      error: "",
    };
  });

  return {
    status: hasBlockingErrors(errors) ? "BLOCKED" : "READY",
    errors,
    resolvedLines,
  };
}

async function loadOrderDetailsWithRetry(orderId: number): Promise<PrestaOrderLine[]> {
  for (let attempt = 1; attempt <= PRESTA_ORDER_DETAILS_RETRY_ATTEMPTS; attempt += 1) {
    const lines = await getOrderDetails(orderId);
    if (lines.length > 0) {
      if (attempt > 1) {
        debugLog("presta order lines recovered after retry", { orderId, attempt, lines: lines.length });
      }
      return lines;
    }
    debugLog("presta order lines empty", { orderId, attempt });
    if (attempt < PRESTA_ORDER_DETAILS_RETRY_ATTEMPTS) {
      await sleep(PRESTA_ORDER_DETAILS_RETRY_DELAY_MS * attempt);
    }
  }
  return [];
}

async function hydrateReceiptLinesIfMissing(
  admin: AdminClient,
  types: { receipt: string; receiptLine: string },
  receiptGid: string,
  order: PrestaOrder,
): Promise<ReceiptLineView[]> {
  const existingLines = await listReceiptLinesForReceipt(admin, types.receiptLine, receiptGid, order.id);
  if (existingLines.length > 0) {
    return existingLines;
  }

  const recoveredLines = await loadOrderDetailsWithRetry(order.id);
  if (!recoveredLines.length) {
    throw new Error(
      `Commande Presta ${order.id}: aucune ligne produit r?cup?r?e. V?rifiez l'API Presta /api/order_details.`,
    );
  }

  const receiptNode = await getMetaobjectById(admin, receiptGid);
  const previousErrors = receiptNode ? parseJsonMap(fieldValue(receiptNode, "errors")) : {};
  const warningsOnly = Object.fromEntries(
    Object.entries(previousErrors).filter(([key]) => key.startsWith("__warning")),
  );
  const resolvedImport = await resolveReceiptLinesForImport(admin, recoveredLines, warningsOnly);
  const hydratedLines = await upsertReceiptLines(
    admin,
    types.receiptLine,
    receiptGid,
    order.id,
    resolvedImport.resolvedLines,
  );

  if (receiptNode) {
    const currentStatus = (fieldValue(receiptNode, "status") || "IMPORTED") as ReceiptStatus;
    if (currentStatus !== "APPLIED" && currentStatus !== "INCOMING" && currentStatus !== "ROLLED_BACK") {
      await updateMetaobject(admin, receiptGid, [
        { key: "status", value: resolvedImport.status },
        { key: "errors", value: JSON.stringify(resolvedImport.errors) },
      ]);
    }
  }

  debugLog("receipt lines hydrated", {
    receiptGid,
    prestaOrderId: order.id,
    lines: recoveredLines.length,
    status: resolvedImport.status,
  });
  return hydratedLines;
}

async function ensureReceiptImported(
  admin: AdminClient,
  shopDomain: string,
  order: PrestaOrder,
  locationId: string,
): Promise<ImportDecision> {
  const types = await getMetaTypes(admin);
  const existing = await getExistingReceiptForOrder(admin, shopDomain, order);
  const existingDecision = classifyExistingReceiptForImport(existing, order.id);
  if (existingDecision === "duplicate_by_id" && existing) {
    if (!existing.receipt.locationId) {
      await updateMetaobject(admin, existing.receipt.gid, [{ key: "location_id", value: locationId }]);
    }
    return { action: "skip", reason: "duplicate_by_id", receiptGid: existing.receipt.gid };
  }
  if (existingDecision === "reference_collision_non_blocking" && existing) {
    debugLog("presta import reference collision", {
      prestaOrderId: order.id,
      reference: order.reference,
      existingReceiptGid: existing.receipt.gid,
      existingPrestaOrderId: existing.receipt.prestaOrderId,
      decision: "continue_import_by_id",
    });
  }

  const addDate = toShopifyDateTime(order.dateAdd);
  const updDate = toShopifyDateTime(order.dateUpd);
  const importWarnings: Record<string, string> = {};
  if (!addDate && order.dateAdd) importWarnings.__warning_presta_date_add = `Date invalide ignor?e: ${order.dateAdd}`;
  if (!updDate && order.dateUpd) importWarnings.__warning_presta_date_upd = `Date invalide ignor?e: ${order.dateUpd}`;
  const lines = await loadOrderDetailsWithRetry(order.id);
  if (!lines.length) {
    throw new Error(
      `Commande Presta ${order.id}: aucune ligne produit r?cup?r?e. V?rifiez l'API Presta /api/order_details.`,
    );
  }
  debugLog("presta order lines fetched", { prestaOrderId: order.id, lines: lines.length });
  const resolvedImport = await resolveReceiptLinesForImport(admin, lines, importWarnings);

  const receiptFields = [
    { key: "presta_order_id", value: String(order.id) },
    { key: "presta_reference", value: order.reference },
    { key: "status", value: resolvedImport.status },
    { key: "location_id", value: locationId },
    { key: "skipped_skus", value: "[]" },
    { key: "errors", value: JSON.stringify(resolvedImport.errors) },
    { key: "applied_adjustment_gid", value: "" },
  ];
  if (addDate) receiptFields.push({ key: "presta_date_add", value: addDate });
  if (updDate) receiptFields.push({ key: "presta_date_upd", value: updDate });

  const receiptId = await upsertMetaobjectByHandle(admin, types.receipt, receiptHandle(order.id), receiptFields);
  await upsertReceiptLines(admin, types.receiptLine, receiptId, order.id, resolvedImport.resolvedLines);
  return { action: "import", reason: "new", receiptGid: receiptId };
}

export function computePrestaSinceId(currentCursor: number): number {
  if (!Number.isFinite(currentCursor) || currentCursor <= 0) return 0;
  return Math.max(0, Math.floor(currentCursor));
}

const SYNC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type ManualSyncDayRange = {
  day: string;
  updatedAtMin: string;
  updatedAtMax: string;
};

export function resolveManualSyncDayRange(syncDayRaw?: string | null): ManualSyncDayRange | null {
  const day = String(syncDayRaw ?? "").trim();
  if (!day) return null;
  if (!SYNC_DAY_PATTERN.test(day)) {
    throw new Error("Date de synchronisation invalide. Format attendu: AAAA-MM-JJ.");
  }
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed) || formatPrestaDateTime(new Date(parsed)).slice(0, 10) !== day) {
    throw new Error("Date de synchronisation invalide.");
  }
  return {
    day,
    updatedAtMin: `${day} 00:00:00`,
    updatedAtMax: `${day} 23:59:59`,
  };
}

export function isOrderOlderThanOrEqualCursor(orderId: number, effectiveSinceId: number): boolean {
  if (!Number.isFinite(orderId) || orderId <= 0) return false;
  if (!Number.isFinite(effectiveSinceId) || effectiveSinceId <= 0) return false;
  return orderId <= effectiveSinceId;
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
  options: {
    syncDay?: string | null;
  } = {},
) {
  const startedAt = Date.now();
  const manualDayRange = resolveManualSyncDayRange(options.syncDay);
  const isManualDayMode = Boolean(manualDayRange);
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const boutique = await resolveBoutiqueContext(admin, locationId);
  const syncState = await getSyncState(admin);
  const runUpperBound = manualDayRange?.updatedAtMax ?? formatPrestaDateTime(new Date());
  const hasStoredCursor = hasOwnRecordKey(syncState.cursorByLocation as Record<string, unknown>, boutique.locationId);
  const hasStoredCheckpoint = hasOwnRecordKey(
    syncState.prestaCheckpointByLocation as Record<string, unknown>,
    boutique.locationId,
  );
  const rawCheckpoint = normalizePrestaCheckpoint(syncState.prestaCheckpointByLocation[boutique.locationId]);
  const checkpointMissing = shouldBootstrapCheckpoint(hasStoredCheckpoint, rawCheckpoint);
  const checkpointStale = !checkpointMissing &&
    isCheckpointStaleForBootstrap(rawCheckpoint, runUpperBound, PRESTA_STALE_CHECKPOINT_MAX_AGE_DAYS);
  const shouldBootstrapCheckpointState = checkpointMissing || checkpointStale;
  let currentCursor = syncState.cursorByLocation[boutique.locationId] ?? 0;
  let cursorBootstrapSource: CursorBootstrapSource = "none";
  let legacyGlobalCursor = 0;
  let receiptsCursor = 0;
  let latestPrestaHeadCursor = 0;

  if (!isManualDayMode && (!hasStoredCursor || currentCursor <= 0 || shouldBootstrapCheckpointState)) {
    legacyGlobalCursor = await getLastPrestaOrderId(admin).catch(() => 0);
    if (legacyGlobalCursor <= 0) {
      const types = await getMetaTypes(admin);
      const receipts = (await listMetaobjects(admin, types.receipt)).map(toReceipt);
      receiptsCursor = maxImportedOrderIdForLocation(receipts, boutique.locationId, boutique.locationName);
      const latestOrders = await listOrders({
        customerId: boutique.prestaCustomerId,
        sinceId: 0,
        offset: 0,
        limit: 1,
        sortKey: "id",
        sortDirection: "DESC",
      });
      latestPrestaHeadCursor = latestOrders[0]?.id ?? 0;
    }
    const bootstrap = resolveCursorBootstrap({
      hasStoredCursor: hasStoredCursor && !shouldBootstrapCheckpointState,
      currentCursor,
      legacyGlobalCursor,
      receiptsCursor,
      latestPrestaHeadCursor,
    });
    currentCursor = bootstrap.cursor;
    cursorBootstrapSource = bootstrap.source;
  }

  const effectiveSinceId = computePrestaSinceId(currentCursor);
  const bootstrapCheckpoint: PrestaCheckpoint = {
    dateUpd: computeCheckpointLookbackStart({ dateUpd: runUpperBound, orderId: 0 }, PRESTA_BOOTSTRAP_LOOKBACK_MINUTES),
    orderId: 0,
  };
  const currentCheckpoint = manualDayRange
    ? { dateUpd: manualDayRange.updatedAtMin, orderId: 0 }
    : shouldBootstrapCheckpointState
    ? bootstrapCheckpoint
    : clampCheckpointToUpperBound(rawCheckpoint, runUpperBound);
  let nextCheckpoint = currentCheckpoint;
  const dateLookbackStart = manualDayRange?.updatedAtMin ??
    computeCheckpointLookbackStart(currentCheckpoint, PRESTA_DATE_LOOKBACK_MINUTES);
  const { dateScanReserve, idScanBudget } = computeSyncScanBudgets(env.syncMaxPerRun);
  debugLog("sync start", {
    manual,
    syncDay: manualDayRange?.day ?? null,
    mode: isManualDayMode ? "manual_day" : "default",
    locationId: boutique.locationId,
    prestaCustomerId: boutique.prestaCustomerId,
    cursorBootstrapSource,
    currentCursor,
    effectiveSinceId,
    checkpointMissing,
    checkpointStale,
    shouldBootstrapCheckpointState,
    bootstrapCheckpoint,
    currentCheckpoint,
    dateLookbackStart,
    runUpperBound,
    idScanBudget,
    dateScanReserve,
  });
  let imported = 0;
  let scanned = 0;
  let maxId = currentCursor;
  const pageSize = Math.min(env.syncBatchSize, 50);

  let idScanned = 0;
  let idImported = 0;
  let idOffset = 0;
  if (!isManualDayMode) {
    while (idScanned < idScanBudget) {
      const requestedLimit = Math.min(pageSize, idScanBudget - idScanned);
      const ordersInput: ListOrdersInput = {
        customerId: boutique.prestaCustomerId,
        sinceId: effectiveSinceId,
        offset: idOffset,
        limit: requestedLimit,
        sortKey: "id",
        sortDirection: "ASC",
      };
      const orders = await listOrders(ordersInput);
      if (!orders.length) break;
      for (const order of orders) {
        const decision = await ensureReceiptImported(admin, shopDomain, order, boutique.locationId);
        scanned += 1;
        idScanned += 1;
        if (decision.action === "import") {
          imported += 1;
          idImported += 1;
        }
        debugLog("presta sync order decision", {
          id_order: order.id,
          reference: order.reference,
          id_customer: order.customerId,
          current_state: order.currentState,
          date_add: order.dateAdd,
          date_upd: order.dateUpd,
          decision: decision.action,
          reason: decision.reason,
          receiptGid: decision.receiptGid,
          pass: "id_cursor",
        });
        maxId = Math.max(maxId, order.id);
        if (idScanned >= idScanBudget) break;
      }
      idOffset += orders.length;
      if (orders.length < requestedLimit) break;
    }
  } else {
    debugLog("presta sync id pass skipped", {
      locationId: boutique.locationId,
      reason: "manual_day_filter",
      syncDay: manualDayRange?.day ?? null,
    });
  }

  let dateScanned = 0;
  let dateImported = 0;
  let dateOffset = 0;
  let runBudgetUsed = scanned;
  while (runBudgetUsed < env.syncMaxPerRun) {
    const requestedLimit = Math.min(pageSize, env.syncMaxPerRun - runBudgetUsed);
    const orders = await listOrders({
      customerId: boutique.prestaCustomerId,
      updatedAtMin: dateLookbackStart,
      updatedAtMax: runUpperBound,
      offset: dateOffset,
      limit: requestedLimit,
      sortKey: "date_upd",
      sortDirection: "ASC",
    });
    if (!orders.length) break;
    for (const order of orders) {
      if (!isManualDayMode && isOrderOlderThanOrEqualCursor(order.id, effectiveSinceId)) {
        debugLog("presta sync order decision", {
          id_order: order.id,
          reference: order.reference,
          id_customer: order.customerId,
          current_state: order.currentState,
          date_add: order.dateAdd,
          date_upd: order.dateUpd,
          decision: "skip",
          reason: "older_than_or_equal_cursor",
          pass: "date_watermark",
        });
        continue;
      }
      if (!isOrderAfterCheckpoint(order.dateUpd, order.id, nextCheckpoint)) {
        debugLog("presta sync order decision", {
          id_order: order.id,
          reference: order.reference,
          id_customer: order.customerId,
          current_state: order.currentState,
          date_add: order.dateAdd,
          date_upd: order.dateUpd,
          decision: "skip",
          reason: "checkpoint_already_seen",
          pass: "date_watermark",
        });
        continue;
      }
      const decision = await ensureReceiptImported(admin, shopDomain, order, boutique.locationId);
      scanned += 1;
      dateScanned += 1;
      const consumeBudget = !isManualDayMode || decision.action === "import";
      if (consumeBudget) {
        runBudgetUsed += 1;
      }
      if (decision.action === "import") {
        imported += 1;
        dateImported += 1;
      }
      const candidateCheckpoint = checkpointFromOrder(order);
      if (candidateCheckpoint) {
        nextCheckpoint = maxPrestaCheckpoint(nextCheckpoint, candidateCheckpoint);
      }
      debugLog("presta sync order decision", {
        id_order: order.id,
        reference: order.reference,
        id_customer: order.customerId,
        current_state: order.currentState,
        date_add: order.dateAdd,
        date_upd: order.dateUpd,
        decision: decision.action,
        reason: decision.reason,
        receiptGid: decision.receiptGid,
        pass: "date_watermark",
        consumeBudget,
        runBudgetUsed,
      });
      maxId = Math.max(maxId, order.id);
      if (runBudgetUsed >= env.syncMaxPerRun) break;
    }
    dateOffset += orders.length;
    if (orders.length < requestedLimit) break;
  }

  const nextCursorMap = { ...syncState.cursorByLocation };
  if (!isManualDayMode) {
    nextCursorMap[boutique.locationId] = Math.max(currentCursor, maxId);
  }
  const nextCheckpointMap = { ...syncState.prestaCheckpointByLocation };
  if (!isManualDayMode) {
    nextCheckpointMap[boutique.locationId] = comparePrestaCheckpoint(nextCheckpoint, currentCheckpoint) >= 0
      ? nextCheckpoint
      : currentCheckpoint;
  }
  const nextLastSyncMap = {
    ...syncState.lastSyncAtByLocation,
    [boutique.locationId]: new Date().toISOString(),
  };
  await setSyncState(admin, {
    selectedLocationId: boutique.locationId,
    cursorByLocation: nextCursorMap,
    lastSyncAtByLocation: nextLastSyncMap,
    prestaCheckpointByLocation: nextCheckpointMap,
  });
  debugLog("sync done", {
    imported,
    scanned,
    mode: isManualDayMode ? "manual_day" : "default",
    syncDay: manualDayRange?.day ?? null,
    importedByIdScan: idImported,
    scannedByIdScan: idScanned,
    importedByDateScan: dateImported,
    scannedByDateScan: dateScanned,
    effectiveSinceId,
    dateLookbackStart,
    runUpperBound,
    currentCheckpoint,
    nextCheckpoint: nextCheckpointMap[boutique.locationId] ?? syncState.prestaCheckpointByLocation[boutique.locationId] ?? null,
    lastPrestaOrderId: nextCursorMap[boutique.locationId] ?? currentCursor,
    locationId: boutique.locationId,
    elapsedMs: elapsedMs(startedAt),
  });
  return {
    imported,
    syncDay: manualDayRange?.day ?? null,
    lastPrestaOrderId: nextCursorMap[boutique.locationId] ?? currentCursor,
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
    throw new Error("Commande trouv?e mais n'appartient pas ? Prestashop BtoB.");
  }
  const existing = await getExistingReceiptForOrder(admin, shopDomain, order);
  if (existing && isStrictDuplicateForOrder(existing, order.id)) {
    const types = await getMetaTypes(admin);
    await hydrateReceiptLinesIfMissing(admin, types, existing.receipt.gid, order);
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
  const importDecision = await ensureReceiptImported(admin, shopDomain, order, boutique.locationId);
  if (importDecision.action === "skip") {
    const syncState = await getSyncState(admin);
    const lastPrestaOrderId = syncState.cursorByLocation[boutique.locationId] ?? 0;
    return {
      created: false,
      receiptGid: importDecision.receiptGid,
      duplicateBy: "id",
      lastPrestaOrderId,
    };
  }
  const syncState = await getSyncState(admin);
  const currentCursor = syncState.cursorByLocation[boutique.locationId] ?? 0;
  const nextCursorMap = { ...syncState.cursorByLocation };
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
    receiptGid: importDecision.receiptGid,
    locationId: boutique.locationId,
    currentCursor,
    lastPrestaOrderId: currentCursor,
  });
  return {
    created: true,
    receiptGid: importDecision.receiptGid,
    duplicateBy: null,
    lastPrestaOrderId: currentCursor,
    locationId: boutique.locationId,
    lastSyncAt: nextLastSyncMap[boutique.locationId],
  };
}

export async function debugEvaluatePrestaOrders(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId: string;
    limit: number;
    offset: number;
    sinceId?: number;
    updatedAtMin?: string;
    updatedAtMax?: string;
    sortKey?: "id" | "date_upd";
    sortDirection?: "ASC" | "DESC";
  },
) {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const boutique = await resolveBoutiqueContext(admin, input.locationId);
  const syncState = await getSyncState(admin);
  const currentCursor = syncState.cursorByLocation[boutique.locationId] ?? 0;
  const currentCheckpoint = clampCheckpointToUpperBound(
    normalizePrestaCheckpoint(syncState.prestaCheckpointByLocation[boutique.locationId]),
    formatPrestaDateTime(new Date()),
  );
  const effectiveSinceId = Math.max(0, input.sinceId ?? computePrestaSinceId(currentCursor));
  const effectiveUpdatedAtMin = input.updatedAtMin?.trim() || computeCheckpointLookbackStart(
    currentCheckpoint,
    PRESTA_DATE_LOOKBACK_MINUTES,
  );
  const effectiveUpdatedAtMax = input.updatedAtMax?.trim() || formatPrestaDateTime(new Date());
  const effectiveSortKey = input.sortKey ?? (input.updatedAtMin || input.updatedAtMax ? "date_upd" : "id");
  const ordersInput: ListOrdersInput = {
    customerId: boutique.prestaCustomerId,
    offset: Math.max(0, input.offset),
    limit: Math.max(1, Math.min(250, input.limit)),
    sortKey: effectiveSortKey,
    sortDirection: input.sortDirection ?? "DESC",
  };
  if (effectiveSortKey === "date_upd") {
    ordersInput.updatedAtMin = effectiveUpdatedAtMin;
    ordersInput.updatedAtMax = effectiveUpdatedAtMax;
  } else {
    ordersInput.sinceId = effectiveSinceId;
  }
  const orders = await listOrders(ordersInput);

  const types = await getMetaTypes(admin);
  const receipts = (await listMetaobjects(admin, types.receipt)).map(toReceipt);
  const decisions = orders.map((order) => {
    if (isOrderOlderThanOrEqualCursor(order.id, effectiveSinceId)) {
      return {
        id_order: order.id,
        reference: order.reference,
        id_customer: order.customerId,
        current_state: order.currentState,
        date_add: order.dateAdd,
        date_upd: order.dateUpd,
        decision: "skip",
        reason: "older_than_or_equal_cursor",
      };
    }
    if (!isOrderAfterCheckpoint(order.dateUpd, order.id, currentCheckpoint)) {
      return {
        id_order: order.id,
        reference: order.reference,
        id_customer: order.customerId,
        current_state: order.currentState,
        date_add: order.dateAdd,
        date_upd: order.dateUpd,
        decision: "skip",
        reason: "checkpoint_already_seen",
      };
    }
    const existing = findExistingReceiptByOrder(receipts, order.id, order.reference);
    const existingDecision = classifyExistingReceiptForImport(existing, order.id);
    if (existingDecision === "duplicate_by_id") {
      return {
        id_order: order.id,
        reference: order.reference,
        id_customer: order.customerId,
        current_state: order.currentState,
        date_add: order.dateAdd,
        date_upd: order.dateUpd,
        decision: "skip",
        reason: "duplicate_by_id",
      };
    }
    if (existingDecision === "reference_collision_non_blocking") {
      return {
        id_order: order.id,
        reference: order.reference,
        id_customer: order.customerId,
        current_state: order.currentState,
        date_add: order.dateAdd,
        date_upd: order.dateUpd,
        decision: "import",
        reason: "reference_collision_ignored_import_by_id",
      };
    }
    return {
      id_order: order.id,
      reference: order.reference,
      id_customer: order.customerId,
      current_state: order.currentState,
      date_add: order.dateAdd,
      date_upd: order.dateUpd,
      decision: "import",
      reason: "new",
    };
  });

  return {
    customerId: boutique.prestaCustomerId,
    currentCursor,
    currentCheckpoint,
    effectiveSinceId,
    effectiveUpdatedAtMin,
    effectiveUpdatedAtMax,
    effectiveSortKey,
    total: orders.length,
    decisions,
  };
}

export async function purgeLocationReceiptsForDebug(
  admin: AdminClient,
  shopDomain: string,
  locationId: string,
) {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const boutique = await resolveBoutiqueContext(admin, locationId);
  const types = await getMetaTypes(admin);
  const receipts = (await listMetaobjects(admin, types.receipt)).map(toReceipt);
  const lines = (await listMetaobjects(admin, types.receiptLine)).map(toLine);
  const includeLegacyUnassigned = isDefaultLocationName(boutique.locationName);
  const receiptsToDelete = receipts.filter(
    (receipt) =>
      receipt.locationId === boutique.locationId ||
      (includeLegacyUnassigned && !receipt.locationId),
  );
  const receiptIds = new Set(receiptsToDelete.map((receipt) => receipt.gid));
  const linesToDelete = lines.filter((line) => receiptIds.has(line.receiptGid));

  for (const line of linesToDelete) {
    await deleteMetaobject(admin, line.gid);
  }
  for (const receipt of receiptsToDelete) {
    await deleteMetaobject(admin, receipt.gid);
  }

  const latestOrders = await listOrders({
    customerId: boutique.prestaCustomerId,
    sinceId: 0,
    offset: 0,
    limit: 1,
    sortKey: "id",
    sortDirection: "DESC",
  });
  const latestPrestaOrderId = latestOrders[0]?.id ?? 0;
  const syncState = await getSyncState(admin);
  const nowIso = new Date().toISOString();
  const nowPresta = formatPrestaDateTime(new Date());
  const nextCursorByLocation = {
    ...syncState.cursorByLocation,
    [boutique.locationId]: latestPrestaOrderId,
  };
  const nextCheckpointByLocation = {
    ...syncState.prestaCheckpointByLocation,
    [boutique.locationId]: { dateUpd: nowPresta, orderId: latestPrestaOrderId },
  };
  const nextLastSyncMap = {
    ...syncState.lastSyncAtByLocation,
    [boutique.locationId]: nowIso,
  };
  await setSyncState(admin, {
    selectedLocationId: boutique.locationId,
    cursorByLocation: nextCursorByLocation,
    prestaCheckpointByLocation: nextCheckpointByLocation,
    lastSyncAtByLocation: nextLastSyncMap,
  });

  debugLog("debug purge receipts done", {
    shop: shopDomain,
    locationId: boutique.locationId,
    deletedReceipts: receiptsToDelete.length,
    deletedLines: linesToDelete.length,
    latestPrestaOrderId,
    checkpoint: nextCheckpointByLocation[boutique.locationId],
  });

  return {
    locationId: boutique.locationId,
    deletedReceipts: receiptsToDelete.length,
    deletedLines: linesToDelete.length,
    lastPrestaOrderId: latestPrestaOrderId,
    checkpoint: nextCheckpointByLocation[boutique.locationId],
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

async function autoResolveImportedReceiptIfNeeded(
  admin: AdminClient,
  receipt: ReceiptView,
  lines: ReceiptLineView[],
): Promise<{ receipt: ReceiptView; lines: ReceiptLineView[] }> {
  if (receipt.status !== "IMPORTED" || lines.length === 0) {
    return { receipt, lines };
  }

  const warningsOnly = Object.fromEntries(
    Object.entries(receipt.errors).filter(([key]) => key.startsWith("__warning")),
  );
  const resolvedImport = await resolveReceiptLinesForImport(
    admin,
    lines.map((line) => ({ sku: line.sku, qty: line.qty })),
    warningsOnly,
  );

  await Promise.all(
    lines.map((line, idx) => {
      const resolvedLine = resolvedImport.resolvedLines[idx];
      return updateMetaobject(admin, line.gid, [
        { key: "status", value: resolvedLine.status },
        { key: "inventory_item_gid", value: resolvedLine.inventoryItemGid },
        { key: "error", value: resolvedLine.error },
      ]);
    }),
  );
  await updateMetaobject(admin, receipt.gid, [
    { key: "status", value: resolvedImport.status },
    { key: "errors", value: JSON.stringify(resolvedImport.errors) },
  ]);

  debugLog("receipt auto-resolved on read", {
    receiptGid: receipt.gid,
    prestaOrderId: receipt.prestaOrderId,
    lines: lines.length,
    status: resolvedImport.status,
  });

  const nextLines = lines.map((line, idx) => {
    const resolvedLine = resolvedImport.resolvedLines[idx];
    return {
      ...line,
      status: resolvedLine.status,
      inventoryItemGid: resolvedLine.inventoryItemGid,
      error: resolvedLine.error,
    };
  });
  const nextReceipt: ReceiptView = {
    ...receipt,
    status: resolvedImport.status,
    errors: resolvedImport.errors,
  };
  return { receipt: nextReceipt, lines: nextLines };
}

export async function getReceiptDetail(admin: AdminClient, shopDomain: string, receiptGid: string) {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const receiptNode = await getMetaobjectById(admin, receiptGid);
  if (!receiptNode || receiptNode.type !== types.receipt) throw new Error("Commande introuvable");
  let receipt = toReceipt(receiptNode);

  let lines = await listReceiptLinesForReceipt(admin, types.receiptLine, receiptGid, receipt.prestaOrderId);
  if (lines.length === 0 && receipt.prestaOrderId > 0) {
    try {
      const order = await getOrderById(receipt.prestaOrderId);
      if (order) {
        lines = await hydrateReceiptLinesIfMissing(admin, types, receiptGid, order);
        const refreshedReceiptNode = await getMetaobjectById(admin, receiptGid);
        if (refreshedReceiptNode && refreshedReceiptNode.type === types.receipt) {
          receipt = toReceipt(refreshedReceiptNode);
        }
      }
    } catch (error) {
      debugLog("receipt lines hydration on read failed", {
        receiptGid,
        prestaOrderId: receipt.prestaOrderId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new Error(
        `Impossible de r?cup?rer les lignes Presta pour la commande ${receipt.prestaOrderId}: ${
          error instanceof Error ? error.message : "erreur inconnue"
        }`,
      );
    }
  }
  const autoResolved = await autoResolveImportedReceiptIfNeeded(admin, receipt, lines);
  return autoResolved;
}

export async function getSkuDiagnosticsForLines(
  admin: AdminClient,
  lines: Array<Pick<ReceiptLineView, "sku">>,
): Promise<SkuDiagnostic[]> {
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

export async function getSkuDiagnostics(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
): Promise<SkuDiagnostic[]> {
  const { lines } = await getReceiptDetail(admin, shopDomain, receiptGid);
  return getSkuDiagnosticsForLines(admin, lines);
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
    actor?: string;
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
    if (receipt.status === "APPLIED") throw new Error("Cette réception a déjà été validée.");
    const alreadyIncoming = receipt.status === "INCOMING";
    if (!receipt.locationId) {
      throw new Error("La boutique de la réception est absente. Relancez la préparation de la réception.");
    }
    assertReceiptLocationMatch(receipt.locationId, boutique.locationId);
    if (!alreadyIncoming && !canApplyFromStatus(receipt.status)) {
      throw new Error("Diagnostic obligatoire: corrigez les SKU pour passer la réception en statut prête.");
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
      throw new Error("Aucune ligne applicable. Ajustez les SKU ou retirez les lignes ignor?es.");
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
      throw new Error("Aucune ligne valide à mettre en arrivage.");
    }
    const restockOrder = await upsertIncomingPurchaseOrderFromPrestaOrder(admin, shopDomain, {
      prestaOrderId: detail.receipt.prestaOrderId,
      prestaReference: detail.receipt.prestaReference,
      destinationLocationId: boutique.locationId,
      actor: input.actor || shopDomain,
      lines: aggregated.map((line) => ({
        sku: line.sku,
        quantity: line.delta,
      })),
      supplierNotes: `Réassort magasin généré automatiquement depuis la commande PrestaShop #${detail.receipt.prestaOrderId}.`,
      internalNotes: `Lien réception: ${detail.receipt.gid}`,
    });

    debugLog("incoming receipt validation", {
      receiptGid: detail.receipt.gid,
      locationId: boutique.locationId,
      incomingSkus: aggregated.map((line) => line.sku),
      incomingCount: aggregated.length,
      restockOrderNumber: restockOrder.number,
      restockOrderCreated: restockOrder.created,
    });

    if (alreadyIncoming && detail.receipt.appliedAdjustmentGid) {
      return {
        restockOrderId: restockOrder.purchaseOrderGid,
        restockOrderNumber: restockOrder.number,
        restockStatus: restockOrder.status,
        restockCreated: restockOrder.created,
      };
    }

    const adjustmentGid = await upsertMetaobjectByHandle(
      admin,
      types.adjustment,
      `adjustment-${detail.receipt.prestaOrderId}-${Date.now()}`,
      [
        { key: "receipt_gid", value: detail.receipt.gid },
        { key: "location_id", value: boutique.locationId },
        { key: "status", value: "INCOMING" },
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
      { key: "status", value: "INCOMING" },
      { key: "location_id", value: boutique.locationId },
      { key: "applied_adjustment_gid", value: adjustmentGid },
    ]);
    debugLog("incoming receipt done", {
      shop: shopDomain,
      receiptGid: detail.receipt.gid,
      locationId: boutique.locationId,
      incomingLines: aggregated.length,
      stockMutation: "none",
      restockOrderNumber: restockOrder.number,
      elapsedMs: elapsedMs(startedAt),
    });

    return {
      restockOrderId: restockOrder.purchaseOrderGid,
      restockOrderNumber: restockOrder.number,
      restockStatus: restockOrder.status,
      restockCreated: restockOrder.created,
    };
  });
}

export async function receiveReceipt(
  admin: AdminClient,
  shopDomain: string,
  input: {
    receiptGid: string;
    locationId: string;
    confirmed: boolean;
  },
) {
  return withReceiptOpLock(shopDomain, input.receiptGid, "receive", async () => {
    const startedAt = Date.now();
    const types = await getMetaTypes(admin);
    const boutique = await resolveBoutiqueContext(admin, input.locationId);
    if (!input.confirmed) {
      throw new Error("Confirmation obligatoire.");
    }

    const { receipt } = await getReceiptDetail(admin, shopDomain, input.receiptGid);
    if (!receipt.locationId) {
      throw new Error("La boutique de la réception est absente.");
    }
    assertReceiptLocationMatch(receipt.locationId, boutique.locationId);
    if (!canReceiveFromStatus(receipt.status)) {
      throw new Error("Validation impossible: la réception n'est pas en cours d'arrivage.");
    }
    if (!receipt.appliedAdjustmentGid) {
      throw new Error("Aucun arrivage en cours n'a été trouvé pour cette réception.");
    }

    const adjustmentNode = await getMetaobjectById(admin, receipt.appliedAdjustmentGid);
    if (!adjustmentNode || adjustmentNode.type !== types.adjustment) {
      throw new Error("Arrivage introuvable.");
    }
    if (fieldValue(adjustmentNode, "status") !== "INCOMING") {
      throw new Error("Arrivage incohérent: statut inattendu.");
    }
    if (fieldValue(adjustmentNode, "receipt_gid") !== receipt.gid) {
      throw new Error("Arrivage incohérent pour cette réception.");
    }
    const adjustmentLocationId = fieldValue(adjustmentNode, "location_id");
    if (!isShopifyGid(adjustmentLocationId)) {
      throw new Error("Identifiant de boutique invalide sur l'arrivage.");
    }
    assertReceiptLocationMatch(receipt.locationId, adjustmentLocationId);

    const adjustmentLines = (await listMetaobjects(admin, types.adjustmentLine))
      .filter((node) => fieldValue(node, "adjustment_gid") === receipt.appliedAdjustmentGid)
      .map((node) => ({
        sku: fieldValue(node, "sku"),
        inventoryItemId: fieldValue(node, "inventory_item_gid"),
        qtyDelta: toNumber(fieldValue(node, "qty_delta")),
      }));
    if (!adjustmentLines.length) {
      throw new Error("Aucune ligne d'arrivage à valider.");
    }
    const invalidLines = adjustmentLines.filter((line) => !isShopifyGid(line.inventoryItemId) || line.qtyDelta <= 0);
    if (invalidLines.length) {
      throw new Error("Lignes d'arrivage invalides.");
    }

    debugLog("receive receipt validation", {
      receiptGid: receipt.gid,
      locationId: adjustmentLocationId,
      receiveSkus: adjustmentLines.map((line) => line.sku),
      receiveCount: adjustmentLines.length,
    });

    await inventoryAdjustQuantities(
      admin,
      adjustmentLocationId,
      adjustmentLines.map((line) => ({ inventoryItemId: line.inventoryItemId, delta: line.qtyDelta })),
      "available",
    );

    await updateMetaobject(admin, adjustmentNode.id, [
      { key: "status", value: "APPLIED" },
      { key: "applied_at", value: toShopifyNowDateTime() },
    ]);
    await updateMetaobject(admin, receipt.gid, [{ key: "status", value: "APPLIED" }]);

    debugLog("receive receipt done", {
      shop: shopDomain,
      receiptGid: receipt.gid,
      locationId: adjustmentLocationId,
      lines: adjustmentLines.length,
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
  return getReceiptStocksForLines(admin, lines, locationId);
}

export async function getReceiptStocksForLines(
  admin: AdminClient,
  lines: Array<Pick<ReceiptLineView, "inventoryItemGid">>,
  locationId: string,
): Promise<Map<string, number>> {
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
    throw new Error("Impossible de supprimer une réception avec un flux de stock en cours ou appliqué.");
  }
  const linkedRestockExists = await hasRestockLinkedToReceipt(admin, shopDomain, receipt.gid);
  if (linkedRestockExists) {
    throw new Error("Impossible de supprimer cette réception: un réassort magasin lié existe. Supprimez le réassort d'abord.");
  }

  const relatedLines = await listReceiptLinesForReceipt(
    admin,
    types.receiptLine,
    receiptGid,
    receipt.prestaOrderId,
  );
  for (const line of relatedLines) {
    await deleteMetaobject(admin, line.gid);
  }

  await deleteMetaobject(admin, receiptGid);
  return { deleted: true };
}



