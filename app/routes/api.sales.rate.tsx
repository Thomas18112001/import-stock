import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { getSalesRateForSku } from "../services/prestaSalesService";

function parseRange(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(365, Math.trunc(parsed)));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method.toUpperCase() !== "GET") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop } = await requireAdmin(request);
    const url = new URL(request.url);
    const sku = String(url.searchParams.get("sku") ?? "").trim();
    const locationId = String(url.searchParams.get("locationId") ?? "").trim();
    const rangeDays = parseRange(String(url.searchParams.get("range") ?? "30"));
    const refresh = String(url.searchParams.get("refresh") ?? "").trim() === "1";

    if (!sku) {
      return Response.json({ ok: false, error: "Paramètre sku requis." }, { status: 400 });
    }
    if (!locationId) {
      return Response.json({ ok: false, error: "Paramètre locationId requis." }, { status: 400 });
    }

    const rate = await getSalesRateForSku(admin, shop, {
      sku,
      locationId,
      rangeDays,
      ensureFresh: true,
      forceRefresh: refresh,
    });

    return Response.json({ ok: true, ...rate });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur interne",
      },
      { status: 500 },
    );
  }
};

export async function action({ request }: ActionFunctionArgs) {
  return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
}

export default function SalesRateApiRoute() {
  return null;
}
