import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { buildEffectiveThresholdMap } from "../services/inventoryThresholdService";
import { getSalesRateMap } from "../services/prestaSalesService";
import { listIncomingForLocation } from "../services/purchaseOrderService";
import { coerceLocationGid, resolveAdminForPos } from "../services/posAuth.server";
import { getStockOnLocation } from "../services/shopifyGraphql";
import { jsonPos, posPreflight } from "../utils/posCors.server";
import { normalizeSkuText, sanitizeSearchQuery } from "../utils/validators";

function parseLimit(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") {
    return posPreflight();
  }
  if (method !== "GET") {
    return jsonPos({ ok: false, error: `Méthode ${request.method} non autorisée.` }, 405);
  }

  try {
    const url = new URL(request.url);
    const locationId = coerceLocationGid(String(url.searchParams.get("locationId") ?? ""));
    const query = sanitizeSearchQuery(String(url.searchParams.get("q") ?? ""));
    const limit = parseLimit(String(url.searchParams.get("limit") ?? "30"));

    if (!locationId) {
      return jsonPos({ ok: false, error: "locationId invalide." }, 400);
    }

    const { admin, shop } = await resolveAdminForPos(request);
    const incoming = await listIncomingForLocation(admin, shop, {
      locationId,
      query,
      limit,
    });

    const inventoryItemIds = incoming.items.map((item) => item.inventoryItemId).filter(Boolean);
    const stocks = inventoryItemIds.length ? await getStockOnLocation(admin, inventoryItemIds, locationId) : new Map();

    const skuList = incoming.items
      .map((item) => normalizeSkuText(item.sku).toUpperCase())
      .filter(Boolean);

    const [thresholds, salesRates] = await Promise.all([
      buildEffectiveThresholdMap(admin, shop, { locationId, skus: skuList }),
      getSalesRateMap(admin, shop, {
        locationId,
        rangeDays: 30,
        skus: skuList,
      }),
    ]);

    const items = incoming.items.map((item) => {
      const availableQty = item.inventoryItemId ? stocks.get(item.inventoryItemId) ?? 0 : 0;
      const etaMs = item.etaDate ? Date.parse(item.etaDate) : NaN;
      const delayed = item.incomingQty > 0 && Number.isFinite(etaMs) && etaMs < Date.now();
      const sku = normalizeSkuText(item.sku).toUpperCase();
      const threshold = thresholds.get(sku) ?? {
        minQty: 0,
        maxQty: 0,
        safetyStock: 0,
        targetCoverageDays: 30,
        source: "default",
      };
      const avgDailySales = Math.max(0, Number(salesRates.get(sku)?.avgDailySales || 0));
      const coverageDays = avgDailySales > 0 ? Number(((availableQty + item.incomingQty) / avgDailySales).toFixed(1)) : null;
      const stockoutRaw = avgDailySales > 0 ? (availableQty + item.incomingQty - threshold.safetyStock) / avgDailySales : null;
      const stockoutDays = stockoutRaw == null ? null : Math.floor(stockoutRaw);
      const stockoutDate =
        stockoutRaw == null
          ? null
          : new Date(Date.now() + Math.max(0, stockoutRaw) * 24 * 60 * 60 * 1000).toISOString();

      let suggestedQty = 0;
      if (avgDailySales > 0) {
        const base = threshold.targetCoverageDays * avgDailySales + threshold.safetyStock - availableQty - item.incomingQty;
        const minGap = threshold.minQty > 0 ? threshold.minQty - availableQty - item.incomingQty : 0;
        suggestedQty = Math.max(0, Math.ceil(Math.max(base, minGap)));
        if (threshold.maxQty > 0) {
          suggestedQty = Math.min(suggestedQty, Math.max(0, threshold.maxQty - availableQty - item.incomingQty));
        }
      }

      let riskStatus: "ok" | "warning" | "critical" | "no_sales" = "no_sales";
      if (availableQty <= 0) riskStatus = "critical";
      else if (avgDailySales <= 0) riskStatus = threshold.minQty > 0 && availableQty < threshold.minQty ? "warning" : "no_sales";
      else if ((stockoutDays ?? 999) <= 7) riskStatus = "critical";
      else if ((stockoutDays ?? 999) <= 21) riskStatus = "warning";
      else riskStatus = "ok";

      return {
        ...item,
        availableQty,
        delayed,
        sources: item.sources.slice(0, 10),
        minQty: threshold.minQty,
        maxQty: threshold.maxQty,
        safetyStock: threshold.safetyStock,
        targetCoverageDays: threshold.targetCoverageDays,
        thresholdSource: threshold.source,
        avgDailySales,
        coverageDays,
        stockoutDays,
        stockoutDate,
        suggestedQty,
        riskStatus,
      };
    });

    return jsonPos({
      ok: true,
      locationId,
      query,
      totalCount: incoming.totalCount,
      items,
    });
  } catch (error) {
    const status = error instanceof Response ? error.status : 500;
    const message = error instanceof Error ? error.message : "Erreur interne";
    return jsonPos({ ok: false, error: message }, status);
  }
};

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() === "OPTIONS") {
    return posPreflight();
  }
  return jsonPos({ ok: false, error: `Méthode ${request.method} non autorisée.` }, 405);
}
