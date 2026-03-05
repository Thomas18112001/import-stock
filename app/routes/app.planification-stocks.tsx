import { useEffect, useMemo, useState } from "react";
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
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { getAlertConfig, listAlertEvents, upsertAlertsFromPlanningRows } from "../services/inventoryAlertService";
import { buildPlanningRows, type PlanningRow } from "../services/inventoryPlanningService";
import { listThresholdGlobals } from "../services/inventoryThresholdService";
import { listLocations } from "../services/shopifyGraphql";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { sanitizeSearchQuery } from "../utils/validators";

function parseRange(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30;
  if ([30, 90, 365].includes(Math.trunc(parsed))) return Math.trunc(parsed);
  return 30;
}

function riskBadgeTone(risk: PlanningRow["riskStatus"]): "success" | "warning" | "critical" | "info" {
  if (risk === "critical") return "critical";
  if (risk === "warning") return "warning";
  if (risk === "ok") return "success";
  return "info";
}

function riskLabel(risk: PlanningRow["riskStatus"]): string {
  if (risk === "critical") return "Critique";
  if (risk === "warning") return "À risque";
  if (risk === "ok") return "OK";
  return "Aucune vente";
}

function formatEta(value: string | null): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleDateString("fr-FR");
}

function formatStockoutDate(value: string | null): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleDateString("fr-FR");
}

function asIntString(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "0";
  return String(Math.trunc(parsed));
}

function buildThresholdGlobalsCsv(
  rows: Array<{
    sku: string;
    minQty: number;
    maxQty: number;
    safetyStock: number;
    targetCoverageDays: number;
  }>,
): string {
  const header = "sku,minQty,maxQty,safetyStock,targetCoverageDays";
  const body = rows.map((row) =>
    [row.sku, row.minQty, row.maxQty, row.safetyStock, row.targetCoverageDays]
      .map((cell) => String(cell).replace(/,/g, " "))
      .join(","),
  );
  return [header, ...body].join("\n");
}

