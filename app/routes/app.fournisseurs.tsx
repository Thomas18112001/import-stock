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
import { listSupplierSkuMappings, listSuppliers } from "../services/inventorySupplierService";
import { sanitizeSearchQuery } from "../utils/validators";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const url = new URL(request.url);
  const supplierHandle = String(url.searchParams.get("supplier") ?? "").trim();
  const q = sanitizeSearchQuery(String(url.searchParams.get("q") ?? ""));

  const [suppliers, mappings] = await Promise.all([
    listSuppliers(admin, shop, { includeInactive: true }),
    listSupplierSkuMappings(admin, shop, {
      supplierHandle: supplierHandle || null,
      query: q || null,
      includeInactiveSuppliers: true,
    }),
  ]);

  return {
    suppliers,
    mappings,
    filters: {
      supplierHandle,
      q,
    },
  };
};

type SupplierFormState = {
  handle: string;
  name: string;
  email: string;
  leadTimeDays: string;
  notes: string;
  active: boolean;
};

const EMPTY_SUPPLIER_FORM: SupplierFormState = {
  handle: "",
  name: "",
  email: "",
  leadTimeDays: "14",
  notes: "",
  active: true,
};

export default function SuppliersPage() {
  const data = useLoaderData<typeof loader>();
  const embeddedNavigate = useEmbeddedNavigate();

  const supplierFetcher = useFetcher<{ ok: boolean; error?: string; handle?: string }>();
  const supplierStateFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const supplierDeleteFetcher = useFetcher<{ ok: boolean; error?: string; deleted?: boolean; deletedMappings?: number }>();
  const mappingFetcher = useFetcher<{ ok: boolean; error?: string; handle?: string }>();
  const mappingDeleteFetcher = useFetcher<{ ok: boolean; error?: string; deleted?: boolean }>();

  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const [supplierForm, setSupplierForm] = useState<SupplierFormState>(EMPTY_SUPPLIER_FORM);
  const [mappingSupplierHandle, setMappingSupplierHandle] = useState(data.filters.supplierHandle || "");
  const [mappingSku, setMappingSku] = useState("");
  const [mappingLeadTime, setMappingLeadTime] = useState("0");
  const [mappingNotes, setMappingNotes] = useState("");
  const [filterSupplierHandle, setFilterSupplierHandle] = useState(data.filters.supplierHandle || "");
  const [filterQuery, setFilterQuery] = useState(data.filters.q || "");

  useEffect(() => {
    setFilterSupplierHandle(data.filters.supplierHandle || "");
    setFilterQuery(data.filters.q || "");
  }, [data.filters.q, data.filters.supplierHandle]);

  useEffect(() => {
    if (mappingSupplierHandle) return;
    const firstActive = data.suppliers.find((supplier) => supplier.active)?.handle || "";
    if (firstActive) setMappingSupplierHandle(firstActive);
  }, [data.suppliers, mappingSupplierHandle]);

  useEffect(() => {
    if (supplierFetcher.data?.ok) {
      setToast({ content: "Fournisseur enregistré." });
      setSupplierForm(EMPTY_SUPPLIER_FORM);
    } else if (supplierFetcher.data?.error) {
      setToast({ content: supplierFetcher.data.error, error: true });
    }
  }, [supplierFetcher.data]);

  useEffect(() => {
    if (supplierStateFetcher.data?.ok) {
      setToast({ content: "Statut fournisseur mis à jour." });
    } else if (supplierStateFetcher.data?.error) {
      setToast({ content: supplierStateFetcher.data.error, error: true });
    }
  }, [supplierStateFetcher.data]);

  useEffect(() => {
    if (supplierDeleteFetcher.data?.ok) {
      setToast({
        content: `Fournisseur supprimé. ${supplierDeleteFetcher.data.deletedMappings ?? 0} mapping(s) supprimé(s).`,
      });
    } else if (supplierDeleteFetcher.data?.error) {
      setToast({ content: supplierDeleteFetcher.data.error, error: true });
    }
  }, [supplierDeleteFetcher.data]);

  useEffect(() => {
    if (mappingFetcher.data?.ok) {
      setToast({ content: "Mapping SKU fournisseur enregistré." });
      setMappingSku("");
      setMappingLeadTime("0");
      setMappingNotes("");
    } else if (mappingFetcher.data?.error) {
      setToast({ content: mappingFetcher.data.error, error: true });
    }
  }, [mappingFetcher.data]);

  useEffect(() => {
    if (mappingDeleteFetcher.data?.ok) {
      setToast({ content: "Mapping supprimé." });
    } else if (mappingDeleteFetcher.data?.error) {
      setToast({ content: mappingDeleteFetcher.data.error, error: true });
    }
  }, [mappingDeleteFetcher.data]);

  const supplierOptions = useMemo(
    () =>
      [
        { label: "Tous les fournisseurs", value: "" },
        ...data.suppliers.map((supplier) => ({
          label: supplier.active ? supplier.name : `${supplier.name} (inactif)`,
          value: supplier.handle,
        })),
      ],
    [data.suppliers],
  );

  const activeSupplierOptions = useMemo(
    () => {
      const rows = data.suppliers
        .filter((supplier) => supplier.active)
        .map((supplier) => ({
          label: supplier.name,
          value: supplier.handle,
        }));
      return rows.length ? rows : [{ label: "Aucun fournisseur actif", value: "" }];
    },
    [data.suppliers],
  );

  return (
    <Page
      title="Fournisseurs & lead time"
      subtitle="V1: CRUD fournisseurs, lead time global et mapping SKU spécifique"
      secondaryActions={[{ content: "Planification", onAction: () => embeddedNavigate("/planification-stock") }]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Nouveau fournisseur / édition
            </Text>
            <supplierFetcher.Form method="post" action="/actions/fournisseurs">
              <input type="hidden" name="intent" value="upsert_supplier" />
              <input type="hidden" name="handle" value={supplierForm.handle} />
              <input type="hidden" name="active" value={supplierForm.active ? "1" : "0"} />
              <InlineStack gap="300" blockAlign="end" align="start" wrap>
                <Box minWidth="200px">
                  <TextField
                    label="Nom"
                    value={supplierForm.name}
                    onChange={(value) => setSupplierForm((prev) => ({ ...prev, name: value }))}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="220px">
                  <TextField
                    label="Email"
                    value={supplierForm.email}
                    onChange={(value) => setSupplierForm((prev) => ({ ...prev, email: value }))}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="120px">
                  <TextField
                    label="Lead time (jours)"
                    value={supplierForm.leadTimeDays}
                    onChange={(value) => setSupplierForm((prev) => ({ ...prev, leadTimeDays: value }))}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="260px">
                  <TextField
                    label="Notes"
                    value={supplierForm.notes}
                    onChange={(value) => setSupplierForm((prev) => ({ ...prev, notes: value }))}
                    autoComplete="off"
                  />
                </Box>
                <input type="hidden" name="name" value={supplierForm.name} />
                <input type="hidden" name="email" value={supplierForm.email} />
                <input type="hidden" name="leadTimeDays" value={supplierForm.leadTimeDays} />
                <input type="hidden" name="notes" value={supplierForm.notes} />
                <Button submit loading={supplierFetcher.state !== "idle"} disabled={!supplierForm.name.trim()}>
                  Sauver
                </Button>
                <Button submit={false} onClick={() => setSupplierForm(EMPTY_SUPPLIER_FORM)}>
                  Réinitialiser
                </Button>
              </InlineStack>
            </supplierFetcher.Form>
            {supplierFetcher.data?.error ? <Banner tone="critical">{supplierFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Fournisseurs
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {data.suppliers.length} fournisseur(s)
              </Text>
            </InlineStack>

            {data.suppliers.length === 0 ? (
              <Banner tone="info">Aucun fournisseur configuré.</Banner>
            ) : (
              <IndexTable
                resourceName={{ singular: "fournisseur", plural: "fournisseurs" }}
                itemCount={data.suppliers.length}
                selectable={false}
                headings={[
                  { title: "Nom" },
                  { title: "Email" },
                  { title: "Lead time" },
                  { title: "Statut" },
                  { title: "Action" },
                ]}
              >
                {data.suppliers.map((supplier, index) => (
                  <IndexTable.Row id={supplier.handle} key={supplier.handle} position={index}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {supplier.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {supplier.handle}
                        </Text>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{supplier.email || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{supplier.leadTimeDays > 0 ? `${supplier.leadTimeDays} j` : "-"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={supplier.active ? "success" : "critical"}>{supplier.active ? "Actif" : "Inactif"}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100" wrap={false}>
                        <Button
                          size="micro"
                          submit={false}
                          onClick={() =>
                            setSupplierForm({
                              handle: supplier.handle,
                              name: supplier.name,
                              email: supplier.email,
                              leadTimeDays: String(supplier.leadTimeDays || 0),
                              notes: supplier.notes,
                              active: supplier.active,
                            })
                          }
                        >
                          Modifier
                        </Button>
                        <supplierStateFetcher.Form method="post" action="/actions/fournisseurs">
                          <input type="hidden" name="intent" value="set_supplier_active" />
                          <input type="hidden" name="handle" value={supplier.handle} />
                          <input type="hidden" name="active" value={supplier.active ? "0" : "1"} />
                          <Button submit size="micro" tone={supplier.active ? "critical" : "success"}>
                            {supplier.active ? "Désactiver" : "Activer"}
                          </Button>
                        </supplierStateFetcher.Form>
                        <supplierDeleteFetcher.Form method="post" action="/actions/fournisseurs">
                          <input type="hidden" name="intent" value="delete_supplier" />
                          <input type="hidden" name="handle" value={supplier.handle} />
                          <input type="hidden" name="deleteMappings" value="1" />
                          <Button submit size="micro" tone="critical">
                            Supprimer
                          </Button>
                        </supplierDeleteFetcher.Form>
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
              Mapping SKU fournisseur (override lead time)
            </Text>
            <mappingFetcher.Form method="post" action="/actions/fournisseurs">
              <input type="hidden" name="intent" value="upsert_supplier_sku" />
              <input type="hidden" name="supplierHandle" value={mappingSupplierHandle} />
              <input type="hidden" name="sku" value={mappingSku} />
              <input type="hidden" name="leadTimeDaysOverride" value={mappingLeadTime} />
              <input type="hidden" name="notes" value={mappingNotes} />
              <InlineStack gap="300" blockAlign="end" align="start" wrap>
                <Box minWidth="220px">
                  <Select
                    label="Fournisseur"
                    options={activeSupplierOptions}
                    value={mappingSupplierHandle}
                    onChange={setMappingSupplierHandle}
                  />
                </Box>
                <Box minWidth="180px">
                  <TextField label="SKU" value={mappingSku} onChange={setMappingSku} autoComplete="off" />
                </Box>
                <Box minWidth="140px">
                  <TextField
                    label="Lead time override (j)"
                    value={mappingLeadTime}
                    onChange={setMappingLeadTime}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="260px">
                  <TextField label="Notes" value={mappingNotes} onChange={setMappingNotes} autoComplete="off" />
                </Box>
                <Button
                  submit
                  loading={mappingFetcher.state !== "idle"}
                  disabled={!mappingSupplierHandle || !mappingSku.trim()}
                >
                  Sauver mapping
                </Button>
              </InlineStack>
            </mappingFetcher.Form>
            {mappingFetcher.data?.error ? <Banner tone="critical">{mappingFetcher.data.error}</Banner> : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Mappings SKU
              </Text>
              <InlineStack gap="200" blockAlign="end">
                <Box minWidth="220px">
                  <Select
                    label="Fournisseur"
                    options={supplierOptions}
                    value={filterSupplierHandle}
                    onChange={setFilterSupplierHandle}
                  />
                </Box>
                <Box minWidth="220px">
                  <TextField
                    label="Recherche"
                    value={filterQuery}
                    onChange={setFilterQuery}
                    autoComplete="off"
                    placeholder="SKU ou fournisseur"
                  />
                </Box>
                <Button
                  submit={false}
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (filterSupplierHandle) params.set("supplier", filterSupplierHandle);
                    if (filterQuery.trim()) params.set("q", filterQuery.trim());
                    embeddedNavigate(`/fournisseurs${params.toString() ? `?${params.toString()}` : ""}`);
                  }}
                >
                  Filtrer
                </Button>
              </InlineStack>
            </InlineStack>

            {data.mappings.length === 0 ? (
              <Banner tone="info">Aucun mapping SKU fournisseur sur ce filtre.</Banner>
            ) : (
              <IndexTable
                resourceName={{ singular: "mapping", plural: "mappings" }}
                itemCount={data.mappings.length}
                selectable={false}
                headings={[
                  { title: "SKU" },
                  { title: "Fournisseur" },
                  { title: "Lead time override" },
                  { title: "Notes" },
                  { title: "Action" },
                ]}
              >
                {data.mappings.map((mapping, index) => (
                  <IndexTable.Row id={mapping.handle} key={mapping.handle} position={index}>
                    <IndexTable.Cell>{mapping.sku}</IndexTable.Cell>
                    <IndexTable.Cell>{mapping.supplierName}</IndexTable.Cell>
                    <IndexTable.Cell>{mapping.leadTimeDaysOverride > 0 ? `${mapping.leadTimeDaysOverride} j` : "-"}</IndexTable.Cell>
                    <IndexTable.Cell>{mapping.notes || "-"}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <mappingDeleteFetcher.Form method="post" action="/actions/fournisseurs">
                        <input type="hidden" name="intent" value="delete_supplier_sku" />
                        <input type="hidden" name="handle" value={mapping.handle} />
                        <Button submit size="micro" tone="critical">
                          Supprimer
                        </Button>
                      </mappingDeleteFetcher.Form>
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
