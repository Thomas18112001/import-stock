import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { markPurchaseOrderReceived } from "../services/purchaseOrderService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.purchaseOrderGid;
  if (!encoded) {
    return Response.json({ ok: false, error: "Identifiant de réassort manquant." }, { status: 400 });
  }

  const { admin, shop, actor } = await requireAdmin(request);
  try {
    const purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
    await markPurchaseOrderReceived(admin, shop, actor, purchaseOrderGid);
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.mark_received.triggered",
      entityType: "purchase_order",
      entityId: purchaseOrderGid,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.mark_received.error",
      entityType: "purchase_order",
      entityId: encoded,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur mark received",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de réception en boutique.") },
      { status: 400 },
    );
  }
};
