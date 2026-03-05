import type { AdminClient } from "./auth.server";
import {
  getInventoryItemSnapshots,
  graphqlRequest,
  inventoryAdjustQuantities,
  listLocations,
  resolveSkus,
  type InventoryItemSnapshot,
} from "./shopifyGraphql";
import {
  createMetaobject,
  deleteMetaobject,
  ensureMetaobjectDefinitions,
  fieldValue,
  getMetaTypes,
  getMetaobjectById,
  getShopMetafieldValue,
  listMetaobjectsConnection,
  setShopMetafields,
  type MetaTypes,
  updateMetaobject,
} from "./shopifyMetaobjects";

export const PURCHASE_ORDER_STATUSES = ["DRAFT", "INCOMING", "RECEIVED", "CANCELED"] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export type PurchaseOrderLineDraftInput = {
  sku: string;
  supplierSku?: string;
  quantityOrdered: number;
  unitCost: number;
  taxRate: number;
};

export type PrestaRestockLineInput = {
  sku: string;
  quantity: number;
  supplierSku?: string | null;
  unitCost?: number | null;
  taxRate?: number | null;
};

export type UpsertIncomingPurchaseOrderFromPrestaInput = {
  prestaOrderId: number;
  prestaReference?: string | null;
  destinationLocationId: string;
  actor: string;
  lines: PrestaRestockLineInput[];
  expectedArrivalAt?: string | null;
  supplierNotes?: string | null;
  internalNotes?: string | null;
  currency?: string | null;
};

export type UpsertIncomingPurchaseOrderFromPrestaResult = {
  purchaseOrderGid: string;
  number: string;
  status: PurchaseOrderStatus;
  created: boolean;
  lines: Array<{
    sku: string;
    quantityOrdered: number;
    quantityReceived: number;
  }>;
};

export type PurchaseOrderCreateInput = {
  destinationLocationId: string;
  expectedArrivalAt?: string | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
  supplierNotes?: string | null;
  internalNotes?: string | null;
  currency?: string | null;
  lines: PurchaseOrderLineDraftInput[];
};

export type PurchaseOrderSummary = {
  gid: string;
  number: string;
  supplierName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  issuedAt: string;
  expectedArrivalAt: string;
  status: PurchaseOrderStatus;
  lineCount: number;
  totalTtc: number;
  currency: string;
  updatedAt: string;
};

export type PurchaseOrderLine = {
  gid: string;
  purchaseOrderGid: string;
  shopifyVariantId: string;
  inventoryItemGid: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  supplierSku: string;
  imageUrl: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  taxRate: number;
  lineTotalHt: number;
  lineTaxAmount: number;
  lineTotalTtc: number;
};

