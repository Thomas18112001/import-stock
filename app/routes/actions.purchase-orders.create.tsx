import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { createPurchaseOrderDraft, type PurchaseOrderLineDraftInput } from "../services/purchaseOrderService";
import { toPublicErrorMessage } from "../utils/error.server";

function parseLinesJson(raw: string): PurchaseOrderLineDraftInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Format des lignes invalide.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Format des lignes invalide.");
  }
  return parsed.map((line) => {
    const record = line as Record<string, unknown>;
    return {
      sku: String(record.sku ?? "").trim(),
      supplierSku: String(record.supplierSku ?? "").trim(),
      quantityOrdered: Number(record.quantityOrdered ?? 0),
      unitCost: Number(record.unitCost ?? 0),
      taxRate: Number(record.taxRate ?? 0),
    };
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actor } = await requireAdmin(request);
  const form = await request.formData();
  const destinationLocationId = String(form.get("destinationLocationId") ?? "").trim();
  const expectedArrivalAt = String(form.get("expectedArrivalAt") ?? "").trim();
  const paymentTerms = String(form.get("paymentTerms") ?? "").trim();
  const referenceNumber = String(form.get("referenceNumber") ?? "").trim();
  const supplierNotes = String(form.get("supplierNotes") ?? "").trim();
  const internalNotes = String(form.get("internalNotes") ?? "").trim();
  const currency = String(form.get("currency") ?? "").trim();
  const linesJson = String(form.get("linesJson") ?? "[]");

  try {
    const lines = parseLinesJson(linesJson);
    const created = await createPurchaseOrderDraft(admin, shop, actor, {
      destinationLocationId,
      expectedArrivalAt: expectedArrivalAt || null,
      paymentTerms: paymentTerms || null,
      referenceNumber: referenceNumber || null,
      supplierNotes: supplierNotes || null,
      internalNotes: internalNotes || null,
      currency: currency || null,
      lines,
    });

    return Response.json({
      ok: true,
      purchaseOrderGid: created.purchaseOrderGid,
      number: created.number,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de création du réassort.") },
      { status: 400 },
    );
  }
};

