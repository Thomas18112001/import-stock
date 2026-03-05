import test from "node:test";
import assert from "node:assert/strict";

function ensurePdfRouteEnv(): void {
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

async function loadPdfRouteModule() {
  ensurePdfRouteEnv();
  return import("../app/routes/api.reassorts.$restockId.pdf");
}

test("resolveRestockGidFromParam accepte gid natif et id encodé", async () => {
  const mod = await loadPdfRouteModule();
  const { encodeReceiptIdForUrl } = await import("../app/utils/receiptId");
  const gid = "gid://shopify/Metaobject/12345";
  const encoded = encodeReceiptIdForUrl(gid);

  assert.equal(mod.resolveRestockGidFromParam(gid), gid);
  assert.equal(mod.resolveRestockGidFromParam(encoded), gid);
});

test("resolveRestockGidFromParam rejette les ids invalides", async () => {
  const mod = await loadPdfRouteModule();
  assert.throws(() => mod.resolveRestockGidFromParam(""), (error: unknown) => {
    return error instanceof Response && error.status === 400;
  });
  assert.throws(() => mod.resolveRestockGidFromParam("invalid-id"), (error: unknown) => {
    return error instanceof Response && error.status === 400;
  });
});

test("buildReassortPdfResponse force le téléchargement en attachment", async () => {
  const mod = await loadPdfRouteModule();
  const response = mod.buildReassortPdfResponse({
    filename: "RS-2026-0001.pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.match(String(response.headers.get("Content-Disposition") || ""), /attachment; filename="RS-2026-0001.pdf"/i);
});