export type PurchaseOrderAuditItem = {
  gid: string;
  action: string;
  actor: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderDetail = {
  order: PurchaseOrderSummary & {
    supplierAddress: string;
    shipToAddress: string;
    billToName: string;
    billToAddress: string;
    paymentTerms: string;
    referenceNumber: string;
    supplierNotes: string;
    internalNotes: string;
    shopifyTransferId: string;
    shopifyTransferAdminUrl: string;
    subtotalHt: number;
    taxTotal: number;
    totalTtc: number;
    totalsSnapshot: string;
  };
  lines: PurchaseOrderLine[];
  audit: PurchaseOrderAuditItem[];
};

type PurchaseOrderTotals = {
  subtotalHt: number;
  taxTotal: number;
  totalTtc: number;
};

type PurchaseOrderLineResolved = PurchaseOrderLineDraftInput & {
  shopifyVariantId: string;
  inventoryItemGid: string;
  snapshot: InventoryItemSnapshot | null;
  lineTotalHt: number;
  lineTaxAmount: number;
  lineTotalTtc: number;
};

const PO_NAMESPACE = "wearmoi_stock_sync";
const PO_SEQUENCE_KEY = "purchase_order_sequence";

function readOptionalEnv(name: string): string {
  const envValue =
    typeof process !== "undefined" && process?.env
      ? process.env[name]
      : undefined;
  return String(envValue ?? "").trim();
}

const SUPPLIER_NAME = readOptionalEnv("PO_SUPPLIER_NAME") || "DEPOT DWP";
const SUPPLIER_ADDRESS = readOptionalEnv("PO_SUPPLIER_ADDRESS") || "DEPOT DWP";
const SUPPLIER_EMAIL = readOptionalEnv("PO_SUPPLIER_EMAIL");
const DEFAULT_CURRENCY = readOptionalEnv("PO_DEFAULT_CURRENCY") || "EUR";
const DEFAULT_PAYMENT_TERMS = readOptionalEnv("PO_PAYMENT_TERMS_DEFAULT") || "Aucune";
const DEFAULT_BILL_TO_ADDRESS = readOptionalEnv("PO_BILL_TO_ADDRESS");
const METAOBJECT_PAGE_SIZE = 250;
const METAOBJECT_MAX_PAGES = 80;

function toInt(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toDecimal(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIsoOrEmpty(value?: string | null): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

function formatPoHandle(number: string): string {
  return `restock-${number.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

function formatPoLineHandle(number: string, index: number): string {
  return `${formatPoHandle(number)}-line-${index + 1}`;
}

function formatPoAuditHandle(number: string, action: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${formatPoHandle(number)}-audit-${action.toLowerCase()}-${Date.now()}-${suffix}`;
}

function formatPrestaRestockIdempotencyKey(prestaOrderId: number, destinationLocationId: string): string {
  const locationToken = destinationLocationId.split("/").pop() || destinationLocationId;
  return `PRESTA:${prestaOrderId}:LOC:${locationToken}`;
}

function ensureMarkerInInternalNotes(internalNotes: string, marker: string): string {
  if (!marker) return internalNotes;
  if (internalNotes.includes(marker)) return internalNotes;
  if (!internalNotes) return marker;
  return `${internalNotes}\n${marker}`;
}

function buildSupplierNotesFromPresta(input: {
  prestaOrderId: number;
  prestaReference?: string | null;
  supplierNotes?: string | null;
}): string {
  const notes = cleanText(input.supplierNotes);
  const source = `Commande PrestaShop #${input.prestaOrderId}${cleanText(input.prestaReference) ? ` (${cleanText(input.prestaReference)})` : ""}`;
  if (!notes) return source;
  if (notes.includes(source)) return notes;
  return `${notes}\n${source}`;
}

function parseStatus(value: string): PurchaseOrderStatus {
  return PURCHASE_ORDER_STATUSES.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : "DRAFT";
}

function escapeMetaobjectSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function computeLineTotals(input: { quantityOrdered: number; unitCost: number; taxRate: number }) {
  const lineTotalHt = round2(input.quantityOrdered * input.unitCost);
  const lineTaxAmount = round2(lineTotalHt * (input.taxRate / 100));
  const lineTotalTtc = round2(lineTotalHt + lineTaxAmount);
  return { lineTotalHt, lineTaxAmount, lineTotalTtc };
}

export function computePurchaseOrderTotals(
  lines: Array<{ lineTotalHt: number; lineTaxAmount: number; lineTotalTtc: number }>,
): PurchaseOrderTotals {
  return {
    subtotalHt: round2(lines.reduce((sum, line) => sum + line.lineTotalHt, 0)),
    taxTotal: round2(lines.reduce((sum, line) => sum + line.lineTaxAmount, 0)),
    totalTtc: round2(lines.reduce((sum, line) => sum + line.lineTotalTtc, 0)),
  };
}

function toSummaryFromNode(
  node: {
    id: string;
    updatedAt: string;
    fields: Array<{ key: string; value: string | null }>;
  },
  destinationLocationName: string,
): PurchaseOrderSummary {
  const find = (key: string) => node.fields.find((field) => field.key === key)?.value ?? "";
  return {
    gid: node.id,
    number: find("number"),
    supplierName: find("supplier_name"),
    destinationLocationId: find("destination_location_id"),
    destinationLocationName,
    issuedAt: find("issued_at"),
    expectedArrivalAt: find("expected_arrival_at"),
    status: parseStatus(find("status")),
    lineCount: toInt(find("line_count"), 0),
    totalTtc: toDecimal(find("total_ttc"), 0),
    currency: find("currency") || DEFAULT_CURRENCY,
    updatedAt: node.updatedAt,
  };
}

function toLineFromNode(node: {
  id: string;
  fields: Array<{ key: string; value: string | null }>;
}): PurchaseOrderLine {
  const find = (key: string) => node.fields.find((field) => field.key === key)?.value ?? "";
  return {
    gid: node.id,
    purchaseOrderGid: find("purchase_order_gid"),
    shopifyVariantId: find("shopify_variant_id"),
    inventoryItemGid: find("inventory_item_gid"),
    productTitle: find("product_title"),
    variantTitle: find("variant_title"),
    sku: find("sku"),
    supplierSku: find("supplier_sku"),
    imageUrl: find("image_url"),
    quantityOrdered: toInt(find("quantity_ordered"), 0),
    quantityReceived: toInt(find("quantity_received"), 0),
    unitCost: toDecimal(find("unit_cost"), 0),
    taxRate: toDecimal(find("tax_rate"), 0),
    lineTotalHt: toDecimal(find("line_total_ht"), 0),
    lineTaxAmount: toDecimal(find("line_tax_amount"), 0),
    lineTotalTtc: toDecimal(find("line_total_ttc"), 0),
  };
}

function toAuditFromNode(node: {
  id: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): PurchaseOrderAuditItem {
  const find = (key: string) => node.fields.find((field) => field.key === key)?.value ?? "";
  return {
    gid: node.id,
    action: find("action"),
    actor: find("actor"),
    payload: find("payload"),
    createdAt: find("created_at"),
    updatedAt: node.updatedAt,
  };
}

async function resolveBillTo(admin: AdminClient): Promise<{ name: string; address: string }> {
  const data = await graphqlRequest<{
    shop: {
      name: string;
      myshopifyDomain: string;
      contactEmail: string | null;
    };
  }>(
    admin,
    `#graphql
      query RestockShopIdentity {
        shop {
          name
          myshopifyDomain
          contactEmail
        }
      }
    `,
  );
  const lines = [DEFAULT_BILL_TO_ADDRESS];
  if (data.shop.contactEmail) lines.push(`Email: ${data.shop.contactEmail}`);
  if (data.shop.myshopifyDomain) lines.push(`URL: ${data.shop.myshopifyDomain}`);
  return {
    name: data.shop.name || "Boutique Shopify",
    address: lines.filter(Boolean).join("\n"),
  };
}

async function resolveDestination(admin: AdminClient, locationId: string): Promise<{ id: string; name: string }> {
  const destination = (await listLocations(admin)).find((location) => location.id === locationId);
  if (!destination) {
    throw new Error("Location de destination introuvable.");
  }
  return destination;
}

async function nextPurchaseOrderNumber(admin: AdminClient): Promise<string> {
  const currentRaw = await getShopMetafieldValue(admin, PO_NAMESPACE, PO_SEQUENCE_KEY);
  const current = Math.max(0, toInt(currentRaw, 0));
  const next = current + 1;
  await setShopMetafields(admin, [
    {
      namespace: PO_NAMESPACE,
      key: PO_SEQUENCE_KEY,
      type: "single_line_text_field",
      value: String(next),
    },
  ]);
  const year = new Date().getUTCFullYear();
  return `RS-${year}-${String(next).padStart(4, "0")}`;
}

async function resolveLines(admin: AdminClient, lines: PurchaseOrderLineDraftInput[]): Promise<PurchaseOrderLineResolved[]> {
  const sanitized = lines
    .map((line) => ({
      sku: cleanText(line.sku),
      supplierSku: cleanText(line.supplierSku) || cleanText(line.sku),
      quantityOrdered: Math.max(0, Math.trunc(Number(line.quantityOrdered))),
      unitCost: Math.max(0, Number(line.unitCost)),
      taxRate: Math.max(0, Number(line.taxRate)),
    }))
    .filter((line) => line.sku && line.quantityOrdered > 0);
  if (!sanitized.length) {
    throw new Error("Ajoutez au moins une ligne valide (SKU + quantité).");
  }

  const bySku = await resolveSkus(
    admin,
    sanitized.map((line) => line.sku),
  );
  const unresolved = sanitized.filter((line) => !bySku.get(line.sku));
  if (unresolved.length) {
    throw new Error(`SKU introuvable(s) dans Shopify: ${unresolved.map((line) => line.sku).join(", ")}`);
  }

  const inventoryItemIds = sanitized.map((line) => bySku.get(line.sku)?.inventoryItemId ?? "").filter(Boolean);
  const snapshots = await getInventoryItemSnapshots(admin, inventoryItemIds);

  return sanitized.map((line) => {
    const resolved = bySku.get(line.sku)!;
    const totals = computeLineTotals(line);
    return {
      ...line,
      shopifyVariantId: resolved.variantId,
      inventoryItemGid: resolved.inventoryItemId,
      snapshot: snapshots.get(resolved.inventoryItemId) ?? null,
      ...totals,
    };
  });
}

function toDraftLinesFromPresta(lines: PrestaRestockLineInput[]): PurchaseOrderLineDraftInput[] {
  const bySku = new Map<string, PurchaseOrderLineDraftInput>();
  for (const line of lines) {
    const sku = cleanText(line.sku);
    const quantity = Math.max(0, Math.trunc(Number(line.quantity)));
    if (!sku || quantity <= 0) continue;
    const existing = bySku.get(sku);
    if (existing) {
      existing.quantityOrdered += quantity;
      continue;
    }
    bySku.set(sku, {
      sku,
      supplierSku: cleanText(line.supplierSku) || sku,
      quantityOrdered: quantity,
      unitCost: Math.max(0, Number(line.unitCost ?? 0)),
      taxRate: Math.max(0, Number(line.taxRate ?? 0)),
    });
  }
  return Array.from(bySku.values());
}

async function findPurchaseOrderNodeByPrestaMarker(
  admin: AdminClient,
  purchaseOrderType: string,
  marker: string,
  destinationLocationId: string,
): Promise<{
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
} | null> {
  const nodes = await listMetaobjectsSafe(admin, purchaseOrderType);
  return (
    nodes.find((node) => {
      const internalNotes = fieldValue(node, "internal_notes");
      const destination = fieldValue(node, "destination_location_id");
      return destination === destinationLocationId && internalNotes.includes(marker);
    }) ?? null
  );
}

async function rewritePurchaseOrderLines(
  admin: AdminClient,
  types: MetaTypes,
  purchaseOrderNumber: string,
  purchaseOrderGid: string,
  lines: PurchaseOrderLineResolved[],
): Promise<void> {
  const existingLineNodes = await listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderLine, purchaseOrderGid);
  await Promise.all(existingLineNodes.map((node) => deleteMetaobject(admin, node.id)));

  await Promise.all(
    lines.map((line, index) =>
      createMetaobject(
        admin,
        types.purchaseOrderLine,
        `${formatPoLineHandle(purchaseOrderNumber, index)}-${Date.now().toString(36)}-${index}`,
        [
          { key: "purchase_order_gid", value: purchaseOrderGid },
          { key: "shopify_variant_id", value: line.shopifyVariantId },
          { key: "inventory_item_gid", value: line.inventoryItemGid },
          { key: "product_title", value: line.snapshot?.productTitle ?? "" },
          { key: "variant_title", value: line.snapshot?.variantTitle ?? "" },
          { key: "sku", value: line.sku },
          { key: "supplier_sku", value: line.supplierSku ?? line.sku },
          { key: "image_url", value: line.snapshot?.imageUrl ?? "" },
          { key: "quantity_ordered", value: String(line.quantityOrdered) },
          { key: "quantity_received", value: "0" },
          { key: "unit_cost", value: String(round2(line.unitCost)) },
          { key: "tax_rate", value: String(round2(line.taxRate)) },
          { key: "line_total_ht", value: String(line.lineTotalHt) },
          { key: "line_tax_amount", value: String(line.lineTaxAmount) },
          { key: "line_total_ttc", value: String(line.lineTotalTtc) },
        ],
      ),
    ),
  );
}

async function writeAudit(
  admin: AdminClient,
  number: string,
  purchaseOrderGid: string,
  action: string,
  actor: string,
  payload: unknown,
): Promise<void> {
  const types = await getMetaTypes(admin);
  await createMetaobject(admin, types.purchaseOrderAudit, formatPoAuditHandle(number, action), [
    { key: "purchase_order_gid", value: purchaseOrderGid },
    { key: "action", value: action },
    { key: "actor", value: actor },
    { key: "payload", value: JSON.stringify(payload ?? {}) },
    { key: "created_at", value: new Date().toISOString() },
  ]);
}

async function listMetaobjectsSafe(admin: AdminClient, type: string): Promise<Array<{
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}>> {
  const nodes: Array<{
    id: string;
    handle: string;
    type: string;
    updatedAt: string;
    fields: Array<{ key: string; value: string | null }>;
  }> = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();
  let pages = 0;

  while (pages < METAOBJECT_MAX_PAGES) {
    const connection = await listMetaobjectsConnection(admin, type, METAOBJECT_PAGE_SIZE, after);
    pages += 1;
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    if (seenCursors.has(connection.pageInfo.endCursor)) {
      break;
    }
    seenCursors.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
  }

  return nodes;
}

async function listMetaobjectsByPurchaseOrder(
  admin: AdminClient,
  type: string,
  purchaseOrderGid: string,
): Promise<Array<{
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}>> {
  const query = `fields.purchase_order_gid:"${escapeMetaobjectSearchValue(purchaseOrderGid)}"`;
  const queried: Array<{
    id: string;
    handle: string;
    type: string;
    updatedAt: string;
    fields: Array<{ key: string; value: string | null }>;
  }> = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();
  let pages = 0;

  try {
    while (pages < METAOBJECT_MAX_PAGES) {
      const connection = await listMetaobjectsConnection(
        admin,
        type,
        METAOBJECT_PAGE_SIZE,
        after,
        query,
      );
      pages += 1;
      queried.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
        break;
      }
      if (seenCursors.has(connection.pageInfo.endCursor)) {
        break;
      }
      seenCursors.add(connection.pageInfo.endCursor);
      after = connection.pageInfo.endCursor;
    }
    if (queried.length > 0) {
      return queried;
    }
  } catch {
    // Fallback below.
  }

  const allNodes = await listMetaobjectsSafe(admin, type);
  return allNodes.filter((node) => fieldValue(node, "purchase_order_gid") === purchaseOrderGid);
}

export async function listPurchaseOrders(
  admin: AdminClient,
  shopDomain: string,
  filters?: {
    status?: PurchaseOrderStatus | "";
    destinationLocationId?: string;
  },
): Promise<PurchaseOrderSummary[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const [locations, nodes] = await Promise.all([listLocations(admin), listMetaobjectsSafe(admin, types.purchaseOrder)]);
  const locationById = new Map(locations.map((location) => [location.id, location.name]));

  return nodes
    .map((node) => {
      const destinationId = fieldValue(node, "destination_location_id");
      const destinationName = (locationById.get(destinationId) ?? fieldValue(node, "ship_to_name")) || "Destination";
      return toSummaryFromNode(node, destinationName);
    })
    .filter((row) => (filters?.status ? row.status === filters.status : true))
    .filter((row) => (filters?.destinationLocationId ? row.destinationLocationId === filters.destinationLocationId : true))
    .sort((left, right) => {
      const leftDate = Date.parse(left.issuedAt || left.updatedAt);
      const rightDate = Date.parse(right.issuedAt || right.updatedAt);
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
        return rightDate - leftDate;
      }
      return right.number.localeCompare(left.number, "fr");
    });
}

export async function getPurchaseOrderDetail(
  admin: AdminClient,
  shopDomain: string,
  purchaseOrderGid: string,
): Promise<PurchaseOrderDetail> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const [orderNode, locations] = await Promise.all([
    getMetaobjectById(admin, purchaseOrderGid),
    listLocations(admin),
  ]);

  if (!orderNode || orderNode.type !== types.purchaseOrder) {
    throw new Error("Bon de réassort introuvable.");
  }

  const [lineNodes, auditNodes] = await Promise.all([
    listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderLine, purchaseOrderGid),
    listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderAudit, purchaseOrderGid),
  ]);

  const destinationLocationId = fieldValue(orderNode, "destination_location_id");
  const destinationLocationName =
    locations.find((location) => location.id === destinationLocationId)?.name ||
    fieldValue(orderNode, "ship_to_name") ||
    "Destination";

  const summary = toSummaryFromNode(orderNode, destinationLocationName);
  const lines = lineNodes
    .map((node) => toLineFromNode(node))
    .filter((line) => line.purchaseOrderGid === purchaseOrderGid)
    .sort((left, right) => left.sku.localeCompare(right.sku, "fr"));

  const audit = auditNodes
    .filter((node) => fieldValue(node, "purchase_order_gid") === purchaseOrderGid)
    .map((node) => toAuditFromNode(node))
    .sort((left, right) => {
      const leftDate = Date.parse(left.createdAt || left.updatedAt);
      const rightDate = Date.parse(right.createdAt || right.updatedAt);
      return rightDate - leftDate;
    });

  const fallbackTotals = computePurchaseOrderTotals(lines);
  return {
    order: {
      ...summary,
      supplierAddress: fieldValue(orderNode, "supplier_address"),
      shipToAddress: fieldValue(orderNode, "ship_to_address"),
      billToName: fieldValue(orderNode, "bill_to_name"),
      billToAddress: fieldValue(orderNode, "bill_to_address"),
      paymentTerms: fieldValue(orderNode, "payment_terms"),
      referenceNumber: fieldValue(orderNode, "reference_number"),
      supplierNotes: fieldValue(orderNode, "supplier_notes"),
      internalNotes: fieldValue(orderNode, "internal_notes"),
      shopifyTransferId: "",
      shopifyTransferAdminUrl: "",
      subtotalHt: toDecimal(fieldValue(orderNode, "subtotal_ht"), fallbackTotals.subtotalHt),
      taxTotal: toDecimal(fieldValue(orderNode, "tax_total"), fallbackTotals.taxTotal),
      totalTtc: toDecimal(fieldValue(orderNode, "total_ttc"), fallbackTotals.totalTtc),
      totalsSnapshot: fieldValue(orderNode, "totals_snapshot"),
    },
    lines,
    audit,
  };
}

