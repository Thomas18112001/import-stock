import type { AdminClient } from "./auth.server";
import { toMissingScopeError } from "../utils/shopifyScopeErrors";
import { normalizeSkuText } from "../utils/validators";

type GraphqlResult<T> = { data?: T; errors?: Array<{ message: string }> };

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function graphqlRequest<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    if (response.status === 429 && attempt < 2) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      let bodyMessage = "";
      try {
        const maybeJson = (await response.json()) as GraphqlResult<T>;
        bodyMessage = maybeJson.errors?.map((e) => e.message).join("; ") ?? "";
      } catch {
        bodyMessage = "";
      }
      const httpError = new Error(
        `Shopify GraphQL HTTP ${response.status}${bodyMessage ? `: ${bodyMessage}` : ""}`,
      );
      const scopeError = toMissingScopeError(httpError, "graphqlRequest:http");
      if (scopeError) throw scopeError;
      throw httpError;
    }
    const json = (await response.json()) as GraphqlResult<T>;
    if (json.errors?.length) {
      const gqlError = new Error(json.errors.map((e) => e.message).join("; "));
      const scopeError = toMissingScopeError(gqlError, "graphqlRequest:graphql");
      if (scopeError) throw scopeError;
      throw gqlError;
    }
    if (!json.data) {
      throw new Error("Shopify GraphQL returned empty data");
    }
    return json.data;
  }
  throw new Error("Shopify GraphQL failed after retries");
}

export type ShopifyLocation = { id: string; name: string };

export async function listLocations(admin: AdminClient): Promise<ShopifyLocation[]> {
  const data = await graphqlRequest<{
    locations: { nodes: Array<{ id: string; name: string }> };
  }>(
    admin,
    `#graphql
      query Locations {
        locations(first: 100) {
          nodes { id name }
        }
      }
    `,
  );
  return data.locations.nodes;
}

