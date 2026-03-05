import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { markPurchaseOrderIncoming } from "../services/purchaseOrderService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
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
  try {
    await markPurchaseOrderIncoming(admin, shop, actor, purchaseOrderGid);
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.mark_incoming.triggered",
      entityType: "purchase_order",
      entityId: purchaseOrderGid,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.mark_incoming.error",
      entityType: "purchase_order",
      entityId: purchaseOrderGid,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur mark incoming",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de passage en cours d'arrivage.") },
      { status: 400 },
    );
  }
};
