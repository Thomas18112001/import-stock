import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import {
  upsertIncomingPurchaseOrderFromPrestaOrder,
  type UpsertIncomingPurchaseOrderFromPrestaResult,
} from "../services/purchaseOrderService";

type RawLineInput = {
  shopifyVariantId?: string | null;
  inventoryItemId?: string | null;
  sku?: string | null;
  title?: string | null;
  variantTitle?: string | null;
  imageUrl?: string | null;
  quantity?: number | string | null;
};

type RawPayload = {
  prestashopOrderId?: number | string | null;
  orderReference?: string | null;
  destinationLocationId?: string | null;
  lines?: RawLineInput[] | null;
};

type NormalizedPayload = {
  prestashopOrderId: number;
  orderReference: string;
  destinationLocationId: string;
  lines: Array<{
    sku: string;
    quantity: number;
  }>;
};

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function normalizeReassortFromPrestashopPayload(raw: RawPayload): NormalizedPayload {
  const prestashopOrderId = toPositiveInt(raw.prestashopOrderId);
  if (!prestashopOrderId) {
    throw new Error("Identifiant de commande PrestaShop obligatoire.");
  }

  const destinationLocationId = String(raw.destinationLocationId ?? "").trim();
  if (!destinationLocationId) {
    throw new Error("Boutique de destination obligatoire.");
  }

  const linesRaw = Array.isArray(raw.lines) ? raw.lines : [];
  const lines = linesRaw
    .map((line) => ({
      sku: String(line.sku ?? "").trim(),
      quantity: Math.trunc(Number(line.quantity ?? 0)),
    }))
    .filter((line) => line.sku.length > 0 && line.quantity > 0);

  if (!lines.length) {
    throw new Error("Aucune ligne valide à importer.");
  }

  return {
    prestashopOrderId,
    orderReference: String(raw.orderReference ?? "").trim(),
    destinationLocationId,
    lines,
  };
}

export async function upsertReassortFromPrestashopPayload(input: {
  admin: Awaited<ReturnType<typeof requireAdmin>>["admin"];
  shop: string;
  actor: string;
  payload: NormalizedPayload;
  deps?: {
    upsertFn: typeof upsertIncomingPurchaseOrderFromPrestaOrder;
  };
}): Promise<UpsertIncomingPurchaseOrderFromPrestaResult> {
  const upsertFn = input.deps?.upsertFn ?? upsertIncomingPurchaseOrderFromPrestaOrder;
  return upsertFn(input.admin, input.shop, {
    prestaOrderId: input.payload.prestashopOrderId,
    prestaReference: input.payload.orderReference || null,
    destinationLocationId: input.payload.destinationLocationId,
    actor: input.actor,
    lines: input.payload.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
    })),
    supplierNotes: `Réassort généré depuis la commande PrestaShop #${input.payload.prestashopOrderId}.`,
    internalNotes: `Référence commande PrestaShop: ${input.payload.orderReference || "-"}`,
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actor } = await requireAdmin(request);

  let rawPayload: RawPayload;
  try {
    rawPayload = (await request.json()) as RawPayload;
  } catch {
    return Response.json({ ok: false, error: "Payload JSON invalide." }, { status: 400 });
  }

  try {
    const payload = normalizeReassortFromPrestashopPayload(rawPayload);
    const restock = await upsertReassortFromPrestashopPayload({
      admin,
      shop,
      actor,
      payload,
    });

    return Response.json(
      {
        ok: true,
        restockOrderId: restock.purchaseOrderGid,
        restockOrderNumber: restock.number,
        status: restock.status,
        created: restock.created,
        lines: restock.lines,
      },
      { status: restock.created ? 201 : 200 },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur de création du réassort." },
      { status: 400 },
    );
  }
};

export default function ApiReassortsFromPrestashopOrder() {
  return null;
}

