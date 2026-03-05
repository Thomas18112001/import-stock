import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderDocuments.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";
import { isValidShopDomain } from "../utils/validators";
import { unauthenticated } from "../shopify.server";
import { buildReassortPdfResponse } from "./api.reassorts.$restockId.pdf";

async function resolveAdminForPdf(request: Request): Promise<{ admin: Awaited<ReturnType<typeof requireAdmin>>["admin"]; shop: string }> {
  try {
    const { admin, shop } = await requireAdmin(request);
    return { admin, shop };
  } catch (error) {
    if (!(error instanceof Response)) {
      throw error;
    }

    const url = new URL(request.url);
    const shop = String(url.searchParams.get("shop") ?? "").trim();
    const idTokenQuery = String(url.searchParams.get("id_token") ?? "").trim();
    const authorization = String(request.headers.get("Authorization") ?? "").trim();
    const bearerToken = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    const token = idTokenQuery || bearerToken;

    if (!shop || !token || !isValidShopDomain(shop)) {
      throw error;
    }

    const unauth = await unauthenticated.admin(shop);
    return {
      admin: unauth.admin as Awaited<ReturnType<typeof requireAdmin>>["admin"],
      shop,
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const encodedId = String(url.searchParams.get("id") ?? "").trim();
  if (!encodedId) {
    throw new Response("Identifiant de réassort manquant.", { status: 400 });
  }

  const { admin, shop } = await resolveAdminForPdf(request);
  const restockGid = decodeReceiptIdFromUrl(encodedId);
  const pdf = await renderPurchaseOrderPdf(admin, shop, restockGid);
  return buildReassortPdfResponse(pdf);
};
