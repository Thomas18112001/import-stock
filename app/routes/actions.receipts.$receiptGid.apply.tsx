import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { applyReceipt } from "../services/receiptService";
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
  const locationId = String(form.get("locationId") ?? "");
  const confirmed = String(form.get("confirmed") ?? "") === "true";
  const skippedSkus = Array.from(
    new Set(form.getAll("skippedSkus[]").map(normalizeSku).filter((sku) => sku.length > 0)),
  );
  if (skippedSkus.some((sku) => !isValidSku(sku))) {
    return Response.json({ ok: false, error: "SKU ignoré invalide." }, { status: 400 });
  }

  try {
    await applyReceipt(admin, shop, {
      receiptGid,
      locationId,
      confirmed,
      skippedSkus,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur d'ajout de stock." },
      { status: 400 },
    );
  }
};
