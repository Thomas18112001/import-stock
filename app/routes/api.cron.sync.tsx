import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { assertCronAccess } from "../services/cron-guard.server";
import { syncRun } from "../services/receiptService";
import { unauthenticated } from "../shopify.server";
import { isShopifyGid, isValidShopDomain } from "../utils/validators";

async function runCronSync(request: Request): Promise<Response> {
  assertCronAccess(request);

  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const shop = String(form?.get("shop") ?? url.searchParams.get("shop") ?? "");
  const locationId = String(form?.get("locationId") ?? url.searchParams.get("locationId") ?? "").trim();

  if (!shop || !isValidShopDomain(shop)) {
    return Response.json({ ok: false, error: "Bad request: invalid shop." }, { status: 400 });
  }
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Bad request: invalid locationId." }, { status: 400 });
  }

  const { admin } = await unauthenticated.admin(shop);
  const result = await syncRun(admin, shop, false, locationId);

  return Response.json({ ok: true, imported: result.imported });
}

export const loader = async ({ request }: LoaderFunctionArgs) => runCronSync(request);
export const action = async ({ request }: ActionFunctionArgs) => runCronSync(request);
