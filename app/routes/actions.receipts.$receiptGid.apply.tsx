import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { applyReceipt } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptId } from "../utils/receiptId";
import { isValidSku, normalizeSku } from "../utils/validators";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.receiptGid;
  if (!encoded) {
    return Response.json({ ok: false, error: "Identifiant de réception manquant." }, { status: 400 });
  }

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
  const skippedSkus = Array.from(
    new Set(form.getAll("skippedSkus[]").map(normalizeSku).filter((sku) => sku.length > 0)),
  );

  if (skippedSkus.some((sku) => !isValidSku(sku))) {
    return Response.json({ ok: false, error: "SKU ignoré invalide." }, { status: 400 });
  }

  try {
    assertActionRateLimit("apply", shop, getClientIp(request), 5_000);
    const result = await applyReceipt(admin, shop, {
      receiptGid,
      locationId,
      confirmed,
      skippedSkus,
      actor,
    });
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.apply.triggered",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "success",
      actor,
      payload: {
        skippedSkus,
        restockOrderId: result.restockOrderId,
        restockOrderNumber: result.restockOrderNumber,
      },
    });

    return Response.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.apply.error",
      entityType: "receipt",
      entityId: receiptGid,
      locationId,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur apply receipt",
      payload: { skippedSkus },
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de mise en arrivage.") },
      { status: 400 },
    );
  }
};
