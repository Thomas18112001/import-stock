import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { sendPurchaseOrderEmail } from "../services/purchaseOrderDocuments.server";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.purchaseOrderGid;
  if (!encoded) {
    return Response.json({ ok: false, error: "Identifiant de réassort manquant." }, { status: 400 });
  }

  const { admin, shop, actor } = await requireAdmin(request);
  const form = await request.formData();
  const recipient = String(form.get("recipient") ?? "").trim();

  try {
    const purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
    await sendPurchaseOrderEmail(admin, shop, actor, purchaseOrderGid, recipient);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur d'envoi email fournisseur.") },
      { status: 400 },
    );
  }
};
