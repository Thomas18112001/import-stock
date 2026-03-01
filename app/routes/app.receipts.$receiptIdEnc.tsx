import { useEffect, useState } from "react";
import { redirect, type LoaderFunctionArgs, useFetcher, useLoaderData, useNavigation } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { listLocations } from "../services/shopifyGraphql";
import { getSyncState } from "../services/shopifyMetaobjects";
import { getReceiptDetail, getReceiptStocks, getSkuDiagnostics } from "../services/receiptService";
import { debugLog } from "../utils/debug";
import { isLocationLockedForReceipt } from "../utils/locationLock";
import { decodeReceiptIdFromUrl, encodeReceiptIdForUrl } from "../utils/receiptId";
import { canAdjustSkuFromStatus, canRetirerStockFromStatus, skuAdjustLockedMessage } from "../utils/receiptStatus";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";

function resolutionLabel(status: string): string {
  if (status === "RESOLVED") return "OK";
  if (status === "MISSING") return "Manquant";
  if (status === "SKIPPED") return "Ignoré";
  return status;
}

function statusLabel(status: string): string {
  if (status === "IMPORTED") return "Importée";
  if (status === "READY") return "Prête";
  if (status === "BLOCKED") return "Bloquée";
  if (status === "APPLIED") return "Stock ajouté";
  if (status === "ROLLED_BACK") return "Stock retiré";
  return status;
}

