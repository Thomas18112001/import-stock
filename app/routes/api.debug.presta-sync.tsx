import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { debugEvaluatePrestaOrders } from "../services/receiptService";
import { parseNonNegativeIntInput, parsePositiveIntInput } from "../utils/validators";

function assertDebugAccess(request: Request): void {
  const isDev = process.env.NODE_ENV === "development";
  const configuredToken = String(process.env.DEBUG_SYNC_TOKEN ?? "").trim();
  const providedToken = String(request.headers.get("x-debug-token") ?? "").trim();

  if (isDev) return;
  if (!configuredToken || providedToken !== configuredToken) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  assertDebugAccess(request);
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const locationId = String(url.searchParams.get("locationId") ?? "").trim();
  if (!locationId) {
    return Response.json({ ok: false, error: "Missing locationId." }, { status: 400 });
  }

  const limit = parsePositiveIntInput(url.searchParams.get("limit")) ?? 50;
  const offset = parseNonNegativeIntInput(url.searchParams.get("offset")) ?? 0;
  const sinceId = parsePositiveIntInput(url.searchParams.get("sinceId"));
  const updatedAtMin = String(url.searchParams.get("updatedAtMin") ?? "").trim();
  const updatedAtMax = String(url.searchParams.get("updatedAtMax") ?? "").trim();
  const sortKeyRaw = String(url.searchParams.get("sortKey") ?? "").trim().toLowerCase();
  const sortKey = sortKeyRaw === "date_upd" ? "date_upd" : "id";
  const sortDirection = String(url.searchParams.get("sort") ?? "DESC").trim().toUpperCase() === "ASC" ? "ASC" : "DESC";

  const result = await debugEvaluatePrestaOrders(admin, shop, {
    locationId,
    limit: Math.min(limit, 250),
    offset,
    sinceId: sinceId ?? undefined,
    updatedAtMin: updatedAtMin || undefined,
    updatedAtMax: updatedAtMax || undefined,
    sortKey,
    sortDirection,
  });
  return Response.json({
    ok: true,
    ...result,
  });
};
