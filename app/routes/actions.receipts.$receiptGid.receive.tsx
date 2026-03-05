import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { receiveReceipt } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptId } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.receiptGid;
  if (!encoded) return Response.json({ ok: false, error: "Identifiant de réception manquant." }, { status: 400 });
  let receiptGid = "";
  try {
    receiptGid = decodeReceiptId(encoded);
  } catch {
    return Response.json({ ok: false, error: "Identifiant de réception invalide." }, { status: 400 });
  }
  const { admin, shop, actor } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "");
  const confirmed = String(form.get("confirmed") ?? "") === "true";

  try {
    assertActionRateLimit("receive", shop, getClientIp(request), 5_000);
    await receiveReceipt(admin, shop, {
      receiptGid,
      locationId,
      confirmed,
    });
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.receive.triggered",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.receive.error",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur reception",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de validation de réception.") },
      { status: 400 },
    );
  }
};


