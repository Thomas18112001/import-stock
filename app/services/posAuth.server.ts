import { authenticate, unauthenticated } from "../shopify.server";
import { isShopifyGid, isValidShopDomain } from "../utils/validators";
import { requireAdmin } from "./auth.server";

const LOCATION_GID_PREFIX = "gid://shopify/Location/";
const INVENTORY_ITEM_GID_PREFIX = "gid://shopify/InventoryItem/";

function toDigits(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : "";
}

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

export function coerceLocationGid(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith(LOCATION_GID_PREFIX) && isShopifyGid(value)) return value;
  const digits = toDigits(value);
  return digits ? `${LOCATION_GID_PREFIX}${digits}` : "";
}

export function coerceInventoryItemGid(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith(INVENTORY_ITEM_GID_PREFIX) && isShopifyGid(value)) return value;
  const digits = toDigits(value);
  return digits ? `${INVENTORY_ITEM_GID_PREFIX}${digits}` : "";
}

export async function resolveAdminForPos(
  request: Request,
): Promise<{ admin: Awaited<ReturnType<typeof requireAdmin>>["admin"]; shop: string }> {
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
