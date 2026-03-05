import test from "node:test";
import assert from "node:assert/strict";
import { resolveSkus, inventoryAdjustQuantities } from "../app/services/shopifyGraphql";
import { selectApplicableStockLines } from "../app/utils/stockValidation";
import { aggregateDeltas } from "../app/utils/stockOps";

test("happy path simule: resolution SKU -> apply stock sur la bonne boutique", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: options?.variables });
      if (query.includes("query ResolveSkus")) {
        return new Response(
          JSON.stringify({
            data: {
              productVariants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    title: "S",
                    sku: "ABBISRED",
                    product: { title: "Abbis" },
                    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                  },
                  {
                    id: "gid://shopify/ProductVariant/2",
                    title: "M",
                    sku: "ERINXSWHI",
                    product: { title: "Erinx" },
                    inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (query.includes("mutation Adjust")) {
        return new Response(
          JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [] } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };

  const resolved = await resolveSkus(admin, ["ABBISRED", "ERINXSWHI", "MISSING"]);
  const candidateLines = [
    {
      sku: "ABBISRED",
      qty: 15,
      status: "RESOLVED" as const,
      inventoryItemGid: resolved.get("ABBISRED")?.inventoryItemId ?? "",
    },
    {
      sku: "ERINXSWHI",
      qty: 3,
      status: "RESOLVED" as const,
      inventoryItemGid: resolved.get("ERINXSWHI")?.inventoryItemId ?? "",
    },
    {
      sku: "MISSING",
      qty: 2,
      status: "MISSING" as const,
      inventoryItemGid: "",
    },
  ];
  const applicable = selectApplicableStockLines(candidateLines, []);
  const deltas = aggregateDeltas(
    applicable.map((line) => ({
      sku: line.sku,
      inventoryItemId: line.inventoryItemGid,
      delta: line.qty,
    })),
  );

  await inventoryAdjustQuantities(
    admin,
    "gid://shopify/Location/999",
    deltas.map((line) => ({ inventoryItemId: line.inventoryItemId, delta: line.delta })),
  );

  const adjustCall = calls.find((call) => call.query.includes("mutation Adjust"));
  assert.ok(adjustCall);
  const input = (adjustCall?.variables?.input ?? {}) as {
    changes?: Array<{ locationId: string; inventoryItemId: string; delta: number }>;
  };
  assert.equal(input.changes?.length, 2);
  assert.deepEqual(
    input.changes?.map((c) => c.locationId),
    ["gid://shopify/Location/999", "gid://shopify/Location/999"],
  );
  assert.deepEqual(
    input.changes?.map((c) => c.delta),
    [15, 3],
  );
});

test("resolveSkus mappe un SKU même si la casse diffère entre Prestashop et Shopify", async () => {
  const admin = {
    graphql: async () =>
      new Response(
        JSON.stringify({
          data: {
            productVariants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/1",
                  title: "S",
                  sku: "ABBISRED",
                  product: { title: "Abbis" },
                  inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  };

  const resolved = await resolveSkus(admin, ["abbisred"]);
  assert.equal(resolved.get("abbisred")?.inventoryItemId, "gid://shopify/InventoryItem/1");
});

test("inventoryAdjustQuantities supporte le stock entrant (incoming)", async () => {
  let lastVariables: Record<string, unknown> | undefined;
  const admin = {
    graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
      lastVariables = options?.variables;
      return new Response(
        JSON.stringify({ data: { inventoryAdjustQuantities: { userErrors: [] } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  };

  await inventoryAdjustQuantities(
    admin,
    "gid://shopify/Location/1",
    [{ inventoryItemId: "gid://shopify/InventoryItem/1", delta: 4 }],
    "incoming",
  );

  const input = (lastVariables?.input ?? {}) as { name?: string };
  assert.equal(input.name, "incoming");
});
