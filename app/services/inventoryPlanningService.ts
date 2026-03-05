import type { AdminClient } from "./auth.server";
import { createPurchaseOrderDraft, type PurchaseOrderLineDraftInput } from "./purchaseOrderService";
import { listIncomingForLocation } from "./purchaseOrderService";
import { getInventoryItemSnapshots, getStockOnLocation, resolveSkus } from "./shopifyGraphql";
import { listSupplierSkuMappings, listSuppliers } from "./inventorySupplierService";
import {
  buildEffectiveThresholdMap,
  listThresholdGlobals,
  listThresholdOverrides,
  type EffectiveThreshold,
} from "./inventoryThresholdService";
import { getSalesRateMap, listSalesAggRows } from "./prestaSalesService";
import { normalizeSkuText } from "../utils/validators";

export type PlanningRiskStatus = "ok" | "warning" | "critical" | "no_sales";

export type PlanningRow = {
  sku: string;
  inventoryItemId: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  availableQty: number;
  incomingQty: number;
  etaDate: string | null;
  sourceRef: string;
  minQty: number;
  maxQty: number;
  safetyStock: number;
  targetCoverageDays: number;
  thresholdSource: EffectiveThreshold["source"];
  avgDailySales: number;
  salesRangeDays: number;
  coverageDays: number | null;
  stockoutDays: number | null;
  stockoutDate: string | null;
  stockoutLabel: string;
  riskStatus: PlanningRiskStatus;
  leadTimeDays: number;
  suggestedQty: number;
  underMin: boolean;
  outOfStock: boolean;
  overStock: boolean;
};

