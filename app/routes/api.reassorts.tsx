import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { listPurchaseOrders, type PurchaseOrderStatus } from "../services/purchaseOrderService";

const ALLOWED_STATUS: Array<PurchaseOrderStatus> = ["DRAFT", "INCOMING", "RECEIVED", "CANCELED"];

type ListApiInput = {
  admin: Awaited<ReturnType<typeof requireAdmin>>["admin"];
  shop: string;
  status: PurchaseOrderStatus | "";
  destinationLocationId: string;
  deps?: {
    listPurchaseOrdersFn: typeof listPurchaseOrders;
  };
};

export async function loadReassortsApiData(input: ListApiInput) {
  const listFn = input.deps?.listPurchaseOrdersFn ?? listPurchaseOrders;
  const orders = await listFn(input.admin, input.shop, {
    status: input.status,
    destinationLocationId: input.destinationLocationId,
  });
  return {
    items: orders.map((order) => ({
      id: order.gid,
      numero: order.number,
      boutique: order.destinationLocationName,
      date: order.issuedAt,
      statut: order.status,
      nbArticles: order.lineCount,
      totalTtc: order.totalTtc,
      devise: order.currency,
    })),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const rawStatus = String(url.searchParams.get("status") ?? "").trim();
  const status = ALLOWED_STATUS.includes(rawStatus as PurchaseOrderStatus)
    ? (rawStatus as PurchaseOrderStatus)
    : "";
  const destinationLocationId = String(url.searchParams.get("destinationLocationId") ?? "").trim();

  const data = await loadReassortsApiData({
    admin,
    shop,
    status,
    destinationLocationId,
  });
  return Response.json({ ok: true, ...data });
};

export default function ApiReassortsListRoute() {
  return null;
}
