import { useEffect, useMemo, useState } from "react";
import { redirect, type LoaderFunctionArgs, useFetcher, useLoaderData, useNavigation, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { getDashboardData } from "../services/receiptService";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";
import { filterReceiptsForSelectedLocation } from "../utils/receiptFilters";
import { formatRelativeSyncFr } from "../utils/relativeTimeFr";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { makeTraceId } from "../utils/trace";

function badgeTone(status: string): "info" | "success" | "critical" | "warning" {
  if (status === "READY") return "success";
  if (status === "INCOMING") return "warning";
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED") return "critical";
  if (status === "ROLLED_BACK") return "warning";
  return "info";
}

function statusLabel(status: string): string {
  if (status === "IMPORTED") return "À vérifier";
  if (status === "READY") return "Prête pour arrivage";
  if (status === "BLOCKED") return "Bloquée (SKU à corriger)";
  if (status === "INCOMING") return "En cours d'arrivage";
  if (status === "APPLIED") return "Reçue en boutique";
  if (status === "ROLLED_BACK") return "Réception annulée";
  return status;
}

function toSortableMs(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function receiptSortTimestamp(receipt: { prestaDateUpd: string; prestaDateAdd: string; updatedAt: string }): number {
  return Math.max(toSortableMs(receipt.prestaDateUpd), toSortableMs(receipt.prestaDateAdd), toSortableMs(receipt.updatedAt));
}

function formatDisplayDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return trimmed;
  return new Date(ms).toLocaleString("fr-FR");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, shop } = await requireAdmin(request);
  const debugMode = env.debug || env.nodeEnv !== "production";

  try {
    const data = await getDashboardData(admin, shop, { pageSize: 20 });
    const sortedReceipts = [...data.receipts].sort((a, b) => {
      const dateDelta = receiptSortTimestamp(b) - receiptSortTimestamp(a);
      if (dateDelta !== 0) return dateDelta;
      return b.prestaOrderId - a.prestaOrderId;
    });

    const defaultLocation =
      data.locations.find((loc) => loc.id === data.syncState.selectedLocationId) ??
      data.locations.find((loc) => loc.name === env.shopifyDefaultLocationName) ??
      data.locations[0] ??
      null;

    return {
      locations: data.locations,
      defaultLocationId: defaultLocation?.id ?? "",
      defaultLocationName: env.shopifyDefaultLocationName,
      syncState: data.syncState,
      receipts: sortedReceipts,
      debug: debugMode,
      scopeIssue: null as null | { missingScope: string; message: string },
    };
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (env.debug) {
        console.info("[debug] scope missing on dashboard loader", {
          shop,
          missingScope: error.missingScope,
          expectedScopes: process.env.SCOPES ?? "",
          shouldReauth: shouldTriggerReauth(url),
        });
      }
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        locations: [],
        defaultLocationId: "",
        defaultLocationName: env.shopifyDefaultLocationName,
        syncState: {
          selectedLocationId: "",
          cursorByLocation: {},
          lastSyncAtByLocation: {},
          prestaCheckpointByLocation: {},
        },
        receipts: [],
        debug: debugMode,
        scopeIssue: {
          missingScope: error.missingScope,
          message: `Autorisation manquante: ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        },
      };
    }

    throw error;
  }
};

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const revalidator = useRevalidator();
  const selectLocationFetcher = useFetcher<{ ok: boolean; selectedLocationId?: string; error?: string }>();
  const [locationId, setLocationId] = useState(data.defaultLocationId);
  const [orderId, setOrderId] = useState("");
  const [syncDay, setSyncDay] = useState("");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const syncFetcher = useFetcher<{
    ok: boolean;
    imported: number;
    syncDay?: string | null;
    locationId?: string;
    lastPrestaOrderId?: number;
    lastSyncAt?: string;
    error?: string;
  }>();

  const importFetcher = useFetcher<{
    ok: boolean;
    prestaOrderId?: number;
    created?: boolean;
    receiptGid?: string;
    duplicateBy?: "id" | "reference" | null;
    locationId?: string;
    lastPrestaOrderId?: number;
    lastSyncAt?: string;
    error?: string;
  }>();

  const purgeFetcher = useFetcher<{
    ok: boolean;
    locationId?: string;
    deletedReceipts?: number;
    deletedLines?: number;
    lastPrestaOrderId?: number;
    checkpoint?: { dateUpd: string; orderId: number };
    error?: string;
  }>();

  const [lastSyncMap, setLastSyncMap] = useState<Record<string, string>>(data.syncState.lastSyncAtByLocation);

  const syncResult = syncFetcher.data;
  const importResult = importFetcher.data;
  const purgeResult = purgeFetcher.data;

  const duplicateImportBlocked =
    importResult?.ok === true &&
    importResult.created === false &&
    typeof importResult.prestaOrderId === "number" &&
    importResult.prestaOrderId === Number(orderId);

  const selectedLocation = data.locations.find((loc) => loc.id === locationId) ?? null;
  const selectedLocationConfigured = Boolean(selectedLocation?.prestaConfigured);
  const lastSyncLabel = formatRelativeSyncFr(lastSyncMap[locationId]);

  const options = useMemo(
    () =>
      data.locations.map((loc) => ({
        value: loc.id,
        label: loc.prestaConfigured ? loc.name : `${loc.name} (à configurer)`,
      })),
    [data.locations],
  );

  const isBusy = navigation.state !== "idle";
  const importBusy = importFetcher.state !== "idle";
  const syncBusy = syncFetcher.state !== "idle";
  const purgeBusy = purgeFetcher.state !== "idle";
  const blockedByScope = Boolean(data.scopeIssue);
  const selectLocationBusy = selectLocationFetcher.state !== "idle";

  useEffect(() => {
    setLastSyncMap(data.syncState.lastSyncAtByLocation);
  }, [data.syncState.lastSyncAtByLocation]);

  useEffect(() => {
    setLocationId(data.defaultLocationId);
  }, [data.defaultLocationId]);

  useEffect(() => {
    if (syncResult?.ok && syncResult.locationId && syncResult.lastSyncAt) {
      setLastSyncMap((prev) => ({ ...prev, [syncResult.locationId!]: syncResult.lastSyncAt! }));
      revalidator.revalidate();
    }
  }, [revalidator, syncResult]);

  useEffect(() => {
    if (importResult?.ok && importResult.locationId && importResult.lastSyncAt) {
      setLastSyncMap((prev) => ({ ...prev, [importResult.locationId!]: importResult.lastSyncAt! }));
      revalidator.revalidate();
    }
  }, [importResult, revalidator]);

  useEffect(() => {
    if (!purgeResult) return;
    if (purgeResult.ok) {
      setToast({
        content: `Nettoyage effectué: ${purgeResult.deletedReceipts ?? 0} réception(s), ${purgeResult.deletedLines ?? 0} ligne(s) supprimée(s).`,
      });
      revalidator.revalidate();
      return;
    }
    if (purgeResult.error) {
      setToast({ content: purgeResult.error, error: true });
    }
  }, [purgeResult, revalidator]);

  const selectedLocationName = data.locations.find((location) => location.id === locationId)?.name ?? "";
  const includeLegacyUnassigned = selectedLocationName === data.defaultLocationName;
  const latestReceiptsForLocation = filterReceiptsForSelectedLocation(
    data.receipts,
    locationId,
    includeLegacyUnassigned,
  );

  const latestRowsFiltered = latestReceiptsForLocation.map((receipt, index) => (
    <IndexTable.Row id={receipt.gid} key={receipt.gid} position={index}>
      <IndexTable.Cell>{receipt.prestaOrderId}</IndexTable.Cell>
      <IndexTable.Cell>{receipt.prestaReference || "-"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={badgeTone(receipt.status)}>{statusLabel(receipt.status)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDisplayDate(receipt.prestaDateAdd)}</IndexTable.Cell>
      <IndexTable.Cell>{formatDisplayDate(receipt.prestaDateUpd)}</IndexTable.Cell>
      <IndexTable.Cell>{formatDisplayDate(receipt.updatedAt)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          submit={false}
          size="slim"
          onClick={() => {
            const traceId = makeTraceId();
            const receiptIdRaw = receipt.gid;
            const receiptIdEnc = encodeReceiptIdForUrl(receiptIdRaw);
            const path = `/produits-en-reception/${receiptIdEnc}?trace=${encodeURIComponent(traceId)}`;
            if (data.debug) {
              console.info("[debug] click ouvrir dashboard", { traceId, receiptIdRaw, receiptIdEnc, path });
            }
            const result = embeddedNavigate(path);
            if (!result.ok) {
              setToast({ content: "Navigation impossible.", error: true });
            }
          }}
        >
          Ouvrir
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page title="Import Stock Boutique" subtitle="Réceptions commandes boutique (depuis Prestashop BtoB)">
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <Layout>
        {data.scopeIssue ? (
          <Layout.Section>
            <Banner tone="critical">
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  {data.scopeIssue.message}
                </Text>
                <InlineStack>
                  <Button submit={false} onClick={() => embeddedNavigate("/aide-autorisations")}>
                    Voir la procédure
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Boutique
                </Text>
                <Select
                  label="Sélectionner la boutique"
                  options={options}
                  value={locationId}
                  onChange={(nextLocationId) => {
                    setLocationId(nextLocationId);
                    const formData = new FormData();
                    formData.set("locationId", nextLocationId);
                    selectLocationFetcher.submit(formData, {
                      method: "post",
                      action: "/actions/boutiques/selectionner",
                    });
                  }}
                  disabled={syncBusy || importBusy || blockedByScope || selectLocationBusy}
                />

                {!selectedLocationConfigured && selectedLocation ? (
                  <Banner tone="warning">
                    La boutique &quot;{selectedLocation.name}&quot; est à configurer pour Prestashop BtoB. Synchronisation indisponible.
                  </Banner>
                ) : null}

                {data.debug ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Debug local: nettoyez les anciennes réceptions avant de tester uniquement les nouvelles commandes.
                    </Text>
                    <InlineStack>
                      <Button
                        submit={false}
                        tone="critical"
                        loading={purgeBusy}
                        disabled={purgeBusy || syncBusy || importBusy || blockedByScope}
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            const ok = window.confirm(
                              "Supprimer les anciennes réceptions de cette boutique (debug) et réinitialiser le checkpoint ?",
                            );
                            if (!ok) return;
                          }
                          const formData = new FormData();
                          formData.set("locationId", locationId);
                          purgeFetcher.submit(formData, {
                            method: "post",
                            action: "/actions/debug/purger-receptions",
                          });
                        }}
                      >
                        Purger les anciennes réceptions (debug)
                      </Button>
                    </InlineStack>

                    {purgeResult?.ok ? (
                      <Banner tone="success">
                        Nettoyage OK. Curseur repositionné sur l&apos;ID Presta {purgeResult.lastPrestaOrderId ?? 0}.
                      </Banner>
                    ) : null}
                    {purgeResult?.error ? <Banner tone="critical">{purgeResult.error}</Banner> : null}
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Synchronisation et import
                </Text>
                <Text as="p" variant="bodyMd">
                  Une synchronisation automatique est exécutée toutes les 4 heures.
                  Vous pouvez lancer une synchro complète ou cibler un jour précis.
                </Text>
                <Text as="p" variant="bodyMd">
                  Dernière synchronisation pour cette boutique: {lastSyncLabel}
                </Text>

                <syncFetcher.Form method="post" action="/actions/synchroniser">
                  <input type="hidden" name="locationId" value={locationId} />
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <Box minWidth="220px">
                      <TextField
                        label="Commandes du jour (optionnel)"
                        type="date"
                        name="syncDay"
                        value={syncDay}
                        onChange={setSyncDay}
                        autoComplete="off"
                      />
                    </Box>
                    <Button
                      submit
                      variant="primary"
                      loading={syncBusy}
                      disabled={syncBusy || blockedByScope || !selectedLocationConfigured}
                    >
                      Synchroniser maintenant
                    </Button>
                    <Button submit={false} onClick={() => setSyncDay("")} disabled={syncBusy}>
                      Réinitialiser le jour
                    </Button>
                  </InlineStack>
                </syncFetcher.Form>

                {syncResult?.error ? <Banner tone="critical">{syncResult.error}</Banner> : null}
                {syncResult?.ok ? (
                  <Banner tone="success">
                    {syncResult.imported} commande(s) synchronisée(s)
                    {syncResult.syncDay ? ` pour le ${syncResult.syncDay}` : ""}.
                  </Banner>
                ) : null}

                <importFetcher.Form method="post" action="/actions/importer-par-id">
                  <input type="hidden" name="locationId" value={locationId} />
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <Box minWidth="240px">
                      <TextField
                        label="ID commande Prestashop"
                        name="presta_order_id"
                        value={orderId}
                        onChange={setOrderId}
                        autoComplete="off"
                      />
                    </Box>
                    <Button
                      submit
                      loading={importBusy}
                      disabled={importBusy || duplicateImportBlocked || blockedByScope || !selectedLocationConfigured}
                    >
                      Importer par ID
                    </Button>
                  </InlineStack>
                </importFetcher.Form>

                {importResult?.error ? <Banner tone="critical">{importResult.error}</Banner> : null}
                {importResult?.ok && importResult.created ? (
                  <Banner tone="success">Commande importée avec succès.</Banner>
                ) : null}
                {importResult?.ok && importResult.created === false && importResult.receiptGid ? (
                  <Banner tone="critical">
                    Cette commande est déjà présente.
                    <Box paddingBlockStart="200">
                      <Button
                        submit={false}
                        onClick={() => {
                          const traceId = makeTraceId();
                          const receiptIdRaw = importResult.receiptGid!;
                          const receiptIdEnc = encodeReceiptIdForUrl(receiptIdRaw);
                          const path = `/produits-en-reception/${receiptIdEnc}?trace=${encodeURIComponent(traceId)}`;
                          if (data.debug) {
                            console.info("[debug] click ouvrir existante", { traceId, receiptIdRaw, receiptIdEnc, path });
                          }
                          embeddedNavigate(path);
                        }}
                      >
                        Ouvrir la commande existante
                      </Button>
                    </Box>
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Mode d&apos;emploi
                </Text>
                <Text as="p" variant="bodyMd">
                  Choisissez la boutique qui reçoit le stock.
                </Text>
                <Text as="p" variant="bodyMd">
                  Synchronisez ou importez une commande Prestashop BtoB.
                </Text>
                <Text as="p" variant="bodyMd">
                  Ouvrez la réception, corrigez les SKU si besoin, puis mettez la commande en cours d&apos;arrivage.
                </Text>
                <Text as="p" variant="bodyMd">
                  À la livraison, validez la réception pour ajouter le stock disponible uniquement sur la boutique.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Dernières réceptions importées
                </Text>
                <Button submit={false} onClick={() => embeddedNavigate("/produits-en-reception")}>
                  Voir toutes les réceptions
                </Button>
              </InlineStack>
              {isBusy ? (
                <BlockStack gap="300">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText />
                </BlockStack>
              ) : latestReceiptsForLocation.length === 0 ? (
                <Text as="p" variant="bodyMd">
                  Aucune réception importée pour cette boutique.
                </Text>
              ) : (
                <IndexTable
                  resourceName={{ singular: "réception", plural: "réceptions" }}
                  itemCount={latestReceiptsForLocation.length}
                  selectable={false}
                  headings={[
                    { title: "ID Presta" },
                    { title: "Référence" },
                    { title: "Statut" },
                    { title: "Date commande" },
                    { title: "Date update Presta" },
                    { title: "Date import app" },
                    { title: "Action" },
                  ]}
                >
                  {latestRowsFiltered}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
