import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { cancelPurchaseOrder } from "../services/purchaseOrderService";
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
    await cancelPurchaseOrder(admin, shop, actor, purchaseOrderGid);
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.cancel.triggered",
      entityType: "purchase_order",
      entityId: purchaseOrderGid,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "purchase_order.cancel.error",
      entityType: "purchase_order",
      entityId: encoded,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur cancel purchase order",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur d'annulation du réassort.") },
      { status: 400 },
    );
  }
};
