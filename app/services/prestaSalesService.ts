import { getBoutiqueMappingByLocationName } from "../config/boutiques";
import { env } from "../env.server";
import { formatPrestaDateTime } from "../utils/prestaCheckpoint";
import { normalizeSkuText } from "../utils/validators";
import type { AdminClient } from "./auth.server";
import { safeLogAuditEvent } from "./auditLogService";
import { getOrderDetails, listOrders } from "./prestaClient";
import { listLocations } from "./shopifyGraphql";
import {
  ensureMetaobjectDefinitions,
  fieldValue,
  getMetaTypes,
  getShopMetafieldValue,
  listMetaobjects,
  setShopMetafields,
  upsertMetaobjectByHandle,
} from "./shopifyMetaobjects";

const SALES_METAFIELD_NAMESPACE = "wearmoi_stock_sync";
const SALES_REFRESH_KEY_PREFIX = "sales_agg_refresh";
const DEFAULT_REFRESH_TTL_MS = 15 * 60 * 1000;
const MAX_ORDERS_PER_REFRESH = 400;
const ORDER_PAGE_SIZE = 100;
const IGNORED_PRESTA_STATES = new Set(["6", "8"]);

export type SalesAggRow = {
  id: string;
  handle: string;
  sku: string;
  locationId: string;
  rangeDays: number;
  totalSold: number;
  avgDailySales: number;
  windowStartAt: string;
  windowEndAt: string;
  salesLastAt: string;
  source: string;
  payload: string;
  updatedAt: string;
};

export type SalesRate = {
  sku: string;
  locationId: string;
  rangeDays: number;
  totalSold: number;
  avgDailySales: number;
};

export type ForecastResult = {
  sku: string;
  locationId: string;
  avgDailySales30: number;
  avgDailySales90: number;
  avgDailySales365: number;
  trendFactor: number;
  seasonalityIndex: number;
  forecast30: number;
  forecast60: number;
  forecast90: number;
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function normalizeSku(value: string): string {
  return normalizeSkuText(value).toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toNonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function toNonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function skuToken(sku: string): string {
  return normalizeSku(sku)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sku";
}

function locationToken(locationId: string): string {
  const last = cleanText(locationId).split("/").pop() || cleanText(locationId);
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "location";
}

function refreshMetafieldKey(locationId: string, rangeDays: number): string {
  return `${SALES_REFRESH_KEY_PREFIX}_${locationToken(locationId)}_${Math.max(1, Math.trunc(rangeDays))}`;
}

function salesHandle(locationId: string, rangeDays: number, sku: string): string {
  return `sales-${locationToken(locationId)}-${Math.max(1, Math.trunc(rangeDays))}-${skuToken(sku)}`;
}

function toIsoFromPresta(rawValue: string): string {
  const trimmed = cleanText(rawValue);
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed.replace(" ", "T") + "Z");
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

async function resolveSalesSource(admin: AdminClient, locationId?: string | null): Promise<{ locationId: string; customerId: number }> {
  const locations = await listLocations(admin);
  const requestedLocationId = cleanText(locationId);
  const location = requestedLocationId
    ? locations.find((entry) => entry.id === requestedLocationId) ?? null
    : locations.find((entry) => entry.name.trim().toLowerCase() === "boutique toulon") ?? locations[0] ?? null;

  if (!location) {
    throw new Error("Aucune location Shopify disponible pour calculer les ventes.");
  }

  const mapping = getBoutiqueMappingByLocationName(location.name);
  const customerId = mapping?.prestaCustomerId ?? env.prestaBoutiqueCustomerId;
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new Error(`Client Prestashop manquant pour la boutique ${location.name}.`);
  }

  return { locationId: location.id, customerId };
}

function parseSalesAgg(node: {
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): SalesAggRow {
  const find = (key: string) => fieldValue(node, key);
  return {
    id: node.id,
    handle: node.handle,
    sku: normalizeSku(find("sku")),
    locationId: cleanText(find("location_id")),
    rangeDays: Math.max(1, toNonNegativeInt(find("range_days"))),
    totalSold: toNonNegativeInt(find("total_sold")),
    avgDailySales: toNonNegativeNumber(find("avg_daily_sales")),
    windowStartAt: cleanText(find("window_start_at")),
    windowEndAt: cleanText(find("window_end_at")),
    salesLastAt: cleanText(find("sales_last_at")),
    source: cleanText(find("source")),
    payload: cleanText(find("payload")),
    updatedAt: node.updatedAt,
  };
}

export async function listSalesAggRows(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId?: string | null;
    rangeDays?: number | null;
    skus?: string[] | null;
  } = {},
): Promise<SalesAggRow[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const rows = (await listMetaobjects(admin, types.salesAgg)).map(parseSalesAgg);

  const skuSet = new Set((input.skus ?? []).map((sku) => normalizeSku(sku)).filter(Boolean));
  const filtered = rows
    .filter((row) => (input.locationId ? row.locationId === input.locationId : true))
    .filter((row) => (input.rangeDays ? row.rangeDays === Math.max(1, Math.trunc(Number(input.rangeDays))) : true))
    .filter((row) => (skuSet.size ? skuSet.has(row.sku) : true));

  return filtered.sort((a, b) => b.totalSold - a.totalSold || a.sku.localeCompare(b.sku, "fr"));
}

export async function ensureSalesAggFresh(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId?: string | null;
    rangeDays: number;
    ttlMs?: number;
    forceRefresh?: boolean;
  },
): Promise<{ locationId: string; refreshed: boolean; refreshedAt: string }> {
  const rangeDays = Math.max(1, Math.trunc(Number(input.rangeDays || 30)));
  const source = await resolveSalesSource(admin, input.locationId);
  const key = refreshMetafieldKey(source.locationId, rangeDays);
  const ttlMs = Math.max(10_000, Math.trunc(Number(input.ttlMs ?? DEFAULT_REFRESH_TTL_MS)));

  const rawLastRefresh = await getShopMetafieldValue(admin, SALES_METAFIELD_NAMESPACE, key);
  const lastRefreshMs = Date.parse(cleanText(rawLastRefresh));
  const isFresh = Number.isFinite(lastRefreshMs) && Date.now() - lastRefreshMs <= ttlMs;

  if (!input.forceRefresh && isFresh) {
    return { locationId: source.locationId, refreshed: false, refreshedAt: new Date(lastRefreshMs).toISOString() };
  }

  const refreshedAt = await refreshSalesAggFromPresta(admin, shopDomain, {
    locationId: source.locationId,
    customerId: source.customerId,
    rangeDays,
  });

  return { locationId: source.locationId, refreshed: true, refreshedAt };
}

