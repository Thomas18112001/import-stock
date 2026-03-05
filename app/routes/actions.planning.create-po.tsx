import type { ActionFunctionArgs } from "react-router";
import { safeLogAuditEvent } from "../services/auditLogService";
import { requireAdmin } from "../services/auth.server";
import { createPurchaseOrderDraftFromSuggestions } from "../services/inventoryPlanningService";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop, actor } = await requireAdmin(request);
    const form = await request.formData();
    const locationId = String(form.get("locationId") ?? "").trim();
    const expectedArrivalAt = String(form.get("expectedArrivalAt") ?? "").trim();
    const referenceNumber = String(form.get("referenceNumber") ?? "").trim();
    const suggestionsJson = String(form.get("suggestionsJson") ?? "").trim();

    if (!locationId) {
      return Response.json({ ok: false, error: "locationId requis." }, { status: 400 });
    }

    let suggestions: Array<{ sku: string; quantity: number }> = [];
    try {
      const parsed = JSON.parse(suggestionsJson) as Array<{ sku?: unknown; quantity?: unknown }>;
      suggestions = Array.isArray(parsed)
        ? parsed.map((row) => ({
            sku: String(row?.sku ?? "").trim(),
            quantity: Math.max(0, Math.trunc(Number(row?.quantity ?? 0))),
          }))
        : [];
    } catch {
      return Response.json({ ok: false, error: "Format suggestionsJson invalide." }, { status: 400 });
    }

    const result = await createPurchaseOrderDraftFromSuggestions(admin, shop, actor, {
      locationId,
      expectedArrivalAt: expectedArrivalAt || null,
      referenceNumber,
      supplierNotes: "Commande fournisseur générée depuis la planification stock.",
      internalNotes: "Source: suggestions automatiques de couverture.",
      suggestions,
    });

    await safeLogAuditEvent(admin, shop, {
      eventType: "planning.create_purchase_order",
      entityType: "purchase_order",
      entityId: result.purchaseOrderGid,
      locationId,
      status: "success",
      actor,
      payload: {
        number: result.number,
        lineCount: result.lineCount,
      },
    });

    return Response.json({ ok: true, ...result });
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

export default function PlanningCreatePoActionRoute() {
  return null;
}