function ThresholdInlineEditor({ row, locationId }: { row: PlanningRow; locationId: string }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [minQty, setMinQty] = useState(String(row.minQty));
  const [maxQty, setMaxQty] = useState(String(row.maxQty));
  const [safetyStock, setSafetyStock] = useState(String(row.safetyStock));
  const [targetCoverageDays, setTargetCoverageDays] = useState(String(row.targetCoverageDays));

  useEffect(() => {
    setMinQty(String(row.minQty));
    setMaxQty(String(row.maxQty));
    setSafetyStock(String(row.safetyStock));
    setTargetCoverageDays(String(row.targetCoverageDays));
  }, [row.maxQty, row.minQty, row.safetyStock, row.targetCoverageDays]);

  const canSave = fetcher.state === "idle";

  return (
    <BlockStack gap="100">
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Box minWidth="68px">
          <TextField label="Min" labelHidden value={minQty} onChange={setMinQty} autoComplete="off" />
        </Box>
        <Box minWidth="68px">
          <TextField label="Max" labelHidden value={maxQty} onChange={setMaxQty} autoComplete="off" />
        </Box>
        <Box minWidth="68px">
          <TextField label="Sécurité" labelHidden value={safetyStock} onChange={setSafetyStock} autoComplete="off" />
        </Box>
        <Box minWidth="68px">
          <TextField
            label="Cible"
            labelHidden
            value={targetCoverageDays}
            onChange={setTargetCoverageDays}
            autoComplete="off"
          />
        </Box>
      </InlineStack>
      <InlineStack gap="100" blockAlign="center">
        <fetcher.Form method="post" action="/actions/planification/seuils">
          <input type="hidden" name="intent" value="upsert_override" />
          <input type="hidden" name="sku" value={row.sku} />
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="minQty" value={asIntString(minQty)} />
          <input type="hidden" name="maxQty" value={asIntString(maxQty)} />
          <input type="hidden" name="safetyStock" value={asIntString(safetyStock)} />
          <input type="hidden" name="targetCoverageDays" value={asIntString(targetCoverageDays)} />
          <Button submit size="micro" loading={fetcher.state !== "idle"} disabled={!canSave}>
            Sauver
          </Button>
        </fetcher.Form>

        {row.thresholdSource === "override" ? (
          <fetcher.Form method="post" action="/actions/planification/seuils">
            <input type="hidden" name="intent" value="reset_override" />
            <input type="hidden" name="sku" value={row.sku} />
            <input type="hidden" name="locationId" value={locationId} />
            <Button submit size="micro" tone="critical" disabled={!canSave}>
              Reset
            </Button>
          </fetcher.Form>
        ) : null}
      </InlineStack>
      {fetcher.data?.error ? (
        <Text as="p" variant="bodySm" tone="critical">
          {fetcher.data.error}
        </Text>
      ) : null}
    </BlockStack>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const locations = await listLocations(admin);

  const selectedLocationId =
    String(url.searchParams.get("locationId") ?? "").trim() ||
    locations[0]?.id ||
    "";

  if (!selectedLocationId) {
    return {
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
      locations,
      selectedLocationId: "",
      range: 30,
      status: "all",
      q: "",
      openAlertsCount: 0,
      thresholdGlobals: [],
    };
  }

  const range = parseRange(String(url.searchParams.get("range") ?? "30"));
  const status =
    String(url.searchParams.get("status") ?? "all").trim() || "all";
  const q = sanitizeSearchQuery(String(url.searchParams.get("q") ?? ""));
  const refreshSales = String(url.searchParams.get("refreshSales") ?? "").trim() === "1";

  const [{ rows, summary }, thresholdGlobals] = await Promise.all([
    buildPlanningRows(admin, shop, {
      locationId: selectedLocationId,
      rangeDays: range,
      query: q,
      status: status as Parameters<typeof buildPlanningRows>[2]["status"],
      ensureFreshSales: refreshSales,
    }),
    listThresholdGlobals(admin, shop),
  ]);

  const alertConfig = await getAlertConfig(admin, shop);
  await upsertAlertsFromPlanningRows(admin, shop, {
    locationId: selectedLocationId,
    rows,
    config: alertConfig,
  });

  const openAlerts = await listAlertEvents(admin, shop, {
    status: "OPEN",
    locationId: selectedLocationId,
    limit: 500,
  });

  return {
    rows,
    summary,
    locations,
    selectedLocationId,
    range,
    status,
    q,
    openAlertsCount: openAlerts.length,
    thresholdGlobals,
  };
};

export default function PlanningStocksPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const copyFetcher = useFetcher<{ ok: boolean; error?: string; copied?: number }>();
  const globalThresholdFetcher = useFetcher<{ ok: boolean; error?: string; mode?: string; imported?: number }>();
  const createPoFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    purchaseOrderGid?: string;
    number?: string;
    lineCount?: number;
  }>();

  const [locationId, setLocationId] = useState(data.selectedLocationId);
  const [range, setRange] = useState(String(data.range));
  const [status, setStatus] = useState(data.status);
  const [query, setQuery] = useState(data.q);
  const [copyFrom, setCopyFrom] = useState(data.selectedLocationId);
  const [copyTo, setCopyTo] = useState(data.selectedLocationId);
  const [globalSku, setGlobalSku] = useState("");
  const [globalMinQty, setGlobalMinQty] = useState("0");
  const [globalMaxQty, setGlobalMaxQty] = useState("0");
  const [globalSafetyStock, setGlobalSafetyStock] = useState("0");
  const [globalTargetCoverageDays, setGlobalTargetCoverageDays] = useState("30");
  const [globalCsv, setGlobalCsv] = useState("");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const [selectedSkus, setSelectedSkus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLocationId(data.selectedLocationId);
    setRange(String(data.range));
    setStatus(data.status);
    setQuery(data.q);
    setCopyFrom(data.selectedLocationId);
    setCopyTo(data.selectedLocationId);
  }, [data.q, data.range, data.selectedLocationId, data.status]);

  useEffect(() => {
    if (copyFetcher.data?.ok) {
      setToast({ content: `${copyFetcher.data.copied ?? 0} override(s) copié(s).` });
    } else if (copyFetcher.data?.error) {
      setToast({ content: copyFetcher.data.error, error: true });
    }
  }, [copyFetcher.data]);

  useEffect(() => {
    if (createPoFetcher.data?.ok && createPoFetcher.data.purchaseOrderGid) {
      setToast({ content: `Commande fournisseur créée: ${createPoFetcher.data.number}` });
    } else if (createPoFetcher.data?.error) {
      setToast({ content: createPoFetcher.data.error, error: true });
    }
  }, [createPoFetcher.data]);

  useEffect(() => {
    if (globalThresholdFetcher.data?.ok) {
      if (globalThresholdFetcher.data.mode === "global_csv") {
        setToast({ content: `${globalThresholdFetcher.data.imported ?? 0} seuil(s) global(aux) importé(s).` });
        setGlobalCsv("");
      } else {
        setToast({ content: "Seuil global enregistré." });
      }
      return;
    }
    if (globalThresholdFetcher.data?.error) {
      setToast({ content: globalThresholdFetcher.data.error, error: true });
    }
  }, [globalThresholdFetcher.data]);

  const locationOptions = useMemo(
    () => data.locations.map((location) => ({ label: location.name, value: location.id })),
    [data.locations],
  );

  const selectedSuggestionRows = useMemo(
    () =>
      data.rows.filter((row) => selectedSkus[row.sku] && row.suggestedQty > 0).map((row) => ({ sku: row.sku, quantity: row.suggestedQty })),
    [data.rows, selectedSkus],
  );

  const totalSuggestedSelected = selectedSuggestionRows.reduce((sum, row) => sum + row.quantity, 0);

  const isLoading = navigation.state !== "idle";
  const globalThresholdPreview = data.thresholdGlobals.slice(0, 30);

  const rowsMarkup = data.rows.map((row, index) => (
    <IndexTable.Row id={row.sku} key={row.sku} position={index}>
      <IndexTable.Cell>
        <Checkbox
          label=""
          labelHidden
          checked={Boolean(selectedSkus[row.sku])}
          onChange={(checked) =>
            setSelectedSkus((prev) => ({
              ...prev,
              [row.sku]: checked,
            }))
          }
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {row.productTitle || row.sku}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {row.variantTitle || row.sku}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            SKU {row.sku}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{row.availableQty}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd">
            {row.incomingQty}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            ETA {formatEta(row.etaDate)}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{row.avgDailySales.toFixed(2)}</IndexTable.Cell>
      <IndexTable.Cell>{row.coverageDays == null ? "-" : `${row.coverageDays} j`}</IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd">
            {row.stockoutDays == null ? "-" : `${row.stockoutDays} j`}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatStockoutDate(row.stockoutDate)}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={riskBadgeTone(row.riskStatus)}>{riskLabel(row.riskStatus)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {row.suggestedQty}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <ThresholdInlineEditor row={row} locationId={locationId} />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          size="slim"
          submit={false}
          onClick={() => embeddedNavigate(`/reassorts-magasin/nouveau?sku=${encodeURIComponent(row.sku)}&locationId=${encodeURIComponent(locationId)}`)}
        >
          PO
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const handleExportThresholdCsv = () => {
    if (typeof window === "undefined") return;
    const csv = buildThresholdGlobalsCsv(data.thresholdGlobals);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `thresholds-globaux-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Page
      title="Planification stock"
      subtitle="Vue centrale type Prediko: stock, entrants, couverture, rupture et suggestion fournisseur"
      secondaryActions={[{ content: "Alertes", onAction: () => embeddedNavigate("/alertes-inventaire") }]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" align="start" blockAlign="end" wrap>
              <Box minWidth="260px">
                <Select label="Boutique" options={locationOptions} value={locationId} onChange={setLocationId} />
              </Box>
              <Box minWidth="160px">
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
              <Box minWidth="200px">
                <Select
                  label="Statut"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { label: "Tous", value: "all" },
                    { label: "Critiques", value: "critical" },
                    { label: "À risque", value: "warning" },
                    { label: "En rupture", value: "out_of_stock" },
                    { label: "Sous min", value: "under_min" },
                    { label: "Surstock", value: "overstock" },
                    { label: "Sans ventes", value: "no_sales" },
                    { label: "OK", value: "ok" },
                  ]}
                />
              </Box>
              <Box minWidth="260px">
                <TextField
                  label="Recherche"
                  value={query}
                  onChange={setQuery}
                  autoComplete="off"
                  placeholder="SKU, produit, référence"
                />
              </Box>
              <Button
                submit={false}
                loading={isLoading}
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set("locationId", locationId);
                  params.set("range", range);
                  if (status && status !== "all") params.set("status", status);
                  if (query.trim()) params.set("q", query.trim());
                  embeddedNavigate(`/planification-stock${params.toString() ? `?${params.toString()}` : ""}`);
                }}
              >
                Filtrer
              </Button>
              <Button
                submit={false}
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set("locationId", locationId);
                  params.set("range", range);
                  params.set("refreshSales", "1");
                  if (status && status !== "all") params.set("status", status);
                  if (query.trim()) params.set("q", query.trim());
                  embeddedNavigate(`/planification-stock?${params.toString()}`);
                }}
              >
                Rafraîchir ventes
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineStack gap="300" wrap>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Produits affichés
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.total}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Risques critiques
              </Text>
              <Text as="p" variant="headingLg" tone={data.summary.critical > 0 ? "critical" : undefined}>
                {data.summary.critical}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Sous minimum
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.underMin}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Suggestions total
              </Text>
              <Text as="p" variant="headingLg">
                {data.summary.suggestedUnits}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Alertes ouvertes
              </Text>
              <Text as="p" variant="headingLg" tone={data.openAlertsCount > 0 ? "critical" : undefined}>
                {data.openAlertsCount}
              </Text>
            </BlockStack>
          </Card>
        </InlineStack>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Copier les overrides de seuils
            </Text>
            <InlineStack gap="300" blockAlign="end" align="start" wrap>
              <Box minWidth="260px">
                <Select label="Depuis" options={locationOptions} value={copyFrom} onChange={setCopyFrom} />
              </Box>
              <Box minWidth="260px">
                <Select label="Vers" options={locationOptions} value={copyTo} onChange={setCopyTo} />
              </Box>
              <copyFetcher.Form method="post" action="/actions/planification/seuils">
                <input type="hidden" name="intent" value="copy_overrides" />
                <input type="hidden" name="fromLocationId" value={copyFrom} />
                <input type="hidden" name="toLocationId" value={copyTo} />
                <Button submit loading={copyFetcher.state !== "idle"} disabled={!copyFrom || !copyTo || copyFrom === copyTo}>
                  Copier
                </Button>
              </copyFetcher.Form>
            </InlineStack>
            {copyFetcher.data?.error ? <Banner tone="critical">{copyFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Seuils globaux (base)
              </Text>
              <InlineStack gap="200">
                <Button submit={false} onClick={handleExportThresholdCsv} disabled={data.thresholdGlobals.length === 0}>
                  Export CSV
                </Button>
              </InlineStack>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              Le global s&apos;applique partout, puis peut être surchargé par boutique dans le tableau de planification.
            </Text>

            <globalThresholdFetcher.Form method="post" action="/actions/planification/seuils">
              <input type="hidden" name="intent" value="upsert_global" />
              <InlineStack gap="300" blockAlign="end" align="start" wrap>
                <Box minWidth="180px">
                  <TextField label="SKU" value={globalSku} onChange={setGlobalSku} autoComplete="off" />
                </Box>
                <Box minWidth="90px">
                  <TextField label="Min" value={globalMinQty} onChange={setGlobalMinQty} autoComplete="off" />
                </Box>
                <Box minWidth="90px">
                  <TextField label="Max" value={globalMaxQty} onChange={setGlobalMaxQty} autoComplete="off" />
                </Box>
                <Box minWidth="110px">
                  <TextField label="Sécurité" value={globalSafetyStock} onChange={setGlobalSafetyStock} autoComplete="off" />
                </Box>
                <Box minWidth="110px">
                  <TextField
                    label="Cible (jours)"
                    value={globalTargetCoverageDays}
                    onChange={setGlobalTargetCoverageDays}
                    autoComplete="off"
                  />
                </Box>

                <input type="hidden" name="sku" value={globalSku.trim()} />
                <input type="hidden" name="minQty" value={asIntString(globalMinQty)} />
                <input type="hidden" name="maxQty" value={asIntString(globalMaxQty)} />
                <input type="hidden" name="safetyStock" value={asIntString(globalSafetyStock)} />
                <input type="hidden" name="targetCoverageDays" value={asIntString(globalTargetCoverageDays)} />

                <Button submit loading={globalThresholdFetcher.state !== "idle"} disabled={!globalSku.trim()}>
                  Sauver global
                </Button>
              </InlineStack>
            </globalThresholdFetcher.Form>

            <globalThresholdFetcher.Form method="post" action="/actions/planification/seuils">
              <input type="hidden" name="intent" value="bulk_upsert_global_csv" />
              <BlockStack gap="200">
                <TextField
                  label="Import CSV seuils globaux"
                  value={globalCsv}
                  onChange={setGlobalCsv}
                  autoComplete="off"
                  multiline={4}
                  helpText="Format: sku,minQty,maxQty,safetyStock,targetCoverageDays"
                />
                <input type="hidden" name="csv" value={globalCsv} />
                <InlineStack>
                  <Button submit disabled={!globalCsv.trim()} loading={globalThresholdFetcher.state !== "idle"}>
                    Importer CSV
                  </Button>
                </InlineStack>
              </BlockStack>
            </globalThresholdFetcher.Form>

            {data.thresholdGlobals.length === 0 ? (
              <Banner tone="info">Aucun seuil global configuré.</Banner>
            ) : (
              <IndexTable
                resourceName={{ singular: "seuil global", plural: "seuils globaux" }}
                itemCount={globalThresholdPreview.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Min" },
                  { title: "Max" },
                  { title: "Sécurité" },
                  { title: "Cible (jours)" },
                  { title: "Source" },
                ]}
              >
                {globalThresholdPreview.map((row, index) => (
                  <IndexTable.Row id={`global-${row.sku}`} key={`global-${row.sku}`} position={index}>
                    <IndexTable.Cell>{row.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{row.minQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.maxQty}</IndexTable.Cell>
                    <IndexTable.Cell>{row.safetyStock}</IndexTable.Cell>
                    <IndexTable.Cell>{row.targetCoverageDays}</IndexTable.Cell>
                    <IndexTable.Cell>{row.updatedBy || "-"}</IndexTable.Cell>
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
                Tableau de planification
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Ventes {range}j · Source Presta Toulon B2B
              </Text>
            </InlineStack>

            {data.rows.length === 0 ? (
              <Banner tone="info">Aucune ligne sur ce filtre.</Banner>
            ) : (
              <IndexTable
                resourceName={{ singular: "ligne planning", plural: "lignes planning" }}
                itemCount={data.rows.length}
                selectable={false}
                headings={[
                  { title: "Sel" },
                  { title: "Produit" },
                  { title: "Stock" },
                  { title: "Entrant" },
                  { title: "Ventes/j" },
                  { title: "Couverture" },
                  { title: "Rupture" },
                  { title: "Risque" },
                  { title: "Suggestion" },
                  { title: "Seuils (inline)" },
                  { title: "Action" },
                ]}
              >
                {rowsMarkup}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Générer une commande fournisseur (brouillon)
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {selectedSuggestionRows.length} SKU sélectionné(s) · {totalSuggestedSelected} unités
              </Text>
            </InlineStack>
            {selectedSuggestionRows.length === 0 ? (
              <Banner tone="warning">Sélectionnez au moins une ligne avec suggestion &gt; 0.</Banner>
            ) : null}
            <createPoFetcher.Form method="post" action="/actions/planification/creer-po">
              <input type="hidden" name="locationId" value={locationId} />
              <input type="hidden" name="referenceNumber" value={`PLAN-${new Date().toISOString().slice(0, 10)}`} />
              <input type="hidden" name="suggestionsJson" value={JSON.stringify(selectedSuggestionRows)} />
              <Button submit loading={createPoFetcher.state !== "idle"} disabled={selectedSuggestionRows.length === 0}>
                Créer PO brouillon
              </Button>
            </createPoFetcher.Form>
            {createPoFetcher.data?.ok && createPoFetcher.data.purchaseOrderGid ? (
              <Banner tone="success">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    PO créée: {createPoFetcher.data.number}
                  </Text>
                  <Button
                    size="micro"
                    submit={false}
                    onClick={() =>
                      embeddedNavigate(`/reassorts-magasin/${encodeReceiptIdForUrl(createPoFetcher.data!.purchaseOrderGid!)}`)
                    }
                  >
                    Ouvrir
                  </Button>
                </InlineStack>
              </Banner>
            ) : null}
            {createPoFetcher.data?.error ? <Banner tone="critical">{createPoFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
