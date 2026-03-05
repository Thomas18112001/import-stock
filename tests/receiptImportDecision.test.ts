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

test("collision de reference n'empeche pas import par ID", async () => {
  ensureCoreEnv();
  const { classifyExistingReceiptForImport } = await import("../app/services/receiptService");
  const result = classifyExistingReceiptForImport(
    {
      duplicateBy: "reference",
      receipt: { prestaOrderId: 1001 },
    },
    2002,
  );
  assert.equal(result, "reference_collision_non_blocking");
});

test("duplicate by id reste bloquant", async () => {
  ensureCoreEnv();
  const { classifyExistingReceiptForImport } = await import("../app/services/receiptService");
  const result = classifyExistingReceiptForImport(
    {
      duplicateBy: "id",
      receipt: { prestaOrderId: 1001 },
    },
    1001,
  );
  assert.equal(result, "duplicate_by_id");
});
