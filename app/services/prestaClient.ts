import { XMLParser } from "fast-xml-parser";
import { env } from "../env.server";
import { debugLog } from "../utils/debug";
import { fetchWithRetry, readResponseTextWithLimit } from "../utils/http.server";
import { isValidSku, normalizeSkuText, parseNonNegativeIntInput } from "../utils/validators";
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

const PRESTA_TIMEOUT_MS = 10_000;
const PRESTA_MAX_RESPONSE_BYTES = 1_000_000;
const SUSPICIOUS_URL_VALUE_PATTERN = /(\.\.|\/\/|%|http|@|\\)/i;
const ALLOWED_STATIC_PATHS = new Set(["/api/orders", "/api/order_details"]);

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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

function assertOrdersQueryInput(input: { customerId: number; sinceId: number; offset: number; limit: number }): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error("Prestashop request blocked: invalid customer id");
  }
  if (!Number.isInteger(input.sinceId) || input.sinceId < 0) {
    throw new Error("Prestashop request blocked: invalid sinceId");
  }
  if (!Number.isInteger(input.offset) || input.offset < 0) {
    throw new Error("Prestashop request blocked: invalid offset");
  }
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 250) {
    throw new Error("Prestashop request blocked: invalid limit");
  }
}

function sanitizeOrdersListParams(input: {
  customerId: number;
  sinceId: number;
  offset: number;
  limit: number;
}): Record<string, string> {
  assertOrdersQueryInput(input);
  const params = {
    "filter[id_customer]": `[${input.customerId}]`,
    "filter[id]": `[>${input.sinceId}]`,
    sort: "[id_ASC]",
    display: "[id,id_customer,reference,date_add,date_upd]",
    limit: `${input.offset},${input.limit}`,
  };
  for (const [key, value] of Object.entries(params)) {
    assertNoSuspiciousUrlValue(value, key);
  }
  return params;
}

function sanitizeOrderByIdParams(): Record<string, string> {
  const params = {
    display: "[id,id_customer,reference,date_add,date_upd]",
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
    display: "[product_reference,product_quantity]",
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
  sinceId: number;
  offset: number;
  limit: number;
}): Promise<PrestaOrder[]> {
  const parsed = await prestaGetXml("/api/orders", sanitizeOrdersListParams(input));
  return parseOrdersListXml(parsed);
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

export async function getOrderDetails(orderId: number): Promise<PrestaOrderLine[]> {
  const parsed = await prestaGetXml("/api/order_details", sanitizeOrderDetailsParams(orderId));
  const lines = toArray(
    (
      parsed.prestashop as
        | { order_details?: { order_detail?: unknown } }
        | undefined
    )?.order_details?.order_detail as XmlRecord | XmlRecord[] | undefined,
  );
  return lines
    .map((line) => {
      const sku = normalizeSkuText(getText((line as XmlRecord).product_reference));
      const qty = parseNonNegativeIntInput(getText((line as XmlRecord).product_quantity));
      return {
        sku,
        qty,
      };
    })
    .filter((line): line is { sku: string; qty: number } => Boolean(line.sku) && isValidSku(line.sku) && line.qty != null);
}
