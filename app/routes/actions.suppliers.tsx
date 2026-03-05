import type { ActionFunctionArgs } from "react-router";
import { safeLogAuditEvent } from "../services/auditLogService";
import { requireAdmin } from "../services/auth.server";
import {
  deleteSupplier,
  deleteSupplierSkuMapping,
  setSupplierActive,
  upsertSupplier,
  upsertSupplierSkuMapping,
} from "../services/inventorySupplierService";
import { parseNonNegativeIntInput } from "../utils/validators";

function cleanText(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function requireText(value: FormDataEntryValue | null, label: string): string {
  const parsed = cleanText(value);
  if (!parsed) {
    throw new Error(`${label} obligatoire.`);
  }
  return parsed;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop, actor } = await requireAdmin(request);
    const form = await request.formData();
    const intent = cleanText(form.get("intent"));

    if (intent === "upsert_supplier") {
      const handle = cleanText(form.get("handle"));
      const name = requireText(form.get("name"), "Nom fournisseur");
      const email = cleanText(form.get("email"));
      const leadTimeDays = parseNonNegativeIntInput(form.get("leadTimeDays")) ?? 0;
      const notes = cleanText(form.get("notes"));
      const active = cleanText(form.get("active")) !== "0";

      const savedHandle = await upsertSupplier(admin, shop, {
        handle,
        name,
        email,
        leadTimeDays,
        notes,
        active,
      });

      await safeLogAuditEvent(admin, shop, {
        eventType: "supplier.upsert",
        entityType: "supplier",
        entityId: savedHandle,
        status: "success",
        actor,
        payload: { name, email, leadTimeDays, active },
      });

      return Response.json({ ok: true, handle: savedHandle });
    }

    if (intent === "set_supplier_active") {
      const handle = requireText(form.get("handle"), "Handle fournisseur");
      const active = cleanText(form.get("active")) === "1";

      await setSupplierActive(admin, shop, { handle, active });
      await safeLogAuditEvent(admin, shop, {
        eventType: "supplier.set_active",
        entityType: "supplier",
        entityId: handle,
        status: "success",
        actor,
        payload: { active },
      });

      return Response.json({ ok: true, handle, active });
    }

    if (intent === "delete_supplier") {
      const handle = requireText(form.get("handle"), "Handle fournisseur");
      const deleteMappings = cleanText(form.get("deleteMappings")) === "1";
      const result = await deleteSupplier(admin, shop, { handle, deleteMappings });

      await safeLogAuditEvent(admin, shop, {
        eventType: "supplier.delete",
        entityType: "supplier",
        entityId: handle,
        status: "success",
        actor,
        payload: result,
      });

      return Response.json({ ok: true, ...result });
    }

    if (intent === "upsert_supplier_sku") {
      const supplierHandle = requireText(form.get("supplierHandle"), "Fournisseur");
      const sku = requireText(form.get("sku"), "SKU");
      const leadTimeDaysOverride = parseNonNegativeIntInput(form.get("leadTimeDaysOverride")) ?? 0;
      const notes = cleanText(form.get("notes"));

      const handle = await upsertSupplierSkuMapping(admin, shop, {
        supplierHandle,
        sku,
        leadTimeDaysOverride,
        notes,
      });

      await safeLogAuditEvent(admin, shop, {
        eventType: "supplier.sku.upsert",
        entityType: "supplier_sku",
        entityId: handle,
        status: "success",
        actor,
        payload: { supplierHandle, sku, leadTimeDaysOverride },
      });

      return Response.json({ ok: true, handle });
    }

    if (intent === "delete_supplier_sku") {
      const handle = requireText(form.get("handle"), "Handle mapping");
      const deleted = await deleteSupplierSkuMapping(admin, shop, { handle });

      await safeLogAuditEvent(admin, shop, {
        eventType: "supplier.sku.delete",
        entityType: "supplier_sku",
        entityId: handle,
        status: "success",
        actor,
        payload: { deleted },
      });

      return Response.json({ ok: true, deleted });
    }

    return Response.json({ ok: false, error: "Intent non géré." }, { status: 400 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur interne",
      },
      { status: 400 },
    );
  }
};

export default function SuppliersActionRoute() {
  return null;
}
