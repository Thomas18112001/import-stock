import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { importById } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { isShopifyGid, parsePositiveIntInput } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }
  const orderId = parsePositiveIntInput(form.get("presta_order_id"));
  if (!orderId) {
    return Response.json({ ok: false, error: "ID commande Prestashop invalide." }, { status: 400 });
  }
  try {
    assertActionRateLimit("import", shop, getClientIp(request), 5_000);
    const result = await importById(admin, shop, orderId, locationId);
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.import_by_id.triggered",
      entityType: "presta_order",
      entityId: String(orderId),
      locationId,
      prestaOrderId: orderId,
      status: "success",
      payload: {
        created: result.created,
        duplicateBy: result.duplicateBy ?? null,
        receiptGid: result.receiptGid,
      },
    });
    return Response.json({
      ok: true,
      prestaOrderId: orderId,
      created: result.created,
      receiptGid: result.receiptGid,
      duplicateBy: result.duplicateBy,
      locationId: result.locationId,
      lastPrestaOrderId: result.lastPrestaOrderId,
      lastSyncAt: result.lastSyncAt,
    });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.import_by_id.error",
      entityType: "presta_order",
      entityId: String(orderId),
      locationId,
      prestaOrderId: orderId,
      status: "error",
      message: error instanceof Error ? error.message : "Erreur import manuel",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur d'import.") },
      { status: 400 },
    );
  }
};

