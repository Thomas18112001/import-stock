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
  purchaseOrder: string;
  purchaseOrderLine: string;
  purchaseOrderAudit: string;
  auditLog: string;
  thresholdGlobal: string;
  thresholdOverride: string;
  salesAgg: string;
  alertConfig: string;
  alertEvent: string;
  supplier: string;
  supplierSku: string;
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
  prestaCheckpointByLocation: Record<string, { dateUpd: string; orderId: number }>;
};

type DefinitionTemplate = {
  key: keyof MetaTypes;
  suffix:
    | "wm_receipt"
    | "wm_receipt_line"
    | "wm_adjustment"
    | "wm_adjustment_line"
    | "wm_purchase_order"
    | "wm_purchase_order_line"
    | "wm_purchase_order_audit"
    | "wm_audit_log"
    | "wm_threshold_global"
    | "wm_threshold_override"
    | "wm_sales_agg"
    | "wm_alert_config"
    | "wm_alert_event"
    | "wm_supplier"
    | "wm_supplier_sku";
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
  {
    key: "purchaseOrder",
    suffix: "wm_purchase_order",
    name: "WearMoi Purchase Order",
    fields: [
      { key: "number", name: "Number", type: "single_line_text_field", required: true },
      { key: "issued_at", name: "Issued At", type: "date_time", required: true },
      { key: "expected_arrival_at", name: "Expected Arrival At", type: "date_time" },
      { key: "supplier_name", name: "Supplier Name", type: "single_line_text_field", required: true },
      { key: "supplier_address", name: "Supplier Address", type: "multi_line_text_field" },
      { key: "ship_to_name", name: "Ship To Name", type: "single_line_text_field" },
      { key: "ship_to_address", name: "Ship To Address", type: "multi_line_text_field" },
      { key: "bill_to_name", name: "Bill To Name", type: "single_line_text_field" },
      { key: "bill_to_address", name: "Bill To Address", type: "multi_line_text_field" },
      { key: "currency", name: "Currency", type: "single_line_text_field", required: true },
      { key: "payment_terms", name: "Payment Terms", type: "single_line_text_field" },
      { key: "reference_number", name: "Reference Number", type: "single_line_text_field" },
      { key: "supplier_notes", name: "Supplier Notes", type: "multi_line_text_field" },
      { key: "internal_notes", name: "Internal Notes", type: "multi_line_text_field" },
      { key: "status", name: "Status", type: "single_line_text_field", required: true },
      { key: "destination_location_id", name: "Destination Location ID", type: "single_line_text_field", required: true },
      { key: "created_by", name: "Created By", type: "single_line_text_field" },
      { key: "shopify_transfer_id", name: "Shopify Transfer ID", type: "single_line_text_field" },
      { key: "shopify_transfer_admin_url", name: "Shopify Transfer Admin URL", type: "single_line_text_field" },
      { key: "totals_snapshot", name: "Totals Snapshot", type: "multi_line_text_field" },
      { key: "line_count", name: "Line Count", type: "number_integer" },
      { key: "subtotal_ht", name: "Subtotal HT", type: "number_decimal" },
      { key: "tax_total", name: "Tax Total", type: "number_decimal" },
      { key: "total_ttc", name: "Total TTC", type: "number_decimal" },
    ],
  },
  {
    key: "purchaseOrderLine",
    suffix: "wm_purchase_order_line",
    name: "WearMoi Purchase Order Line",
    fields: [
      { key: "purchase_order_gid", name: "Purchase Order GID", type: "single_line_text_field", required: true },
      { key: "shopify_variant_id", name: "Shopify Variant ID", type: "single_line_text_field", required: true },
      { key: "inventory_item_gid", name: "Inventory Item GID", type: "single_line_text_field", required: true },
      { key: "product_title", name: "Product Title", type: "single_line_text_field" },
      { key: "variant_title", name: "Variant Title", type: "single_line_text_field" },
      { key: "sku", name: "SKU", type: "single_line_text_field" },
      { key: "supplier_sku", name: "Supplier SKU", type: "single_line_text_field" },
      { key: "image_url", name: "Image URL", type: "single_line_text_field" },
      { key: "quantity_ordered", name: "Quantity Ordered", type: "number_integer", required: true },
      { key: "quantity_received", name: "Quantity Received", type: "number_integer", required: true },
      { key: "unit_cost", name: "Unit Cost HT", type: "number_decimal", required: true },
      { key: "tax_rate", name: "Tax Rate", type: "number_decimal", required: true },
      { key: "line_total_ht", name: "Line Total HT", type: "number_decimal", required: true },
      { key: "line_tax_amount", name: "Line Tax Amount", type: "number_decimal", required: true },
      { key: "line_total_ttc", name: "Line Total TTC", type: "number_decimal", required: true },
    ],
  },
  {
    key: "purchaseOrderAudit",
    suffix: "wm_purchase_order_audit",
    name: "WearMoi Purchase Order Audit",
    fields: [
      { key: "purchase_order_gid", name: "Purchase Order GID", type: "single_line_text_field", required: true },
      { key: "action", name: "Action", type: "single_line_text_field", required: true },
      { key: "actor", name: "Actor", type: "single_line_text_field", required: true },
      { key: "payload", name: "Payload", type: "multi_line_text_field" },
      { key: "created_at", name: "Created At", type: "date_time", required: true },
    ],
  },
  {
    key: "auditLog",
    suffix: "wm_audit_log",
    name: "WearMoi Audit Log",
    fields: [
      { key: "event_type", name: "Event Type", type: "single_line_text_field", required: true },
      { key: "entity_type", name: "Entity Type", type: "single_line_text_field", required: true },
      { key: "entity_id", name: "Entity ID", type: "single_line_text_field" },
      { key: "location_id", name: "Location ID", type: "single_line_text_field" },
      { key: "presta_order_id", name: "Presta Order ID", type: "number_integer" },
      { key: "status", name: "Status", type: "single_line_text_field" },
      { key: "message", name: "Message", type: "single_line_text_field" },
      { key: "payload", name: "Payload", type: "multi_line_text_field" },
      { key: "actor", name: "Actor", type: "single_line_text_field" },
      { key: "created_at", name: "Created At", type: "date_time", required: true },
    ],
  },
  {
    key: "thresholdGlobal",
    suffix: "wm_threshold_global",
    name: "WearMoi Threshold Global",
    fields: [
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "min_qty", name: "Min Qty", type: "number_integer" },
      { key: "max_qty", name: "Max Qty", type: "number_integer" },
      { key: "safety_stock", name: "Safety Stock", type: "number_integer" },
      { key: "target_coverage_days", name: "Target Coverage Days", type: "number_integer" },
      { key: "updated_by", name: "Updated By", type: "single_line_text_field" },
      { key: "notes", name: "Notes", type: "multi_line_text_field" },
    ],
  },
  {
    key: "thresholdOverride",
    suffix: "wm_threshold_override",
    name: "WearMoi Threshold Override",
    fields: [
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "location_id", name: "Location ID", type: "single_line_text_field", required: true },
      { key: "min_qty", name: "Min Qty", type: "number_integer" },
      { key: "max_qty", name: "Max Qty", type: "number_integer" },
      { key: "safety_stock", name: "Safety Stock", type: "number_integer" },
      { key: "target_coverage_days", name: "Target Coverage Days", type: "number_integer" },
      { key: "updated_by", name: "Updated By", type: "single_line_text_field" },
      { key: "notes", name: "Notes", type: "multi_line_text_field" },
    ],
  },
  {
    key: "salesAgg",
    suffix: "wm_sales_agg",
    name: "WearMoi Sales Aggregation",
    fields: [
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "location_id", name: "Location ID", type: "single_line_text_field", required: true },
      { key: "range_days", name: "Range Days", type: "number_integer", required: true },
      { key: "total_sold", name: "Total Sold", type: "number_integer", required: true },
      { key: "avg_daily_sales", name: "Avg Daily Sales", type: "number_decimal", required: true },
      { key: "window_start_at", name: "Window Start At", type: "date_time", required: true },
      { key: "window_end_at", name: "Window End At", type: "date_time", required: true },
      { key: "sales_last_at", name: "Sales Last At", type: "date_time" },
      { key: "source", name: "Source", type: "single_line_text_field" },
      { key: "payload", name: "Payload", type: "multi_line_text_field" },
    ],
  },
  {
    key: "alertConfig",
    suffix: "wm_alert_config",
    name: "WearMoi Alert Config",
    fields: [
      { key: "frequency", name: "Frequency", type: "single_line_text_field" },
      { key: "emails", name: "Emails", type: "multi_line_text_field" },
      { key: "enabled_types", name: "Enabled Types", type: "multi_line_text_field" },
      { key: "stockout_soon_days", name: "Stockout Soon Days", type: "number_integer" },
      { key: "updated_by", name: "Updated By", type: "single_line_text_field" },
      { key: "updated_at", name: "Updated At", type: "date_time" },
    ],
  },
  {
    key: "alertEvent",
    suffix: "wm_alert_event",
    name: "WearMoi Alert Event",
    fields: [
      { key: "dedup_key", name: "Dedup Key", type: "single_line_text_field", required: true },
      { key: "type", name: "Type", type: "single_line_text_field", required: true },
      { key: "status", name: "Status", type: "single_line_text_field", required: true },
      { key: "severity", name: "Severity", type: "single_line_text_field", required: true },
      { key: "location_id", name: "Location ID", type: "single_line_text_field" },
      { key: "sku", name: "SKU", type: "single_line_text_field" },
      { key: "message", name: "Message", type: "single_line_text_field" },
      { key: "payload", name: "Payload", type: "multi_line_text_field" },
      { key: "first_triggered_at", name: "First Triggered At", type: "date_time", required: true },
      { key: "last_triggered_at", name: "Last Triggered At", type: "date_time", required: true },
      { key: "resolved_at", name: "Resolved At", type: "date_time" },
    ],
  },
  {
    key: "supplier",
    suffix: "wm_supplier",
    name: "WearMoi Supplier",
    fields: [
      { key: "name", name: "Name", type: "single_line_text_field", required: true },
      { key: "email", name: "Email", type: "single_line_text_field" },
      { key: "lead_time_days", name: "Lead Time Days", type: "number_integer" },
      { key: "notes", name: "Notes", type: "multi_line_text_field" },
      { key: "active", name: "Active", type: "single_line_text_field" },
    ],
  },
  {
    key: "supplierSku",
    suffix: "wm_supplier_sku",
    name: "WearMoi Supplier SKU",
    fields: [
      { key: "supplier_handle", name: "Supplier Handle", type: "single_line_text_field", required: true },
      { key: "sku", name: "SKU", type: "single_line_text_field", required: true },
      { key: "lead_time_days_override", name: "Lead Time Days Override", type: "number_integer" },
      { key: "notes", name: "Notes", type: "multi_line_text_field" },
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
    purchaseOrder: `app--${appId}--wm_purchase_order`,
    purchaseOrderLine: `app--${appId}--wm_purchase_order_line`,
    purchaseOrderAudit: `app--${appId}--wm_purchase_order_audit`,
    auditLog: `app--${appId}--wm_audit_log`,
    thresholdGlobal: `app--${appId}--wm_threshold_global`,
    thresholdOverride: `app--${appId}--wm_threshold_override`,
    salesAgg: `app--${appId}--wm_sales_agg`,
    alertConfig: `app--${appId}--wm_alert_config`,
    alertEvent: `app--${appId}--wm_alert_event`,
    supplier: `app--${appId}--wm_supplier`,
    supplierSku: `app--${appId}--wm_supplier_sku`,
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
      `[metaobjects] using app-reserved types: ${cachedMetaTypes.receipt}, ${cachedMetaTypes.receiptLine}, ${cachedMetaTypes.adjustment}, ${cachedMetaTypes.adjustmentLine}, ${cachedMetaTypes.purchaseOrder}, ${cachedMetaTypes.purchaseOrderLine}, ${cachedMetaTypes.purchaseOrderAudit}, ${cachedMetaTypes.auditLog}, ${cachedMetaTypes.thresholdGlobal}, ${cachedMetaTypes.thresholdOverride}, ${cachedMetaTypes.salesAgg}, ${cachedMetaTypes.alertConfig}, ${cachedMetaTypes.alertEvent}, ${cachedMetaTypes.supplier}, ${cachedMetaTypes.supplierSku}`,
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
  const nodes: MetaobjectNode[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();
  let pages = 0;
  const maxPages = 200;
  while (pages < maxPages) {
    const connection = await listMetaobjectsConnection(admin, type, 250, after);
    nodes.push(...connection.nodes);
    pages += 1;
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    if (seenCursors.has(connection.pageInfo.endCursor)) {
      debugLog("metaobjects pagination cursor loop", {
        type,
        pages,
        nodes: nodes.length,
        cursor: connection.pageInfo.endCursor,
      });
      break;
    }
    seenCursors.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
  }
  if (pages >= maxPages) {
    debugLog("metaobjects pagination capped", { type, pages, maxPages, nodes: nodes.length });
  }
  return nodes;
}

export async function listMetaobjectsConnection(
  admin: AdminClient,
  type: string,
  first: number,
  after: string | null,
  query?: string | null,
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
      query MetaobjectsByType($type: String!, $first: Int!, $after: String, $query: String) {
        metaobjects(type: $type, first: $first, after: $after, query: $query) {
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
    { type, first, after, query: query ?? null },
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
      checkpointByLocation: { value: string | null } | null;
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
          checkpointByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_presta_checkpoint_by_location") {
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
  const prestaCheckpointByLocation = parseCheckpointMap(data.shop.checkpointByLocation?.value);
  const selectedLocationId = data.shop.selectedLocation?.value ?? "";
  debugLog("dashboard sync state read", {
    selectedLocationId,
    cursorKeys: Object.keys(cursorByLocation).length,
    lastSyncKeys: Object.keys(lastSyncAtByLocation).length,
    checkpointKeys: Object.keys(prestaCheckpointByLocation).length,
  });
  return {
    syncState: {
      selectedLocationId,
      cursorByLocation,
      lastSyncAtByLocation,
      prestaCheckpointByLocation,
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

function parseCheckpointMap(
  rawValue: string | null | undefined,
): Record<string, { dateUpd: string; orderId: number }> {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const out: Record<string, { dateUpd: string; orderId: number }> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const dateUpd = String((value as { dateUpd?: unknown }).dateUpd ?? "").trim();
      const orderId = Number((value as { orderId?: unknown }).orderId ?? NaN);
      if (!dateUpd) continue;
      if (!Number.isInteger(orderId) || orderId < 0) continue;
      out[key] = { dateUpd, orderId };
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

export async function getShopMetafieldValue(
  admin: AdminClient,
  namespace: string,
  key: string,
): Promise<string | null> {
  const data = await graphqlRequest<{
    shop: {
      metafield: { value: string | null } | null;
    };
  }>(
    admin,
    `#graphql
      query GetShopMetafield($namespace: String!, $key: String!) {
        shop {
          metafield(namespace: $namespace, key: $key) {
            value
          }
        }
      }
    `,
    { namespace, key },
  );
  return data.shop.metafield?.value ?? null;
}

export async function setShopMetafields(
  admin: AdminClient,
  input: Array<{
    namespace: string;
    key: string;
    type: string;
    value: string;
  }>,
): Promise<void> {
  if (!input.length) return;
  const shopData = await graphqlRequest<{ shop: { id: string } }>(
    admin,
    `#graphql
      query ShopIdForSetMetafields {
        shop { id }
      }
    `,
  );
  const metafields = input.map((field) => ({
    ownerId: shopData.shop.id,
    namespace: field.namespace,
    key: field.key,
    type: field.type,
    value: field.value,
  }));
  const result = await graphqlRequest<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation SetShopMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { message }
        }
      }
    `,
    { metafields },
  );
  if (result.metafieldsSet.userErrors.length) {
    throw new Error(result.metafieldsSet.userErrors.map((error) => error.message).join("; "));
  }
}

export async function getLastPrestaOrderId(admin: AdminClient): Promise<number> {
  const raw = (await getShopMetafieldValue(admin, "wearmoi_stock_sync", "last_presta_order_id")) ?? "0";
  const value = Number(raw);
  const parsed = Number.isFinite(value) ? value : 0;
  debugLog("cursor read", { raw, parsed });
  return parsed;
}

export async function setLastPrestaOrderId(admin: AdminClient, value: number): Promise<void> {
  await setShopMetafields(admin, [
    {
      namespace: "wearmoi_stock_sync",
      key: "last_presta_order_id",
      type: "single_line_text_field",
      value: String(value),
    },
  ]);
  debugLog("cursor write", { next: value });
}

export async function getSyncState(admin: AdminClient): Promise<SyncState> {
  const data = await graphqlRequest<{
    shop: {
      cursorByLocation: { value: string | null } | null;
      lastSyncByLocation: { value: string | null } | null;
      checkpointByLocation: { value: string | null } | null;
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
          checkpointByLocation: metafield(namespace: "wearmoi_stock_sync", key: "last_presta_checkpoint_by_location") {
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
    prestaCheckpointByLocation: parseCheckpointMap(data.shop.checkpointByLocation?.value),
  };
}

export async function setSyncState(
  admin: AdminClient,
  input: {
    selectedLocationId?: string;
    cursorByLocation?: Record<string, number>;
    lastSyncAtByLocation?: Record<string, string>;
    prestaCheckpointByLocation?: Record<string, { dateUpd: string; orderId: number }>;
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
  if (input.prestaCheckpointByLocation) {
    metafields.push({
      ownerId: shopData.shop.id,
      namespace: "wearmoi_stock_sync",
      key: "last_presta_checkpoint_by_location",
      type: "multi_line_text_field",
      value: JSON.stringify(input.prestaCheckpointByLocation),
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
