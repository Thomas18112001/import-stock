import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { renderPurchaseOrderPdf } from "../services/purchaseOrderDocuments.server";
import { decodeReceiptIdFromUrl } from "../utils/receiptId";
import { isValidShopDomain } from "../utils/validators";
import { authenticate, unauthenticated } from "../shopify.server";
import { buildReassortPdfResponse } from "./api.reassorts.$restockId.pdf";

function parseShopFromDest(destRaw: unknown): string {
  const dest = String(destRaw ?? "").trim();
  if (!dest) return "";
  try {
    const host = new URL(dest).hostname.trim();
    return isValidShopDomain(host) ? host : "";
  } catch {
    return "";
  }
}

async function resolveAdminForPdf(request: Request): Promise<{ admin: Awaited<ReturnType<typeof requireAdmin>>["admin"]; shop: string }> {
  try {
    const { admin, shop } = await requireAdmin(request);
    return { admin, shop };
  } catch (error) {
    if (!(error instanceof Response)) {
      throw error;
    }
  }

  const { sessionToken } = await authenticate.pos(request);
  const sessionShop = parseShopFromDest(sessionToken.dest);
  if (!sessionShop) {
    throw new Response("Contexte boutique invalide.", { status: 403 });
  }

  const requestShop = new URL(request.url).searchParams.get("shop");
  if (requestShop && requestShop !== sessionShop) {
    throw new Response("Contexte boutique incohérent.", { status: 403 });
  }

  const unauth = await unauthenticated.admin(sessionShop);
  return {
    admin: unauth.admin as Awaited<ReturnType<typeof requireAdmin>>["admin"],
    shop: sessionShop,
  };
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
