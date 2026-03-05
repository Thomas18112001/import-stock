import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { toggleSkip } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { decodeReceiptId } from "../utils/receiptId";
import { isValidSku, normalizeSku } from "../utils/validators";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const encoded = params.receiptGid;
  if (!encoded) return Response.json({ ok: false, error: "Identifiant de réception manquant." }, { status: 400 });
  let receiptGid = "";
  try {
    receiptGid = decodeReceiptId(encoded);
  } catch {
    return Response.json({ ok: false, error: "Identifiant de réception invalide." }, { status: 400 });
  }
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const sku = normalizeSku(form.get("sku"));
  if (!sku || !isValidSku(sku)) {
    return Response.json({ ok: false, error: "SKU invalide." }, { status: 400 });
  }

  try {
    await toggleSkip(admin, shop, receiptGid, sku);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de mise à jour du saut de ligne.") },
      { status: 400 },
    );
  }
};



