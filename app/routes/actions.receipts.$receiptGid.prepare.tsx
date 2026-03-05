import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { prepareReceipt } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptId } from "../utils/receiptId";
import { isShopifyGid } from "../utils/validators";

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
  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }
  try {
    assertActionRateLimit("prepare", shop, getClientIp(request), 3_000);
    await prepareReceipt(admin, shop, receiptGid, locationId);
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.prepare.triggered",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "success",
      actor,
    });
    return Response.json({ ok: true });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.prepare.error",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur prepare receipt",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de diagnostic SKU.") },
      { status: 400 },
    );
  }
};


