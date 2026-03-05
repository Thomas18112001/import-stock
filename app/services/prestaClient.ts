import { XMLParser } from "fast-xml-parser";
import { env } from "../env.server";
import { debugLog } from "../utils/debug";
import { fetchWithRetry, readResponseTextWithLimit } from "../utils/http.server";
import { isValidSku, normalizeSkuText } from "../utils/validators";
import {
  PrestaParsingError,
  getText,
  parseOrderDetailXml,
  parseOrdersListXml,
  type PrestaOrder,
} from "./prestaXmlParser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  trimValues: true,
});

export type { PrestaOrder };

export type PrestaOrderLine = {
  sku: string;
  qty: number;
};

type XmlRecord = Record<string, unknown>;
type AllowedPrestaPath = "/api/orders" | "/api/order_details" | `/api/orders/${number}`;
type OrderSortDirection = "ASC" | "DESC";
type OrdersSortKey = "id" | "date_upd";
const PRESTA_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const PRESTA_TIMEOUT_MS = 10_000;
const PRESTA_MAX_RESPONSE_BYTES = 1_000_000;
const SUSPICIOUS_URL_VALUE_PATTERN = /(\.\.|\/\/|%|http|@|\\)/i;
const ALLOWED_STATIC_PATHS = new Set(["/api/orders", "/api/order_details"]);

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePrestaQuantity(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function assertNoSuspiciousUrlValue(value: string, label: string): void {
  if (SUSPICIOUS_URL_VALUE_PATTERN.test(value)) {
    throw new Error(`Prestashop request blocked: invalid ${label}`);
  }
}

export function assertAllowedPrestaPath(path: string): asserts path is AllowedPrestaPath {
  const trimmed = path.trim();
  if (ALLOWED_STATIC_PATHS.has(trimmed)) {
    return;
  }
  if (/^\/api\/orders\/\d+$/.test(trimmed)) {
    return;
  }
  throw new Error("Prestashop request blocked: endpoint not allowed");
}

function buildOrderPath(orderId: number): AllowedPrestaPath {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("Prestashop request blocked: invalid order id");
  }
  return `/api/orders/${orderId}`;
}

function prestaUrl(path: AllowedPrestaPath, params: Record<string, string>): URL {
  assertAllowedPrestaPath(path);
  const base = new URL(env.prestaBaseUrl);
  if (base.hostname !== env.prestaAllowedHost) {
    throw new Error("Prestashop request blocked: invalid Prestashop host");
  }
  const url = new URL(path, base);
  url.searchParams.set("ws_key", env.prestaWsKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url;
}

function assertOrdersQueryInput(input: {
  customerId: number;
  offset: number;
  limit: number;
  sinceId: number | null;
  updatedAtMin: string | null;
  updatedAtMax: string | null;
  sortKey: OrdersSortKey;
  sortDirection: OrderSortDirection;
}): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error("Prestashop request blocked: invalid customer id");
  }
  if (input.sinceId != null && (!Number.isInteger(input.sinceId) || input.sinceId < 0)) {
    throw new Error("Prestashop request blocked: invalid sinceId");
  }
  if (!Number.isInteger(input.offset) || input.offset < 0) {
    throw new Error("Prestashop request blocked: invalid offset");
  }
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 250) {
    throw new Error("Prestashop request blocked: invalid limit");
  }
  if (input.sortDirection !== "ASC" && input.sortDirection !== "DESC") {
    throw new Error("Prestashop request blocked: invalid sortDirection");
  }
  if (input.sortKey !== "id" && input.sortKey !== "date_upd") {
    throw new Error("Prestashop request blocked: invalid sortKey");
  }
  const hasDateMin = Boolean(input.updatedAtMin);
  const hasDateMax = Boolean(input.updatedAtMax);
  if (hasDateMin && !PRESTA_DATE_TIME_PATTERN.test(input.updatedAtMin!)) {
    throw new Error("Prestashop request blocked: invalid updatedAtMin");
  }
  if (hasDateMax && !PRESTA_DATE_TIME_PATTERN.test(input.updatedAtMax!)) {
    throw new Error("Prestashop request blocked: invalid updatedAtMax");
  }
  if (input.updatedAtMin && input.updatedAtMax && input.updatedAtMin > input.updatedAtMax) {
    throw new Error("Prestashop request blocked: updatedAtMin cannot be greater than updatedAtMax");
  }
  if (input.sinceId == null && !hasDateMin && !hasDateMax) {
    throw new Error("Prestashop request blocked: at least one filter is required");
  }
}

