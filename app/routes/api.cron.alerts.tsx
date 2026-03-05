import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { assertCronAccess } from "../services/cron-guard.server";
import { dispatchAlertNotifications } from "../services/inventoryAlertNotificationService";
import { unauthenticated } from "../shopify.server";
import { isShopifyGid, isValidShopDomain } from "../utils/validators";

async function runAlertCron(request: Request): Promise<Response> {
  assertCronAccess(request);

  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const shop = String(form?.get("shop") ?? url.searchParams.get("shop") ?? "").trim();
  const locationIdRaw = String(form?.get("locationId") ?? url.searchParams.get("locationId") ?? "").trim();
  const force = String(form?.get("force") ?? url.searchParams.get("force") ?? "").trim() === "1";
  const dryRun = String(form?.get("dryRun") ?? url.searchParams.get("dryRun") ?? "").trim() === "1";

  if (!shop || !isValidShopDomain(shop)) {
    return Response.json({ ok: false, error: "Bad request: invalid shop." }, { status: 400 });
  }
  if (locationIdRaw && !isShopifyGid(locationIdRaw)) {
    return Response.json({ ok: false, error: "Bad request: invalid locationId." }, { status: 400 });
  }

  const { admin } = await unauthenticated.admin(shop);
  const result = await dispatchAlertNotifications(admin, shop, {
    locationId: locationIdRaw || null,
    force,
    dryRun,
    actor: "cron",
  });

  return Response.json({ ok: true, ...result });
}

export const loader = async ({ request }: LoaderFunctionArgs) => runAlertCron(request);
export const action = async ({ request }: ActionFunctionArgs) => runAlertCron(request);

export default function CronAlertsRoute() {
  return null;
}
