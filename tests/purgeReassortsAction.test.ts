import test from "node:test";
import assert from "node:assert/strict";

function ensureDebugPurgeReassortsEnv(): void {
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

async function loadRoute() {
  ensureDebugPurgeReassortsEnv();
  return import("../app/routes/actions.debug.purgePurchaseOrders");
}

test("debug purge réassorts redirige vers login sans session", async () => {
  const route = await loadRoute();
  const form = new FormData();
  form.set("destinationLocationId", "invalid");
  const request = new Request("https://app.test/actions/debug/purger-reassorts", {
    method: "POST",
    body: form,
  });

  let response: Response;
  try {
    const result = await route.action({
      request,
      params: {},
    } as never);
    response = result as Response;
  } catch (thrown) {
    response = thrown as Response;
  }

  assert.equal(response.status, 302);
  assert.match(String(response.headers.get("Location") || ""), /auth\/login/i);
});
