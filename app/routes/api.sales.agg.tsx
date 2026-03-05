import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { ensureSalesAggFresh, listSalesAggRows } from "../services/prestaSalesService";

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
    const locationId = String(url.searchParams.get("locationId") ?? "").trim();
    const rangeDays = parseRange(String(url.searchParams.get("range") ?? "30"));
    const refresh = String(url.searchParams.get("refresh") ?? "").trim() === "1";

    const freshness = await ensureSalesAggFresh(admin, shop, {
      locationId: locationId || null,
      rangeDays,
      forceRefresh: refresh,
    });

    const rows = await listSalesAggRows(admin, shop, {
      locationId: freshness.locationId,
      rangeDays,
    });

    return Response.json({
      ok: true,
      refreshed: freshness.refreshed,
      refreshedAt: freshness.refreshedAt,
      locationId: freshness.locationId,
      rangeDays,
      count: rows.length,
      items: rows,
    });
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

export default function SalesAggApiRoute() {
  return null;
}
