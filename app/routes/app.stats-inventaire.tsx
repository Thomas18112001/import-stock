import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { buildPlanningRows, type PlanningRow } from "../services/inventoryPlanningService";
import {
  ensureSalesAggFresh,
  listSalesAggRows,
} from "../services/prestaSalesService";
import {
  getPurchaseOrderDetail,
  listPurchaseOrders,
  type PurchaseOrderStatus,
} from "../services/purchaseOrderService";
import { listLocations } from "../services/shopifyGraphql";
import { encodeReceiptIdForUrl } from "../utils/receiptId";

function parseRange(raw: string): 30 | 90 | 365 {
  const value = Math.trunc(Number(raw));
  if (value === 90) return 90;
  if (value === 365) return 365;
  return 30;
}

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

function formatDate(value: string): string {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString("fr-FR");
}

function formatCurrency(value: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

type StatsHistoryRow = {
  gid: string;
  number: string;
  status: PurchaseOrderStatus;
  productCount: number;
  quantityTotal: number;
  totalTtc: number;
  currency: string;
  importDate: string;
  orderDate: string;
  updateDate: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const locations = await listLocations(admin);
  const locationId = String(url.searchParams.get("locationId") ?? "").trim() || locations[0]?.id || "";
  const range = parseRange(String(url.searchParams.get("range") ?? "30"));
  const refreshSales = String(url.searchParams.get("refreshSales") ?? "").trim() === "1";

  if (!locationId) {
    return {
      locations,
      locationId: "",
      range,
      kpis: {
        riskProducts: 0,
        outOfStock: 0,
        averageCoverage: null as number | null,
        incomingUnits: 0,
        salesVelocity30: 0,
        salesVelocity365: 0,
        totalSold30: 0,
        totalSold365: 0,
        totalPurchaseOrders: 0,
        totalReceivedOrders: 0,
        totalIncomingOrders: 0,
        totalImportedAmount: 0,
      },
      topSalesRows: [] as Array<{ sku: string; totalSold: number; avgDailySales: number }>,
      riskRows: [] as PlanningRow[],
      historyRows: [] as StatsHistoryRow[],
    };
  }

  if (refreshSales) {
    await Promise.all([
      ensureSalesAggFresh(admin, shop, {
        locationId,
        rangeDays: 30,
        forceRefresh: true,
      }),
      ensureSalesAggFresh(admin, shop, {
        locationId,
        rangeDays: 365,
        forceRefresh: true,
      }),
    ]);
  }

  const [{ rows, summary }, sales30, sales365, orders] = await Promise.all([
    buildPlanningRows(admin, shop, {
      locationId,
      rangeDays: range,
      status: "all",
      limit: 400,
    }),
    listSalesAggRows(admin, shop, { locationId, rangeDays: 30 }),
    listSalesAggRows(admin, shop, { locationId, rangeDays: 365 }),
    listPurchaseOrders(admin, shop, { destinationLocationId: locationId }),
  ]);

  const coverageValues = rows
    .map((row) => row.coverageDays)
    .filter((value): value is number => value != null);
  const averageCoverage =
    coverageValues.length > 0
      ? Number((coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length).toFixed(1))
      : null;

  const totalSold30 = sales30.reduce((sum, row) => sum + row.totalSold, 0);
  const totalSold365 = sales365.reduce((sum, row) => sum + row.totalSold, 0);
  const salesVelocity30 =
    sales30.length > 0
      ? Number((sales30.reduce((sum, row) => sum + row.avgDailySales, 0) / sales30.length).toFixed(3))
      : 0;
  const salesVelocity365 =
    sales365.length > 0
      ? Number((sales365.reduce((sum, row) => sum + row.avgDailySales, 0) / sales365.length).toFixed(3))
      : 0;

  const sortedOrders = [...orders].sort((left, right) => {
    const leftMs = Date.parse(left.updatedAt || left.issuedAt || "");
    const rightMs = Date.parse(right.updatedAt || right.issuedAt || "");
    return (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
  });

  const historyBase = sortedOrders.slice(0, 20);
  const historyDetails = await Promise.all(
    historyBase.map(async (order) => {
      try {
        return await getPurchaseOrderDetail(admin, shop, order.gid);
      } catch {
        return null;
      }
    }),
  );

  const historyRows: StatsHistoryRow[] = historyBase.map((order, index) => {
    const detail = historyDetails[index];
    const lines = detail?.lines ?? [];
    const quantityTotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantityOrdered || 0)), 0);
    const productCount = lines.length || order.lineCount;
    const importDate =
      detail?.audit
        .map((audit) => String(audit.createdAt || "").trim())
        .filter(Boolean)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || order.updatedAt;

    return {
      gid: order.gid,
      number: order.number,
      status: order.status,
      productCount,
      quantityTotal,
      totalTtc: detail?.order.totalTtc ?? order.totalTtc,
      currency: detail?.order.currency ?? order.currency,
      importDate,
      orderDate: order.issuedAt,
      updateDate: order.updatedAt,
    };
  });

  const riskRows = rows
    .filter((row) => row.riskStatus === "critical" || row.riskStatus === "warning")
    .sort((left, right) => {
      const leftDays = left.stockoutDays ?? Number.POSITIVE_INFINITY;
      const rightDays = right.stockoutDays ?? Number.POSITIVE_INFINITY;
      if (leftDays !== rightDays) return leftDays - rightDays;
      return left.sku.localeCompare(right.sku, "fr");
    })
    .slice(0, 30);

  const totalImportedAmount = sortedOrders.reduce((sum, row) => sum + Number(row.totalTtc || 0), 0);

  return {
    locations,
    locationId,
    range,
    kpis: {
      riskProducts: summary.critical + summary.warning,
      outOfStock: summary.outOfStock,
      averageCoverage,
      incomingUnits: summary.incomingUnits,
      salesVelocity30,
      salesVelocity365,
      totalSold30,
      totalSold365,
      totalPurchaseOrders: sortedOrders.length,
      totalReceivedOrders: sortedOrders.filter((row) => row.status === "RECEIVED").length,
      totalIncomingOrders: sortedOrders.filter((row) => row.status === "INCOMING").length,
      totalImportedAmount,
    },
    topSalesRows: sales30.slice(0, 20).map((row) => ({
      sku: row.sku,
      totalSold: row.totalSold,
      avgDailySales: Number(row.avgDailySales.toFixed(3)),
    })),
    riskRows,
    historyRows,
    refreshSalesRequested: refreshSales,
    salesAggMissing: sales30.length === 0 && sales365.length === 0,
  };
};