export async function createPurchaseOrderDraft(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  input: PurchaseOrderCreateInput,
): Promise<{ purchaseOrderGid: string; number: string }> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const [number, destination, billTo, resolvedLines] = await Promise.all([
    nextPurchaseOrderNumber(admin),
    resolveDestination(admin, input.destinationLocationId),
    resolveBillTo(admin),
    resolveLines(admin, input.lines),
  ]);

  const totals = computePurchaseOrderTotals(resolvedLines);
  const issuedAt = new Date().toISOString();
  const expectedArrivalAt = toIsoOrEmpty(input.expectedArrivalAt);
  const status: PurchaseOrderStatus = "DRAFT";
  const currency = cleanText(input.currency) || DEFAULT_CURRENCY;
  const paymentTerms = cleanText(input.paymentTerms) || DEFAULT_PAYMENT_TERMS;
  const referenceNumber = cleanText(input.referenceNumber);
  const supplierNotes = cleanText(input.supplierNotes);
  const internalNotes = cleanText(input.internalNotes);

  const purchaseOrderGid = await createMetaobject(admin, types.purchaseOrder, formatPoHandle(number), [
    { key: "number", value: number },
    { key: "issued_at", value: issuedAt },
    { key: "expected_arrival_at", value: expectedArrivalAt },
    { key: "supplier_name", value: SUPPLIER_NAME },
    { key: "supplier_address", value: SUPPLIER_ADDRESS },
    { key: "ship_to_name", value: destination.name },
    { key: "ship_to_address", value: destination.name },
    { key: "bill_to_name", value: billTo.name },
    { key: "bill_to_address", value: billTo.address },
    { key: "currency", value: currency },
    { key: "payment_terms", value: paymentTerms },
    { key: "reference_number", value: referenceNumber },
    { key: "supplier_notes", value: supplierNotes },
    { key: "internal_notes", value: internalNotes },
    { key: "status", value: status },
    { key: "destination_location_id", value: destination.id },
    { key: "created_by", value: actor },
    { key: "shopify_transfer_id", value: "" },
    { key: "shopify_transfer_admin_url", value: "" },
    {
      key: "totals_snapshot",
      value: JSON.stringify({
        subtotalHt: totals.subtotalHt,
        taxTotal: totals.taxTotal,
        totalTtc: totals.totalTtc,
        generatedAt: issuedAt,
      }),
    },
    { key: "line_count", value: String(resolvedLines.length) },
    { key: "subtotal_ht", value: String(totals.subtotalHt) },
    { key: "tax_total", value: String(totals.taxTotal) },
    { key: "total_ttc", value: String(totals.totalTtc) },
  ]);

  await Promise.all(
    resolvedLines.map((line, index) =>
      createMetaobject(admin, types.purchaseOrderLine, formatPoLineHandle(number, index), [
        { key: "purchase_order_gid", value: purchaseOrderGid },
        { key: "shopify_variant_id", value: line.shopifyVariantId },
        { key: "inventory_item_gid", value: line.inventoryItemGid },
        { key: "product_title", value: line.snapshot?.productTitle ?? "" },
        { key: "variant_title", value: line.snapshot?.variantTitle ?? "" },
        { key: "sku", value: line.sku },
        { key: "supplier_sku", value: line.supplierSku ?? line.sku },
        { key: "image_url", value: line.snapshot?.imageUrl ?? "" },
        { key: "quantity_ordered", value: String(line.quantityOrdered) },
        { key: "quantity_received", value: "0" },
        { key: "unit_cost", value: String(round2(line.unitCost)) },
        { key: "tax_rate", value: String(round2(line.taxRate)) },
        { key: "line_total_ht", value: String(line.lineTotalHt) },
        { key: "line_tax_amount", value: String(line.lineTaxAmount) },
        { key: "line_total_ttc", value: String(line.lineTotalTtc) },
      ]),
    ),
  );

  await writeAudit(admin, number, purchaseOrderGid, "CREATE_DRAFT", actor, {
    destinationLocationId: destination.id,
    lineCount: resolvedLines.length,
    totals,
  });

  return { purchaseOrderGid, number };
}

