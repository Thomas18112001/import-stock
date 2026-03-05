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
import { listLocations } from "../services/shopifyGraphql";

function riskTone(row: PlanningRow): "critical" | "warning" | "success" | "info" {
  if (row.riskStatus === "critical") return "critical";
  if (row.riskStatus === "warning") return "warning";
  if (row.riskStatus === "ok") return "success";
  return "info";
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleDateString("fr-FR");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const locations = await listLocations(admin);
  const locationId = String(url.searchParams.get("locationId") ?? "").trim() || locations[0]?.id || "";
  const range = [30, 90, 365].includes(Number(url.searchParams.get("range"))) ? Number(url.searchParams.get("range")) : 30;

  if (!locationId) {
    return {
      locations,
      locationId: "",
      range,
      rows: [],
      summary: {
        total: 0,
        critical: 0,
        warning: 0,
        noSales: 0,
        outOfStock: 0,
        underMin: 0,
        overStock: 0,
        incomingUnits: 0,
        suggestedUnits: 0,
      },
      averageCoverage: null,
    };
  }

  const { rows, summary } = await buildPlanningRows(admin, shop, {
    locationId,
    rangeDays: range,
    status: "all",
    limit: 350,
  });

  const coverageValues = rows.map((row) => row.coverageDays).filter((value): value is number => value != null);
  const averageCoverage =
    coverageValues.length > 0
      ? Number((coverageValues.reduce((sum, value) => sum + value, 0) / coverageValues.length).toFixed(1))
      : null;

  return {
    locations,
    locationId,
    range,
    rows,
    summary,
    averageCoverage,
  };
};

export default function InventoryHealthPage() {
  const data = useLoaderData<typeof loader>();
  const embeddedNavigate = useEmbeddedNavigate();
  const [locationId, setLocationId] = useState(data.locationId);
  const [range, setRange] = useState(String(data.range));

  const atRiskRows = useMemo(
    () => data.rows.filter((row) => row.riskStatus === "critical" || row.riskStatus === "warning").slice(0, 25),
    [data.rows],
  );
  const outOfStockRows = useMemo(() => data.rows.filter((row) => row.outOfStock).slice(0, 25), [data.rows]);
  const overStockRows = useMemo(() => data.rows.filter((row) => row.overStock).slice(0, 25), [data.rows]);

  const locationOptions = useMemo(
    () => data.locations.map((location) => ({ label: location.name, value: location.id })),
    [data.locations],
  );

  const goPlanning = (status: string) => {
    const params = new URLSearchParams();
    params.set("locationId", data.locationId);
    params.set("range", String(data.range));
    if (status !== "all") params.set("status", status);
    embeddedNavigate(`/planification-stock?${params.toString()}`);
  };

  return (
    <Page
      title="Santé inventaire"
      subtitle="Vue synthèse: ruptures, à risque, surstock et couverture"
      secondaryActions={[{ content: "Planification", onAction: () => goPlanning("all") }]}
    >
      <BlockStack gap="400">
        <Card>
          <InlineStack gap="300" align="start" blockAlign="end" wrap>
            <Box minWidth="240px">
              <Select label="Boutique" options={locationOptions} value={locationId} onChange={setLocationId} />
            </Box>
            <Box minWidth="180px">
              <Select
                label="Période ventes"
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
                embeddedNavigate(`/sante-inventaire?${params.toString()}`);
              }}
            >
              Actualiser
            </Button>
          </InlineStack>
        </Card>

        {data.rows.length === 0 ? (
          <Banner tone="info">Aucune donnée planning sur cette boutique.</Banner>
        ) : null}

        <InlineStack gap="300" wrap>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Produits analysés
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.total}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Ruptures
              </Text>
              <Text as="p" variant="headingLg" tone={data.summary.outOfStock > 0 ? "critical" : undefined}>
                {data.summary.outOfStock}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                À risque
              </Text>
              <Text as="p" variant="headingLg" tone={data.summary.critical + data.summary.warning > 0 ? "critical" : undefined}>
                {data.summary.critical + data.summary.warning}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Surstock
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.overStock}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Couverture moyenne
              </Text>
              <Text as="p" variant="headingLg">
                {data.averageCoverage == null ? "-" : `${data.averageCoverage} j`}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Entrants en cours
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.incomingUnits}
              </Text>
            </BlockStack>
          </Card>
        </InlineStack>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Ruptures
              </Text>
              <Button submit={false} onClick={() => goPlanning("out_of_stock")}>
                Ouvrir dans planification
              </Button>
            </InlineStack>
            {outOfStockRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun SKU en rupture.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "rupture", plural: "ruptures" }}
                itemCount={outOfStockRows.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Produit" },
                  { title: "Disponible" },
                  { title: "Entrant" },
                  { title: "Rupture estimée" },
                ]}
              >
                {outOfStockRows.map((row, index) => (
                  <IndexTable.Row id={`out-${row.sku}`} key={`out-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.productTitle || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{row.availableQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.incomingQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.stockoutDays == null ? "-" : `${row.stockoutDays} j`}</IndexTable.Cell>
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
                Produits à risque
              </Text>
              <Button submit={false} onClick={() => goPlanning("warning")}>
                Voir warning
              </Button>
            </InlineStack>
            {atRiskRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun risque immédiat.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "risque", plural: "risques" }}
                itemCount={atRiskRows.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Produit" },
                  { title: "Risque" },
                  { title: "Couverture" },
                  { title: "Date rupture" },
                ]}
              >
                {atRiskRows.map((row, index) => (
                  <IndexTable.Row id={`risk-${row.sku}`} key={`risk-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.productTitle || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={riskTone(row)}>{row.riskStatus}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.coverageDays == null ? "-" : `${row.coverageDays} j`}</IndexTable.Cell>
                    <IndexTable.Cell>{formatDate(row.stockoutDate)}</IndexTable.Cell>
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
                Surstock
              </Text>
              <Button submit={false} onClick={() => goPlanning("overstock")}>
                Ouvrir dans planification
              </Button>
            </InlineStack>
            {overStockRows.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Aucun SKU en surstock.
              </Text>
            ) : (
              <IndexTable
                resourceName={{ singular: "surstock", plural: "surstocks" }}
                itemCount={overStockRows.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Produit" },
                  { title: "Stock" },
                  { title: "Max" },
                  { title: "Suggestion" },
                ]}
              >
                {overStockRows.map((row, index) => (
                  <IndexTable.Row id={`over-${row.sku}`} key={`over-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.productTitle || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{row.availableQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.maxQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.suggestedQty}</IndexTable.Cell>
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
