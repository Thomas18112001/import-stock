import type { AdminClient } from "./auth.server";
import { toMissingScopeError } from "../utils/shopifyScopeErrors";

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

export async function resolveSkus(
  admin: AdminClient,
  skus: string[],
): Promise<Map<string, { variantId: string; inventoryItemId: string; variantTitle: string }>> {
  const uniq = Array.from(new Set(skus.map((s) => s.trim()).filter(Boolean)));
  const result = new Map<string, { variantId: string; inventoryItemId: string; variantTitle: string }>();
  for (let i = 0; i < uniq.length; i += 20) {
    const batch = uniq.slice(i, i + 20);
    const queryString = batch.map((sku) => `sku:${sku.replace(/"/g, '\\"')}`).join(" OR ");
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
        result.set(node.sku, {
          variantId: node.id,
          inventoryItemId: node.inventoryItem.id,
          variantTitle,
        });
      }
    }
  }
  return result;
}

export async function getStockOnLocation(
  admin: AdminClient,
  inventoryItemIds: string[],
  locationId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(inventoryItemIds));
  for (const itemId of uniq) {
    const data = await graphqlRequest<{
      inventoryItem: {
        id: string;
        inventoryLevel?: { quantities?: Array<{ name: string; quantity: number }> } | null;
      } | null;
    }>(
      admin,
      `#graphql
        query InventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
          inventoryItem(id: $inventoryItemId) {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      `,
      { inventoryItemId: itemId, locationId },
    );
    const qty =
      data.inventoryItem?.inventoryLevel?.quantities?.find((q) => q.name === "available")
        ?.quantity ?? 0;
    out.set(itemId, Number(qty));
  }
  return out;
}

export async function inventoryAdjustQuantities(
  admin: AdminClient,
  locationId: string,
  changes: Array<{ inventoryItemId: string; delta: number }>,
) {
  if (!changes.length) return;
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
        name: "available",
        changes: changes.map((c) => ({
          inventoryItemId: c.inventoryItemId,
          locationId,
          delta: c.delta,
        })),
      },
    },
  );

  if (data.inventoryAdjustQuantities.userErrors.length) {
    throw new Error(data.inventoryAdjustQuantities.userErrors.map((e) => e.message).join("; "));
  }
}