export async function upsertIncomingPurchaseOrderFromPrestaOrder(
  admin: AdminClient,
  shopDomain: string,
  input: UpsertIncomingPurchaseOrderFromPrestaInput,
): Promise<UpsertIncomingPurchaseOrderFromPrestaResult> {
  const prestaOrderId = Math.trunc(Number(input.prestaOrderId));
  if (!Number.isInteger(prestaOrderId) || prestaOrderId <= 0) {
    throw new Error("Identifiant de commande PrestaShop invalide.");
  }
  if (!cleanText(input.destinationLocationId)) {
    throw new Error("Boutique de destination obligatoire.");
  }

  const draftLines = toDraftLinesFromPresta(input.lines);
  if (!draftLines.length) {
    throw new Error("Aucune ligne valide pour créer le réassort.");
  }

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const marker = formatPrestaRestockIdempotencyKey(prestaOrderId, input.destinationLocationId);
  const expectedArrivalAt = toIsoOrEmpty(input.expectedArrivalAt);
  const supplierNotes = buildSupplierNotesFromPresta({
    prestaOrderId,
    prestaReference: input.prestaReference,
    supplierNotes: input.supplierNotes,
  });
  const referenceNumber = cleanText(input.prestaReference) || `PRESTA-${prestaOrderId}`;
  const normalizedActor = cleanText(input.actor) || shopDomain;

  const existingNode = await findPurchaseOrderNodeByPrestaMarker(
    admin,
    types.purchaseOrder,
    marker,
    input.destinationLocationId,
  );

  if (existingNode) {
    const detail = await getPurchaseOrderDetail(admin, shopDomain, existingNode.id);
    if (detail.order.status === "RECEIVED") {
      return {
        purchaseOrderGid: detail.order.gid,
        number: detail.order.number,
        status: detail.order.status,
        created: false,
        lines: detail.lines.map((line) => ({
          sku: line.sku,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived,
        })),
      };
    }

    const resolvedLines = await resolveLines(admin, draftLines);
    const totals = computePurchaseOrderTotals(resolvedLines);
    await rewritePurchaseOrderLines(admin, types, detail.order.number, detail.order.gid, resolvedLines);
    await updateMetaobject(admin, detail.order.gid, [
      { key: "status", value: "INCOMING" },
      { key: "expected_arrival_at", value: expectedArrivalAt },
      { key: "reference_number", value: referenceNumber },
      { key: "supplier_notes", value: supplierNotes },
      {
        key: "internal_notes",
        value: ensureMarkerInInternalNotes(cleanText(input.internalNotes) || detail.order.internalNotes, marker),
      },
      { key: "currency", value: cleanText(input.currency) || detail.order.currency || DEFAULT_CURRENCY },
      { key: "line_count", value: String(resolvedLines.length) },
      { key: "subtotal_ht", value: String(totals.subtotalHt) },
      { key: "tax_total", value: String(totals.taxTotal) },
      { key: "total_ttc", value: String(totals.totalTtc) },
      {
        key: "totals_snapshot",
        value: JSON.stringify({
          subtotalHt: totals.subtotalHt,
          taxTotal: totals.taxTotal,
          totalTtc: totals.totalTtc,
          generatedAt: new Date().toISOString(),
        }),
      },
    ]);
    await writeAudit(admin, detail.order.number, detail.order.gid, "UPSERT_FROM_PRESTA", normalizedActor, {
      prestaOrderId,
      reference: input.prestaReference ?? "",
      destinationLocationId: input.destinationLocationId,
      lineCount: resolvedLines.length,
      created: false,
    });

    const updatedDetail = await getPurchaseOrderDetail(admin, shopDomain, detail.order.gid);
    return {
      purchaseOrderGid: updatedDetail.order.gid,
      number: updatedDetail.order.number,
      status: updatedDetail.order.status,
      created: false,
      lines: updatedDetail.lines.map((line) => ({
        sku: line.sku,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
      })),
    };
  }

  const created = await createPurchaseOrderDraft(admin, shopDomain, normalizedActor, {
    destinationLocationId: input.destinationLocationId,
    expectedArrivalAt: expectedArrivalAt || null,
    paymentTerms: DEFAULT_PAYMENT_TERMS,
    referenceNumber,
    supplierNotes,
    internalNotes: ensureMarkerInInternalNotes(cleanText(input.internalNotes), marker),
    currency: cleanText(input.currency) || DEFAULT_CURRENCY,
    lines: draftLines,
  });
  await markPurchaseOrderIncoming(admin, shopDomain, normalizedActor, created.purchaseOrderGid);
  await writeAudit(admin, created.number, created.purchaseOrderGid, "UPSERT_FROM_PRESTA", normalizedActor, {
    prestaOrderId,
    reference: input.prestaReference ?? "",
    destinationLocationId: input.destinationLocationId,
    lineCount: draftLines.length,
    created: true,
  });

  const detail = await getPurchaseOrderDetail(admin, shopDomain, created.purchaseOrderGid);
  return {
    purchaseOrderGid: detail.order.gid,
    number: detail.order.number,
    status: detail.order.status,
    created: true,
    lines: detail.lines.map((line) => ({
      sku: line.sku,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: line.quantityReceived,
    })),
  };
}

