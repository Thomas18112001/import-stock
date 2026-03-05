import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { deleteReceipt } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
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
  const { admin, shop, actor } = await requireAdmin(request);
  const form = await request.formData();
  const confirmed = String(form.get("confirmed") ?? "") === "true";
  const redirectToList = String(form.get("redirectToList") ?? "") === "true";

  try {
    await deleteReceipt(admin, shop, receiptGid, confirmed);
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.delete.triggered",
      entityType: "receipt",
      entityId: receiptGid,
      status: "success",
      actor,
    });
    if (redirectToList) {
      return redirect("/produits-en-reception?deleted=1");
    }
    return Response.json({ ok: true, deletedGid: receiptGid });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "receipt.delete.error",
      entityType: "receipt",
      entityId: receiptGid,
      status: "error",
      actor,
      message: error instanceof Error ? error.message : "Erreur suppression receipt",
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Suppression impossible.") },
      { status: 400 },
    );
  }
};



