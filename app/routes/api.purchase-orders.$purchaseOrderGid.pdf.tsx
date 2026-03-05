import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderDocuments.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";
import { buildReassortPdfResponse } from "./api.reassorts.$restockId.pdf";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const encoded = params.purchaseOrderGid;
  if (!encoded) {
    throw new Response("Identifiant de réassort manquant.", { status: 400 });
  }

  const { admin, shop } = await requireAdmin(request);
  const purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
  const pdf = await renderPurchaseOrderPdf(admin, shop, purchaseOrderGid);
  return buildReassortPdfResponse(pdf);
};
