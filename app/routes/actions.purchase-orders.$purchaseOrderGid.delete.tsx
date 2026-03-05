import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { deletePurchaseOrder } from "../services/purchaseOrderService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.purchaseOrderGid;
  if (!encoded) {
    return Response.json({ ok: false, error: "Identifiant de réassort manquant." }, { status: 400 });
  }

  let purchaseOrderGid = "";
  try {
    purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
  } catch {
    return Response.json({ ok: false, error: "Identifiant de réassort invalide." }, { status: 400 });
  }

  const { admin, shop, actor } = await requireAdmin(request);
  try {
    await deletePurchaseOrder(admin, shop, actor, purchaseOrderGid);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de suppression du réassort.") },
      { status: 400 },
    );
  }
};

export default function DeletePurchaseOrderActionRoute() {
  return null;
}