export async function refreshSalesAggFromPresta(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId: string;
    customerId: number;
    rangeDays: number;
    maxOrders?: number;
  },
): Promise<string> {
  const rangeDays = Math.max(1, Math.trunc(Number(input.rangeDays || 30)));
  const maxOrders = Math.max(1, Math.min(MAX_ORDERS_PER_REFRESH, Math.trunc(Number(input.maxOrders ?? MAX_ORDERS_PER_REFRESH))));

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const windowStartPresta = formatPrestaDateTime(windowStart);
  const windowEndPresta = formatPrestaDateTime(windowEnd);

  const totals = new Map<string, { totalSold: number; salesLastAt: string; orderCount: number }>();
  let offset = 0;
  let seenOrders = 0;

  while (seenOrders < maxOrders) {
    const batch = await listOrders({
      customerId: input.customerId,
      updatedAtMin: windowStartPresta,
      updatedAtMax: windowEndPresta,
      offset,
      limit: ORDER_PAGE_SIZE,
      sortKey: "date_upd",
      sortDirection: "ASC",
    });

    if (!batch.length) {
      break;
    }

    for (const order of batch) {
      if (seenOrders >= maxOrders) break;
      if (IGNORED_PRESTA_STATES.has(String(order.currentState).trim())) {
        continue;
      }

      let lines;
      try {
        lines = await getOrderDetails(order.id);
      } catch {
        continue;
      }

      seenOrders += 1;
      const salesLastAt = toIsoFromPresta(order.dateUpd) || windowEnd.toISOString();

      for (const line of lines) {
        const sku = normalizeSku(line.sku);
        if (!sku) continue;
        const qty = Math.max(0, Math.trunc(Number(line.qty || 0)));
        if (qty <= 0) continue;

        const existing = totals.get(sku);
        if (!existing) {
          totals.set(sku, { totalSold: qty, salesLastAt, orderCount: 1 });
          continue;
        }

        existing.totalSold += qty;
        existing.orderCount += 1;
        if (salesLastAt && (!existing.salesLastAt || Date.parse(salesLastAt) > Date.parse(existing.salesLastAt))) {
          existing.salesLastAt = salesLastAt;
        }
      }
    }

    if (batch.length < ORDER_PAGE_SIZE) {
      break;
    }

    offset += ORDER_PAGE_SIZE;
  }

  for (const [sku, summary] of totals) {
    const avgDailySales = summary.totalSold / rangeDays;
    await upsertMetaobjectByHandle(admin, types.salesAgg, salesHandle(input.locationId, rangeDays, sku), [
      { key: "sku", value: sku },
      { key: "location_id", value: input.locationId },
      { key: "range_days", value: String(rangeDays) },
      { key: "total_sold", value: String(summary.totalSold) },
      { key: "avg_daily_sales", value: avgDailySales.toFixed(4) },
      { key: "window_start_at", value: windowStart.toISOString() },
      { key: "window_end_at", value: windowEnd.toISOString() },
      { key: "sales_last_at", value: summary.salesLastAt || "" },
      { key: "source", value: "prestashop_b2b_toulon" },
      {
        key: "payload",
        value: JSON.stringify({
          orderCount: summary.orderCount,
          customerId: input.customerId,
          refreshedAt: windowEnd.toISOString(),
        }),
      },
    ]);
  }

  const refreshedAt = windowEnd.toISOString();
  await setShopMetafields(admin, [
    {
      namespace: SALES_METAFIELD_NAMESPACE,
      key: refreshMetafieldKey(input.locationId, rangeDays),
      type: "single_line_text_field",
      value: refreshedAt,
    },
  ]);

  await safeLogAuditEvent(admin, shopDomain, {
    eventType: "sales_agg.refresh",
    entityType: "sales_agg",
    locationId: input.locationId,
    status: "success",
    message: `Agrégats de vente recalculés sur ${rangeDays}j`,
    payload: {
      rangeDays,
      skuCount: totals.size,
      seenOrders,
      customerId: input.customerId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    },
  });

  return refreshedAt;
}

