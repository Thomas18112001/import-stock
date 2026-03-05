import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { purgeLocationReceiptsForDebug } from "../services/receiptService";
import { isShopifyGid } from "../utils/validators";

function isDebugAuthorized(request: Request, form: FormData): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const expectedToken = String(process.env.DEBUG_SYNC_TOKEN ?? "").trim();
  if (!expectedToken) return false;
  const providedToken = String(
    request.headers.get("x-debug-token") ??
      form.get("debugToken") ??
      "",
  ).trim();
  return Boolean(providedToken) && providedToken === expectedToken;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  if (!isDebugAuthorized(request, form)) {
    return Response.json({ ok: false, error: "Route debug non autorisée." }, { status: 403 });
  }

  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }

  try {
    const result = await purgeLocationReceiptsForDebug(admin, shop, locationId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur purge debug.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
};

