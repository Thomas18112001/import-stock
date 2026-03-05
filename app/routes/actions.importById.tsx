import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
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
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur d'import.") },
      { status: 400 },
    );
  }
};

