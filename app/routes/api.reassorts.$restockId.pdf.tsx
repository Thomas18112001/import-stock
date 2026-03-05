import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderDocuments.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";

export function resolveRestockGidFromParam(restockIdRaw: string): string {
  const raw = String(restockIdRaw ?? "").trim();
  if (!raw) {
    throw new Response("Identifiant de réassort manquant.", { status: 400 });
  }
  try {
    const decoded = decodeReceiptIdFromUrl(raw);
    if (!decoded.startsWith("gid://")) {
      throw new Response("Identifiant de réassort invalide.", { status: 400 });
    }
    return decoded;
  } catch {
    if (!raw.startsWith("gid://")) {
      throw new Response("Identifiant de réassort invalide.", { status: 400 });
    }
    return raw;
  }
}

export function buildReassortPdfResponse(pdf: { filename: string; buffer: Buffer | Uint8Array }): Response {
  const body = Buffer.from(pdf.buffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const restockGid = resolveRestockGidFromParam(String(params.restockId ?? ""));
  const pdf = await renderPurchaseOrderPdf(admin, shop, restockGid);
  return buildReassortPdfResponse(pdf);
};
