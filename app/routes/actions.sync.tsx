import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { assertManualSyncRateLimit } from "../services/manual-sync-guard.server";
import { syncRun } from "../services/receiptService";
import { isShopifyGid } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }
  try {
    assertManualSyncRateLimit(shop);
    const result = await syncRun(admin, shop, true, locationId);
    return Response.json({
      ok: true,
      imported: result.imported,
      locationId: result.locationId,
      lastPrestaOrderId: result.lastPrestaOrderId,
      lastSyncAt: result.lastSyncAt,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur de synchronisation." },
      { status: 400 },
    );
  }
};
