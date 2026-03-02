import test from "node:test";
import assert from "node:assert/strict";
import { assertManualSyncRateLimit } from "../app/services/manual-sync-guard.server";

test("manual sync guard bloque deux refresh trop rapproches", () => {
  const shop = "woora-app-2.myshopify.com";
  assert.doesNotThrow(() => assertManualSyncRateLimit(shop));
  assert.throws(
    () => assertManualSyncRateLimit(shop),
    /Synchronisation trop fréquente/,
  );
});