export async function duplicatePurchaseOrder(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
): Promise<{ purchaseOrderGid: string; number: string }> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  return createPurchaseOrderDraft(admin, shopDomain, actor, {
    destinationLocationId: detail.order.destinationLocationId,
    expectedArrivalAt: detail.order.expectedArrivalAt,
    paymentTerms: detail.order.paymentTerms,
    referenceNumber: detail.order.referenceNumber,
    supplierNotes: detail.order.supplierNotes,
    internalNotes: detail.order.internalNotes,
    currency: detail.order.currency,
    lines: detail.lines.map((line) => ({
      sku: line.sku,
      supplierSku: line.supplierSku,
      quantityOrdered: line.quantityOrdered,
      unitCost: line.unitCost,
      taxRate: line.taxRate,
    })),
  });
}

export async function cancelPurchaseOrder(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
): Promise<void> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  if (detail.order.status === "RECEIVED") {
    throw new Error("Impossible d'annuler un réassort déjà reçu.");
  }
  await updateMetaobject(admin, purchaseOrderGid, [{ key: "status", value: "CANCELED" }]);
  await writeAudit(admin, detail.order.number, purchaseOrderGid, "CANCELED", actor, {});
}

export async function deletePurchaseOrder(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
): Promise<void> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  if (detail.order.status === "RECEIVED") {
    throw new Error("Impossible de supprimer un réassort déjà reçu.");
  }
  const linkedReceiptMatch = detail.order.internalNotes.match(/Lien réception:\s*(gid:\/\/[^\s]+)/i);
  const linkedReceiptGid = linkedReceiptMatch?.[1] ?? "";

  const types = await getMetaTypes(admin);
  const lineNodes = await listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderLine, purchaseOrderGid);

  await writeAudit(admin, detail.order.number, purchaseOrderGid, "DELETED", actor, {
    statusBeforeDelete: detail.order.status,
    lineCount: lineNodes.length,
  });

  const auditsWithDelete = await listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderAudit, purchaseOrderGid);
  const allDeletes = [
    ...lineNodes.map((node) => deleteMetaobject(admin, node.id)),
    ...auditsWithDelete.map((node) => deleteMetaobject(admin, node.id)),
    deleteMetaobject(admin, purchaseOrderGid),
  ];
  await Promise.all(allDeletes);

  if (linkedReceiptGid) {
    try {
      const receiptNode = await getMetaobjectById(admin, linkedReceiptGid);
      if (receiptNode && fieldValue(receiptNode, "status") === "INCOMING") {
        await updateMetaobject(admin, linkedReceiptGid, [{ key: "status", value: "READY" }]);
      }
    } catch {
      // Ignore if linked receipt no longer exists.
    }
  }
}