export async function getSalesRateMap(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId: string;
    rangeDays: number;
    skus?: string[];
    ensureFresh?: boolean;
    forceRefresh?: boolean;
  },
): Promise<Map<string, SalesRate>> {
  const rangeDays = Math.max(1, Math.trunc(Number(input.rangeDays || 30)));
  if (input.ensureFresh) {
    await ensureSalesAggFresh(admin, shopDomain, {
      locationId: input.locationId,
      rangeDays,
      forceRefresh: Boolean(input.forceRefresh),
    });
  }

  const rows = await listSalesAggRows(admin, shopDomain, {
    locationId: input.locationId,
    rangeDays,
    skus: input.skus,
  });

  const map = new Map<string, SalesRate>();
  for (const row of rows) {
    map.set(row.sku, {
      sku: row.sku,
      locationId: row.locationId,
      rangeDays: row.rangeDays,
      totalSold: row.totalSold,
      avgDailySales: row.avgDailySales,
    });
  }

  return map;
}

export async function getSalesRateForSku(
  admin: AdminClient,
  shopDomain: string,
  input: {
    sku: string;
    locationId: string;
    rangeDays: number;
    ensureFresh?: boolean;
    forceRefresh?: boolean;
  },
): Promise<SalesRate> {
  const sku = normalizeSku(input.sku);
  const map = await getSalesRateMap(admin, shopDomain, {
    locationId: input.locationId,
    rangeDays: input.rangeDays,
    skus: [sku],
    ensureFresh: input.ensureFresh,
    forceRefresh: input.forceRefresh,
  });
  const existing = map.get(sku);
  if (existing) return existing;
  return {
    sku,
    locationId: input.locationId,
    rangeDays: Math.max(1, Math.trunc(Number(input.rangeDays || 30))),
    totalSold: 0,
    avgDailySales: 0,
  };
}

export async function computeForecastForSku(
  admin: AdminClient,
  shopDomain: string,
  input: {
    sku: string;
    locationId: string;
    ensureFresh?: boolean;
    forceRefresh?: boolean;
  },
): Promise<ForecastResult> {
  const sku = normalizeSku(input.sku);
  const [rate30, rate90, rate365] = await Promise.all([
    getSalesRateForSku(admin, shopDomain, {
      sku,
      locationId: input.locationId,
      rangeDays: 30,
      ensureFresh: input.ensureFresh,
      forceRefresh: input.forceRefresh,
    }),
    getSalesRateForSku(admin, shopDomain, {
      sku,
      locationId: input.locationId,
      rangeDays: 90,
      ensureFresh: input.ensureFresh,
      forceRefresh: input.forceRefresh,
    }),
    getSalesRateForSku(admin, shopDomain, {
      sku,
      locationId: input.locationId,
      rangeDays: 365,
      ensureFresh: input.ensureFresh,
      forceRefresh: input.forceRefresh,
    }),
  ]);

  const trendFactor = rate90.avgDailySales > 0 ? clamp(rate30.avgDailySales / rate90.avgDailySales, 0.5, 1.8) : 1;
  const seasonalityIndex = rate365.avgDailySales > 0 ? clamp(rate30.avgDailySales / rate365.avgDailySales, 0.6, 1.8) : 1;
  const adjustedDaily = rate30.avgDailySales * trendFactor * seasonalityIndex;

  return {
    sku,
    locationId: input.locationId,
    avgDailySales30: rate30.avgDailySales,
    avgDailySales90: rate90.avgDailySales,
    avgDailySales365: rate365.avgDailySales,
    trendFactor,
    seasonalityIndex,
    forecast30: Math.max(0, Math.round(adjustedDaily * 30)),
    forecast60: Math.max(0, Math.round(adjustedDaily * 60)),
    forecast90: Math.max(0, Math.round(adjustedDaily * 90)),
  };
}
