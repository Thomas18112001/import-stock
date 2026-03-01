import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeReceiptIdFromUrl,
  encodeReceiptIdForUrl,
} from "../app/utils/receiptId";

test("encode/decode receipt gid roundtrip", () => {
  const gid = "gid://shopify/Metaobject/123456789";
  const encoded = encodeReceiptIdForUrl(gid);
  const decoded = decodeReceiptIdFromUrl(encoded);
  assert.equal(decoded, gid);
});

test("encodeReceiptIdForUrl avoids double-encoding", () => {
  const gid = "gid://shopify/Metaobject/123456789";
  const once = encodeReceiptIdForUrl(gid);
  const twice = encodeReceiptIdForUrl(once);
  assert.equal(twice, once);
});

test("decodeReceiptIdFromUrl throws on invalid input", () => {
  assert.throws(() => decodeReceiptIdFromUrl("%E0%A4%A"), /invalide/i);
});
