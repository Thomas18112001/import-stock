import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { rollbackReceipt } from "../services/receiptService";
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
  try {
    assertActionRateLimit("rollback", shop, getClientIp(request), 5_000);
    await rollbackReceipt(admin, shop, receiptGid);
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.rollback.triggered",
      entityType: "receipt",
      entityId: receiptGid,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.rollback.error",
      entityType: "receipt",
      entityId: receiptGid,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur rollback",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de retrait du stock.") },
      { status: 400 },
    );
  }
};


