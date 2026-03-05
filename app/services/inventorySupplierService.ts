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

export type SupplierRecord = {
  id: string;
  handle: string;
  name: string;
  email: string;
  leadTimeDays: number;
  notes: string;
  active: boolean;
  updatedAt: string;
};

export type SupplierSkuMappingRecord = {
  id: string;
  handle: string;
  supplierHandle: string;
  supplierName: string;
  sku: string;
  leadTimeDaysOverride: number;
  notes: string;
  updatedAt: string;
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function normalizeSku(value: string): string {
  return normalizeSkuText(value).toUpperCase();
}

function parsePositiveInt(rawValue: string, fallback = 0): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function token(rawValue: string, fallback: string, maxLength = 70): string {
  return cleanText(rawValue)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength) || fallback;
}

function supplierHandleFromName(name: string): string {
  return `supplier-${token(name, "default-supplier")}`;
}

function supplierSkuHandle(supplierHandle: string, sku: string): string {
  return `supplier-sku-${token(supplierHandle, "supplier")}-${token(sku, "sku")}`;
}

function parseSupplier(node: {
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): SupplierRecord {
  const find = (key: string) => fieldValue(node, key);
  return {
    id: node.id,
    handle: node.handle,
    name: cleanText(find("name")),
    email: cleanText(find("email")),
    leadTimeDays: parsePositiveInt(find("lead_time_days"), 0),
    notes: cleanText(find("notes")),
    active: cleanText(find("active")).toLowerCase() !== "false",
    updatedAt: node.updatedAt,
  };
}

export async function listSuppliers(
  admin: AdminClient,
  shopDomain: string,
  options: { includeInactive?: boolean } = {},
): Promise<SupplierRecord[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const rows = (await listMetaobjects(admin, types.supplier)).map(parseSupplier);
  const filtered = options.includeInactive ? rows : rows.filter((row) => row.active);
  return filtered.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function upsertSupplier(
  admin: AdminClient,
  shopDomain: string,
  input: {
    handle?: string | null;
    name: string;
    email?: string | null;
    leadTimeDays?: number | null;
    notes?: string | null;
    active?: boolean;
  },
): Promise<string> {
  const name = cleanText(input.name);
  if (!name) {
    throw new Error("Le nom fournisseur est obligatoire.");
  }
  const handle = cleanText(input.handle) || supplierHandleFromName(name);
  const leadTimeDays = Math.max(0, Math.trunc(Number(input.leadTimeDays || 0)));
  const active = input.active === false ? "false" : "true";

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  await upsertMetaobjectByHandle(admin, types.supplier, handle, [
    { key: "name", value: name },
    { key: "email", value: cleanText(input.email) },
    { key: "lead_time_days", value: String(leadTimeDays) },
    { key: "notes", value: cleanText(input.notes) },
    { key: "active", value: active },
  ]);
  return handle;
}

export async function setSupplierActive(
  admin: AdminClient,
  shopDomain: string,
  input: { handle: string; active: boolean },
): Promise<void> {
  const handle = cleanText(input.handle);
  if (!handle) {
    throw new Error("Handle fournisseur manquant.");
  }

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const existing = await getMetaobjectByHandle(admin, types.supplier, handle);
  if (!existing) {
    throw new Error("Fournisseur introuvable.");
  }
  const find = (key: string) => fieldValue(existing, key);
  await upsertMetaobjectByHandle(admin, types.supplier, handle, [
    { key: "name", value: cleanText(find("name")) },
    { key: "email", value: cleanText(find("email")) },
    { key: "lead_time_days", value: String(parsePositiveInt(find("lead_time_days"), 0)) },
    { key: "notes", value: cleanText(find("notes")) },
    { key: "active", value: input.active ? "true" : "false" },
  ]);
}

export async function deleteSupplier(
  admin: AdminClient,
  shopDomain: string,
  input: { handle: string; deleteMappings?: boolean },
): Promise<{ deleted: boolean; deletedMappings: number }> {
  const handle = cleanText(input.handle);
  if (!handle) return { deleted: false, deletedMappings: 0 };

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  let deletedMappings = 0;
  if (input.deleteMappings) {
    const mappings = await listMetaobjects(admin, types.supplierSku);
    for (const mapping of mappings) {
      if (cleanText(fieldValue(mapping, "supplier_handle")) !== handle) continue;
      await deleteMetaobject(admin, mapping.id);
      deletedMappings += 1;
    }
  }

  const existing = await getMetaobjectByHandle(admin, types.supplier, handle);
  if (!existing) return { deleted: false, deletedMappings };
  await deleteMetaobject(admin, existing.id);
  return { deleted: true, deletedMappings };
}

export async function listSupplierSkuMappings(
  admin: AdminClient,
  shopDomain: string,
  options: {
    supplierHandle?: string | null;
    query?: string | null;
    includeInactiveSuppliers?: boolean;
  } = {},
): Promise<SupplierSkuMappingRecord[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  const suppliers = await listSuppliers(admin, shopDomain, { includeInactive: true });
  const supplierByHandle = new Map(suppliers.map((supplier) => [supplier.handle, supplier]));
  const mappings = await listMetaobjects(admin, types.supplierSku);

  const rows = mappings.map((node) => {
    const find = (key: string) => fieldValue(node, key);
    const supplierHandle = cleanText(find("supplier_handle"));
    const supplier = supplierByHandle.get(supplierHandle);
    return {
      id: node.id,
      handle: node.handle,
      supplierHandle,
      supplierName: supplier?.name || supplierHandle,
      sku: normalizeSku(find("sku")),
      leadTimeDaysOverride: parsePositiveInt(find("lead_time_days_override"), 0),
      notes: cleanText(find("notes")),
      updatedAt: node.updatedAt,
    } satisfies SupplierSkuMappingRecord;
  });

  const query = cleanText(options.query).toLowerCase();
  const filtered = rows
    .filter((row) => (options.supplierHandle ? row.supplierHandle === options.supplierHandle : true))
    .filter((row) => {
      if (options.includeInactiveSuppliers) return true;
      const supplier = supplierByHandle.get(row.supplierHandle);
      return supplier ? supplier.active : false;
    })
    .filter((row) => {
      if (!query) return true;
      const haystack = `${row.sku} ${row.supplierName} ${row.supplierHandle}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => `${a.supplierName}:${a.sku}`.localeCompare(`${b.supplierName}:${b.sku}`, "fr"));

  return filtered;
}

export async function upsertSupplierSkuMapping(
  admin: AdminClient,
  shopDomain: string,
  input: {
    supplierHandle: string;
    sku: string;
    leadTimeDaysOverride?: number | null;
    notes?: string | null;
  },
): Promise<string> {
  const supplierHandle = cleanText(input.supplierHandle);
  const sku = normalizeSku(input.sku);
  if (!supplierHandle) {
    throw new Error("supplierHandle requis.");
  }
  if (!sku) {
    throw new Error("SKU requis.");
  }

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  const supplier = await getMetaobjectByHandle(admin, types.supplier, supplierHandle);
  if (!supplier) {
    throw new Error("Fournisseur introuvable pour ce mapping.");
  }

  const handle = supplierSkuHandle(supplierHandle, sku);
  await upsertMetaobjectByHandle(admin, types.supplierSku, handle, [
    { key: "supplier_handle", value: supplierHandle },
    { key: "sku", value: sku },
    { key: "lead_time_days_override", value: String(Math.max(0, Math.trunc(Number(input.leadTimeDaysOverride || 0)))) },
    { key: "notes", value: cleanText(input.notes) },
  ]);
  return handle;
}

export async function deleteSupplierSkuMapping(
  admin: AdminClient,
  shopDomain: string,
  input: { handle: string },
): Promise<boolean> {
  const handle = cleanText(input.handle);
  if (!handle) return false;

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const existing = await getMetaobjectByHandle(admin, types.supplierSku, handle);
  if (!existing) return false;
  await deleteMetaobject(admin, existing.id);
  return true;
}
