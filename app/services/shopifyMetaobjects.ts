import type { AdminClient } from "./auth.server";
import { graphqlRequest } from "./shopifyGraphql";
import { debugLog } from "../utils/debug";
import { parseScopes, REQUIRED_SHOPIFY_SCOPES } from "../config/shopifyScopes";
import { MissingShopifyScopeError, toMissingScopeError } from "../utils/shopifyScopeErrors";

export type MetaobjectField = { key: string; value: string };
export type MetaobjectNode = {
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
};

type DefField = {
  key: string;
  name: string;
  type: string;
  required?: boolean;
};

export type MetaTypes = {
  receipt: string;
  receiptLine: string;
  adjustment: string;
  adjustmentLine: string;
};

export type MetaobjectConnection = {
  nodes: MetaobjectNode[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
};

export type SyncState = {
  selectedLocationId: string;
  cursorByLocation: Record<string, number>;
  lastSyncAtByLocation: Record<string, string>;
};

type DefinitionTemplate = {
  key: keyof MetaTypes;
  suffix: "wm_receipt" | "wm_receipt_line" | "wm_adjustment" | "wm_adjustment_line";
  name: string;
  fields: DefField[];
};

const definitionTemplates: DefinitionTemplate[] = [
  {
    key: "receipt",
    suffix: "wm_receipt",
    name: "WearMoi Receipt",
    fields: [
      { key: "presta_order_id", name: "Presta Order ID", type: "single_line_text_field", required: true },
      { key: "presta_reference", name: "Presta Reference", type: "single_line_text_field" },
      { key: "presta_date_add", name: "Presta Date Add", type: "date_time" },
      { key: "presta_date_upd", name: "Presta Date Update", type: "date_time" },
      { key: "status", name: "Status", type: "single_line_text_field", required: true },
      { key: "location_id", name: "Location ID", type: "single_line_text_field" },
      { key: "skipped_skus", name: "Skipped SKUs", type: "multi_line_text_field" },
      { key: "errors", name: "Errors", type: "multi_line_text_field" },
      { key: "applied_adjustment_gid", name: "Applied Adjustment GID", type: "single_line_text_field" },
    ],
  },
  {
    key: "receiptLine",
    suffix: "wm_receipt_line",
    name: "WearMoi Receipt Line",
    fields: [
      { key: "receipt_gid", name: "Receipt GID", type: "single_line_text_field", required: true },
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "qty", name: "Qty", type: "number_integer", required: true },
      { key: "status", name: "Status", type: "single_line_text_field", required: true },
      { key: "inventory_item_gid", name: "Inventory Item GID", type: "single_line_text_field" },
      { key: "error", name: "Error", type: "single_line_text_field" },
    ],
  },
  {
    key: "adjustment",
    suffix: "wm_adjustment",
    name: "WearMoi Adjustment",
    fields: [
      { key: "receipt_gid", name: "Receipt GID", type: "single_line_text_field", required: true },
      { key: "location_id", name: "Location ID", type: "single_line_text_field", required: true },
      { key: "status", name: "Status", type: "single_line_text_field", required: true },
      { key: "applied_at", name: "Applied At", type: "date_time", required: true },
      { key: "rolled_back_at", name: "Rolled Back At", type: "date_time" },
    ],
  },
  {
    key: "adjustmentLine",
    suffix: "wm_adjustment_line",
    name: "WearMoi Adjustment Line",
    fields: [
      { key: "adjustment_gid", name: "Adjustment GID", type: "single_line_text_field", required: true },
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "qty_delta", name: "Qty Delta", type: "number_integer", required: true },
      { key: "inventory_item_gid", name: "Inventory Item GID", type: "single_line_text_field", required: true },
    ],
  },
];

let cachedMetaTypes: MetaTypes | null = null;
let loggedTypes = false;
const DEFINITION_CACHE_TTL_MS = 10 * 60 * 1000;
const definitionCacheByShop = new Map<string, { ok: boolean; checkedAt: number }>();

function mapNode(node: {
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): MetaobjectNode {
  return {
    id: node.id,
    handle: node.handle,
    type: node.type,
    updatedAt: node.updatedAt,
    fields: node.fields,
  };
}

function extractStableAppId(appGid: string): string {
  const last = appGid.split("/").pop() ?? "";
  const normalized = last.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!normalized) {
    throw new Error(`Unable to normalize app id from gid: ${appGid}`);
  }
  return normalized;
}

async function fetchStableAppId(admin: AdminClient): Promise<string> {
  const data = await graphqlRequest<{
    currentAppInstallation: { app: { id: string } | null } | null;
  }>(
    admin,
    `#graphql
      query CurrentAppInstallation {
        currentAppInstallation {
          app { id }
        }
      }
    `,
  );
  const appGid = data.currentAppInstallation?.app?.id;
  if (!appGid) {
    throw new Error("Unable to resolve current app installation id");
  }
  return extractStableAppId(appGid);
}

