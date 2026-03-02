import test from "node:test";
import assert from "node:assert/strict";
import { assertReceiptLocationMatch, isLocationLockedForReceipt } from "../app/utils/locationLock";

test("verrouillage boutique: import initial non verrouille", () => {
  assert.equal(isLocationLockedForReceipt("IMPORTED", ""), false);
});

test("verrouillage boutique: statut pret/bloque/applique verrouille", () => {
  assert.equal(isLocationLockedForReceipt("READY", ""), true);
  assert.equal(isLocationLockedForReceipt("BLOCKED", ""), true);
  assert.equal(isLocationLockedForReceipt("APPLIED", "gid://shopify/Location/1"), true);
});

test("verrouillage boutique: garde serveur location match", () => {
  assert.doesNotThrow(() =>
    assertReceiptLocationMatch("gid://shopify/Location/1", "gid://shopify/Location/1"),
  );
  assert.throws(
    () => assertReceiptLocationMatch("gid://shopify/Location/1", "gid://shopify/Location/2"),
    /verrouill/i,
  );
});
