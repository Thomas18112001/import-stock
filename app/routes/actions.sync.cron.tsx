import type { ActionFunctionArgs } from "react-router";
import { assertCronAccess } from "../services/cron-guard.server";
import { syncRun } from "../services/receiptService";
import { unauthenticated } from "../shopify.server";
import { isShopifyGid, isValidShopDomain } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertCronAccess(request);
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const shop = String(form?.get("shop") ?? url.searchParams.get("shop") ?? "");
  const locationId = String(form?.get("locationId") ?? url.searchParams.get("locationId") ?? "").trim();
  if (!shop || !isValidShopDomain(shop)) return new Response("Bad request", { status: 400 });
  if (!isShopifyGid(locationId)) return new Response("Bad request", { status: 400 });
  const { admin } = await unauthenticated.admin(shop);
  await syncRun(admin, shop, false, locationId);
  return new Response("ok", { status: 200 });
};
