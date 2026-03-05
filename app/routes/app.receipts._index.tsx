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
  Modal,
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
import { listReceipts } from "../services/receiptService";
import { listLocations } from "../services/shopifyGraphql";
import { getSyncState } from "../services/shopifyMetaobjects";
import { buildMissingPrestaConfigMessage, getBoutiqueMappingByLocationName } from "../config/boutiques";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";
import { filterReceiptsForSelectedLocation } from "../utils/receiptFilters";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { makeTraceId } from "../utils/trace";
import { sanitizeSearchQuery, sanitizeSort } from "../utils/validators";

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

function cityLabelFromLocationName(name: string): string {
  return name.replace(/^Boutique\s+/i, "").trim() || name;
}

function toSortableMs(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function receiptSortTimestamp(receipt: { prestaDateAdd: string; prestaDateUpd?: string }): number {
  return Math.max(toSortableMs(receipt.prestaDateUpd ?? ""), toSortableMs(receipt.prestaDateAdd));
}

type ReceiptRow = {
  gid: string;
  prestaOrderId: number;
  prestaReference: string;
  status: string;
  prestaDateAdd: string;
  prestaDateUpd?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const debug = process.env.DEBUG === "true";
  const url = new URL(request.url);

  let adminShop: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    adminShop = await requireAdmin(request);
  } catch (error) {
    if (debug) {
      if (error instanceof Response) {
        console.info("[debug] receipts loader redirect", {
          status: error.status,
          location: error.headers.get("Location") ?? null,
        });
      } else {
        console.info("[debug] receipts loader auth error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    throw error;
  }
  const { admin, shop } = adminShop;

  const allowedStatuses = ["", "IMPORTED", "READY", "BLOCKED", "INCOMING", "APPLIED", "ROLLED_BACK"];
  const allowedSorts = ["date_desc", "date_asc", "id_desc", "id_asc"];
  const rawStatus = url.searchParams.get("status") ?? "";
  const status = allowedStatuses.includes(rawStatus) ? rawStatus : "";
  const q = sanitizeSearchQuery(url.searchParams.get("q") ?? "");
  const sort = sanitizeSort(url.searchParams.get("sort") ?? "date_desc", allowedSorts, "date_desc");
  const cursor = url.searchParams.get("cursor");
  const stack = (url.searchParams.get("stack") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  try {
    const [page, syncState, locations] = await Promise.all([
      listReceipts(admin, shop, { pageSize: 20, cursor: cursor || null }),
      getSyncState(admin),
      listLocations(admin),
    ]);

    const selectedLocation =
      locations.find((loc) => loc.id === syncState.selectedLocationId) ||
      locations.find((loc) => loc.name === env.shopifyDefaultLocationName) ||
      locations[0] ||
      null;

    const boutiqueMapping = selectedLocation ? getBoutiqueMappingByLocationName(selectedLocation.name) : null;
    const locationConfigured = Boolean(boutiqueMapping?.prestaCustomerId);
    const configurationMessage =
      selectedLocation && !locationConfigured ? buildMissingPrestaConfigMessage(selectedLocation.name) : null;

    const includeLegacyUnassigned =
      selectedLocation?.name?.trim().toLowerCase() === env.shopifyDefaultLocationName.trim().toLowerCase();
    const filteredByLocation = selectedLocation
      ? filterReceiptsForSelectedLocation(page.receipts, selectedLocation.id, includeLegacyUnassigned)
      : page.receipts;

    const filtered = filteredByLocation.filter((r) => {
      if (status && r.status !== status) return false;
      if (q) {
        const haystack = `${r.prestaOrderId} ${r.prestaReference}`.toLowerCase();
        if (!haystack.includes(q.toLowerCase())) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "date_asc") {
        const dateDelta = receiptSortTimestamp(a) - receiptSortTimestamp(b);
        if (dateDelta !== 0) return dateDelta;
        return a.prestaOrderId - b.prestaOrderId;
      }
      if (sort === "id_asc") return a.prestaOrderId - b.prestaOrderId;
      if (sort === "id_desc") return b.prestaOrderId - a.prestaOrderId;
      const dateDelta = receiptSortTimestamp(b) - receiptSortTimestamp(a);
      if (dateDelta !== 0) return dateDelta;
      return b.prestaOrderId - a.prestaOrderId;
    });

    return {
      status,
      q,
      sort,
      deleted: url.searchParams.get("deleted") === "1",
      cursor: cursor ?? "",
      stack,
      pageInfo: page.pageInfo,
      receipts: sorted,
      debug: env.debug,
      locationName: selectedLocation?.name ?? "Boutique",
      locationCity: selectedLocation ? cityLabelFromLocationName(selectedLocation.name) : "Boutique",
      locationConfigured,
      configurationMessage,
      scopeIssue: null as null | { missingScope: string; message: string },
    };
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (env.debug) {
        console.info("[debug] scope missing on receipts loader", {
          shop,
          missingScope: error.missingScope,
          shouldReauth: shouldTriggerReauth(url),
        });
      }
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        status,
        q,
        sort,
        deleted: false,
        cursor: "",
        stack,
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
        receipts: [],
        debug: env.debug,
        locationName: "Boutique",
        locationCity: "Boutique",
        locationConfigured: true,
        configurationMessage: null,
        scopeIssue: {
          missingScope: error.missingScope,
          message: `Autorisation manquante: ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        },
      };
    }
    throw error;
  }
};

export default function ReceiptsPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const revalidator = useRevalidator();
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string; deletedGid?: string }>();

  const [receipts, setReceipts] = useState<ReceiptRow[]>(data.receipts);
  const [query, setQuery] = useState(data.q);
  const [status, setStatus] = useState(data.status);
  const [sort, setSort] = useState(data.sort);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(
    data.deleted ? { content: "Réception supprimée." } : null,
  );
  const [deleteTarget, setDeleteTarget] = useState<ReceiptRow | null>(null);
  const [deletingGid, setDeletingGid] = useState<string | null>(null);

  useEffect(() => {
    setReceipts(data.receipts);
  }, [data.receipts]);

  useEffect(() => {
    if (!deleteFetcher.data) return;
    if (deleteFetcher.data.ok && deleteFetcher.data.deletedGid) {
      setReceipts((prev) => prev.filter((r) => r.gid !== deleteFetcher.data!.deletedGid));
      setToast({ content: "Réception supprimée." });
      setDeleteTarget(null);
      setDeletingGid(null);
      revalidator.revalidate();
    } else if (deleteFetcher.data.error) {
      setToast({ content: deleteFetcher.data.error, error: true });
      setDeletingGid(null);
    }
  }, [deleteFetcher.data, revalidator]);

  const nextStack = [...data.stack, data.cursor || "ROOT"].join(",");
  const prevCursorToken = data.stack[data.stack.length - 1];
  const prevCursor = !prevCursorToken || prevCursorToken === "ROOT" ? "" : prevCursorToken;
  const prevStack = data.stack.slice(0, -1).join(",");

  const isLoading = navigation.state !== "idle";
  const deleting = deleteFetcher.state !== "idle";

  const applyFilters = () => {
    const path = `/produits-en-reception?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}`;
    const result = embeddedNavigate(path);
    if (!result.ok) {
      setToast({ content: "Navigation impossible.", error: true });
    }
  };

  const rows = useMemo(
    () =>
      receipts.map((receipt, index) => {
        const isDeletingRow = deletingGid === receipt.gid && deleting;
        return (
          <IndexTable.Row id={receipt.gid} key={receipt.gid} position={index}>
            <IndexTable.Cell>{receipt.prestaOrderId}</IndexTable.Cell>
            <IndexTable.Cell>{receipt.prestaReference || "-"}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={badgeTone(receipt.status)}>{statusLabel(receipt.status)}</Badge>
            </IndexTable.Cell>
            <IndexTable.Cell>{receipt.prestaDateAdd || "-"}</IndexTable.Cell>
            <IndexTable.Cell>
              <InlineStack gap="200">
                <Button
                  size="slim"
                  submit={false}
                  disabled={isDeletingRow}
                  onClick={() => {
                    const traceId = makeTraceId();
                    const receiptIdRaw = receipt.gid;
                    const receiptIdEnc = encodeReceiptIdForUrl(receiptIdRaw);
                    const path = `/produits-en-reception/${receiptIdEnc}?trace=${encodeURIComponent(traceId)}`;
                    if (data.debug) {
                      console.info("[debug] click ouvrir receipts", {
                        traceId,
                        receiptIdRaw,
                        receiptIdEnc,
                        path,
                      });
                    }
                    const result = embeddedNavigate(path);
                    if (!result.ok) {
                      setToast({ content: "Navigation impossible.", error: true });
                    }
                  }}
                >
                  Ouvrir
                </Button>
                <Button
                  size="slim"
                  submit={false}
                  tone="critical"
                  disabled={isDeletingRow}
                  loading={isDeletingRow}
                  onClick={() => setDeleteTarget(receipt)}
                >
                  Supprimer
                </Button>
              </InlineStack>
            </IndexTable.Cell>
          </IndexTable.Row>
        );
      }),
    [data.debug, deleting, deletingGid, embeddedNavigate, receipts],
  );

  return (
    <Page
      title={`Réceptions commandes boutique ${data.locationCity}`}
      backAction={{ content: "Tableau de bord", onAction: () => embeddedNavigate("/") }}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <BlockStack gap="400">
        {data.scopeIssue ? (
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
        ) : null}

        {!data.locationConfigured && data.configurationMessage ? (
          <Banner tone="warning" title="Configuration requise">
            {data.configurationMessage}
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Seules les commandes Prestashop BtoB sont listées.
            </Text>
            <InlineStack gap="300" align="start" blockAlign="end">
              <Box minWidth="240px">
                <TextField label="Recherche (ID ou référence)" name="q" value={query} onChange={setQuery} autoComplete="off" />
              </Box>
              <Select
                label="Statut"
                name="status"
                value={status}
                onChange={setStatus}
                options={[
                  { label: "Tous", value: "" },
                  { label: "À vérifier", value: "IMPORTED" },
                  { label: "Prête pour arrivage", value: "READY" },
                  { label: "Bloquée (SKU à corriger)", value: "BLOCKED" },
                  { label: "En cours d'arrivage", value: "INCOMING" },
                  { label: "Reçue en boutique", value: "APPLIED" },
                  { label: "Réception annulée", value: "ROLLED_BACK" },
                ]}
              />
              <Select
                label="Tri"
                name="sort"
                value={sort}
                onChange={setSort}
                options={[
                  { label: "Date décroissante", value: "date_desc" },
                  { label: "Date croissante", value: "date_asc" },
                  { label: "ID décroissant", value: "id_desc" },
                  { label: "ID croissant", value: "id_asc" },
                ]}
              />
              <Button submit={false} onClick={applyFilters}>
                Filtrer
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          {isLoading ? (
            <BlockStack gap="300">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText />
            </BlockStack>
          ) : (
            <IndexTable
              resourceName={{ singular: "réception", plural: "réceptions" }}
              itemCount={receipts.length}
              selectable={false}
              headings={[
                { title: "ID Presta" },
                { title: "Référence" },
                { title: "Statut" },
                { title: "Date commande" },
                { title: "Action" },
              ]}
            >
              {rows}
            </IndexTable>
          )}
        </Card>

        <InlineStack gap="300" align="space-between">
          <Button
            disabled={data.stack.length === 0}
            onClick={() =>
              embeddedNavigate(
                `/produits-en-reception?q=${encodeURIComponent(data.q)}&status=${encodeURIComponent(
                  data.status,
                )}&sort=${encodeURIComponent(data.sort)}&cursor=${encodeURIComponent(prevCursor)}&stack=${encodeURIComponent(
                  prevStack,
                )}`,
              )
            }
          >
            Précédent
          </Button>
          <Button
            disabled={!data.pageInfo.hasNextPage || !data.pageInfo.endCursor}
            onClick={() =>
              embeddedNavigate(
                `/produits-en-reception?q=${encodeURIComponent(data.q)}&status=${encodeURIComponent(
                  data.status,
                )}&sort=${encodeURIComponent(data.sort)}&cursor=${encodeURIComponent(
                  data.pageInfo.endCursor ?? "",
                )}&stack=${encodeURIComponent(nextStack)}`,
              )
            }
          >
            Suivant
          </Button>
        </InlineStack>
      </BlockStack>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
          }
        }}
        title={deleteTarget ? `Supprimer la réception #${deleteTarget.prestaOrderId}` : "Supprimer la réception"}
        primaryAction={{
          content: "Supprimer",
          destructive: true,
          disabled: deleting || deleteTarget?.status === "APPLIED" || deleteTarget?.status === "INCOMING",
          loading: deleting,
          onAction: () => {
            if (!deleteTarget) return;
            setDeletingGid(deleteTarget.gid);
            const formData = new FormData();
            formData.set("confirmed", "true");
            deleteFetcher.submit(formData, {
              method: "post",
              action: `/actions/produits-en-reception/${encodeReceiptIdForUrl(deleteTarget.gid)}/supprimer`,
            });
          },
        }}
        secondaryActions={[
          {
            content: "Annuler",
            disabled: deleting,
            onAction: () => {
              setDeleteTarget(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Cette action supprime l&apos;import. Si un flux de stock est en cours ou appliqué, terminez/annulez-le d&apos;abord.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
