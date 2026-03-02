import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inventoryAdjustQuantities } from "../app/services/shopifyGraphql";
import { assertReceiptLocationMatch } from "../app/utils/locationLock";
import { invertJournalDeltas } from "../app/utils/stockOps";
import { selectApplicableStockLines } from "../app/utils/stockValidation";

test("Apply n'affecte que les SKU valides de la reception", async () => {
  let appliedChanges: Array<{ locationId: string; inventoryItemId: string; delta: number }> = [];
  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      if (query.includes("mutation Adjust")) {
        appliedChanges = (
          options?.variables as { input?: { changes?: Array<{ locationId: string; inventoryItemId: string; delta: number }> } }
        )?.input?.changes ?? [];
        return new Response(
          JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [] } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    },
  };

  const selected = selectApplicableStockLines(
    [
      { sku: "A-1", qty: 3, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/1" },
      { sku: "A-2", qty: 2, status: "MISSING", inventoryItemGid: "gid://shopify/InventoryItem/2" },
      { sku: "A-3", qty: 0, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/3" },
      { sku: "A-4", qty: 5, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/4" },
    ],
    ["A-4"],
  );

  await inventoryAdjustQuantities(
    admin,
    "gid://shopify/Location/10",
    selected.map((line) => ({ inventoryItemId: line.inventoryItemGid, delta: line.qty })),
  );

  assert.equal(appliedChanges.length, 1);
  assert.equal(appliedChanges[0]?.inventoryItemId, "gid://shopify/InventoryItem/1");
  assert.equal(appliedChanges[0]?.delta, 3);
});

test("Rollback applique l'inverse exact des deltas, y compris vers stock negatif", () => {
  const initial = -1;
  const afterApply = initial + 1;
  const rollbackDeltas = invertJournalDeltas([
    { sku: "NEG-1", inventoryItemId: "gid://shopify/InventoryItem/99", qtyDelta: 1 },
  ]);
  const afterRollback = afterApply + rollbackDeltas[0]!.delta;

  assert.equal(afterApply, 0);
  assert.equal(rollbackDeltas[0]?.delta, -1);
  assert.equal(afterRollback, -1);
});

test("Verrouillage boutique: serveur refuse un changement de location sur une reception", () => {
  assert.doesNotThrow(() =>
    assertReceiptLocationMatch("gid://shopify/Location/1", "gid://shopify/Location/1"),
  );
  assert.throws(
    () => assertReceiptLocationMatch("gid://shopify/Location/1", "gid://shopify/Location/2"),
    /verrouill/i,
  );
});

test("Verrouillage boutique: UI detail reception garde le select desactive", () => {
  const filePath = path.resolve(process.cwd(), "app/routes/app.receipts.$receiptIdEnc.tsx");
  const source = fs.readFileSync(filePath, "utf8");
  assert.match(source, /label="Sélectionner la boutique"/);
  assert.match(source, /disabled/);
});

function ensureAuthEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test-key";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test-secret";
  process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.test";
  process.env.SCOPES =
    process.env.SCOPES ||
    "read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_locations,read_products,read_inventory,write_inventory";
}

test("Endpoints sensibles refusent sans session Shopify", async () => {
  ensureAuthEnv();
  const syncRoute = await import("../app/routes/actions.sync");
  const applyRoute = await import("../app/routes/actions.receipts.$receiptGid.apply");

  await assert.rejects(
    () =>
      syncRoute.action({
        request: new Request("https://app.test/actions/sync", { method: "POST" }),
      } as never),
    (error: unknown) => error instanceof Response,
  );

  await assert.rejects(
    () =>
      applyRoute.action({
        request: new Request("https://app.test/actions/receipts/test/apply", { method: "POST" }),
        params: { receiptGid: encodeURIComponent("gid://shopify/Metaobject/1") },
      } as never),
    (error: unknown) => error instanceof Response,
  );
});
