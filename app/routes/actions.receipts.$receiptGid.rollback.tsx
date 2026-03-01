import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { rollbackReceipt } from "../services/receiptService";
import { decodeReceiptId } from "../utils/receiptId";

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
  try {
    await rollbackReceipt(admin, shop, receiptGid);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur de retrait du stock." },
      { status: 400 },
    );
  }
};
