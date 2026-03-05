import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { receiveReceipt } from "../services/receiptService";
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
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "");
  const confirmed = String(form.get("confirmed") ?? "") === "true";

  try {
    assertActionRateLimit("receive", shop, getClientIp(request), 5_000);
    await receiveReceipt(admin, shop, {
      receiptGid,
      locationId,
      confirmed,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de validation de réception.") },
      { status: 400 },
    );
  }
};



