import test from "node:test";
import assert from "node:assert/strict";
import { isLocationLockedForReceipt } from "../app/utils/locationLock";

test("verrouillage boutique: import initial non verrouille", () => {
  assert.equal(isLocationLockedForReceipt("IMPORTED", ""), false);
});

test("verrouillage boutique: statut pret/bloque/applique verrouille", () => {
  assert.equal(isLocationLockedForReceipt("READY", ""), true);
  assert.equal(isLocationLockedForReceipt("BLOCKED", ""), true);
  assert.equal(isLocationLockedForReceipt("APPLIED", "gid://shopify/Location/1"), true);
});