export async function ensureLocationByName(
  admin: AdminClient,
  input: {
    name: string;
    address1?: string;
    city?: string;
    zip?: string;
    provinceCode?: string;
    countryCode?: string;
  },
): Promise<ShopifyLocation> {
  const normalizedName = input.name.trim();
  if (!normalizedName) {
    throw new Error("Le nom de location Shopify est requis.");
  }

  const existing = (await listLocations(admin)).find(
    (location) => location.name.trim().toLowerCase() === normalizedName.toLowerCase(),
  );
  if (existing) return existing;

  const data = await graphqlRequest<{
    locationAdd: {
      location: { id: string; name: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation LocationAdd($input: LocationAddInput!) {
        locationAdd(input: $input) {
          location { id name }
          userErrors { message }
        }
      }
    `,
    {
      input: {
        name: normalizedName,
        address: {
          address1: input.address1 ?? "Adresse fournisseur",
          city: input.city ?? "Marseille",
          zip: input.zip ?? "13001",
          provinceCode: input.provinceCode ?? "FR-13",
          countryCode: input.countryCode ?? "FR",
        },
      },
    },
  );

  if (data.locationAdd.userErrors.length) {
    throw new Error(data.locationAdd.userErrors.map((error) => error.message).join("; "));
  }
  if (!data.locationAdd.location) {
    throw new Error("Impossible de créer la location fournisseur.");
  }

  return data.locationAdd.location;
}

export async function resolveSkus(
  admin: AdminClient,
  skus: string[],
): Promise<Map<string, { variantId: string; inventoryItemId: string; variantTitle: string }>> {
  const uniq = Array.from(new Set(skus.map((s) => normalizeSkuText(s)).filter(Boolean)));
  const result = new Map<string, { variantId: string; inventoryItemId: string; variantTitle: string }>();
  const byNormalizedSku = new Map<string, { variantId: string; inventoryItemId: string; variantTitle: string }>();
  const normalizeSkuKey = (sku: string) => normalizeSkuText(sku).toUpperCase();
  const escapeSearchValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  for (let i = 0; i < uniq.length; i += 20) {
    const batch = uniq.slice(i, i + 20);
    const queryString = batch.map((sku) => `sku:"${escapeSearchValue(sku)}"`).join(" OR ");
    const data = await graphqlRequest<{
      productVariants: {
        nodes: Array<{
          id: string;
          title: string;
          sku: string | null;
          inventoryItem: { id: string } | null;
          product: { title: string } | null;
        }>;
      };
    }>(
      admin,
      `#graphql
        query ResolveSkus($query: String!) {
          productVariants(first: 250, query: $query) {
            nodes {
              id
              title
              sku
              product { title }
              inventoryItem { id }
            }
          }
        }
      `,
      { query: queryString },
    );
    for (const node of data.productVariants.nodes) {
      if (node.sku && node.inventoryItem?.id) {
        const variantTitle = node.product?.title
          ? `${node.product.title} / ${node.title}`
          : node.title;
        const match = {
          variantId: node.id,
          inventoryItemId: node.inventoryItem.id,
          variantTitle,
        };
        byNormalizedSku.set(normalizeSkuKey(node.sku), match);
        result.set(normalizeSkuText(node.sku), match);
      }
    }
  }
  for (const requestedSku of uniq) {
    const match = byNormalizedSku.get(normalizeSkuKey(requestedSku));
    if (match) {
      result.set(requestedSku, match);
    }
  }
  return result;
}

export type VariantSearchRow = {
  variantId: string;
  inventoryItemId: string;
  sku: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  imageAlt: string;
};

export async function searchVariants(
  admin: AdminClient,
  query: string,
  first = 25,
): Promise<VariantSearchRow[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  const data = await graphqlRequest<{
    productVariants: {
      nodes: Array<{
        id: string;
        title: string;
        sku: string | null;
        inventoryItem: { id: string } | null;
        image: { url: string; altText: string | null } | null;
        product: {
          title: string;
          featuredImage: { url: string; altText: string | null } | null;
        } | null;
      }>;
    };
  }>(
    admin,
    `#graphql
      query SearchVariants($query: String!, $first: Int!) {
        productVariants(first: $first, query: $query) {
          nodes {
            id
            title
            sku
            image { url altText }
            inventoryItem { id }
            product {
              title
              featuredImage { url altText }
            }
          }
        }
      }
    `,
    { query: normalizedQuery, first: Math.max(1, Math.min(50, first)) },
  );
  return data.productVariants.nodes
    .filter((node) => Boolean(node.inventoryItem?.id))
    .map((node) => {
      const image = node.image ?? node.product?.featuredImage ?? null;
      return {
        variantId: node.id,
        inventoryItemId: node.inventoryItem!.id,
        sku: node.sku ?? "",
        productTitle: node.product?.title ?? "",
        variantTitle: node.title ?? "",
        imageUrl: image?.url ?? "",
        imageAlt: image?.altText ?? "",
      };
    });
}

export type InventoryTransferLineInput = {
  inventoryItemId: string;
  quantity: number;
};

export type InventoryTransferResult = {
  id: string;
  referenceName: string;
  status: string;
};

export function transferAdminUrl(shopDomain: string, transferGid: string): string {
  const transferId = transferGid.split("/").pop() ?? transferGid;
  return `https://${shopDomain}/admin/inventory/transfers/${transferId}`;
}

export async function inventoryTransferCreate(
  admin: AdminClient,
  input: {
    name: string;
    originLocationId: string;
    destinationLocationId: string;
    lineItems: InventoryTransferLineInput[];
  },
): Promise<InventoryTransferResult> {
  const lines = input.lineItems.filter((line) => line.quantity > 0);
  if (!lines.length) {
    throw new Error("Aucune ligne de transfert valide.");
  }

  const data = await graphqlRequest<{
    inventoryTransferCreate: {
      inventoryTransfer: {
        id: string;
        referenceName: string;
        status: string;
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation InventoryTransferCreate($input: InventoryTransferInput!) {
        inventoryTransferCreate(input: $input) {
          inventoryTransfer {
            id
            referenceName
            status
          }
          userErrors { message }
        }
      }
    `,
    {
      input: {
        name: input.name,
        origin: { locationId: input.originLocationId },
        destination: { locationId: input.destinationLocationId },
        lineItems: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
        })),
      },
    },
  );
  if (data.inventoryTransferCreate.userErrors.length) {
    throw new Error(data.inventoryTransferCreate.userErrors.map((error) => error.message).join("; "));
  }
  if (!data.inventoryTransferCreate.inventoryTransfer) {
    throw new Error("Échec de création du transfert Shopify.");
  }
  return data.inventoryTransferCreate.inventoryTransfer;
}

export async function getStockOnLocation(
  admin: AdminClient,
  inventoryItemIds: string[],
  locationId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(inventoryItemIds));
  const batchSize = 100;

  for (let i = 0; i < uniq.length; i += batchSize) {
    const batch = uniq.slice(i, i + batchSize);
    const data = await graphqlRequest<{
      nodes: Array<
        | {
            id: string;
            inventoryLevel?: { quantities?: Array<{ name: string; quantity: number }> } | null;
          }
        | null
      >;
    }>(
      admin,
      `#graphql
        query InventoryLevelsByIds($ids: [ID!]!, $locationId: ID!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              inventoryLevel(locationId: $locationId) {
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      `,
      { ids: batch, locationId },
    );

    for (const node of data.nodes) {
      if (!node?.id) continue;
      const qty =
        node.inventoryLevel?.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
      out.set(node.id, Number(qty));
    }
    for (const itemId of batch) {
      if (!out.has(itemId)) {
        out.set(itemId, 0);
      }
    }
  }
  return out;
}

export type InventoryItemSnapshot = {
  inventoryItemId: string;
  sku: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  imageAlt: string;
};

export async function getInventoryItemSnapshots(
  admin: AdminClient,
  inventoryItemIds: string[],
): Promise<Map<string, InventoryItemSnapshot>> {
  const result = new Map<string, InventoryItemSnapshot>();
  const uniq = Array.from(new Set(inventoryItemIds.filter(Boolean)));
  if (!uniq.length) return result;

  const batchSize = 100;
  for (let i = 0; i < uniq.length; i += batchSize) {
    const batch = uniq.slice(i, i + batchSize);
    const data = await graphqlRequest<{
      nodes: Array<
        | {
            id: string;
            sku: string | null;
            variant:
              | {
                  title: string | null;
                  image: { url: string; altText: string | null } | null;
                  product:
                    | {
                        title: string | null;
                        featuredImage: { url: string; altText: string | null } | null;
                      }
                    | null;
                }
              | null;
          }
        | null
      >;
    }>(
      admin,
      `#graphql
        query InventoryItemSnapshots($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              sku
              variant {
                title
                image { url altText }
                product {
                  title
                  featuredImage { url altText }
                }
              }
            }
          }
        }
      `,
      { ids: batch },
    );

    for (const node of data.nodes) {
      if (!node?.id) continue;
      const variantImage = node.variant?.image ?? null;
      const productImage = node.variant?.product?.featuredImage ?? null;
      const image = variantImage ?? productImage;
      result.set(node.id, {
        inventoryItemId: node.id,
        sku: node.sku ?? "",
        productTitle: node.variant?.product?.title ?? "",
        variantTitle: node.variant?.title ?? "",
        imageUrl: image?.url ?? "",
        imageAlt: image?.altText ?? "",
      });
    }
  }

  return result;
}

type InventoryAdjustQuantityName = "available" | "incoming";
type InventoryAdjustOptions = {
  quantityName?: InventoryAdjustQuantityName;
  referenceDocumentUri?: string;
};

function uniqueMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.map((msg) => msg.trim()).filter(Boolean)));
}

function resolveAdjustOptions(
  quantityOrOptions: InventoryAdjustQuantityName | InventoryAdjustOptions | undefined,
): Required<InventoryAdjustOptions> {
  if (!quantityOrOptions) {
    return { quantityName: "available", referenceDocumentUri: "" };
  }
  if (typeof quantityOrOptions === "string") {
    return { quantityName: quantityOrOptions, referenceDocumentUri: "" };
  }
  return {
    quantityName: quantityOrOptions.quantityName ?? "available",
    referenceDocumentUri: quantityOrOptions.referenceDocumentUri ?? "",
  };
}

function fallbackReferenceDocumentUri(): string {
  return `logistics://wearmoi/import-stock/${Date.now()}`;
}

export async function inventoryAdjustQuantities(
  admin: AdminClient,
  locationId: string,
  changes: Array<{ inventoryItemId: string; delta: number }>,
  quantityOrOptions?: InventoryAdjustQuantityName | InventoryAdjustOptions,
) {
  if (!changes.length) return;
  const options = resolveAdjustOptions(quantityOrOptions);
  const mustProvideReference = options.quantityName !== "available";
  const referenceDocumentUri =
    options.referenceDocumentUri || (mustProvideReference ? fallbackReferenceDocumentUri() : "");

  const data = await graphqlRequest<{
    inventoryAdjustQuantities: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { message }
        }
      }
    `,
    {
      input: {
        reason: "correction",
        name: options.quantityName,
        ...(referenceDocumentUri ? { referenceDocumentUri } : {}),
        changes: changes.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId,
          delta: c.delta,
          changeFromQuantity: null,
        })),
      },
    },
  );

  if (data.inventoryAdjustQuantities.userErrors.length) {
    const messages = uniqueMessages(data.inventoryAdjustQuantities.userErrors.map((e) => e.message));
    throw new Error(messages.join("; "));
  }
}