export type ListOrdersInput = {
  customerId: number;
  sinceId?: number;
  updatedAtMin?: string;
  updatedAtMax?: string;
  offset: number;
  limit: number;
  sortKey?: OrdersSortKey;
  sortDirection?: OrderSortDirection;
};

function sanitizeOrdersListParams(input: {
  customerId: number;
  sinceId: number | null;
  updatedAtMin: string | null;
  updatedAtMax: string | null;
  offset: number;
  limit: number;
  sortKey: OrdersSortKey;
  sortDirection: OrderSortDirection;
}): Record<string, string> {
  assertOrdersQueryInput(input);
  const sort = `[${input.sortKey}_${input.sortDirection}]`;
  const params: Record<string, string> = {
    "filter[id_customer]": `[${input.customerId}]`,
    sort,
    display: "[id,id_customer,reference,current_state,date_add,date_upd]",
    limit: `${input.offset},${input.limit}`,
  };
  if (input.sinceId != null) {
    params["filter[id]"] = `[>${input.sinceId}]`;
  }
  if (input.updatedAtMin || input.updatedAtMax) {
    params.date = "1";
    const min = input.updatedAtMin ?? "";
    const max = input.updatedAtMax ?? "";
    params["filter[date_upd]"] = `[${min},${max}]`;
  }
  for (const [key, value] of Object.entries(params)) {
    assertNoSuspiciousUrlValue(value, key);
  }
  return params;
}

function sanitizeOrderByIdParams(): Record<string, string> {
  const params = {
    display: "[id,id_customer,reference,current_state,date_add,date_upd]",
  };
  for (const [key, value] of Object.entries(params)) {
    assertNoSuspiciousUrlValue(value, key);
  }
  return params;
}

function sanitizeOrderAssociationsParams(): Record<string, string> {
  const params = {
    display: "full",
  };
  for (const [key, value] of Object.entries(params)) {
    assertNoSuspiciousUrlValue(value, key);
  }
  return params;
}

function sanitizeOrderDetailsParams(orderId: number): Record<string, string> {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("Prestashop request blocked: invalid order id");
  }
  const params = {
    "filter[id_order]": `[${orderId}]`,
    display: "full",
    limit: "0,250",
  };
  for (const [key, value] of Object.entries(params)) {
    assertNoSuspiciousUrlValue(value, key);
  }
  return params;
}

async function prestaGetXml(path: AllowedPrestaPath, params: Record<string, string>) {
  const url = prestaUrl(path, params);
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/xml" },
    timeoutMs: PRESTA_TIMEOUT_MS,
  });

  debugLog("presta request", {
    endpoint: path,
    status: response.status,
  });

  if (!response.ok) {
    throw new Error("Erreur de communication Prestashop.");
  }
  try {
    const raw = await readResponseTextWithLimit(response, PRESTA_MAX_RESPONSE_BYTES);
    return parser.parse(raw) as XmlRecord;
  } catch {
    throw new Error("Réponse Prestashop invalide.");
  }
}

export async function listOrders(input: {
  customerId: number;
  sinceId?: number;
  updatedAtMin?: string;
  updatedAtMax?: string;
  offset: number;
  limit: number;
  sortKey?: OrdersSortKey;
  sortDirection?: OrderSortDirection;
}): Promise<PrestaOrder[]> {
  const resolvedInput = {
    ...input,
    sinceId: input.sinceId ?? null,
    updatedAtMin: input.updatedAtMin?.trim() || null,
    updatedAtMax: input.updatedAtMax?.trim() || null,
    sortKey: input.sortKey ?? "id",
    sortDirection: input.sortDirection ?? "ASC",
  };
  debugLog("presta listOrders input", {
    customerId: resolvedInput.customerId,
    sinceId: resolvedInput.sinceId,
    updatedAtMin: resolvedInput.updatedAtMin,
    updatedAtMax: resolvedInput.updatedAtMax,
    offset: resolvedInput.offset,
    limit: resolvedInput.limit,
    sortKey: resolvedInput.sortKey,
    sortDirection: resolvedInput.sortDirection,
  });
  const parsed = await prestaGetXml("/api/orders", sanitizeOrdersListParams(resolvedInput));
  const orders = parseOrdersListXml(parsed);
  debugLog("presta listOrders result", {
    count: orders.length,
    rows: orders.slice(0, 50).map((order) => ({
      id_order: order.id,
      reference: order.reference,
      id_customer: order.customerId,
      current_state: order.currentState,
      date_add: order.dateAdd,
      date_upd: order.dateUpd,
    })),
  });
  return orders;
}

