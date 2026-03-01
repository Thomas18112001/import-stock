import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { deleteReceipt } from "../services/receiptService";
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
  const form = await request.formData();
  const confirmed = String(form.get("confirmed") ?? "") === "true";
  const redirectToList = String(form.get("redirectToList") ?? "") === "true";

  try {
    await deleteReceipt(admin, shop, receiptGid, confirmed);
    if (redirectToList) {
      return redirect("/app/receipts?deleted=1");
    }
    return Response.json({ ok: true, deletedGid: receiptGid });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Suppression impossible." },
      { status: 400 },
    );
  }
};
