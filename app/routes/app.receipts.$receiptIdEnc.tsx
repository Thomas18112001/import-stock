import { useEffect, useState } from "react";
import { redirect, type LoaderFunctionArgs, useFetcher, useLoaderData, useLocation, useNavigation, useRevalidator } from "react-router";
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
  Toast,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { getInventoryItemSnapshots, listLocations } from "../services/shopifyGraphql";
import { getSyncState } from "../services/shopifyMetaobjects";
import { getReceiptDetail, getReceiptStocksForLines, getSkuDiagnosticsForLines } from "../services/receiptService";
import { debugLog } from "../utils/debug";
import { decodeReceiptIdFromUrl, encodeReceiptIdForUrl } from "../utils/receiptId";
import { withEmbeddedContext } from "../utils/embeddedPath";
import {
  canAdjustSkuFromStatus,
  canReceiveFromStatus,
  canRetirerStockFromStatus,
  skuAdjustLockedMessage,
} from "../utils/receiptStatus";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";

function resolutionLabel(status: string): string {
  if (status === "RESOLVED") return "OK";
  if (status === "MISSING") return "Manquant";
  if (status === "SKIPPED") return "Ignoré";
  return status;
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

function badgeTone(status: string): "info" | "success" | "critical" | "warning" {
  if (status === "READY") return "success";
  if (status === "INCOMING") return "warning";
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED") return "critical";
  if (status === "ROLLED_BACK") return "warning";
  return "info";
}

type DetailLoaderData =
  | {
      notFound: true;
      error: string;
    }
  | {
      notFound: false;
      error: null;
      receiptGid: string;
      receipt: {
        gid: string;
        prestaOrderId: number;
        prestaReference: string;
        prestaDateAdd: string;
        status: string;
        skippedSkus: string[];
      };
      lines: Array<{
        gid: string;
        sku: string;
        qty: number;
        status: string;
        inventoryItemGid: string;
        error: string;
        before: number | null;
        productTitle: string;
        variantTitle: string;
        imageUrl: string;
        imageAlt: string;
      }>;
      diagnostics: Array<{
        sku: string;
        found: boolean;
        variantTitle: string;
        inventoryItemGid: string;
      }>;
      locations: Array<{ id: string; name: string }>;
      defaultLocationId: string;
      debug: boolean;
    };

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

    const defaultLocationId =
      detail.receipt.locationId ||
      syncState.selectedLocationId ||
      locations.find((loc) => loc.name === env.shopifyDefaultLocationName)?.id ||
      locations[0]?.id ||
      "";

    const shouldLoadDiagnostics =
      detail.receipt.status === "IMPORTED" ||
      detail.receipt.status === "BLOCKED" ||
      detail.lines.some((line) => line.status === "MISSING");
    const inventoryItemIds = detail.lines.map((line) => line.inventoryItemGid).filter(Boolean);

    const [stocks, diagnostics, itemSnapshots] = await Promise.all([
      defaultLocationId
        ? getReceiptStocksForLines(admin, detail.lines, defaultLocationId)
        : Promise.resolve(new Map<string, number>()),
      shouldLoadDiagnostics ? getSkuDiagnosticsForLines(admin, detail.lines) : Promise.resolve([]),
      inventoryItemIds.length ? getInventoryItemSnapshots(admin, inventoryItemIds) : Promise.resolve(new Map()),
    ]);

    return {
      error: null,
      notFound: false,
      receiptGid,
      receipt: detail.receipt,
      lines: detail.lines.map((line) => {
        const snapshot = line.inventoryItemGid ? itemSnapshots.get(line.inventoryItemGid) : null;
        return {
          ...line,
          before: line.inventoryItemGid ? stocks.get(line.inventoryItemGid) ?? null : null,
          productTitle: snapshot?.productTitle ?? "",
          variantTitle: snapshot?.variantTitle ?? "",
          imageUrl: snapshot?.imageUrl ?? "",
          imageAlt: snapshot?.imageAlt ?? "",
        };
      }),
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
      return { error: "Commande introuvable ou supprimée.", notFound: true } as const;
    }
    debugLog("receipt detail loader error", { traceId, reason: message });
    return { error: message, notFound: true } as const;
  }
};