export async function getOrderById(orderId: number): Promise<PrestaOrder | null> {
  const parsed = await prestaGetXml(buildOrderPath(orderId), sanitizeOrderByIdParams());
  try {
    const order = parseOrderDetailXml(parsed);
    debugLog("presta order parsed", { id: order.id, id_customer: order.customerId });
    return order;
  } catch (error) {
    if (error instanceof PrestaParsingError) {
      throw error;
    }
    throw new PrestaParsingError("Unable to parse Presta order detail response");
  }
}

function parseOrderLinesFromOrderDetailsPayload(parsed: XmlRecord): PrestaOrderLine[] {
  const rows = toArray(
    (
      parsed.prestashop as
        | { order_details?: { order_detail?: unknown } }
        | undefined
    )?.order_details?.order_detail as XmlRecord | XmlRecord[] | undefined,
  );
  const lines = rows
    .map((line, index) => {
      const rec = line as XmlRecord;
      const skuCandidates = [
        getText(rec.product_reference),
        getText(rec.reference),
        getText(rec.product_supplier_reference),
      ];
      const fallbackSkuParts = [getText(rec.product_id), getText(rec.product_attribute_id)].filter(Boolean);
      const fallbackSku =
        fallbackSkuParts.length > 0 ? `PRESTA-${fallbackSkuParts.join("-")}` : `PRESTA-ROW-${index + 1}`;
      const sku = normalizeSkuText(skuCandidates.find((candidate) => candidate.trim().length > 0) ?? fallbackSku);
      const qtyRaw = getText(rec.product_quantity) || getText(rec.quantity);
      const qty = parsePrestaQuantity(qtyRaw);
      return { sku, qty };
    })
    .filter((line): line is { sku: string; qty: number } => Boolean(line.sku) && isValidSku(line.sku) && line.qty != null);
  debugLog("presta order details parsed", {
    rows: rows.length,
    kept: lines.length,
  });
  return lines;
}

function parseOrderLinesFromOrderAssociationsPayload(parsed: XmlRecord): PrestaOrderLine[] {
  const orderNode =
    (parsed.prestashop as { order?: XmlRecord } | undefined)?.order ??
    null;
  if (!orderNode) return [];
  const rows = toArray(
    (
      orderNode.associations as
        | { order_rows?: { order_row?: unknown } }
        | undefined
    )?.order_rows?.order_row as XmlRecord | XmlRecord[] | undefined,
  );
  return rows
    .map((row, index) => {
      const rec = row as XmlRecord;
      const skuCandidates = [
        getText(rec.product_reference),
        getText(rec.reference),
        getText(rec.product_supplier_reference),
      ];
      const fallbackSkuParts = [getText(rec.product_id), getText(rec.product_attribute_id)].filter(Boolean);
      const fallbackSku =
        fallbackSkuParts.length > 0 ? `PRESTA-${fallbackSkuParts.join("-")}` : `PRESTA-ROW-${index + 1}`;
      const sku = normalizeSkuText(skuCandidates.find((candidate) => candidate.trim().length > 0) ?? fallbackSku);
      const qtyRaw = getText(rec.product_quantity) || getText(rec.quantity);
      const qty = parsePrestaQuantity(qtyRaw);
      return { sku, qty };
    })
    .filter((line): line is { sku: string; qty: number } => Boolean(line.sku) && isValidSku(line.sku) && line.qty != null);
}

export async function getOrderDetails(orderId: number): Promise<PrestaOrderLine[]> {
  const parsedOrderDetails = await prestaGetXml("/api/order_details", sanitizeOrderDetailsParams(orderId));
  const directLines = parseOrderLinesFromOrderDetailsPayload(parsedOrderDetails);
  if (directLines.length > 0) {
    return directLines;
  }

  debugLog("presta order details empty; fallback to order associations", { orderId });
  const parsedOrder = await prestaGetXml(buildOrderPath(orderId), sanitizeOrderAssociationsParams());
  const fallbackLines = parseOrderLinesFromOrderAssociationsPayload(parsedOrder);
  debugLog("presta order details fallback result", {
    orderId,
    count: fallbackLines.length,
    rows: fallbackLines.slice(0, 50),
  });
  return fallbackLines;
}


