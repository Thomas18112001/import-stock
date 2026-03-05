import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { purgePurchaseOrders } from "../services/purchaseOrderService";
import { isShopifyGid } from "../utils/validators";

const CONFIRM_WORD = "SUPPRIMER";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();

  const destinationLocationId = String(form.get("destinationLocationId") ?? "").trim();
  const confirmation = String(form.get("confirmation") ?? "").trim().toUpperCase();
  const includeReceived = String(form.get("includeReceived") ?? "").trim() === "true";

  if (!destinationLocationId) {
    return Response.json({ ok: false, error: "Sélectionnez une boutique avant de purger." }, { status: 400 });
  }
  if (!isShopifyGid(destinationLocationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }
  if (confirmation !== CONFIRM_WORD && !(includeReceived && confirmation === "SUPPRIMER TOUT")) {
    return Response.json(
      {
        ok: false,
        error: `Confirmation invalide. Tapez ${CONFIRM_WORD} (ou SUPPRIMER TOUT si vous incluez les réassorts reçus).`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await purgePurchaseOrders(admin, shop, destinationLocationId, includeReceived);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de purge des réassorts.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
};

export default function PurgePurchaseOrdersActionRoute() {
  return null;
}


