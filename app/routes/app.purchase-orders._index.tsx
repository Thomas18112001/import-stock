import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  IndexTable,
  InlineStack,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
} from "@shopify/polaris";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import {
  PURCHASE_ORDER_STATUSES,
  getPurchaseOrderDetail,
  listPurchaseOrders,
  type PurchaseOrderStatus,
} from "../services/purchaseOrderService";
import { listLocations } from "../services/shopifyGraphql";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";

function statusLabel(status: PurchaseOrderStatus): string {
  if (status === "DRAFT") return "Brouillon";
  if (status === "INCOMING") return "En cours d'arrivage";
  if (status === "RECEIVED") return "Reçu en boutique";
  if (status === "CANCELED") return "Annulé";
  return status;
}

function statusTone(status: PurchaseOrderStatus): "info" | "success" | "warning" | "critical" {
  if (status === "RECEIVED") return "success";
  if (status === "INCOMING") return "warning";
  if (status === "CANCELED") return "critical";
  return "info";
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export type PurchaseOrdersIndexData = {
  orders: Awaited<ReturnType<typeof listPurchaseOrders>>;
  stockEntrant: {
    totalReassorts: number;
    totalLignes: number;
    totalUnites: number;
    produits: Array<{
      sku: string;
      produit: string;
      variante: string;
      imageUrl: string;
      quantite: number;
      boutique: string;
    }>;
  };
  status: PurchaseOrderStatus | "";
  destinationLocationId: string;
  locations: Awaited<ReturnType<typeof listLocations>>;
  scopeIssue: null | { missingScope: string; message: string };
  loadError: string | null;
  debug: boolean;
};

export async function loadPurchaseOrdersIndexData(input: {
  admin: Parameters<typeof listLocations>[0];
  shop: string;
  status: PurchaseOrderStatus | "";
  destinationLocationId: string;
  debug: boolean;
  timeoutMs?: number;
  deps?: {
    listLocationsFn: typeof listLocations;
    listPurchaseOrdersFn: typeof listPurchaseOrders;
    getPurchaseOrderDetailFn: typeof getPurchaseOrderDetail;
  };
}): Promise<PurchaseOrdersIndexData> {
  const deps = input.deps ?? {
    listLocationsFn: listLocations,
    listPurchaseOrdersFn: listPurchaseOrders,
    getPurchaseOrderDetailFn: getPurchaseOrderDetail,
  };

  try {
    const [locations, orders] = await withTimeout(
      Promise.all([
        deps.listLocationsFn(input.admin),
        deps.listPurchaseOrdersFn(input.admin, input.shop, {
          status: input.status,
          destinationLocationId: input.destinationLocationId,
        }),
      ]),
      input.timeoutMs ?? 2_000,
      "Le chargement des réassorts est trop long.",
    );

    const incomingOrders = orders.filter((order) => order.status === "INCOMING");
    const incomingDetails = await Promise.all(
      incomingOrders.slice(0, 30).map((order) => deps.getPurchaseOrderDetailFn(input.admin, input.shop, order.gid)),
    );

    const stockEntrantBySku = new Map<
      string,
      {
        sku: string;
        produit: string;
        variante: string;
        imageUrl: string;
        quantite: number;
        boutique: string;
      }
    >();
    let totalLignes = 0;
    let totalUnites = 0;

    for (const detail of incomingDetails) {
      for (const line of detail.lines) {
        const qty = Math.max(0, Number(line.quantityOrdered) - Number(line.quantityReceived));
        if (qty <= 0) continue;
        totalLignes += 1;
        totalUnites += qty;

        const key = `${detail.order.destinationLocationId}::${line.sku}`;
        const existing = stockEntrantBySku.get(key);
        if (existing) {
          existing.quantite += qty;
          continue;
        }

        stockEntrantBySku.set(key, {
          sku: line.sku || "-",
          produit: line.productTitle || line.sku || "Produit sans nom",
          variante: line.variantTitle || "-",
          imageUrl: line.imageUrl || "",
          quantite: qty,
          boutique: detail.order.destinationLocationName || "Boutique",
        });
      }
    }

    return {
      orders,
      stockEntrant: {
        totalReassorts: incomingOrders.length,
        totalLignes,
        totalUnites,
        produits: Array.from(stockEntrantBySku.values()).sort((a, b) => b.quantite - a.quantite),
      },
      status: input.status,
      destinationLocationId: input.destinationLocationId,
      locations,
      scopeIssue: null,
      loadError: null,
      debug: input.debug,
    };
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      return {
        orders: [],
        stockEntrant: { totalReassorts: 0, totalLignes: 0, totalUnites: 0, produits: [] },
        status: input.status,
        destinationLocationId: input.destinationLocationId,
        locations: [],
        scopeIssue: {
          missingScope: error.missingScope,
          message: `Autorisation manquante: ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        },
        loadError: null,
        debug: input.debug,
      };
    }

    return {
      orders: [],
      stockEntrant: { totalReassorts: 0, totalLignes: 0, totalUnites: 0, produits: [] },
      status: input.status,
      destinationLocationId: input.destinationLocationId,
      locations: [],
      scopeIssue: null,
      loadError: error instanceof Error ? error.message : "Erreur de chargement des réassorts.",
      debug: input.debug,
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const rawStatus = (url.searchParams.get("status") ?? "").trim();
  const status = PURCHASE_ORDER_STATUSES.includes(rawStatus as PurchaseOrderStatus)
    ? (rawStatus as PurchaseOrderStatus)
    : "";
  const destinationLocationId = (url.searchParams.get("destinationLocationId") ?? "").trim();
  return loadPurchaseOrdersIndexData({
    admin,
    shop,
    status,
    destinationLocationId,
    debug: env.debug,
  });
};

export default function PurchaseOrdersIndexPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const purgeFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    deletedOrders?: number;
    deletedLines?: number;
    deletedAudits?: number;
    skippedReceived?: number;
  }>();
  const [status, setStatus] = useState(data.status);
  const [destinationLocationId, setDestinationLocationId] = useState(data.destinationLocationId);
  const [includeReceived, setIncludeReceived] = useState(false);

  const isLoading = navigation.state !== "idle";
  const statusOptions = useMemo(
    () => [
      { label: "Tous", value: "" },
      ...PURCHASE_ORDER_STATUSES.map((value) => ({ label: statusLabel(value), value })),
    ],
    [],
  );

  const locationOptions = useMemo(
    () => [
      { label: "Toutes les destinations", value: "" },
      ...data.locations.map((location) => ({ label: location.name, value: location.id })),
    ],
    [data.locations],
  );

  const rows = data.orders.map((order, index) => (
    <IndexTable.Row id={order.gid} key={order.gid} position={index}>
      <IndexTable.Cell>{order.number}</IndexTable.Cell>
      <IndexTable.Cell>{order.supplierName}</IndexTable.Cell>
      <IndexTable.Cell>{order.destinationLocationName}</IndexTable.Cell>
      <IndexTable.Cell>{order.issuedAt ? new Date(order.issuedAt).toLocaleDateString("fr-FR") : "-"}</IndexTable.Cell>
      <IndexTable.Cell>
        {order.expectedArrivalAt ? new Date(order.expectedArrivalAt).toLocaleDateString("fr-FR") : "-"}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{String(order.lineCount)}</IndexTable.Cell>
      <IndexTable.Cell>{formatMoney(order.totalTtc, order.currency)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="slim"
          submit={false}
          onClick={() => embeddedNavigate(`/reassorts-magasin/${encodeReceiptIdForUrl(order.gid)}`)}
        >
          Ouvrir
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Réassorts magasin"
      subtitle="Suivi interne des commandes Presta B2B vers la boutique"
      primaryAction={{
        content: "Nouveau réassort",
        onAction: () => embeddedNavigate("/reassorts-magasin/nouveau"),
      }}
    >
      <BlockStack gap="400">
        {data.scopeIssue ? <Banner tone="critical">{data.scopeIssue.message}</Banner> : null}
        {data.loadError ? <Banner tone="critical">{data.loadError}</Banner> : null}

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Le statut en cours d&apos;arrivage est interne à l&apos;application. Shopify est mis à jour seulement au clic
              &quot;Reçu en boutique&quot;.
            </Text>
            <InlineStack gap="300" align="start" blockAlign="end">
              <Box minWidth="220px">
                <Select
                  label="Statut"
                  options={statusOptions}
                  value={status}
                  onChange={(value) =>
                    setStatus(
                      PURCHASE_ORDER_STATUSES.includes(value as PurchaseOrderStatus)
                        ? (value as PurchaseOrderStatus)
                        : "",
                    )
                  }
                />
              </Box>
              <Box minWidth="260px">
                <Select
                  label="Destination"
                  options={locationOptions}
                  value={destinationLocationId}
                  onChange={setDestinationLocationId}
                  disabled={data.locations.length === 0}
                />
              </Box>
              <Button
                submit={false}
                disabled={Boolean(data.scopeIssue) || Boolean(data.loadError)}
                onClick={() => {
                  const params = new URLSearchParams();
                  if (status) params.set("status", status);
                  if (destinationLocationId) params.set("destinationLocationId", destinationLocationId);
                  const query = params.toString();
                  embeddedNavigate(`/reassorts-magasin${query ? `?${query}` : ""}`);
                }}
              >
                Filtrer
              </Button>
            </InlineStack>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Nettoyage: vous pouvez supprimer en une fois les réassorts non reçus (Brouillon, En cours d&apos;arrivage, Annulé)
                pour la boutique sélectionnée.
              </Text>
              <Checkbox
                label="Inclure aussi les réassorts “Reçu en boutique” (mode test)"
                checked={includeReceived}
                onChange={setIncludeReceived}
              />
              <InlineStack>
                <Button
                  submit={false}
                  tone="critical"
                  loading={purgeFetcher.state !== "idle"}
                  disabled={purgeFetcher.state !== "idle" || !destinationLocationId}
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const confirmWord = includeReceived ? "SUPPRIMER TOUT" : "SUPPRIMER";
                      const value = window.prompt(
                        includeReceived
                          ? "Tapez SUPPRIMER TOUT pour confirmer la purge de tous les réassorts (y compris reçus)."
                          : "Tapez SUPPRIMER pour confirmer la purge des réassorts non reçus de cette boutique.",
                        "",
                      );
                      if ((value || "").trim().toUpperCase() !== confirmWord) {
                        return;
                      }
                    }
                    const formData = new FormData();
                    formData.set("destinationLocationId", destinationLocationId);
                    formData.set("confirmation", includeReceived ? "SUPPRIMER TOUT" : "SUPPRIMER");
                    formData.set("includeReceived", includeReceived ? "true" : "false");
                    purgeFetcher.submit(formData, {
                      method: "post",
                      action: "/actions/reassorts-magasin/purger",
                    });
                  }}
                >
                  {includeReceived ? "Purger tous les réassorts (test)" : "Purger les réassorts non reçus"}
                </Button>
              </InlineStack>
              {purgeFetcher.data?.ok ? (
                <Banner tone="success">
                  Purge terminée: {purgeFetcher.data.deletedOrders ?? 0} réassort(s), {purgeFetcher.data.deletedLines ?? 0} ligne(s),{" "}
                  {purgeFetcher.data.deletedAudits ?? 0} audit(s). Réassorts reçus conservés: {purgeFetcher.data.skippedReceived ?? 0}.
                </Banner>
              ) : null}
              {purgeFetcher.data?.error ? <Banner tone="critical">{purgeFetcher.data.error}</Banner> : null}
              {!destinationLocationId ? <Banner tone="warning">Sélectionnez d&apos;abord une boutique.</Banner> : null}
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Stock entrant (interne)
              </Text>
              <Badge tone={data.stockEntrant.totalReassorts > 0 ? "warning" : "info"}>
                {`${data.stockEntrant.totalReassorts} réassort(s) en cours d'arrivage`}
              </Badge>
            </InlineStack>
            <InlineStack gap="400">
              <Text as="p" variant="bodyMd">
                Lignes: {data.stockEntrant.totalLignes}
              </Text>
              <Text as="p" variant="bodyMd">
                Unités: {data.stockEntrant.totalUnites}
              </Text>
            </InlineStack>
            {data.stockEntrant.produits.length === 0 ? (
              <Text as="p" variant="bodyMd">
                Aucun stock entrant pour le filtre actuel.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "produit entrant", plural: "produits entrants" }}
                itemCount={data.stockEntrant.produits.length}
                selectable={false}
                headings={[
                  { title: "Produit" },
                  { title: "Variante" },
                  { title: "SKU" },
                  { title: "Quantité entrante" },
                  { title: "Boutique" },
                ]}
              >
                {data.stockEntrant.produits.slice(0, 20).map((item, index) => (
                  <IndexTable.Row id={`${item.boutique}-${item.sku}`} key={`${item.boutique}-${item.sku}`} position={index}>
                    <IndexTable.Cell>
                      <InlineStack gap="200" blockAlign="center">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.produit}
                            style={{
                              width: 28,
                              height: 28,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: "1px solid #d0d5dd",
                            }}
                          />
                        ) : null}
                        <Text as="span" variant="bodyMd">
                          {item.produit}
                        </Text>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{item.variante}</IndexTable.Cell>
                    <IndexTable.Cell>{item.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{String(item.quantite)}</IndexTable.Cell>
                    <IndexTable.Cell>{item.boutique}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Réassorts créés
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Liste des documents de réassort magasin avec leur statut et accès au détail.
            </Text>
            {isLoading ? (
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText />
              </BlockStack>
            ) : data.orders.length === 0 ? (
              <Text as="p" variant="bodyMd">
                Aucun réassort.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "réassort", plural: "réassorts" }}
                itemCount={data.orders.length}
                selectable={false}
                headings={[
                  { title: "Numéro" },
                  { title: "Fournisseur" },
                  { title: "Destination" },
                  { title: "Date" },
                  { title: "Arrivée estimée" },
                  { title: "Statut" },
                  { title: "Articles" },
                  { title: "Total TTC" },
                  { title: "Actions" },
                ]}
              >
                {rows}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