export default function ReceiptDetailPage() {
  const data = useLoaderData<typeof loader>() as DetailLoaderData;
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const location = useLocation();
  const revalidator = useRevalidator();
  const embeddedNavigate = useEmbeddedNavigate();
  const [locationId, setLocationId] = useState(!data.notFound ? data.defaultLocationId : "");
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const prepareFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const applyFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    restockOrderId?: string;
    restockOrderNumber?: string;
    restockStatus?: string;
    restockCreated?: boolean;
  }>();
  const receiveFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const rollbackFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const skipFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      embeddedNavigate("/produits-en-reception?deleted=1");
    }
  }, [deleteFetcher.data, embeddedNavigate]);

  useEffect(() => {
    if (!applyFetcher.data) return;
    if (applyFetcher.data.ok && applyFetcher.data.restockOrderNumber) {
      setToast({
        content: `Réassort créé : ${applyFetcher.data.restockOrderNumber} (En cours d'arrivage)`,
      });
      revalidator.revalidate();
      return;
    }
    if (!applyFetcher.data.ok && applyFetcher.data.error) {
      setToast({ content: applyFetcher.data.error, error: true });
    }
  }, [applyFetcher.data, revalidator]);

  if (data.notFound) {
    return (
      <Page title="Commande">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Banner tone="critical">{data.error}</Banner>
                <InlineStack>
                  <Button onClick={() => embeddedNavigate("/produits-en-reception")}>Retour aux commandes</Button>
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

  const canReceive =
    canReceiveFromStatus(data.receipt.status) &&
    !receiveFetcher.data?.ok &&
    eligibleLines.length > 0 &&
    receiveFetcher.state === "idle";

  const canAdjustSku = canAdjustSkuFromStatus(data.receipt.status);
  const showDiagnosticCard =
    data.receipt.status === "IMPORTED" ||
    data.receipt.status === "BLOCKED" ||
    missingLines.length > 0 ||
    Boolean(prepareFetcher.data?.error);

  const locationName = data.locations.find((loc) => loc.id === locationId)?.name ?? "Non définie";
  const isLoading = navigation.state !== "idle";
  const restockOrderId = applyFetcher.data?.restockOrderId || "";
  const restockOrderIdEnc = restockOrderId ? encodeReceiptIdForUrl(restockOrderId) : "";
  const downloadRestockPdf = async () => {
    if (!restockOrderIdEnc) return;
    setPdfDownloading(true);
    try {
      const rawPdfUrl = withEmbeddedContext(
        `/api/reassorts/pdf?id=${restockOrderIdEnc}`,
        location.search,
        location.pathname,
      );
      await shopify.ready;
      const token = await shopify.idToken();
      if (!token) {
        throw new Error("Session Shopify introuvable. Rechargez l'application puis réessayez.");
      }

      const requestUrl = new URL(rawPdfUrl, window.location.origin);
      requestUrl.searchParams.set("id_token", token);
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(requestUrl.toString(), { method: "GET", headers, credentials: "include" });
      if (!response.ok) {
        throw new Error(`Téléchargement impossible (HTTP ${response.status}).`);
      }
      const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
      if (!contentType.includes("application/pdf")) {
        throw new Error(`Le serveur n'a pas renvoyé un PDF (content-type: ${contentType || "inconnu"}).`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${applyFetcher.data?.restockOrderNumber ?? "reassort"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setToast({
        content: error instanceof Error ? error.message : "Erreur lors du téléchargement du PDF.",
        error: true,
      });
    } finally {
      setPdfDownloading(false);
    }
  };

  const lineRows = data.lines.map((line) => {
    const productName =
      line.productTitle || line.variantTitle
        ? [line.productTitle, line.variantTitle].filter(Boolean).join(" / ")
        : line.sku || "Produit non identifié";

    return [
      <InlineStack key={`product-${line.gid}`} gap="200" blockAlign="center">
        {line.imageUrl ? (
          <img
            src={line.imageUrl}
            alt={line.imageAlt || productName}
            style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #d0d5dd" }}
          />
        ) : (
          <Box
            background="bg-fill-tertiary"
            borderRadius="200"
            minHeight="40px"
            minWidth="40px"
            width="40px"
            padding="100"
          />
        )}
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {productName}
          </Text>
        </BlockStack>
      </InlineStack>,
      line.sku || "-",
      String(line.qty),
      resolutionLabel(line.status),
      line.error || "-",
      <skipFetcher.Form
        key={`skip-${line.gid}`}
        method="post"
        action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/basculer-ignorer`}
      >
        <input type="hidden" name="sku" value={line.sku} />
        <Button submit size="slim" disabled={skipFetcher.state !== "idle" || !canAdjustSku}>
          {data.receipt.skippedSkus.includes(line.sku) ? "Ne plus ignorer" : "Ignorer"}
        </Button>
      </skipFetcher.Form>,
    ];
  });

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
      backAction={{ content: "Réceptions", onAction: () => embeddedNavigate("/produits-en-reception") }}
      secondaryActions={[{ content: "Tableau de bord", onAction: () => embeddedNavigate("/") }]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
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
                  Produits en réception
                </Text>
                {data.lines.length === 0 ? (
                  <Banner tone="warning">
                    Aucun produit n&apos;a été récupéré pour cette réception. Relancez la synchronisation de cette
                    commande ou l&apos;import par ID pour reconstruire les lignes.
                  </Banner>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text", "text", "text"]}
                    headings={["Produit", "SKU", "Quantité", "Résolution", "Message", "Ignorer cette ligne"]}
                    rows={lineRows}
                  />
                )}
              </BlockStack>
            </Card>

            {showDiagnosticCard ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Diagnostic SKU
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Ajustez les SKU Prestashop avec les variantes Shopify via le champ SKU.
                  </Text>
                  <prepareFetcher.Form method="post" action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/preparer`}>
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
            ) : null}
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
                  1) Mettre en cours d&apos;arrivage enregistre un statut interne dans l&apos;application.
                </Text>
                <Text as="p" variant="bodyMd">
                  2) Reçu en boutique ajoute le stock disponible uniquement sur la boutique sélectionnée.
                </Text>
                <Select
                  label="Sélectionner la boutique"
                  value={locationId}
                  onChange={(value) => setLocationId(value)}
                  options={data.locations.map((loc) => ({ value: loc.id, label: loc.name }))}
                  disabled
                />
                <Banner tone="info">La boutique est verrouillée pour cette réception.</Banner>
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
                {data.receipt.status === "INCOMING" ? (
                  <Banner tone="info">
                    Cette réception est en cours d&apos;arrivage. Validez la réception quand la commande est livrée.
                  </Banner>
                ) : null}
                {data.receipt.status === "APPLIED" ? <Banner tone="info">Le stock de cette réception est déjà appliqué.</Banner> : null}
                <Button
                  variant="primary"
                  disabled={!canApply}
                  loading={applyFetcher.state !== "idle"}
                  onClick={() => setApplyModalOpen(true)}
                >
                  Mettre en cours d&apos;arrivage
                </Button>
                {applyFetcher.data?.error ? <Banner tone="critical">{applyFetcher.data.error}</Banner> : null}
                {applyFetcher.data?.ok && applyFetcher.data.restockOrderId && applyFetcher.data.restockOrderNumber ? (
                  <Banner tone="success">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        Réassort créé: {applyFetcher.data.restockOrderNumber} (En cours d&apos;arrivage).
                      </Text>
                      <InlineStack gap="200">
                        <Button
                          submit={false}
                          onClick={() => embeddedNavigate(`/reassorts-magasin/${restockOrderIdEnc}`)}
                        >
                          Ouvrir le réassort
                        </Button>
                        <Button
                          submit={false}
                          onClick={() => {
                            void downloadRestockPdf();
                          }}
                          loading={pdfDownloading}
                        >
                          Télécharger le PDF
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Banner>
                ) : null}
                <receiveFetcher.Form method="post" action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/recu-en-boutique`}>
                  <input type="hidden" name="locationId" value={locationId} />
                  <input type="hidden" name="confirmed" value="true" />
                  <Button submit disabled={!canReceive} loading={receiveFetcher.state !== "idle"}>
                    Reçu en boutique
                  </Button>
                </receiveFetcher.Form>
                {receiveFetcher.data?.error ? <Banner tone="critical">{receiveFetcher.data.error}</Banner> : null}
                {receiveFetcher.data?.ok ? <Banner tone="success">Réception validée. Stock boutique mis à jour.</Banner> : null}
              </BlockStack>
            </Card>

            {canRetirerStockFromStatus(data.receipt.status) || receiveFetcher.data?.ok ? (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Annuler l&apos;application du stock
                  </Text>
                  <rollbackFetcher.Form method="post" action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/annuler-reception`}>
                    <Button submit tone="critical" loading={rollbackFetcher.state !== "idle"}>
                      Annuler l&apos;application du stock
                    </Button>
                  </rollbackFetcher.Form>
                  {rollbackFetcher.data?.ok ? <Banner tone="success">Application du stock annulée avec succès.</Banner> : null}
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
              disabled={data.receipt.status === "APPLIED" || data.receipt.status === "INCOMING"}
              loading={deleteFetcher.state !== "idle"}
              onClick={() => setDeleteModalOpen(true)}
            >
              Supprimer l&apos;import
            </Button>
          </InlineStack>
          {data.receipt.status === "APPLIED" || data.receipt.status === "INCOMING" ? (
            <Box paddingBlockStart="200">
              <Banner tone="critical">Terminez ou annulez le flux de stock avant de supprimer l&apos;import.</Banner>
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
        title="Confirmer la mise en arrivage"
        primaryAction={{
          content: "Confirmer",
          onAction: () => {
            const formData = new FormData();
            formData.set("locationId", locationId);
            formData.set("confirmed", "true");
            data.receipt.skippedSkus.forEach((sku) => formData.append("skippedSkus[]", sku));
            applyFetcher.submit(formData, {
              method: "post",
              action: `/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/mettre-en-cours-d-arrivage`,
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
              Cette action ne modifie pas le stock Shopify. Elle passe uniquement la réception en statut en arrivage pour la boutique {locationName}.
            </Text>
            <Text as="p" variant="bodyMd">
              Utilisez ensuite &quot;Reçu en boutique&quot; pour ajouter le stock disponible.
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
              action: `/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/supprimer`,
            });
            setDeleteModalOpen(false);
          },
          disabled: data.receipt.status === "APPLIED" || data.receipt.status === "INCOMING",
          loading: deleteFetcher.state !== "idle",
        }}
        secondaryActions={[{ content: "Non", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Cette réception et ses lignes seront supprimées définitivement.
            </Text>
            {data.receipt.status === "APPLIED" || data.receipt.status === "INCOMING" ? (
              <Banner tone="critical">Terminez ou annulez le flux de stock avant de supprimer l&apos;import.</Banner>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
