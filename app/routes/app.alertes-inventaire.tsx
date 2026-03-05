import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
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
import {
  getAlertConfig,
  listAlertEvents,
  type AlertStatus,
  type AlertType,
} from "../services/inventoryAlertService";
import { listLocations } from "../services/shopifyGraphql";

const ALERT_TYPES: AlertType[] = ["LOW_STOCK", "OUT_OF_STOCK", "INCOMING_DELAY", "STOCKOUT_SOON", "OVERSTOCK", "SYNC_ERROR"];

function typeLabel(type: AlertType): string {
  if (type === "LOW_STOCK") return "Sous min";
  if (type === "OUT_OF_STOCK") return "Rupture";
  if (type === "INCOMING_DELAY") return "Retard arrivage";
  if (type === "STOCKOUT_SOON") return "Rupture imminente";
  if (type === "OVERSTOCK") return "Surstock";
  return "Erreur sync";
}

function statusLabel(status: AlertStatus): string {
  if (status === "ACKNOWLEDGED") return "En cours";
  if (status === "RESOLVED") return "Résolue";
  return "Ouverte";
}

function statusTone(status: AlertStatus): "critical" | "warning" | "success" | "info" {
  if (status === "RESOLVED") return "success";
  if (status === "ACKNOWLEDGED") return "warning";
  return "critical";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const locations = await listLocations(admin);
  const locationId = String(url.searchParams.get("locationId") ?? "").trim();
  const status = String(url.searchParams.get("status") ?? "OPEN").trim().toUpperCase();
  const type = String(url.searchParams.get("type") ?? "ALL").trim().toUpperCase();

  const [config, alerts] = await Promise.all([
    getAlertConfig(admin, shop),
    listAlertEvents(admin, shop, {
      status: (status === "ALL" ? "ALL" : status) as AlertStatus | "ALL",
      type: (type === "ALL" ? "ALL" : type) as AlertType | "ALL",
      locationId: locationId || undefined,
      limit: 300,
    }),
  ]);

  return {
    config,
    alerts,
    locations,
    filters: {
      locationId,
      status,
      type,
    },
  };
};

