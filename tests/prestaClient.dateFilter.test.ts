import test from "node:test";
import assert from "node:assert/strict";

test("listOrders supporte filter date_upd avec borne min/max", async () => {
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
    return new Response(`<prestashop><orders></orders></prestashop>`, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }) as typeof global.fetch;

  try {
    await listOrders({
      customerId: 21749,
      updatedAtMin: "2026-03-01 00:00:00",
      updatedAtMax: "2026-03-01 12:00:00",
      offset: 0,
      limit: 10,
      sortKey: "date_upd",
      sortDirection: "ASC",
    });
  } finally {
    global.fetch = originalFetch;
  }

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("date"), "1");
  assert.equal(url.searchParams.get("filter[date_upd]"), "[2026-03-01 00:00:00,2026-03-01 12:00:00]");
  assert.equal(url.searchParams.get("sort"), "[date_upd_ASC]");
});
