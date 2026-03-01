import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { importById } from "../services/receiptService";
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
      { ok: false, error: error instanceof Error ? error.message : "Erreur d'import." },
      { status: 400 },
    );
  }
};
