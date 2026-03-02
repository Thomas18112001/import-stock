import test from "node:test";
import assert from "node:assert/strict";

function ensurePrestaEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_ALLOWED_HOST = process.env.PRESTA_ALLOWED_HOST || "btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
}

test("tentative d'endpoint non autorise => refus", async () => {
  ensurePrestaEnv();
  const { assertAllowedPrestaPath } = await import("../app/services/prestaClient");
  assert.throws(() => assertAllowedPrestaPath("/api/customers"), /not allowed/i);
});

test("tentative de path traversal / URL injection => refus", async () => {
  ensurePrestaEnv();
  const { assertAllowedPrestaPath } = await import("../app/services/prestaClient");
  assert.throws(() => assertAllowedPrestaPath("/api/orders/12/../../etc/passwd"), /not allowed/i);
  assert.throws(() => assertAllowedPrestaPath("/api/orders/http://evil"), /not allowed/i);
});

test("listOrders bloque les parametres invalides sans appel reseau", async () => {
  ensurePrestaEnv();
  const { listOrders } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof global.fetch;

  await assert.rejects(
    () =>
      listOrders({
        customerId: 21749,
        sinceId: 0,
        offset: 0,
        limit: 9999,
      }),
    /invalid limit/i,
  );
  assert.equal(called, false);
  global.fetch = originalFetch;
});

test("reponse Prestashop trop volumineuse => erreur neutre", async () => {
  ensurePrestaEnv();
  const { listOrders } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  const hugeXml = `<prestashop>${"x".repeat(1_200_000)}</prestashop>`;
  global.fetch = (async () =>
    new Response(hugeXml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    })) as typeof global.fetch;

  await assert.rejects(
    () =>
      listOrders({
        customerId: 21749,
        sinceId: 0,
        offset: 0,
        limit: 1,
      }),
    /Réponse Prestashop invalide/i,
  );
  global.fetch = originalFetch;
});
