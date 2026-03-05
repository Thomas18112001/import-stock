import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { updatePurchaseOrderExpectedArrival } from "../services/purchaseOrderService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: "Méthode non autorisée." }, { status: 405 });
  }

  const encoded = params.purchaseOrderGid;
  if (!encoded) {
    return Response.json({ ok: false, error: "Identifiant de réassort manquant." }, { status: 400 });
  }

  let purchaseOrderGid = "";
  try {
    purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
  } catch {
    return Response.json({ ok: false, error: "Identifiant de réassort invalide." }, { status: 400 });
  }

  const { admin, shop, actor } = await requireAdmin(request);
  const form = await request.formData();
  const expectedArrivalAtRaw = String(form.get("expectedArrivalAt") ?? "").trim();
  if (expectedArrivalAtRaw && !Number.isFinite(Date.parse(expectedArrivalAtRaw))) {
    return Response.json({ ok: false, error: "Date ETA invalide." }, { status: 400 });
  }

  try {
    const updated = await updatePurchaseOrderExpectedArrival(
      admin,
      shop,
      actor,
      purchaseOrderGid,
      expectedArrivalAtRaw || null,
    );
    return Response.json({
      ok: true,
      previousExpectedArrivalAt: updated.previousExpectedArrivalAt || null,
      nextExpectedArrivalAt: updated.nextExpectedArrivalAt || null,
    });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.eta.update.error",
      entityType: "purchase_order",
      entityId: purchaseOrderGid,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur de mise à jour ETA",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de mise à jour ETA.") },
      { status: 400 },
    );
  }
};
