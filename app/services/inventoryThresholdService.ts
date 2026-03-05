import type { AdminClient } from "./auth.server";
import {
  deleteMetaobject,
  ensureMetaobjectDefinitions,
  fieldValue,
  getMetaTypes,
  getMetaobjectByHandle,
  listMetaobjects,
  upsertMetaobjectByHandle,
} from "./shopifyMetaobjects";
import { normalizeSkuText } from "../utils/validators";

export const DEFAULT_TARGET_COVERAGE_DAYS = 30;

export type ThresholdValues = {
  minQty: number;
  maxQty: number;
  safetyStock: number;
  targetCoverageDays: number;
};

export type ThresholdGlobalRecord = ThresholdValues & {
  id: string;
  handle: string;
  sku: string;
  updatedAt: string;
  updatedBy: string;
  notes: string;
};

export type ThresholdOverrideRecord = ThresholdValues & {
  id: string;
  handle: string;
  sku: string;
  locationId: string;
  updatedAt: string;
  updatedBy: string;
  notes: string;
};

export type EffectiveThreshold = ThresholdValues & {
  sku: string;
  locationId: string;
  source: "override" | "global" | "default";
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function normalizeSku(value: string): string {
  return normalizeSkuText(value).toUpperCase();
}

function toNonNegativeInt(raw: string, fallback = 0): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function skuToken(sku: string): string {
  return normalizeSku(sku).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "sku";
}

function locationToken(locationId: string): string {
  const last = cleanText(locationId).split("/").pop() || cleanText(locationId);
  return last.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "location";
}

function thresholdGlobalHandle(sku: string): string {
  return `threshold-global-${skuToken(sku)}`;
}

function thresholdOverrideHandle(locationId: string, sku: string): string {
  return `threshold-override-${locationToken(locationId)}-${skuToken(sku)}`;
}

function parseThresholdValues(find: (key: string) => string): ThresholdValues {
  return {
    minQty: toNonNegativeInt(find("min_qty"), 0),
    maxQty: toNonNegativeInt(find("max_qty"), 0),
    safetyStock: toNonNegativeInt(find("safety_stock"), 0),
    targetCoverageDays: Math.max(1, toNonNegativeInt(find("target_coverage_days"), DEFAULT_TARGET_COVERAGE_DAYS)),
  };
}

function assertThresholdValues(values: ThresholdValues): void {
  if (values.maxQty > 0 && values.maxQty < values.minQty) {
    throw new Error("Le seuil max doit être supérieur ou égal au seuil min.");
  }
}

export async function listThresholdGlobals(
  admin: AdminClient,
  shopDomain: string,
): Promise<ThresholdGlobalRecord[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const nodes = await listMetaobjects(admin, types.thresholdGlobal);
  const rows = nodes.map((node) => {
    const find = (key: string) => fieldValue(node, key);
    return {
      id: node.id,
      handle: node.handle,
      sku: normalizeSku(find("sku")),
      ...parseThresholdValues(find),
      updatedAt: node.updatedAt,
      updatedBy: cleanText(find("updated_by")),
      notes: cleanText(find("notes")),
    };
  });
  return rows.sort((a, b) => a.sku.localeCompare(b.sku, "fr"));
}

export async function listThresholdOverrides(
  admin: AdminClient,
  shopDomain: string,
  options: { locationId?: string | null } = {},
): Promise<ThresholdOverrideRecord[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const nodes = await listMetaobjects(admin, types.thresholdOverride);
  const rows = nodes.map((node) => {
    const find = (key: string) => fieldValue(node, key);
    return {
      id: node.id,
      handle: node.handle,
      sku: normalizeSku(find("sku")),
      locationId: cleanText(find("location_id")),
      ...parseThresholdValues(find),
      updatedAt: node.updatedAt,
      updatedBy: cleanText(find("updated_by")),
      notes: cleanText(find("notes")),
    };
  });
  const filtered = options.locationId ? rows.filter((row) => row.locationId === options.locationId) : rows;
  return filtered.sort((a, b) => `${a.locationId}:${a.sku}`.localeCompare(`${b.locationId}:${b.sku}`, "fr"));
}

export async function upsertThresholdGlobal(
  admin: AdminClient,
  shopDomain: string,
  input: {
    sku: string;
    minQty: number;
    maxQty: number;
    safetyStock?: number;
    targetCoverageDays?: number;
    updatedBy?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const sku = normalizeSku(input.sku);
  if (!sku) {
    throw new Error("SKU manquant pour enregistrer le seuil global.");
  }
  const values: ThresholdValues = {
    minQty: Math.max(0, Math.trunc(Number(input.minQty || 0))),
    maxQty: Math.max(0, Math.trunc(Number(input.maxQty || 0))),
    safetyStock: Math.max(0, Math.trunc(Number(input.safetyStock || 0))),
    targetCoverageDays: Math.max(1, Math.trunc(Number(input.targetCoverageDays || DEFAULT_TARGET_COVERAGE_DAYS))),
  };
  assertThresholdValues(values);

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  await upsertMetaobjectByHandle(admin, types.thresholdGlobal, thresholdGlobalHandle(sku), [
    { key: "sku", value: sku },
    { key: "min_qty", value: String(values.minQty) },
    { key: "max_qty", value: String(values.maxQty) },
    { key: "safety_stock", value: String(values.safetyStock) },
    { key: "target_coverage_days", value: String(values.targetCoverageDays) },
    { key: "updated_by", value: cleanText(input.updatedBy) },
    { key: "notes", value: cleanText(input.notes) },
  ]);
}

export async function upsertThresholdOverride(
  admin: AdminClient,
  shopDomain: string,
  input: {
    sku: string;
    locationId: string;
    minQty: number;
    maxQty: number;
    safetyStock?: number;
    targetCoverageDays?: number;
    updatedBy?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const sku = normalizeSku(input.sku);
  const locationId = cleanText(input.locationId);
  if (!sku) {
    throw new Error("SKU manquant pour enregistrer l'override.");
  }
  if (!locationId) {
    throw new Error("locationId manquant pour enregistrer l'override.");
  }

  const values: ThresholdValues = {
    minQty: Math.max(0, Math.trunc(Number(input.minQty || 0))),
    maxQty: Math.max(0, Math.trunc(Number(input.maxQty || 0))),
    safetyStock: Math.max(0, Math.trunc(Number(input.safetyStock || 0))),
    targetCoverageDays: Math.max(1, Math.trunc(Number(input.targetCoverageDays || DEFAULT_TARGET_COVERAGE_DAYS))),
  };
  assertThresholdValues(values);

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  await upsertMetaobjectByHandle(admin, types.thresholdOverride, thresholdOverrideHandle(locationId, sku), [
    { key: "sku", value: sku },
    { key: "location_id", value: locationId },
    { key: "min_qty", value: String(values.minQty) },
    { key: "max_qty", value: String(values.maxQty) },
    { key: "safety_stock", value: String(values.safetyStock) },
    { key: "target_coverage_days", value: String(values.targetCoverageDays) },
    { key: "updated_by", value: cleanText(input.updatedBy) },
    { key: "notes", value: cleanText(input.notes) },
  ]);
}

export async function resetThresholdOverride(
  admin: AdminClient,
  shopDomain: string,
  input: { sku: string; locationId: string },
): Promise<boolean> {
  const sku = normalizeSku(input.sku);
  const locationId = cleanText(input.locationId);
  if (!sku || !locationId) return false;

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const existing = await getMetaobjectByHandle(admin, types.thresholdOverride, thresholdOverrideHandle(locationId, sku));
  if (!existing) return false;
  await deleteMetaobject(admin, existing.id);
  return true;
}

export async function copyThresholdOverrides(
  admin: AdminClient,
  shopDomain: string,
  input: { fromLocationId: string; toLocationId: string; updatedBy?: string | null },
): Promise<{ copied: number }> {
  const fromLocationId = cleanText(input.fromLocationId);
  const toLocationId = cleanText(input.toLocationId);
  if (!fromLocationId || !toLocationId) {
    throw new Error("Les deux locations sont obligatoires pour copier des overrides.");
  }

  const rows = await listThresholdOverrides(admin, shopDomain, { locationId: fromLocationId });
  let copied = 0;
  for (const row of rows) {
    await upsertThresholdOverride(admin, shopDomain, {
      sku: row.sku,
      locationId: toLocationId,
      minQty: row.minQty,
      maxQty: row.maxQty,
      safetyStock: row.safetyStock,
      targetCoverageDays: row.targetCoverageDays,
      updatedBy: input.updatedBy,
      notes: row.notes,
    });
    copied += 1;
  }
  return { copied };
}

export async function buildEffectiveThresholdMap(
  admin: AdminClient,
  shopDomain: string,
  input: { locationId: string; skus: string[] },
): Promise<Map<string, EffectiveThreshold>> {
  const locationId = cleanText(input.locationId);
  const skuKeys = Array.from(new Set(input.skus.map(normalizeSku).filter(Boolean)));
  const result = new Map<string, EffectiveThreshold>();

  if (!locationId || skuKeys.length === 0) {
    return result;
  }

  const [globals, overrides] = await Promise.all([
    listThresholdGlobals(admin, shopDomain),
    listThresholdOverrides(admin, shopDomain, { locationId }),
  ]);

  const globalMap = new Map(globals.map((row) => [row.sku, row]));
  const overrideMap = new Map(overrides.map((row) => [row.sku, row]));

  for (const sku of skuKeys) {
    const override = overrideMap.get(sku);
    if (override) {
      result.set(sku, {
        sku,
        locationId,
        minQty: override.minQty,
        maxQty: override.maxQty,
        safetyStock: override.safetyStock,
        targetCoverageDays: override.targetCoverageDays,
        source: "override",
      });
      continue;
    }

    const global = globalMap.get(sku);
    if (global) {
      result.set(sku, {
        sku,
        locationId,
        minQty: global.minQty,
        maxQty: global.maxQty,
        safetyStock: global.safetyStock,
        targetCoverageDays: global.targetCoverageDays,
        source: "global",
      });
      continue;
    }

    result.set(sku, {
      sku,
      locationId,
      minQty: 0,
      maxQty: 0,
      safetyStock: 0,
      targetCoverageDays: DEFAULT_TARGET_COVERAGE_DAYS,
      source: "default",
    });
  }

  return result;
}
