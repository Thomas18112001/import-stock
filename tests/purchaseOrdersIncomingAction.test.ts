import test from "node:test";
import assert from "node:assert/strict";

function ensurePurchaseOrdersActionEnv(): void {
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

async function loadIncomingActionRoute() {
  ensurePurchaseOrdersActionEnv();
  return import("../app/routes/actions.purchase-orders.$purchaseOrderGid.validate-transfer");
}

test("API mettre-en-cours-d-arrivage renvoie 400 si id manquant", async () => {
  const route = await loadIncomingActionRoute();
  const response = await route.action({
    request: new Request("https://app.test/actions/reassorts-magasin//mettre-en-cours-d-arrivage", {
      method: "POST",
    }),
    params: {},
  } as never);

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(String(body.error || ""), /identifiant/i);
});

test("API mettre-en-cours-d-arrivage renvoie 400 si id invalide", async () => {
  const route = await loadIncomingActionRoute();
  const response = await route.action({
    request: new Request("https://app.test/actions/reassorts-magasin/invalid/mettre-en-cours-d-arrivage", {
      method: "POST",
    }),
    params: { purchaseOrderGid: "%E0%A4%A" },
  } as never);

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(String(body.error || ""), /invalide/i);
});