export default function AlertsCenterPage() {
  const data = useLoaderData<typeof loader>();
  const embeddedNavigate = useEmbeddedNavigate();

  const configFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const statusFetcher = useFetcher<{ ok: boolean; error?: string }>();

  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const [locationId, setLocationId] = useState(data.filters.locationId || "");
  const [status, setStatus] = useState(data.filters.status || "OPEN");
  const [type, setType] = useState(data.filters.type || "ALL");

  const [emails, setEmails] = useState(data.config.emails.join(", "));
  const [frequency, setFrequency] = useState(data.config.frequency);
  const [stockoutSoonDays, setStockoutSoonDays] = useState(String(data.config.stockoutSoonDays));
  const [enabledTypes, setEnabledTypes] = useState<Record<string, boolean>>(
    Object.fromEntries(ALERT_TYPES.map((alertType) => [alertType, data.config.enabledTypes.includes(alertType)])),
  );

  useEffect(() => {
    if (configFetcher.data?.ok) {
      setToast({ content: "Configuration des alertes enregistrée." });
    } else if (configFetcher.data?.error) {
      setToast({ content: configFetcher.data.error, error: true });
    }
  }, [configFetcher.data]);

  useEffect(() => {
    if (statusFetcher.data?.ok) {
      setToast({ content: "Alerte mise à jour." });
    } else if (statusFetcher.data?.error) {
      setToast({ content: statusFetcher.data.error, error: true });
    }
  }, [statusFetcher.data]);

  const locationOptions = useMemo(
    () => [{ label: "Toutes les boutiques", value: "" }, ...data.locations.map((location) => ({ label: location.name, value: location.id }))],
    [data.locations],
  );

  return (
    <Page
      title="Centre d'alertes"
      subtitle="LOW_STOCK, OUT_OF_STOCK, INCOMING_DELAY, STOCKOUT_SOON, OVERSTOCK, SYNC_ERROR"
      secondaryActions={[{ content: "Planification", onAction: () => embeddedNavigate("/planification-stock") }]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Filtres
            </Text>
            <InlineStack gap="300" blockAlign="end" wrap>
              <Box minWidth="260px">
                <Select label="Boutique" options={locationOptions} value={locationId} onChange={setLocationId} />
              </Box>
              <Box minWidth="200px">
                <Select
                  label="Statut"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { label: "Toutes", value: "ALL" },
                    { label: "Ouvertes", value: "OPEN" },
                    { label: "En cours", value: "ACKNOWLEDGED" },
                    { label: "Résolues", value: "RESOLVED" },
                  ]}
                />
              </Box>
              <Box minWidth="220px">
                <Select
                  label="Type"
                  value={type}
                  onChange={setType}
                  options={[
                    { label: "Tous", value: "ALL" },
                    ...ALERT_TYPES.map((alertType) => ({ label: typeLabel(alertType), value: alertType })),
                  ]}
                />
              </Box>
              <Button
                submit={false}
                onClick={() => {
                  const params = new URLSearchParams();
                  if (locationId) params.set("locationId", locationId);
                  if (status && status !== "OPEN") params.set("status", status);
                  if (type && type !== "ALL") params.set("type", type);
                  embeddedNavigate(`/alertes-inventaire${params.toString() ? `?${params.toString()}` : ""}`);
                }}
              >
                Filtrer
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Alertes
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {data.alerts.length} alerte(s)
              </Text>
            </InlineStack>

            {data.alerts.length === 0 ? (
              <Banner tone="success">Aucune alerte pour ce filtre.</Banner>
            ) : (
              <IndexTable
                resourceName={{ singular: "alerte", plural: "alertes" }}
                itemCount={data.alerts.length}
                selectable={false}
                headings={[
                  { title: "Type" },
                  { title: "SKU" },
                  { title: "Message" },
                  { title: "Statut" },
                  { title: "Dernier déclenchement" },
                  { title: "Action" },
                ]}
              >
                {data.alerts.map((alert, index) => (
                  <IndexTable.Row id={alert.dedupKey} key={alert.dedupKey} position={index}>
                    <IndexTable.Cell>{typeLabel(alert.type)}</IndexTable.Cell>
                    <IndexTable.Cell>{alert.sku || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{alert.message || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={statusTone(alert.status)}>{statusLabel(alert.status)}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt).toLocaleString("fr-FR") : "-"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100" wrap={false}>
                        {alert.status !== "ACKNOWLEDGED" ? (
                          <statusFetcher.Form method="post" action="/actions/alertes/statut">
                            <input type="hidden" name="dedupKey" value={alert.dedupKey} />
                            <input type="hidden" name="status" value="ACKNOWLEDGED" />
                            <Button submit size="micro" loading={statusFetcher.state !== "idle"}>
                              En cours
                            </Button>
                          </statusFetcher.Form>
                        ) : null}
                        {alert.status !== "RESOLVED" ? (
                          <statusFetcher.Form method="post" action="/actions/alertes/statut">
                            <input type="hidden" name="dedupKey" value={alert.dedupKey} />
                            <input type="hidden" name="status" value="RESOLVED" />
                            <Button submit size="micro" tone="critical" loading={statusFetcher.state !== "idle"}>
                              Résoudre
                            </Button>
                          </statusFetcher.Form>
                        ) : null}
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Configuration notifications
            </Text>
            <configFetcher.Form method="post" action="/actions/alertes/configuration">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="end" wrap>
                  <Box minWidth="200px">
                    <Select
                      label="Fréquence"
                      value={frequency}
                      onChange={(value) => setFrequency(value as typeof frequency)}
                      options={[
                        { label: "Instant", value: "instant" },
                        { label: "Digest quotidien", value: "daily" },
                        { label: "Digest hebdo", value: "weekly" },
                      ]}
                    />
                  </Box>
                  <Box minWidth="220px">
                    <TextField
                      label="Rupture imminente (jours)"
                      value={stockoutSoonDays}
                      onChange={setStockoutSoonDays}
                      autoComplete="off"
                    />
                  </Box>
                </InlineStack>

                <TextField
                  label="Destinataires email"
                  value={emails}
                  onChange={setEmails}
                  autoComplete="off"
                  helpText="Séparer par virgule ou retour à la ligne"
                  multiline={3}
                />

                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Types activés
                  </Text>
                  <InlineStack gap="200" wrap>
                    {ALERT_TYPES.map((alertType) => (
                      <Checkbox
                        key={alertType}
                        label={typeLabel(alertType)}
                        checked={Boolean(enabledTypes[alertType])}
                        onChange={(checked) =>
                          setEnabledTypes((prev) => ({
                            ...prev,
                            [alertType]: checked,
                          }))
                        }
                      />
                    ))}
                  </InlineStack>
                </BlockStack>

                <input type="hidden" name="frequency" value={frequency} />
                <input type="hidden" name="emails" value={emails} />
                <input type="hidden" name="stockoutSoonDays" value={stockoutSoonDays} />
                {ALERT_TYPES.map((alertType) => (
                  <input
                    key={`input-${alertType}`}
                    type="hidden"
                    name={`enabled:${alertType}`}
                    value={enabledTypes[alertType] ? "1" : "0"}
                  />
                ))}

                <InlineStack>
                  <Button submit loading={configFetcher.state !== "idle"}>
                    Enregistrer
                  </Button>
                </InlineStack>
              </BlockStack>
            </configFetcher.Form>

            {configFetcher.data?.error ? <Banner tone="critical">{configFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