export default function InventoryStatsPage() {
  const data = useLoaderData<typeof loader>();
  const embeddedNavigate = useEmbeddedNavigate();
  const [locationId, setLocationId] = useState(data.locationId);
  const [range, setRange] = useState(String(data.range));

  const locationOptions = useMemo(
    () => data.locations.map((location) => ({ label: location.name, value: location.id })),
    [data.locations],
  );

  const goToPlanning = (status: string) => {
    if (!data.locationId) return;
    const params = new URLSearchParams();
    params.set("locationId", data.locationId);
    params.set("range", String(data.range));
    if (status) params.set("status", status);
    embeddedNavigate(`/planification-stock?${params.toString()}`);
  };

  return (
    <Page
      title="Stats inventaire"
      subtitle="Produits à risque, couverture, historique imports/réceptions et vitesse de vente"
      secondaryActions={[{ content: "Planification", onAction: () => goToPlanning("all") }]}
    >
      <BlockStack gap="400">
        {data.salesAggMissing ? (
          <Banner tone="info">
            Aucun agrégat de ventes Presta en cache pour cette boutique. Utilisez &quot;Rafraîchir ventes Presta&quot; pour charger les
            statistiques.
          </Banner>
        ) : null}

        <Card>
          <InlineStack gap="300" align="start" blockAlign="end" wrap>
            <Box minWidth="260px">
              <Select label="Boutique" value={locationId} options={locationOptions} onChange={setLocationId} />
            </Box>
            <Box minWidth="200px">
              <Select
                label="Fenêtre planning"
                value={range}
                onChange={setRange}
                options={[
                  { label: "30 jours", value: "30" },
                  { label: "90 jours", value: "90" },
                  { label: "365 jours", value: "365" },
                ]}
              />
            </Box>
            <Button
              submit={false}
              onClick={() => {
                const params = new URLSearchParams();
                params.set("locationId", locationId);
                params.set("range", range);
                embeddedNavigate(`/stats-inventaire?${params.toString()}`);
              }}
            >
              Actualiser
            </Button>
            <Button
              submit={false}
              onClick={() => {
                const params = new URLSearchParams();
                params.set("locationId", locationId);
                params.set("range", range);
                params.set("refreshSales", "1");
                embeddedNavigate(`/stats-inventaire?${params.toString()}`);
              }}
            >
              Rafraîchir ventes Presta
            </Button>
          </InlineStack>
        </Card>

        <InlineStack gap="300" wrap>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Produits à risque
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.riskProducts}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Ruptures
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.outOfStock}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Couverture moyenne
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.averageCoverage == null ? "-" : `${data.kpis.averageCoverage} j`}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Entrants
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.incomingUnits}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Vitesse 30j
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.salesVelocity30.toFixed(3)} /j
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Vitesse 365j
              </Text>
              <Text as="p" variant="headingLg">
                {data.kpis.salesVelocity365.toFixed(3)} /j
              </Text>
            </BlockStack>
          </Card>
        </InlineStack>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Produits à risque
              </Text>
              <Button submit={false} onClick={() => goToPlanning("warning")}>
                Ouvrir planification
              </Button>
            </InlineStack>
            {data.riskRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun produit à risque pour ce filtre.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "risque", plural: "risques" }}
                itemCount={data.riskRows.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Produit" },
                  { title: "Risque" },
                  { title: "Couverture" },
                  { title: "Rupture estimée" },
                ]}
              >
                {data.riskRows.map((row, index) => (
                  <IndexTable.Row id={`risk-${row.sku}`} key={`risk-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.productTitle || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={row.riskStatus === "critical" ? "critical" : "warning"}>{row.riskStatus}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.coverageDays == null ? "-" : `${row.coverageDays} j`}</IndexTable.Cell>
                    <IndexTable.Cell>{row.stockoutDate ? formatDate(row.stockoutDate) : "-"}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Vitesse de vente (Top SKU - 30 jours)
            </Text>
            {data.topSalesRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun agrégat de ventes disponible.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "vente", plural: "ventes" }}
                itemCount={data.topSalesRows.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Vendus (30j)" },
                  { title: "Moyenne / jour" },
                ]}
              >
                {data.topSalesRows.map((row, index) => (
                  <IndexTable.Row id={`sale-${row.sku}`} key={`sale-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.totalSold}</IndexTable.Cell>
                    <IndexTable.Cell>{row.avgDailySales.toFixed(3)}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Historique imports / réceptions (20)
              </Text>
              <Button submit={false} onClick={() => embeddedNavigate("/reassorts-magasin")}>
                Voir toutes
              </Button>
            </InlineStack>

            <InlineStack gap="300" wrap>
              <Text as="p" variant="bodySm" tone="subdued">
                Commandes: {data.kpis.totalPurchaseOrders}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                En arrivage: {data.kpis.totalIncomingOrders}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Reçues: {data.kpis.totalReceivedOrders}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Montant total: {formatCurrency(data.kpis.totalImportedAmount)}
              </Text>
            </InlineStack>

            {data.historyRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun import/réception.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "historique", plural: "historiques" }}
                itemCount={data.historyRows.length}
                selectable={false}
                headings={[
                  { title: "Commande" },
                  { title: "Statut" },
                  { title: "Produits" },
                  { title: "Qté" },
                  { title: "Montant" },
                  { title: "Date import" },
                  { title: "Date commande" },
                  { title: "Date maj" },
                  { title: "Action" },
                ]}
              >
                {data.historyRows.map((row, index) => (
                  <IndexTable.Row id={row.gid} key={row.gid} position={index}>
                    <IndexTable.Cell>{row.number}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.productCount}</IndexTable.Cell>
                    <IndexTable.Cell>{row.quantityTotal}</IndexTable.Cell>
                    <IndexTable.Cell>{formatCurrency(row.totalTtc, row.currency)}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(row.importDate)}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(row.orderDate)}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(row.updateDate)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Button
                        size="slim"
                        submit={false}
                        onClick={() =>
                          embeddedNavigate(`/reassorts-magasin/${encodeReceiptIdForUrl(row.gid)}`)
                        }
                      >
                        Ouvrir
                      </Button>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
