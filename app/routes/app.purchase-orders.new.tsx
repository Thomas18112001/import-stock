import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { defaultPurchaseOrderSupplier } from "../services/purchaseOrderService";
import { listLocations } from "../services/shopifyGraphql";
import { encodeReceiptIdForUrl } from "../utils/receiptId";

type DraftLine = {
  sku: string;
  supplierSku: string;
  quantityOrdered: string;
  unitCost: string;
  taxRate: string;
};

const EMPTY_LINE: DraftLine = {
  sku: "",
  supplierSku: "",
  quantityOrdered: "1",
  unitCost: "0",
  taxRate: "20",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await requireAdmin(request);
  const url = new URL(request.url);
  const locations = await listLocations(admin);
  const requestedLocationId = (url.searchParams.get("locationId") ?? "").trim();
  const requestedSku = (url.searchParams.get("sku") ?? "").trim();
  const defaultLocationId = locations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : (locations[0]?.id ?? "");
  return {
    locations,
    supplier: defaultPurchaseOrderSupplier(),
    defaultLocationId,
    initialSku: requestedSku,
  };
};

export default function PurchaseOrderCreatePage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    ok: boolean;
    error?: string;
    purchaseOrderGid?: string;
  }>();
  const embeddedNavigate = useEmbeddedNavigate();

  const [destinationLocationId, setDestinationLocationId] = useState(data.defaultLocationId);
  const [expectedArrivalAt, setExpectedArrivalAt] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(data.supplier.defaultPaymentTerms);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [currency, setCurrency] = useState(data.supplier.defaultCurrency);
  const [lines, setLines] = useState<DraftLine[]>([
    {
      ...EMPTY_LINE,
      sku: data.initialSku || "",
      supplierSku: data.initialSku || "",
    },
  ]);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.purchaseOrderGid) {
      embeddedNavigate(`/reassorts-magasin/${encodeReceiptIdForUrl(fetcher.data.purchaseOrderGid)}`);
    }
  }, [embeddedNavigate, fetcher.data]);

  const locationOptions = useMemo(
    () => data.locations.map((location) => ({ label: location.name, value: location.id })),
    [data.locations],
  );

  const linesJson = JSON.stringify(lines);

  return (
    <Page
      title="Nouveau réassort magasin"
      subtitle="Source: DEPOT DWP (information interne)"
      backAction={{ content: "Réassorts magasin", onAction: () => embeddedNavigate("/reassorts-magasin") }}
    >
      <fetcher.Form method="post" action="/actions/reassorts-magasin/creer">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300">
                <Box minWidth="280px">
                  <Select
                    label="Destination"
                    options={locationOptions}
                    value={destinationLocationId}
                    onChange={setDestinationLocationId}
                  />
                </Box>
                <Box minWidth="220px">
                  <TextField
                    label="Arrivée estimée"
                    type="date"
                    value={expectedArrivalAt}
                    onChange={setExpectedArrivalAt}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="200px">
                  <TextField
                    label="Devise"
                    value={currency}
                    onChange={setCurrency}
                    autoComplete="off"
                  />
                </Box>
              </InlineStack>

              <InlineStack gap="300">
                <Box minWidth="220px">
                  <TextField
                    label="Modalités de paiement"
                    value={paymentTerms}
                    onChange={setPaymentTerms}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="220px">
                  <TextField
                    label="Numéro de référence"
                    value={referenceNumber}
                    onChange={setReferenceNumber}
                    autoComplete="off"
                  />
                </Box>
              </InlineStack>

              <TextField
                label="Remarques fournisseur"
                value={supplierNotes}
                onChange={setSupplierNotes}
                autoComplete="off"
                multiline={3}
              />
              <TextField
                label="Notes internes"
                value={internalNotes}
                onChange={setInternalNotes}
                autoComplete="off"
                multiline={3}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Produits en réassort
                </Text>
                <Button
                  submit={false}
                  onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
                >
                  Ajouter une ligne
                </Button>
              </InlineStack>

              {lines.map((line, index) => (
                <BlockStack key={`line-${index}`} gap="200">
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <Box minWidth="200px">
                      <TextField
                        label={`SKU ligne ${index + 1}`}
                        value={line.sku}
                        onChange={(value) =>
                          setLines((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, sku: value } : item,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="200px">
                      <TextField
                        label="SKU fournisseur"
                        value={line.supplierSku}
                        onChange={(value) =>
                          setLines((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, supplierSku: value } : item,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="140px">
                      <TextField
                        label="Quantité"
                        type="number"
                        value={line.quantityOrdered}
                        onChange={(value) =>
                          setLines((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, quantityOrdered: value } : item,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="140px">
                      <TextField
                        label="Coût HT"
                        type="number"
                        value={line.unitCost}
                        onChange={(value) =>
                          setLines((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, unitCost: value } : item,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                    </Box>
                    <Box minWidth="140px">
                      <TextField
                        label="Taxe %"
                        type="number"
                        value={line.taxRate}
                        onChange={(value) =>
                          setLines((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, taxRate: value } : item,
                            ),
                          )
                        }
                        autoComplete="off"
                      />
                    </Box>
                    <Button
                      submit={false}
                      tone="critical"
                      disabled={lines.length <= 1}
                      onClick={() => setLines((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Retirer
                    </Button>
                  </InlineStack>
                  {index < lines.length - 1 ? <Divider /> : null}
                </BlockStack>
              ))}
            </BlockStack>
          </Card>

          <input type="hidden" name="destinationLocationId" value={destinationLocationId} />
          <input type="hidden" name="expectedArrivalAt" value={expectedArrivalAt} />
          <input type="hidden" name="paymentTerms" value={paymentTerms} />
          <input type="hidden" name="referenceNumber" value={referenceNumber} />
          <input type="hidden" name="supplierNotes" value={supplierNotes} />
          <input type="hidden" name="internalNotes" value={internalNotes} />
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="linesJson" value={linesJson} />

          {fetcher.data?.error ? <Banner tone="critical">{fetcher.data.error}</Banner> : null}

          <InlineStack gap="300">
            <Button submit variant="primary" loading={fetcher.state !== "idle"} disabled={!destinationLocationId}>
              Créer le brouillon
            </Button>
            <Button submit={false} onClick={() => embeddedNavigate("/reassorts-magasin")}>
              Annuler
            </Button>
          </InlineStack>
        </BlockStack>
      </fetcher.Form>
    </Page>
  );
}