export async function hasRestockLinkedToReceipt(
  admin: AdminClient,
  shopDomain: string,
  receiptGid: string,
): Promise<boolean> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const orders = await listMetaobjectsSafe(admin, types.purchaseOrder);
  const marker = `Lien réception: ${receiptGid}`;
  return orders.some((order) => fieldValue(order, "internal_notes").includes(marker));
}

export async function purgePurchaseOrders(
  admin: AdminClient,
  shopDomain: string,
  destinationLocationId: string,
  includeReceived = false,
): Promise<{
  destinationLocationId: string;
  deletedOrders: number;
  deletedLines: number;
  deletedAudits: number;
  skippedReceived: number;
}> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const orders = await listMetaobjectsSafe(admin, types.purchaseOrder);
  const scopedOrders = orders.filter((order) =>
    destinationLocationId ? fieldValue(order, "destination_location_id") === destinationLocationId : true,
  );

  let deletedOrders = 0;
  let deletedLines = 0;
  let deletedAudits = 0;
  let skippedReceived = 0;

  for (const order of scopedOrders) {
    const status = parseStatus(fieldValue(order, "status"));
    if (!includeReceived && status === "RECEIVED") {
      skippedReceived += 1;
      continue;
    }
    const linkedReceiptMatch = fieldValue(order, "internal_notes").match(/Lien réception:\s*(gid:\/\/[^\s]+)/i);
    const linkedReceiptGid = linkedReceiptMatch?.[1] ?? "";
    const [lineNodes, auditNodes] = await Promise.all([
      listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderLine, order.id),
      listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderAudit, order.id),
    ]);

    await Promise.all([
      ...lineNodes.map((line) => deleteMetaobject(admin, line.id)),
      ...auditNodes.map((audit) => deleteMetaobject(admin, audit.id)),
      deleteMetaobject(admin, order.id),
    ]);

    deletedOrders += 1;
    deletedLines += lineNodes.length;
    deletedAudits += auditNodes.length;

    if (linkedReceiptGid) {
      try {
        const receiptNode = await getMetaobjectById(admin, linkedReceiptGid);
        if (receiptNode && fieldValue(receiptNode, "status") === "INCOMING") {
          await updateMetaobject(admin, linkedReceiptGid, [{ key: "status", value: "READY" }]);
        }
      } catch {
        // Ignore if linked receipt no longer exists.
      }
    }
  }

  return {
    destinationLocationId,
    deletedOrders,
    deletedLines,
    deletedAudits,
    skippedReceived,
  };
}

