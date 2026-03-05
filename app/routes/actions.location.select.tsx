import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { listLocations } from "../services/shopifyGraphql";
import { setSyncState } from "../services/shopifyMetaobjects";
import { isShopifyGid } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }

  const locations = await listLocations(admin);
  if (!locations.some((location) => location.id === locationId)) {
    return Response.json({ ok: false, error: "Boutique introuvable." }, { status: 400 });
  }

  await setSyncState(admin, { selectedLocationId: locationId });
  return Response.json({ ok: true, selectedLocationId: locationId });
};


