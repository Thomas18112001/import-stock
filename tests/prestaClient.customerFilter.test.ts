import test from "node:test";
import assert from "node:assert/strict";

test("sync utilise le bon id_customer selon la boutique selectionnee", async () => {
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
  const { listOrders } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      `<prestashop><orders><order><id>100</id><id_customer>99999</id_customer><reference>REF</reference><date_add>2026-01-01 10:00:00</date_add><date_upd>2026-01-01 10:00:00</date_upd></order></orders></prestashop>`,
      { status: 200, headers: { "Content-Type": "application/xml" } },
    );
  }) as typeof global.fetch;

  try {
    await listOrders({ customerId: 99999, sinceId: 0, offset: 0, limit: 10 });
  } finally {
    global.fetch = originalFetch;
  }

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("filter[id_customer]"), "[99999]");
});