export async function purgePurchaseOrdersForDebug(
  admin: AdminClient,
  shopDomain: string,
  destinationLocationId: string,
  includeReceived = false,
) {
  return purgePurchaseOrders(admin, shopDomain, destinationLocationId, includeReceived);
}

export async function markPurchaseOrderIncoming(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
): Promise<void> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  if (detail.order.status === "CANCELED") {
    throw new Error("Impossible de passer en arrivage un réassort annulé.");
  }
  if (detail.order.status === "RECEIVED") {
    throw new Error("Ce réassort est déjà reçu.");
  }
  if (!detail.lines.length) {
    throw new Error("Aucune ligne sur ce réassort.");
  }
  if (detail.order.status === "INCOMING") {
    return;
  }

  await updateMetaobject(admin, purchaseOrderGid, [
    { key: "status", value: "INCOMING" },
    { key: "issued_at", value: detail.order.issuedAt || new Date().toISOString() },
  ]);

  await writeAudit(admin, detail.order.number, purchaseOrderGid, "MARK_INCOMING", actor, {
    inventoryMutation: "none",
  });
}

export async function markPurchaseOrderReceived(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
): Promise<void> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  if (detail.order.status === "CANCELED") {
    throw new Error("Impossible de réceptionner un réassort annulé.");
  }
  if (detail.order.status === "RECEIVED") {
    throw new Error("Ce réassort est déjà reçu.");
  }
  if (detail.order.status !== "INCOMING") {
    throw new Error("Passez d'abord ce réassort en cours d'arrivage.");
  }

  const destination = await resolveDestination(admin, detail.order.destinationLocationId);
  const types = await getMetaTypes(admin);
  const lineNodes = await listMetaobjectsByPurchaseOrder(admin, types.purchaseOrderLine, purchaseOrderGid);
  const relatedLines = lineNodes
    .map((node) => ({
      node,
      inventoryItemId: fieldValue(node, "inventory_item_gid"),
      ordered: toInt(fieldValue(node, "quantity_ordered"), 0),
      received: toInt(fieldValue(node, "quantity_received"), 0),
      sku: fieldValue(node, "sku"),
    }));

  if (!relatedLines.length) {
    throw new Error("Aucune ligne à réceptionner.");
  }

  const deltas = relatedLines
    .map((line) => ({
      line,
      delta: Math.max(0, line.ordered - line.received),
    }))
    .filter((entry) => entry.delta > 0);

  const invalidLines = deltas.filter((entry) => !entry.line.inventoryItemId);
  if (invalidLines.length) {
    throw new Error(`Lignes sans inventaire Shopify: ${invalidLines.map((entry) => entry.line.sku).join(", ")}`);
  }

  if (deltas.length > 0) {
    await inventoryAdjustQuantities(
      admin,
      destination.id,
      deltas.map((entry) => ({
        inventoryItemId: entry.line.inventoryItemId,
        delta: entry.delta,
      })),
      "available",
    );
  }

  await Promise.all(
    relatedLines.map((line) =>
      updateMetaobject(admin, line.node.id, [{ key: "quantity_received", value: String(line.ordered) }]),
    ),
  );
  await updateMetaobject(admin, purchaseOrderGid, [{ key: "status", value: "RECEIVED" }]);

  await writeAudit(admin, detail.order.number, purchaseOrderGid, "MARK_RECEIVED", actor, {
    destinationLocationId: destination.id,
    destinationLocationName: destination.name,
    availableAdjustedLines: deltas.length,
  });
}

export async function logPurchaseOrderEmailSent(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
  payload: { recipient: string; subject: string },
): Promise<void> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  await writeAudit(admin, detail.order.number, purchaseOrderGid, "EMAIL_SENT", actor, payload);
}

export function defaultPurchaseOrderSupplier() {
  return {
    supplierName: SUPPLIER_NAME,
    supplierAddress: SUPPLIER_ADDRESS,
    supplierEmail: SUPPLIER_EMAIL,
    defaultCurrency: DEFAULT_CURRENCY,
    defaultPaymentTerms: DEFAULT_PAYMENT_TERMS,
    debugMode: process.env.DEBUG === "true",
  };
}
