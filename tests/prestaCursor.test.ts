import test from "node:test";
import assert from "node:assert/strict";

function ensureCoreEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_ALLOWED_HOST = process.env.PRESTA_ALLOWED_HOST || "btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
}

test("computePrestaSinceId keeps cursor when valid", async () => {
  ensureCoreEnv();
  const { computePrestaSinceId } = await import("../app/services/receiptService");
  assert.equal(computePrestaSinceId(1000), 1000);
});

test("computePrestaSinceId handles invalid cursor", async () => {
  ensureCoreEnv();
  const { computePrestaSinceId } = await import("../app/services/receiptService");
  assert.equal(computePrestaSinceId(NaN), 0);
  assert.equal(computePrestaSinceId(-1), 0);
});

test("date pass ignores orders older than or equal to cursor", async () => {
  ensureCoreEnv();
  const { isOrderOlderThanOrEqualCursor } = await import("../app/services/receiptService");
  assert.equal(isOrderOlderThanOrEqualCursor(100, 100), true);
  assert.equal(isOrderOlderThanOrEqualCursor(99, 100), true);
  assert.equal(isOrderOlderThanOrEqualCursor(101, 100), false);
});

test("resolveManualSyncDayRange validates and formats a day filter", async () => {
  ensureCoreEnv();
  const { resolveManualSyncDayRange } = await import("../app/services/receiptService");
  const range = resolveManualSyncDayRange("2026-03-04");
  assert.deepEqual(range, {
    day: "2026-03-04",
    updatedAtMin: "2026-03-04 00:00:00",
    updatedAtMax: "2026-03-04 23:59:59",
  });
});

test("resolveManualSyncDayRange rejects invalid values", async () => {
  ensureCoreEnv();
  const { resolveManualSyncDayRange } = await import("../app/services/receiptService");
  assert.equal(resolveManualSyncDayRange(""), null);
  assert.throws(() => resolveManualSyncDayRange("2026-13-40"));
  assert.throws(() => resolveManualSyncDayRange("04/03/2026"));
});
