import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { buildEffectiveThresholdMap } from "../services/inventoryThresholdService";
import { getSalesRateMap } from "../services/prestaSalesService";
import { coerceInventoryItemGid, coerceLocationGid, resolveAdminForPos } from "../services/posAuth.server";
import { getIncomingSnapshotForSku } from "../services/purchaseOrderService";
import { getStockOnLocation, resolveSkus } from "../services/shopifyGraphql";
import { jsonPos, posPreflight } from "../utils/posCors.server";
import { normalizeSkuText } from "../utils/validators";

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
    const sku = String(url.searchParams.get("sku") ?? "").trim();
    const inventoryItemIdRaw = coerceInventoryItemGid(String(url.searchParams.get("inventoryItemId") ?? ""));

    if (!locationId) {
      return jsonPos({ ok: false, error: "locationId invalide." }, 400);
    }
    if (!sku && !inventoryItemIdRaw) {
      return jsonPos({ ok: false, error: "sku ou inventoryItemId obligatoire." }, 400);
    }

    const { admin, shop } = await resolveAdminForPos(request);

    let inventoryItemId = inventoryItemIdRaw;
    if (!inventoryItemId && sku) {
      const resolved = await resolveSkus(admin, [sku]);
      inventoryItemId = resolved.get(sku)?.inventoryItemId ?? "";
    }

    if (!inventoryItemId) {
      return jsonPos({
        ok: true,
        sku,
        locationId,
        inventoryItemId: null,
        availableQty: 0,
        incomingQty: 0,
        etaDate: null,
        delayed: false,
        sources: [],
      });
    }

    const [stocks, incoming] = await Promise.all([
      getStockOnLocation(admin, [inventoryItemId], locationId),
      getIncomingSnapshotForSku(admin, shop, {
        locationId,
        sku: sku || null,
        inventoryItemId,
      }),
    ]);

    const availableQty = stocks.get(inventoryItemId) ?? 0;
    const etaMs = incoming.etaDate ? Date.parse(incoming.etaDate) : NaN;
    const delayed = incoming.incomingQty > 0 && Number.isFinite(etaMs) && etaMs < Date.now();
    const normalizedSku = normalizeSkuText(sku).toUpperCase();

    const [thresholds, salesRates] = await Promise.all([
      buildEffectiveThresholdMap(admin, shop, {
        locationId,
        skus: normalizedSku ? [normalizedSku] : [],
      }),
      getSalesRateMap(admin, shop, {
        locationId,
        rangeDays: 30,
        skus: normalizedSku ? [normalizedSku] : [],
      }),
    ]);

    const threshold = thresholds.get(normalizedSku) ?? {
      minQty: 0,
      maxQty: 0,
      safetyStock: 0,
      targetCoverageDays: 30,
      source: "default",
    };
    const avgDailySales = Math.max(0, Number(salesRates.get(normalizedSku)?.avgDailySales || 0));
    const coverageDays = avgDailySales > 0 ? Number(((availableQty + incoming.incomingQty) / avgDailySales).toFixed(1)) : null;
    const stockoutRaw = avgDailySales > 0 ? (availableQty + incoming.incomingQty - threshold.safetyStock) / avgDailySales : null;
    const stockoutDays = stockoutRaw == null ? null : Math.floor(stockoutRaw);
    const stockoutDate =
      stockoutRaw == null ? null : new Date(Date.now() + Math.max(0, stockoutRaw) * 24 * 60 * 60 * 1000).toISOString();

    let suggestedQty = 0;
    if (avgDailySales > 0) {
      const base = threshold.targetCoverageDays * avgDailySales + threshold.safetyStock - availableQty - incoming.incomingQty;
      const minGap = threshold.minQty > 0 ? threshold.minQty - availableQty - incoming.incomingQty : 0;
      suggestedQty = Math.max(0, Math.ceil(Math.max(base, minGap)));
      if (threshold.maxQty > 0) {
        suggestedQty = Math.min(suggestedQty, Math.max(0, threshold.maxQty - availableQty - incoming.incomingQty));
      }
    }

    let riskStatus: "ok" | "warning" | "critical" | "no_sales" = "no_sales";
    if (availableQty <= 0) riskStatus = "critical";
    else if (avgDailySales <= 0) riskStatus = threshold.minQty > 0 && availableQty < threshold.minQty ? "warning" : "no_sales";
    else if ((stockoutDays ?? 999) <= 7) riskStatus = "critical";
    else if ((stockoutDays ?? 999) <= 21) riskStatus = "warning";
    else riskStatus = "ok";

    return jsonPos({
      ok: true,
      sku,
      locationId,
      inventoryItemId,
      availableQty,
      incomingQty: incoming.incomingQty,
      etaDate: incoming.etaDate,
      delayed,
      sources: incoming.sources.slice(0, 10),
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