function buildAppReservedTypes(appId: string): MetaTypes {
  return {
    receipt: `app--${appId}--wm_receipt`,
    receiptLine: `app--${appId}--wm_receipt_line`,
    adjustment: `app--${appId}--wm_adjustment`,
    adjustmentLine: `app--${appId}--wm_adjustment_line`,
  };
}

export async function getMetaTypes(admin: AdminClient): Promise<MetaTypes> {
  if (cachedMetaTypes) {
    return cachedMetaTypes;
  }
  const stableAppId = await fetchStableAppId(admin);
  cachedMetaTypes = buildAppReservedTypes(stableAppId);
  if (!loggedTypes) {
    loggedTypes = true;
    console.info(
      `[metaobjects] using app-reserved types: ${cachedMetaTypes.receipt}, ${cachedMetaTypes.receiptLine}, ${cachedMetaTypes.adjustment}, ${cachedMetaTypes.adjustmentLine}`,
    );
  }
  return cachedMetaTypes;
}

export function fieldValue(node: MetaobjectNode, key: string): string {
  return node.fields.find((f) => f.key === key)?.value ?? "";
}

export async function ensureMetaobjectDefinitions(admin: AdminClient, shopDomain: string) {
  const cached = definitionCacheByShop.get(shopDomain);
  if (cached?.ok && Date.now() - cached.checkedAt < DEFINITION_CACHE_TTL_MS) {
    return;
  }

  const types = await getMetaTypes(admin);

  try {
    for (const template of definitionTemplates) {
      const type = types[template.key];
      const exists = await graphqlRequest<{ metaobjectDefinitionByType: { id: string } | null }>(
        admin,
        `#graphql
          query DefByType($type: String!) {
            metaobjectDefinitionByType(type: $type) { id }
          }
        `,
        { type },
      );
      if (exists.metaobjectDefinitionByType) continue;

      const created = await graphqlRequest<{
        metaobjectDefinitionCreate: { userErrors: Array<{ message: string }> };
      }>(
        admin,
        `#graphql
          mutation DefCreate($definition: MetaobjectDefinitionCreateInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              userErrors { message }
            }
          }
        `,
        {
          definition: {
            type,
            name: template.name,
            access: { admin: "MERCHANT_READ_WRITE" },
            fieldDefinitions: template.fields.map((f) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              required: Boolean(f.required),
            })),
          },
        },
      );
      if (created.metaobjectDefinitionCreate.userErrors.length) {
        throw new Error(
          `metaobjectDefinitionCreate ${type}: ${created.metaobjectDefinitionCreate.userErrors
            .map((e) => e.message)
            .join("; ")}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      debugLog("missing shopify scope", {
        shop: shopDomain,
        operation: error.operation,
        missingScope: error.missingScope,
        expectedScopes: REQUIRED_SHOPIFY_SCOPES.join(","),
        grantedScopes: parseScopes(process.env.SCOPES).join(","),
      });
      throw error;
    }
    const scopeError = toMissingScopeError(error, "ensureMetaobjectDefinitions");
    if (scopeError) {
      debugLog("missing shopify scope", {
        shop: shopDomain,
        operation: scopeError.operation,
        missingScope: scopeError.missingScope,
        expectedScopes: REQUIRED_SHOPIFY_SCOPES.join(","),
        grantedScopes: parseScopes(process.env.SCOPES).join(","),
      });
      throw scopeError;
    }
    throw error;
  }

  definitionCacheByShop.set(shopDomain, { ok: true, checkedAt: Date.now() });
}

export async function getMetaobjectByHandle(
  admin: AdminClient,
  type: string,
  handle: string,
): Promise<MetaobjectNode | null> {
  const data = await graphqlRequest<{
    metaobjectByHandle: {
      id: string;
      handle: string;
      type: string;
      updatedAt: string;
      fields: Array<{ key: string; value: string | null }>;
    } | null;
  }>(
    admin,
    `#graphql
      query MetaobjectByHandle($handle: MetaobjectHandleInput!) {
        metaobjectByHandle(handle: $handle) {
          id
          handle
          type
          updatedAt
          fields { key value }
        }
      }
    `,
    { handle: { type, handle } },
  );
  return data.metaobjectByHandle ? mapNode(data.metaobjectByHandle) : null;
}

export async function getMetaobjectById(
  admin: AdminClient,
  id: string,
): Promise<MetaobjectNode | null> {
  const data = await graphqlRequest<{
    metaobject: {
      id: string;
      handle: string;
      type: string;
      updatedAt: string;
      fields: Array<{ key: string; value: string | null }>;
    } | null;
  }>(
    admin,
    `#graphql
      query MetaobjectById($id: ID!) {
        metaobject(id: $id) {
          id
          handle
          type
          updatedAt
          fields { key value }
        }
      }
    `,
    { id },
  );
  return data.metaobject ? mapNode(data.metaobject) : null;
}

export async function listMetaobjects(admin: AdminClient, type: string): Promise<MetaobjectNode[]> {
  const connection = await listMetaobjectsConnection(admin, type, 250, null);
  return connection.nodes;
}

export async function listMetaobjectsConnection(
  admin: AdminClient,
  type: string,
  first: number,
  after: string | null,
): Promise<MetaobjectConnection> {
  const data = await graphqlRequest<{
    metaobjects: {
      nodes: Array<{
        id: string;
        handle: string;
        type: string;
        updatedAt: string;
        fields: Array<{ key: string; value: string | null }>;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    };
  }>(
    admin,
    `#graphql
      query MetaobjectsByType($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          nodes {
            id
            handle
            type
            updatedAt
            fields { key value }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `,
    { type, first, after },
  );
  return {
    nodes: data.metaobjects.nodes.map(mapNode),
    pageInfo: data.metaobjects.pageInfo,
  };
}

export async function getDashboardBundle(
  admin: AdminClient,
  receiptType: string,
  pageSize = 20,
  cursor: string | null = null,
) {
  const data = await graphqlRequest<{
    shop: {
      cursorByLocation: { value: string | null } | null;
      lastSyncByLocation: { value: string | null } | null;
      selectedLocation: { value: string | null } | null;
    };
    locations: {
      nodes: Array<{ id: string; name: string }>;
    };
    metaobjects: {
      nodes: Array<{
        id: string;
        handle: string;
        type: string;
        updatedAt: string;
        fields: Array<{ key: string; value: string | null }>;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
      };
    };
  }>(
    admin,
    `#graphql
      query DashboardBundle($receiptType: String!, $first: Int!, $after: String) {
        shop {
          cursorByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_presta_order_by_location") {
            value
          }
          lastSyncByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_sync_at_by_location") {
            value
          }
          selectedLocation: metafield(namespace: "wearmoi_stock_sync", key: "selected_location_id") {
            value
          }
        }
        locations(first: 100) {
          nodes { id name }
        }
        metaobjects(type: $receiptType, first: $first, after: $after) {
          nodes {
            id
            handle
            type
            updatedAt
            fields { key value }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    `,
    {
      receiptType,
      first: pageSize,
      after: cursor,
    },
  );
  const cursorByLocation = parseNumberMap(data.shop.cursorByLocation?.value);
  const lastSyncAtByLocation = parseStringMap(data.shop.lastSyncByLocation?.value);
  const selectedLocationId = data.shop.selectedLocation?.value ?? "";
  debugLog("dashboard sync state read", {
    selectedLocationId,
    cursorKeys: Object.keys(cursorByLocation).length,
    lastSyncKeys: Object.keys(lastSyncAtByLocation).length,
  });
  return {
    syncState: {
      selectedLocationId,
      cursorByLocation,
      lastSyncAtByLocation,
    },
    locations: data.locations.nodes,
    receipts: data.metaobjects.nodes.map(mapNode),
    pageInfo: data.metaobjects.pageInfo,
  };
}

function parseNumberMap(rawValue: string | null | undefined): Record<string, number> {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        out[key] = numeric;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseStringMap(rawValue: string | null | undefined): Record<string, string> {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function createMetaobject(
  admin: AdminClient,
  type: string,
  handle: string,
  fields: MetaobjectField[],
) {
  const data = await graphqlRequest<{
    metaobjectCreate: {
      metaobject: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id }
          userErrors { message }
        }
      }
    `,
    { metaobject: { type, handle, fields } },
  );
  if (data.metaobjectCreate.userErrors.length) {
    throw new Error(data.metaobjectCreate.userErrors.map((e) => e.message).join("; "));
  }
  if (!data.metaobjectCreate.metaobject) {
    throw new Error("metaobjectCreate returned null metaobject");
  }
  return data.metaobjectCreate.metaobject.id;
}

export async function updateMetaobject(
  admin: AdminClient,
  id: string,
  fields: MetaobjectField[],
) {
  const data = await graphqlRequest<{
    metaobjectUpdate: {
      metaobject: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { message }
        }
      }
    `,
    { id, metaobject: { fields } },
  );
  if (data.metaobjectUpdate.userErrors.length) {
    throw new Error(data.metaobjectUpdate.userErrors.map((e) => e.message).join("; "));
  }
}

export async function deleteMetaobject(admin: AdminClient, id: string): Promise<void> {
  const data = await graphqlRequest<{
    metaobjectDelete: {
      deletedId: string | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation MetaobjectDelete($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { message }
        }
      }
    `,
    { id },
  );
  if (data.metaobjectDelete.userErrors.length) {
    throw new Error(data.metaobjectDelete.userErrors.map((e) => e.message).join("; "));
  }
}

export async function upsertMetaobjectByHandle(
  admin: AdminClient,
  type: string,
  handle: string,
  fields: MetaobjectField[],
) {
  const existing = await getMetaobjectByHandle(admin, type, handle);
  if (!existing) {
    return createMetaobject(admin, type, handle, fields);
  }
  await updateMetaobject(admin, existing.id, fields);
  return existing.id;
}

export async function getLastPrestaOrderId(admin: AdminClient): Promise<number> {
  const data = await graphqlRequest<{
    shop: {
      metafield: { value: string | null } | null;
    };
  }>(
    admin,
    `#graphql
      query GetCursor {
        shop {
          metafield(namespace: "wearmoi_stock_sync", key: "last_presta_order_id") {
            value
          }
        }
      }
    `,
  );
  const raw = data.shop.metafield?.value ?? "0";
  const value = Number(raw);
  const parsed = Number.isFinite(value) ? value : 0;
  debugLog("cursor read", { raw, parsed });
  return parsed;
}

export async function setLastPrestaOrderId(admin: AdminClient, value: number): Promise<void> {
  const data = await graphqlRequest<{
    shop: { id: string };
  }>(
    admin,
    `#graphql
      query ShopId {
        shop { id }
      }
    `,
  );

  const result = await graphqlRequest<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation SetCursor($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { message }
        }
      }
    `,
    {
      metafields: [
        {
          ownerId: data.shop.id,
          namespace: "wearmoi_stock_sync",
          key: "last_presta_order_id",
          type: "single_line_text_field",
          value: String(value),
        },
      ],
    },
  );
  if (result.metafieldsSet.userErrors.length) {
    throw new Error(
      `Cursor write failed: ${result.metafieldsSet.userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  debugLog("cursor write", { next: value });
}

export async function getSyncState(admin: AdminClient): Promise<SyncState> {
  const data = await graphqlRequest<{
    shop: {
      cursorByLocation: { value: string | null } | null;
      lastSyncByLocation: { value: string | null } | null;
      selectedLocation: { value: string | null } | null;
    };
  }>(
    admin,
    `#graphql
      query GetSyncState {
        shop {
          cursorByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_presta_order_by_location") {
            value
          }
          lastSyncByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_sync_at_by_location") {
            value
          }
          selectedLocation: metafield(namespace: "wearmoi_stock_sync", key: "selected_location_id") {
            value
          }
        }
      }
    `,
  );
  return {
    selectedLocationId: data.shop.selectedLocation?.value ?? "",
    cursorByLocation: parseNumberMap(data.shop.cursorByLocation?.value),
    lastSyncAtByLocation: parseStringMap(data.shop.lastSyncByLocation?.value),
  };
}

export async function setSyncState(
  admin: AdminClient,
  input: {
    selectedLocationId?: string;
    cursorByLocation?: Record<string, number>;
    lastSyncAtByLocation?: Record<string, string>;
  },
): Promise<void> {
  const shopData = await graphqlRequest<{ shop: { id: string } }>(
    admin,
    `#graphql
      query ShopIdForSyncState {
        shop { id }
      }
    `,
  );
  const metafields: Array<{
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }> = [];
  if (typeof input.selectedLocationId === "string") {
    metafields.push({
      ownerId: shopData.shop.id,
      namespace: "wearmoi_stock_sync",
      key: "selected_location_id",
      type: "single_line_text_field",
      value: input.selectedLocationId,
    });
  }
  if (input.cursorByLocation) {
    metafields.push({
      ownerId: shopData.shop.id,
      namespace: "wearmoi_stock_sync",
      key: "last_presta_order_by_location",
      type: "multi_line_text_field",
      value: JSON.stringify(input.cursorByLocation),
    });
  }
  if (input.lastSyncAtByLocation) {
    metafields.push({
      ownerId: shopData.shop.id,
      namespace: "wearmoi_stock_sync",
      key: "last_sync_at_by_location",
      type: "multi_line_text_field",
      value: JSON.stringify(input.lastSyncAtByLocation),
    });
  }
  if (!metafields.length) return;

  const result = await graphqlRequest<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation SetSyncState($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { message }
        }
      }
    `,
    { metafields },
  );
  if (result.metafieldsSet.userErrors.length) {
    throw new Error(`Sync state write failed: ${result.metafieldsSet.userErrors.map((e) => e.message).join("; ")}`);
  }
}
