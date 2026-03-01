import { XMLParser } from "fast-xml-parser";
import { env } from "../env.server";
import { debugLog } from "../utils/debug";
import { fetchWithRetry } from "../utils/http.server";
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

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function prestaUrl(path: string, params: Record<string, string>): URL {
  const cleanPath = path.startsWith("/") ? path : `/api/${path}`;
  const url = new URL(cleanPath, env.prestaBaseUrl);
  url.searchParams.set("ws_key", env.prestaWsKey);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url;
}

async function prestaGetXml(path: string, params: Record<string, string>) {
  const url = prestaUrl(path, params);
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/xml" },
    timeoutMs: 10_000,
  });

  debugLog("presta request", {
    endpoint: path.startsWith("/") ? path : `/api/${path}`,
    status: response.status,
  });

  if (!response.ok) {
    throw new Error(`Presta API error ${path} (${response.status})`);
  }
  const raw = await response.text();
  return parser.parse(raw) as XmlRecord;
}

export async function listOrders(input: {
  customerId: number;
  sinceId: number;
  offset: number;
  limit: number;
}): Promise<PrestaOrder[]> {
  const parsed = await prestaGetXml("orders", {
    "filter[id_customer]": `[${input.customerId}]`,
    "filter[id]": `[>${input.sinceId}]`,
    sort: "[id_ASC]",
    display: "[id,id_customer,reference,date_add,date_upd]",
    limit: `${input.offset},${input.limit}`,
  });
  return parseOrdersListXml(parsed);
}

export async function getOrderById(orderId: number): Promise<PrestaOrder | null> {
  const parsed = await prestaGetXml(`/api/orders/${orderId}`, {
    display: "[id,id_customer,reference,date_add,date_upd]",
  });
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
  const parsed = await prestaGetXml("order_details", {
    "filter[id_order]": `[${orderId}]`,
    display: "[product_reference,product_quantity]",
    limit: "0,250",
  });
  const lines = toArray(
    (
      parsed.prestashop as
        | { order_details?: { order_detail?: unknown } }
        | undefined
    )?.order_details?.order_detail as XmlRecord | XmlRecord[] | undefined,
  );
  return lines
    .map((line) => ({
      sku: getText((line as XmlRecord).product_reference),
      qty: Number(getText((line as XmlRecord).product_quantity)),
    }))
    .filter((line) => line.sku.length > 0 && Number.isFinite(line.qty) && line.qty > 0);
}