function badgeTone(status: string): "info" | "success" | "critical" | "warning" {
  if (status === "READY") return "success";
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED") return "critical";
  if (status === "ROLLED_BACK") return "warning";
  return "info";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const traceId = url.searchParams.get("trace") ?? "";
  const encoded = params.receiptIdEnc;
  if (!encoded) {
    debugLog("receipt detail loader: missing param", { traceId });
    return { error: "Identifiant de réception absent.", notFound: true } as const;
  }

  let receiptGid = "";
  try {
    receiptGid = decodeReceiptIdFromUrl(encoded);
  } catch {
    debugLog("receipt detail loader: invalid param", { traceId, receiptIdEnc: encoded });
    return { error: "Identifiant de réception invalide.", notFound: true } as const;
  }

  debugLog("loader receipt detail params", {
    traceId,
    receiptIdEnc: encoded,
    decodedReceiptGid: receiptGid,
  });

  let adminShop: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    adminShop = await requireAdmin(request);
  } catch (error) {
    if (error instanceof Response) {
      debugLog("receipt detail loader auth redirect", {
        traceId,
        status: error.status,
        redirectTo: error.headers.get("Location") ?? null,
      });
    } else {
      debugLog("receipt detail loader auth error", {
        traceId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    throw error;
  }
  const { admin, shop } = adminShop;

  try {
    const [detail, locations, syncState] = await Promise.all([
      getReceiptDetail(admin, shop, receiptGid),
      listLocations(admin),
      getSyncState(admin),
    ]);
    debugLog("receipt detail loader result", {
      traceId,
      found: true,
      prestaOrderId: detail.receipt.prestaOrderId,
      linesCount: detail.lines.length,
    });

    const defaultLocationId =
      detail.receipt.locationId ||
      syncState.selectedLocationId ||
      locations.find((loc) => loc.name === env.shopifyDefaultLocationName)?.id ||
      locations[0]?.id ||
      "";

    const stocks = defaultLocationId
      ? await getReceiptStocks(admin, shop, receiptGid, defaultLocationId)
      : new Map<string, number>();
    const diagnostics = await getSkuDiagnostics(admin, shop, receiptGid);

    return {
      error: null,
      notFound: false,
      receiptGid,
      receipt: detail.receipt,
      lines: detail.lines.map((line) => ({
        ...line,
        before: line.inventoryItemGid ? stocks.get(line.inventoryItemGid) ?? null : null,
      })),
      diagnostics,
      locations,
      defaultLocationId,
      debug: env.debug,
    } as const;
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        error: `Autorisation manquante: ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        notFound: true,
      } as const;
    }
    const message = error instanceof Error ? error.message : "Commande introuvable";
    if (message.toLowerCase().includes("introuvable")) {
      debugLog("receipt detail loader result", {
        traceId,
        found: false,
        reason: message,
      });
      return { error: "Commande introuvable ou supprimée.", notFound: true } as const;
    }
    debugLog("receipt detail loader error", {
      traceId,
      reason: message,
    });
    return { error: message, notFound: true } as const;
  }
};

export default function ReceiptDetailPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const [locationId, setLocationId] = useState(!data.notFound && data.defaultLocationId ? data.defaultLocationId : "");
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const prepareFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const applyFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const rollbackFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const skipFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>();

  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      embeddedNavigate("/app/receipts?deleted=1");
    }
  }, [deleteFetcher.data, embeddedNavigate]);

  if (data.notFound) {
    return (
      <Page title="Commande">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Banner tone="critical">{data.error}</Banner>
                <InlineStack>
                  <Button onClick={() => embeddedNavigate("/app/receipts")}>Retour aux commandes</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const missingLines = data.lines.filter((line) => line.status === "MISSING" && !data.receipt.skippedSkus.includes(line.sku));
  const eligibleLines = data.lines.filter(
    (line) => line.status === "RESOLVED" && !data.receipt.skippedSkus.includes(line.sku) && line.qty > 0,
  );
  const invalidQtyLines = data.lines.filter(
    (line) => line.status === "RESOLVED" && !data.receipt.skippedSkus.includes(line.sku) && line.qty <= 0,
  );
  const canApply =
    data.receipt.status === "READY" &&
    !applyFetcher.data?.ok &&
    missingLines.length === 0 &&
    invalidQtyLines.length === 0 &&
    eligibleLines.length > 0 &&
    applyFetcher.state === "idle";
  const locationLocked = isLocationLockedForReceipt(data.receipt.status, data.receipt.locationId);
  const canAdjustSku = canAdjustSkuFromStatus(data.receipt.status);
  const locationName = data.locations.find((loc) => loc.id === locationId)?.name ?? "Non définie";
  const isLoading = navigation.state !== "idle";

  const lineRows = data.lines.map((line) => [
    line.sku,
    String(line.qty),
    resolutionLabel(line.status),
    line.error || "-",
    <skipFetcher.Form
      key={`skip-${line.gid}`}
      method="post"
      action={`/actions/receipts/${encodeReceiptIdForUrl(data.receiptGid)}/toggle-skip`}
    >
      <input type="hidden" name="sku" value={line.sku} />
      <Button submit size="slim" disabled={skipFetcher.state !== "idle" || !canAdjustSku}>
        {data.receipt.skippedSkus.includes(line.sku) ? "Ne plus ignorer" : "Ignorer"}
      </Button>
    </skipFetcher.Form>,
  ]);

  const diagnosticRows = data.diagnostics.map((diag) => [
    diag.sku,
    diag.found ? "Trouvé" : "Non trouvé",
    diag.variantTitle || "-",
    diag.inventoryItemGid || "-",
  ]);

  return (
    <Page
      title={`Réception Prestashop #${data.receipt.prestaOrderId}`}
      subtitle="Réception boutique (depuis Prestashop BtoB)"
      backAction={{ content: "Réceptions", onAction: () => embeddedNavigate("/app/receipts") }}
      secondaryActions={[{ content: "Tableau de bord", onAction: () => embeddedNavigate("/app") }]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              {isLoading ? (
                <SkeletonBodyText lines={3} />
              ) : (
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Résumé
                    </Text>
                    <Badge tone={badgeTone(data.receipt.status)}>{statusLabel(data.receipt.status)}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd">
                    Référence: {data.receipt.prestaReference || "-"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Date: {data.receipt.prestaDateAdd || "-"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Boutique sélectionnée: {locationName}
                  </Text>
                </BlockStack>
              )}
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Lignes de réception
                </Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "text", "text"]}
                  headings={["SKU", "Quantité", "Résolution", "Message", "Ignorer cette ligne"]}
                  rows={lineRows}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Diagnostic
                </Text>
                <Text as="p" variant="bodyMd">
                  Ajustez les SKU Prestashop avec les variantes Shopify via le champ SKU.
                </Text>
                <prepareFetcher.Form method="post" action={`/actions/receipts/${encodeReceiptIdForUrl(data.receiptGid)}/prepare`}>
                  <input type="hidden" name="locationId" value={locationId} />
                  <Button submit disabled={!canAdjustSku} loading={prepareFetcher.state !== "idle"} variant="primary">
                    {data.receipt.status === "READY" || data.receipt.status === "BLOCKED"
                      ? "Ajuster les SKU"
                      : "Diagnostiquer les SKU"}
                  </Button>
                </prepareFetcher.Form>
                {!canAdjustSku ? <Banner tone="warning">{skuAdjustLockedMessage()}</Banner> : null}
                {prepareFetcher.data?.error ? <Banner tone="critical">{prepareFetcher.data.error}</Banner> : null}
                {missingLines.length > 0 ? (
                  <Banner tone="critical">
                    {missingLines.length} SKU introuvables. Ajoutez-les dans Shopify ou ignorez la ligne pour continuer.
                  </Banner>
                ) : null}
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["SKU", "Diagnostic", "Variante", "InventoryItemId"]}
                  rows={diagnosticRows}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Validation obligatoire
                </Text>
                <Text as="p" variant="bodyMd">
                  Cette action ajoute du stock sur la location sélectionnée.
                </Text>
                <Select
                  label="Sélectionner la boutique"
                  value={locationId}
                  onChange={(value) => {
                    if (locationLocked) return;
                    setLocationId(value);
                  }}
                  options={data.locations.map((loc) => ({ value: loc.id, label: loc.name }))}
                  disabled={locationLocked}
                />
                {locationLocked ? (
                  <Banner tone="info">La boutique est verrouillée pour cette réception pendant le flux de validation.</Banner>
                ) : null}
                <Divider />
                <Text as="p" variant="bodyMd">
                  Modifications à appliquer:
                </Text>
                {eligibleLines.length ? (
                  <ul style={{ margin: 0, paddingInlineStart: "1rem" }}>
                    {eligibleLines.map((line) => (
                      <li key={`add-${line.gid}`}>
                        {line.sku}: +{line.qty}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text as="p" variant="bodyMd">
                    Aucune ligne applicable.
                  </Text>
                )}
                {invalidQtyLines.length ? (
                  <Banner tone="critical">
                    Quantités invalides (&lt;= 0): {invalidQtyLines.map((line) => line.sku).join(", ")}.
                  </Banner>
                ) : null}
                {data.receipt.status === "APPLIED" ? <Banner tone="info">Cette réception a déjà été traitée.</Banner> : null}
                <Button
                  variant="primary"
                  disabled={!canApply}
                  loading={applyFetcher.state !== "idle"}
                  onClick={() => setApplyModalOpen(true)}
                >
                  Ajouter au stock boutique
                </Button>
                {applyFetcher.data?.error ? <Banner tone="critical">{applyFetcher.data.error}</Banner> : null}
                {applyFetcher.data?.ok ? <Banner tone="success">Stock ajouté sur la location {locationName}.</Banner> : null}
              </BlockStack>
            </Card>

            {canRetirerStockFromStatus(data.receipt.status) || applyFetcher.data?.ok ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Retirer le stock
                  </Text>
                  <rollbackFetcher.Form method="post" action={`/actions/receipts/${encodeReceiptIdForUrl(data.receiptGid)}/rollback`}>
                    <Button submit tone="critical" loading={rollbackFetcher.state !== "idle"}>
                      Retirer le stock
                    </Button>
                  </rollbackFetcher.Form>
                  {rollbackFetcher.data?.ok ? <Banner tone="success">Stock retiré avec succès.</Banner> : null}
                  {rollbackFetcher.data?.error ? <Banner tone="critical">{rollbackFetcher.data.error}</Banner> : null}
                </BlockStack>
              </Card>
            ) : null}
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="start">
            <Button
              tone="critical"
              disabled={data.receipt.status === "APPLIED"}
              loading={deleteFetcher.state !== "idle"}
              onClick={() => setDeleteModalOpen(true)}
            >
              Supprimer l&apos;import
            </Button>
          </InlineStack>
          {data.receipt.status === "APPLIED" ? (
            <Box paddingBlockStart="200">
              <Banner tone="critical">Retirez le stock avant de supprimer l&apos;import.</Banner>
            </Box>
          ) : null}
          {deleteFetcher.data?.error ? (
            <Box paddingBlockStart="200">
              <Banner tone="critical">{deleteFetcher.data.error}</Banner>
            </Box>
          ) : null}
        </Layout.Section>
      </Layout>

      <Modal
        open={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        title="Confirmer l&apos;ajout au stock"
        primaryAction={{
          content: "Confirmer",
          onAction: () => {
            const formData = new FormData();
            formData.set("locationId", locationId);
            formData.set("confirmed", "true");
            data.receipt.skippedSkus.forEach((sku) => formData.append("skippedSkus[]", sku));
            applyFetcher.submit(formData, {
              method: "post",
              action: `/actions/receipts/${encodeReceiptIdForUrl(data.receiptGid)}/apply`,
            });
            setApplyModalOpen(false);
          },
          loading: applyFetcher.state !== "idle",
          disabled: !canApply,
        }}
        secondaryActions={[{ content: "Annuler", onAction: () => setApplyModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Cette action ajoute les quantités de la réception sur la location {locationName}.
            </Text>
            <Text as="p" variant="bodyMd">
              Vérifiez le résumé des modifications avant de confirmer.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirmer la suppression"
        primaryAction={{
          content: "Oui, supprimer",
          destructive: true,
          onAction: () => {
            const formData = new FormData();
            formData.set("confirmed", "true");
            deleteFetcher.submit(formData, {
              method: "post",
              action: `/actions/receipts/${encodeReceiptIdForUrl(data.receiptGid)}/delete`,
            });
            setDeleteModalOpen(false);
          },
          disabled: data.receipt.status === "APPLIED",
          loading: deleteFetcher.state !== "idle",
        }}
        secondaryActions={[{ content: "Non", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Cette réception et ses lignes seront supprimées définitivement.
            </Text>
            {data.receipt.status === "APPLIED" ? (
              <Banner tone="critical">Retirez le stock avant de supprimer l&apos;import.</Banner>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
