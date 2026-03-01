import test from "node:test";
import assert from "node:assert/strict";

async function loadCronGuard() {
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
  return import("../app/services/cron-guard.server");
}

test("cron secret accepte le header X-CRON-SECRET", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const request = new Request("https://example.com/api/cron/sync", {
    headers: { "X-CRON-SECRET": "top-secret" },
  });

  assert.doesNotThrow(() => assertCronSecret(request, "top-secret"));
});

test("cron secret accepte la query cron_secret", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const request = new Request("https://example.com/api/cron/sync?cron_secret=top-secret");

  assert.doesNotThrow(() => assertCronSecret(request, "top-secret"));
});

test("cron secret refuse un secret absent ou invalide", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const missing = new Request("https://example.com/api/cron/sync");
  const wrong = new Request("https://example.com/api/cron/sync", {
    headers: { "X-CRON-SECRET": "wrong" },
  });

  assert.throws(
    () => assertCronSecret(missing, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
  assert.throws(
    () => assertCronSecret(wrong, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});
