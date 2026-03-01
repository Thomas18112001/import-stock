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
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED") return "critical";
  if (status === "ROLLED_BACK") return "warning";
  return "info";
}

function statusLabel(status: string): string {
  if (status === "IMPORTED") return "Importée";
  if (status === "READY") return "Prête";
  if (status === "BLOCKED") return "Bloquée";
  if (status === "APPLIED") return "Stock ajouté";
  if (status === "ROLLED_BACK") return "Stock retiré";
  return status;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, shop } = await requireAdmin(request);
  try {
    const data = await getDashboardData(admin, shop, { pageSize: 20 });
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
      receipts: data.receipts,
      debug: env.debug,
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
        syncState: { selectedLocationId: "", cursorByLocation: {}, lastSyncAtByLocation: {} },
        receipts: [],
        debug: env.debug,
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
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const syncFetcher = useFetcher<{
    ok: boolean;
    imported: number;
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
  const [lastSyncMap, setLastSyncMap] = useState<Record<string, string>>(data.syncState.lastSyncAtByLocation);

  const syncResult = syncFetcher.data;
  const importResult = importFetcher.data;
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
      <IndexTable.Cell>{receipt.prestaDateAdd || "-"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          submit={false}
          size="slim"
          onClick={() => {
            const traceId = makeTraceId();
            const receiptIdRaw = receipt.gid;
            const receiptIdEnc = encodeReceiptIdForUrl(receiptIdRaw);
            const path = `/app/receipts/${receiptIdEnc}?trace=${encodeURIComponent(traceId)}`;
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
                  <Button submit={false} onClick={() => embeddedNavigate("/app/help/scopes")}>
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
                      action: "/actions/location/select",
                    });
                  }}
                  disabled={syncBusy || importBusy || blockedByScope || selectLocationBusy}
                />
                {!selectedLocationConfigured && selectedLocation ? (
                  <Banner tone="warning">
                    La boutique &quot;{selectedLocation.name}&quot; est à configurer pour Prestashop BtoB. Synchronisation indisponible.
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Synchronisation et import
                </Text>
                <Text as="p" variant="bodyMd">
                  Une synchronisation automatique est exécutée toutes les 4 heures. Vous pouvez aussi lancer une synchronisation
                  manuelle ou importer une commande précise.
                </Text>
                <Text as="p" variant="bodyMd">
                  Dernière synchronisation pour cette boutique: {lastSyncLabel}
                </Text>

                <syncFetcher.Form method="post" action="/actions/sync">
                  <input type="hidden" name="locationId" value={locationId} />
                  <Button
                    submit
                    variant="primary"
                    loading={syncBusy}
                    disabled={syncBusy || blockedByScope || !selectedLocationConfigured}
                  >
                    Synchroniser maintenant
                  </Button>
                </syncFetcher.Form>
                {syncResult?.error ? <Banner tone="critical">{syncResult.error}</Banner> : null}
                {syncResult?.ok ? <Banner tone="success">{syncResult.imported} réception(s) importée(s).</Banner> : null}

                <importFetcher.Form method="post" action="/actions/importById">
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
                  <Banner tone="success">Réception importée avec succès.</Banner>
                ) : null}
                {importResult?.ok && importResult.created === false && importResult.receiptGid ? (
                  <Banner tone="critical">
                    Cette commande a déjà été importée.
                    <Box paddingBlockStart="200">
                      <Button
                        submit={false}
                        onClick={() => {
                          const traceId = makeTraceId();
                          const receiptIdRaw = importResult.receiptGid!;
                          const receiptIdEnc = encodeReceiptIdForUrl(receiptIdRaw);
                          const path = `/app/receipts/${receiptIdEnc}?trace=${encodeURIComponent(traceId)}`;
                          if (data.debug) {
                            console.info("[debug] click ouvrir existante", { traceId, receiptIdRaw, receiptIdEnc, path });
                          }
                          embeddedNavigate(path);
                        }}
                      >
                        Ouvrir la réception existante
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
                  Choisissez la boutique qui recoit le stock.
                </Text>
                <Text as="p" variant="bodyMd">
                  Synchronisez ou importez une commande Prestashop BtoB.
                </Text>
                <Text as="p" variant="bodyMd">
                  Ouvrez la réception, corrigez les SKU si besoin, puis confirmez l&apos;ajout de stock.
                </Text>
                <Text as="p" variant="bodyMd">
                  Si vous avez fait une erreur, utilisez &quot;Retirer le stock&quot;.
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
                <Button submit={false} onClick={() => embeddedNavigate("/app/receipts")}>
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
                    { title: "Date" },
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
