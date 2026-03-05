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

test("cursor bootstrap keeps stored cursor when already initialized", async () => {
  ensureCoreEnv();
  const { resolveCursorBootstrap } = await import("../app/services/receiptService");
  const result = resolveCursorBootstrap({
    hasStoredCursor: true,
    currentCursor: 1500,
    legacyGlobalCursor: 9999,
    receiptsCursor: 8888,
    latestPrestaHeadCursor: 7777,
  });
  assert.deepEqual(result, { cursor: 1500, source: "none" });
});

test("cursor bootstrap migrates from legacy global cursor first", async () => {
  ensureCoreEnv();
  const { resolveCursorBootstrap } = await import("../app/services/receiptService");
  const result = resolveCursorBootstrap({
    hasStoredCursor: false,
    currentCursor: 0,
    legacyGlobalCursor: 4200,
    receiptsCursor: 3100,
    latestPrestaHeadCursor: 9000,
  });
  assert.deepEqual(result, { cursor: 4200, source: "legacy_global_cursor" });
});

test("cursor bootstrap prioritizes Presta head before existing receipts", async () => {
  ensureCoreEnv();
  const { resolveCursorBootstrap } = await import("../app/services/receiptService");
  const fromHead = resolveCursorBootstrap({
    hasStoredCursor: false,
    currentCursor: 0,
    legacyGlobalCursor: 0,
    receiptsCursor: 3100,
    latestPrestaHeadCursor: 9000,
  });
  assert.deepEqual(fromHead, { cursor: 9000, source: "latest_presta_head" });

  const fromReceipts = resolveCursorBootstrap({
    hasStoredCursor: false,
    currentCursor: 0,
    legacyGlobalCursor: 0,
    receiptsCursor: 3100,
    latestPrestaHeadCursor: 0,
  });
  assert.deepEqual(fromReceipts, { cursor: 3100, source: "existing_receipts" });
});

test("checkpoint bootstrap is enabled only when checkpoint is missing/empty", async () => {
  ensureCoreEnv();
  const { isCheckpointStaleForBootstrap, shouldBootstrapCheckpoint } = await import("../app/services/receiptService");
  assert.equal(
    shouldBootstrapCheckpoint(false, { dateUpd: "2026-03-04 10:00:00", orderId: 123 }),
    true,
  );
  assert.equal(
    shouldBootstrapCheckpoint(true, { dateUpd: "1970-01-01 00:00:00", orderId: 0 }),
    true,
  );
  assert.equal(
    shouldBootstrapCheckpoint(true, { dateUpd: "2026-03-04 10:00:00", orderId: 123 }),
    false,
  );
  assert.equal(
    isCheckpointStaleForBootstrap(
      { dateUpd: "2020-01-01 00:00:00", orderId: 1 },
      "2026-03-04 10:00:00",
      30,
    ),
    true,
  );
  assert.equal(
    isCheckpointStaleForBootstrap(
      { dateUpd: "2026-03-04 09:45:00", orderId: 1 },
      "2026-03-04 10:00:00",
      30,
    ),
    false,
  );
});
