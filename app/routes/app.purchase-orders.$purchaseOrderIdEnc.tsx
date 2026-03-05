import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useLocation, useRevalidator } from "react-router";
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
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { withEmbeddedContext } from "../utils/embeddedPath";
import { requireAdmin } from "../services/auth.server";
import {
  getPurchaseOrderDetail,
  type PurchaseOrderStatus,
} from "../services/purchaseOrderService";
import { decodeReceiptIdFromUrl, encodeReceiptIdForUrl } from "../utils/receiptId";

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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const encoded = params.purchaseOrderIdEnc;
  if (!encoded) {
    throw new Response("Identifiant de bon de commande manquant.", { status: 400 });
  }
  const purchaseOrderGid = decodeReceiptIdFromUrl(encoded);
  const { admin, shop } = await requireAdmin(request);
  const detail = await getPurchaseOrderDetail(admin, shop, purchaseOrderGid);
  return {
    purchaseOrderGid,
    detail,
  };
};

export default function PurchaseOrderDetailPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const embeddedNavigate = useEmbeddedNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();

  const validateFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const receiveFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const duplicateFetcher = useFetcher<{ ok: boolean; error?: string; purchaseOrderGid?: string }>();
  const cancelFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const sendFetcher = useFetcher<{ ok: boolean; error?: string }>();

  const [supplierEmail, setSupplierEmail] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const downloadPdf = async () => {
    const rawUrl = withEmbeddedContext(
      `/api/reassorts/pdf?id=${encodeReceiptIdForUrl(data.purchaseOrderGid)}`,
      location.search,
      location.pathname,
    );
    setPdfError(null);
    setPdfLoading(true);
    try {
      await shopify.ready;
      const token = await shopify.idToken();
      if (!token) {
        throw new Error("Session Shopify introuvable. Rechargez l'application puis réessayez.");
      }

      const requestUrl = new URL(rawUrl, window.location.origin);
      requestUrl.searchParams.set("id_token", token);
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        headers,
        credentials: "include",
      });
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
      link.download = `${data.detail.order.number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Erreur lors du téléchargement du PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    if (duplicateFetcher.data?.ok && duplicateFetcher.data.purchaseOrderGid) {
      embeddedNavigate(`/reassorts-magasin/${encodeReceiptIdForUrl(duplicateFetcher.data.purchaseOrderGid)}`);
    }
  }, [duplicateFetcher.data, embeddedNavigate]);

  useEffect(() => {
    if (validateFetcher.data?.ok || receiveFetcher.data?.ok || cancelFetcher.data?.ok || sendFetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [cancelFetcher.data, receiveFetcher.data, revalidator, sendFetcher.data, validateFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.data?.ok) {
      embeddedNavigate("/reassorts-magasin");
    }
  }, [deleteFetcher.data, embeddedNavigate]);

  const canValidate = data.detail.order.status === "DRAFT";
  const canReceive = data.detail.order.status === "INCOMING";
  const canCancel = data.detail.order.status !== "RECEIVED" && data.detail.order.status !== "CANCELED";
  const canDelete = data.detail.order.status !== "RECEIVED";

  const lineRows = useMemo(
    () =>
      data.detail.lines.map((line) => {
        const productName = [line.productTitle, line.variantTitle].filter(Boolean).join(" / ") || line.sku;
        return [
          <InlineStack key={`product-${line.gid}`} gap="200" blockAlign="center">
            {line.imageUrl ? (
              <img
                src={line.imageUrl}
                alt={productName}
                style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid #d0d5dd" }}
              />
            ) : (
              <Box
                background="bg-fill-tertiary"
                borderRadius="200"
                minHeight="36px"
                minWidth="36px"
                width="36px"
                padding="100"
              />
            )}
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {productName}
              </Text>
            </BlockStack>
          </InlineStack>,
          line.supplierSku || "-",
          String(line.quantityOrdered),
          String(line.quantityReceived),
          formatMoney(line.unitCost, data.detail.order.currency),
          `${line.taxRate}%`,
          formatMoney(line.lineTotalTtc, data.detail.order.currency),
        ];
      }),
    [data.detail.lines, data.detail.order.currency],
  );

  return (
    <Page
      title={`Réassort magasin ${data.detail.order.number}`}
      subtitle={`Source dépôt: ${data.detail.order.supplierName}`}
      backAction={{ content: "Réassorts magasin", onAction: () => embeddedNavigate("/reassorts-magasin") }}
      secondaryActions={[
        {
          content: "Exporter en PDF",
          onAction: () => {
            void downloadPdf();
          },
        },
        {
          content: "Dupliquer",
          onAction: () => {
            duplicateFetcher.submit(
              {},
              {
                method: "post",
                action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/dupliquer`,
              },
            );
          },
          loading: duplicateFetcher.state !== "idle",
        },
      ]}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Résumé
              </Text>
              <Badge tone={statusTone(data.detail.order.status)}>{statusLabel(data.detail.order.status)}</Badge>
            </InlineStack>

            <InlineStack gap="300" wrap>
              <Text as="p" variant="bodyMd">
                Date d&apos;émission: {data.detail.order.issuedAt ? new Date(data.detail.order.issuedAt).toLocaleDateString("fr-FR") : "-"}
              </Text>
              <Text as="p" variant="bodyMd">
                Arrivée estimée: {data.detail.order.expectedArrivalAt ? new Date(data.detail.order.expectedArrivalAt).toLocaleDateString("fr-FR") : "-"}
              </Text>
              <Text as="p" variant="bodyMd">Destination: {data.detail.order.destinationLocationName}</Text>
              <Text as="p" variant="bodyMd">
                Référence commande Prestashop: {data.detail.order.referenceNumber || "-"}
              </Text>
            </InlineStack>

            <InlineStack gap="300" wrap>
              <Text as="p" variant="bodyMd">Sous-total HT: {formatMoney(data.detail.order.subtotalHt, data.detail.order.currency)}</Text>
              <Text as="p" variant="bodyMd">Taxes: {formatMoney(data.detail.order.taxTotal, data.detail.order.currency)}</Text>
              <Text as="p" variant="bodyMd">Total TTC: {formatMoney(data.detail.order.totalTtc, data.detail.order.currency)}</Text>
            </InlineStack>

            <Banner tone="info">
              Le dépôt n&apos;est jamais modifié dans Shopify. Le stock boutique est ajouté uniquement au clic &quot;Reçu en boutique&quot;.
            </Banner>
            {pdfError ? <Banner tone="critical">{pdfError}</Banner> : null}
            {pdfLoading ? <Banner tone="info">Téléchargement du PDF en cours...</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Produits en réception
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "numeric", "text", "text", "text"]}
              headings={[
                "Produit",
                "SKU fournisseur",
                "Qté commandée",
                "Qté reçue",
                "Coût HT",
                "Taxe",
                "Total",
              ]}
              rows={lineRows}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Actions disponibles
            </Text>

            <InlineStack gap="300">
              {canValidate ? (
                <Button
                  submit={false}
                  variant="primary"
                  loading={validateFetcher.state !== "idle"}
                  onClick={() => {
                    validateFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/mettre-en-cours-d-arrivage`,
                      },
                    );
                  }}
                >
                  Mettre en cours d&apos;arrivage
                </Button>
              ) : null}

              {canReceive ? (
                <Button
                  submit={false}
                  loading={receiveFetcher.state !== "idle"}
                  onClick={() => {
                    receiveFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/recu-en-boutique`,
                      },
                    );
                  }}
                >
                  Reçu en boutique
                </Button>
              ) : null}

              {canCancel ? (
                <Button
                  submit={false}
                  tone="critical"
                  loading={cancelFetcher.state !== "idle"}
                  onClick={() => {
                    cancelFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/annuler`,
                      },
                    );
                  }}
                >
                  Annuler le réassort
                </Button>
              ) : null}

              {canDelete ? (
                <Button
                  submit={false}
                  tone="critical"
                  loading={deleteFetcher.state !== "idle"}
                  onClick={() => {
                    if (!window.confirm("Supprimer ce réassort ? Cette action est définitive.")) {
                      return;
                    }
                    deleteFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/supprimer`,
                      },
                    );
                  }}
                >
                  Supprimer le réassort
                </Button>
              ) : null}
            </InlineStack>

            {data.detail.order.status === "DRAFT" ? (
              <Banner tone="info">Étape suivante: cliquez sur &quot;Mettre en cours d&apos;arrivage&quot;.</Banner>
            ) : null}
            {data.detail.order.status === "INCOMING" ? (
              <Banner tone="info">Étape suivante: cliquez sur &quot;Reçu en boutique&quot; pour ajouter le stock POS.</Banner>
            ) : null}
            {data.detail.order.status === "RECEIVED" ? (
              <Banner tone="success">Réassort finalisé: le stock boutique a déjà été ajouté.</Banner>
            ) : null}
            {data.detail.order.status === "CANCELED" ? (
              <Banner tone="warning">Réassort annulé: aucune action stock supplémentaire n&apos;est possible.</Banner>
            ) : null}

            {validateFetcher.data?.error ? <Banner tone="critical">{validateFetcher.data.error}</Banner> : null}
            {validateFetcher.data?.ok ? (
              <Banner tone="success">
                Réassort passé en cours d&apos;arrivage (aucune écriture stock Shopify).
              </Banner>
            ) : null}

            {receiveFetcher.data?.error ? <Banner tone="critical">{receiveFetcher.data.error}</Banner> : null}
            {receiveFetcher.data?.ok ? <Banner tone="success">Réception enregistrée. Stock boutique mis à jour.</Banner> : null}

            {cancelFetcher.data?.error ? <Banner tone="critical">{cancelFetcher.data.error}</Banner> : null}
            {cancelFetcher.data?.ok ? <Banner tone="success">Réassort annulé.</Banner> : null}
            {deleteFetcher.data?.error ? <Banner tone="critical">{deleteFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Envoyer au fournisseur
            </Text>
            <InlineStack gap="300" blockAlign="end" align="start">
              <Box minWidth="320px">
                <TextField
                  label="Email fournisseur"
                  value={supplierEmail}
                  onChange={setSupplierEmail}
                  autoComplete="off"
                />
              </Box>
              <Button
                submit={false}
                disabled={!supplierEmail.trim()}
                loading={sendFetcher.state !== "idle"}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("recipient", supplierEmail.trim());
                  sendFetcher.submit(formData, {
                    method: "post",
                    action: `/actions/reassorts-magasin/${encodeReceiptIdForUrl(data.purchaseOrderGid)}/envoyer`,
                  });
                }}
              >
                Envoyer le PDF
              </Button>
            </InlineStack>
            {sendFetcher.data?.error ? <Banner tone="critical">{sendFetcher.data.error}</Banner> : null}
            {sendFetcher.data?.ok ? <Banner tone="success">Email envoyé au fournisseur.</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Historique
            </Text>
            {data.detail.audit.length === 0 ? (
              <Text as="p" variant="bodyMd">Aucune entrée d&apos;historique.</Text>
            ) : (
              <BlockStack gap="200">
                {data.detail.audit.map((item) => (
                  <BlockStack key={item.gid} gap="100">
                    <Text as="p" variant="bodyMd">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("fr-FR") : "-"} · {item.action} · {item.actor}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.payload || "{}"}
                    </Text>
                    <Divider />
                  </BlockStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