export type PlanningSummary = {
  total: number;
  critical: number;
  warning: number;
  noSales: number;
  outOfStock: number;
  underMin: number;
  overStock: number;
  incomingUnits: number;
  suggestedUnits: number;
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function normalizeSku(value: string): string {
  return normalizeSkuText(value).toUpperCase();
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysIso(days: number): string {
  const base = startOfTodayUtc();
  base.setUTCDate(base.getUTCDate() + Math.max(0, Math.floor(days)));
  return base.toISOString();
}

function formatStockoutLabel(stockoutDays: number | null): string {
  if (stockoutDays == null) return "Aucune vente récente";
  if (stockoutDays <= 0) return "Rupture imminente";
  if (stockoutDays === 1) return "Rupture estimée dans 1 jour";
  return `Rupture estimée dans ${stockoutDays} jours`;
}

type SupplierLeadTimeContext = {
  defaultLeadTimeDays: number;
  perSkuLeadTimeDays: Map<string, number>;
};

async function getSupplierLeadTimeContext(admin: AdminClient, shopDomain: string): Promise<SupplierLeadTimeContext> {
  const [suppliers, mappings] = await Promise.all([
    listSuppliers(admin, shopDomain, { includeInactive: false }),
    listSupplierSkuMappings(admin, shopDomain, { includeInactiveSuppliers: false }),
  ]);

  const defaultLeadTimeDays =
    suppliers
      .map((supplier) => Math.max(0, Math.trunc(Number(supplier.leadTimeDays || 0))))
      .filter((days) => days > 0)
      .sort((a, b) => a - b)[0] ?? 14;

  // If a SKU has multiple supplier mappings, keep the shortest lead time.
  const perSkuLeadTimeDays = new Map<string, number>();
  for (const mapping of mappings) {
    const sku = normalizeSku(mapping.sku);
    if (!sku) continue;
    const days = Math.max(0, Math.trunc(Number(mapping.leadTimeDaysOverride || 0)));
    if (days <= 0) continue;
    const existing = perSkuLeadTimeDays.get(sku);
    if (!existing || days < existing) {
      perSkuLeadTimeDays.set(sku, days);
    }
  }

  return { defaultLeadTimeDays, perSkuLeadTimeDays };
}

function computeSuggestion(input: {
  availableQty: number;
  incomingQty: number;
  avgDailySales: number;
  threshold: EffectiveThreshold;
  leadTimeDays: number;
}): number {
  const stock = Math.max(0, Number(input.availableQty || 0));
  const incoming = Math.max(0, Number(input.incomingQty || 0));
  const avg = Math.max(0, Number(input.avgDailySales || 0));
  const targetCoverage = Math.max(1, Number(input.threshold.targetCoverageDays || 30));
  const safety = Math.max(0, Number(input.threshold.safetyStock || 0));

  let suggestedRaw = targetCoverage * avg + safety - stock - incoming;

  if (input.leadTimeDays > 0) {
    const leadNeed = input.leadTimeDays * avg + safety - stock - incoming;
    suggestedRaw = Math.max(suggestedRaw, leadNeed);
  }

  if (input.threshold.minQty > 0) {
    suggestedRaw = Math.max(suggestedRaw, input.threshold.minQty - stock - incoming);
  }

  let suggestedQty = Math.max(0, Math.ceil(suggestedRaw));

  if (input.threshold.maxQty > 0) {
    const maxToOrder = Math.max(0, input.threshold.maxQty - stock - incoming);
    suggestedQty = Math.min(suggestedQty, maxToOrder);
  }

  return suggestedQty;
}

function computeRisk(input: {
  avgDailySales: number;
  stockoutDays: number | null;
  leadTimeDays: number;
  outOfStock: boolean;
  underMin: boolean;
}): PlanningRiskStatus {
  if (input.outOfStock) return "critical";
  if (input.avgDailySales <= 0) {
    return input.underMin ? "warning" : "no_sales";
  }
  if (input.stockoutDays == null) return "no_sales";
  if (input.stockoutDays <= 7) return "critical";
  if (input.stockoutDays <= Math.max(21, input.leadTimeDays)) return "warning";
  return "ok";
}

export async function buildPlanningRows(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId: string;
    rangeDays?: number;
    query?: string;
    status?: "all" | "critical" | "warning" | "ok" | "out_of_stock" | "under_min" | "overstock";
    limit?: number;
    ensureFreshSales?: boolean;
  },
): Promise<{ rows: PlanningRow[]; summary: PlanningSummary }> {
  const locationId = cleanText(input.locationId);
  if (!locationId) {
    throw new Error("locationId obligatoire pour charger la planification.");
  }

  const rangeDays = Math.max(1, Math.trunc(Number(input.rangeDays || 30)));
  const query = cleanText(input.query).toLowerCase();
  const limit = Math.max(1, Math.min(400, Math.trunc(Number(input.limit || 120))));

  const [incoming, thresholdGlobals, thresholdOverrides, salesRows, supplierLeadTimes] = await Promise.all([
    listIncomingForLocation(admin, shopDomain, { locationId, query: "", limit: 100 }),
    listThresholdGlobals(admin, shopDomain),
    listThresholdOverrides(admin, shopDomain, { locationId }),
    listSalesAggRows(admin, shopDomain, { locationId, rangeDays }),
    getSupplierLeadTimeContext(admin, shopDomain),
  ]);

  const skuCandidates = new Set<string>();
  incoming.items.forEach((item) => {
    const sku = normalizeSku(item.sku);
    if (sku) skuCandidates.add(sku);
  });
  thresholdGlobals.forEach((row) => skuCandidates.add(row.sku));
  thresholdOverrides.forEach((row) => skuCandidates.add(row.sku));
  salesRows.forEach((row) => skuCandidates.add(row.sku));

  let skuList = Array.from(skuCandidates);
  if (query) {
    skuList = skuList.filter((sku) => sku.toLowerCase().includes(query));
  }
  if (!skuList.length) {
    return {
      rows: [],
      summary: {
        total: 0,
        critical: 0,
        warning: 0,
        noSales: 0,
        outOfStock: 0,
        underMin: 0,
        overStock: 0,
        incomingUnits: 0,
        suggestedUnits: 0,
      },
    };
  }

  const incomingBySku = new Map(
    incoming.items
      .map((item) => [normalizeSku(item.sku), item] as const)
      .filter(([sku]) => Boolean(sku)),
  );

  const resolvedSkus = await resolveSkus(admin, skuList);
  const inventoryItemIds = new Set<string>();
  for (const sku of skuList) {
    const incomingItem = incomingBySku.get(sku);
    if (incomingItem?.inventoryItemId) {
      inventoryItemIds.add(incomingItem.inventoryItemId);
      continue;
    }
    const resolved = resolvedSkus.get(sku);
    if (resolved?.inventoryItemId) {
      inventoryItemIds.add(resolved.inventoryItemId);
    }
  }

  const inventoryIdsArray = Array.from(inventoryItemIds);

  const [stocks, snapshots, thresholds, salesRateMap] = await Promise.all([
    inventoryIdsArray.length ? getStockOnLocation(admin, inventoryIdsArray, locationId) : Promise.resolve(new Map()),
    inventoryIdsArray.length ? getInventoryItemSnapshots(admin, inventoryIdsArray) : Promise.resolve(new Map()),
    buildEffectiveThresholdMap(admin, shopDomain, { locationId, skus: skuList }),
    getSalesRateMap(admin, shopDomain, {
      locationId,
      rangeDays,
      skus: skuList,
      ensureFresh: Boolean(input.ensureFreshSales),
    }),
  ]);

  const rows = skuList.map((sku) => {
    const incomingItem = incomingBySku.get(sku);
    const resolved = resolvedSkus.get(sku);
    const inventoryItemId = cleanText(incomingItem?.inventoryItemId || resolved?.inventoryItemId || "");
    const snapshot = inventoryItemId ? snapshots.get(inventoryItemId) : null;

    const availableQty = inventoryItemId ? stocks.get(inventoryItemId) ?? 0 : 0;
    const incomingQty = Math.max(0, Number(incomingItem?.incomingQty || 0));
    const threshold =
      thresholds.get(sku) ??
      ({ sku, locationId, minQty: 0, maxQty: 0, safetyStock: 0, targetCoverageDays: 30, source: "default" } as EffectiveThreshold);

    const salesRate = salesRateMap.get(sku);
    const avgDailySales = Math.max(0, Number(salesRate?.avgDailySales || 0));

    const stockAfterSafety = availableQty + incomingQty - threshold.safetyStock;
    const stockoutRawDays = avgDailySales > 0 ? stockAfterSafety / avgDailySales : null;
    const stockoutDays = stockoutRawDays == null ? null : Math.floor(stockoutRawDays);
    const stockoutDate = stockoutRawDays == null ? null : addDaysIso(stockoutRawDays <= 0 ? 0 : stockoutRawDays);
    const coverageDays = avgDailySales > 0 ? Number(((availableQty + incomingQty) / avgDailySales).toFixed(1)) : null;

    const leadTimeDays = supplierLeadTimes.perSkuLeadTimeDays.get(sku) ?? supplierLeadTimes.defaultLeadTimeDays;
    const underMin = threshold.minQty > 0 && availableQty + incomingQty < threshold.minQty;
    const outOfStock = availableQty <= 0;
    const overStock = threshold.maxQty > 0 && availableQty > threshold.maxQty;

    const riskStatus = computeRisk({
      avgDailySales,
      stockoutDays,
      leadTimeDays,
      outOfStock,
      underMin,
    });

    const suggestedQty = computeSuggestion({
      availableQty,
      incomingQty,
      avgDailySales,
      threshold,
      leadTimeDays,
    });

    return {
      sku,
      inventoryItemId,
      productTitle: cleanText(incomingItem?.productTitle || snapshot?.productTitle || resolved?.variantTitle || sku),
      variantTitle: cleanText(incomingItem?.variantTitle || snapshot?.variantTitle || ""),
      imageUrl: cleanText(incomingItem?.imageUrl || snapshot?.imageUrl || ""),
      availableQty,
      incomingQty,
      etaDate: incomingItem?.etaDate ?? null,
      sourceRef: cleanText(incomingItem?.sources?.[0]?.number || ""),
      minQty: threshold.minQty,
      maxQty: threshold.maxQty,
      safetyStock: threshold.safetyStock,
      targetCoverageDays: threshold.targetCoverageDays,
      thresholdSource: threshold.source,
      avgDailySales: Number(avgDailySales.toFixed(4)),
      salesRangeDays: rangeDays,
      coverageDays,
      stockoutDays,
      stockoutDate,
      stockoutLabel: formatStockoutLabel(stockoutDays),
      riskStatus,
      leadTimeDays,
      suggestedQty,
      underMin,
      outOfStock,
      overStock,
    } satisfies PlanningRow;
  });

  const filteredByStatus = rows.filter((row) => {
    if (!input.status || input.status === "all") return true;
    if (input.status === "critical") return row.riskStatus === "critical";
    if (input.status === "warning") return row.riskStatus === "warning";
    if (input.status === "ok") return row.riskStatus === "ok";
    if (input.status === "out_of_stock") return row.outOfStock;
    if (input.status === "under_min") return row.underMin;
    if (input.status === "overstock") return row.overStock;
    return true;
  });

  const sorted = filteredByStatus.sort((a, b) => {
    const riskWeight = (status: PlanningRiskStatus): number => {
      if (status === "critical") return 3;
      if (status === "warning") return 2;
      if (status === "no_sales") return 1;
      return 0;
    };
    const riskDelta = riskWeight(b.riskStatus) - riskWeight(a.riskStatus);
    if (riskDelta !== 0) return riskDelta;

    const stockoutA = a.stockoutDays ?? Number.POSITIVE_INFINITY;
    const stockoutB = b.stockoutDays ?? Number.POSITIVE_INFINITY;
    if (stockoutA !== stockoutB) return stockoutA - stockoutB;

    if (a.suggestedQty !== b.suggestedQty) return b.suggestedQty - a.suggestedQty;
    return a.sku.localeCompare(b.sku, "fr");
  });

  const limitedRows = sorted.slice(0, limit);
  const summary = limitedRows.reduce<PlanningSummary>(
    (acc, row) => {
      acc.total += 1;
      if (row.riskStatus === "critical") acc.critical += 1;
      if (row.riskStatus === "warning") acc.warning += 1;
      if (row.riskStatus === "no_sales") acc.noSales += 1;
      if (row.outOfStock) acc.outOfStock += 1;
      if (row.underMin) acc.underMin += 1;
      if (row.overStock) acc.overStock += 1;
      acc.incomingUnits += row.incomingQty;
      acc.suggestedUnits += row.suggestedQty;
      return acc;
    },
    {
      total: 0,
      critical: 0,
      warning: 0,
      noSales: 0,
      outOfStock: 0,
      underMin: 0,
      overStock: 0,
      incomingUnits: 0,
      suggestedUnits: 0,
    },
  );

  return { rows: limitedRows, summary };
}

export async function createPurchaseOrderDraftFromSuggestions(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  input: {
    locationId: string;
    referenceNumber?: string;
    expectedArrivalAt?: string | null;
    supplierNotes?: string | null;
    internalNotes?: string | null;
    suggestions: Array<{
      sku: string;
      quantity: number;
    }>;
  },
): Promise<{ purchaseOrderGid: string; number: string; lineCount: number }> {
  const lines: PurchaseOrderLineDraftInput[] = input.suggestions
    .map((item) => ({
      sku: normalizeSku(item.sku),
      supplierSku: normalizeSku(item.sku),
      quantityOrdered: Math.max(0, Math.trunc(Number(item.quantity || 0))),
      unitCost: 0,
      taxRate: 20,
    }))
    .filter((item) => item.sku && item.quantityOrdered > 0);

  if (!lines.length) {
    throw new Error("Aucune suggestion valide à convertir en commande fournisseur.");
  }

  const draft = await createPurchaseOrderDraft(admin, shopDomain, actor, {
    destinationLocationId: input.locationId,
    referenceNumber: cleanText(input.referenceNumber) || null,
    expectedArrivalAt: cleanText(input.expectedArrivalAt),
    supplierNotes: cleanText(input.supplierNotes),
    internalNotes: cleanText(input.internalNotes),
    lines,
  });

  return {
    purchaseOrderGid: draft.purchaseOrderGid,
    number: draft.number,
    lineCount: lines.length,
  };
}
