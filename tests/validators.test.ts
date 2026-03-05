import test from "node:test";
import assert from "node:assert/strict";
import {
  isShopifyGid,
  isValidSku,
  normalizeSku,
  parsePositiveIntInput,
  sanitizeSearchQuery,
} from "../app/utils/validators";

test("parsePositiveIntInput valide uniquement les entiers positifs", () => {
  assert.equal(parsePositiveIntInput("1000500"), 1000500);
  assert.equal(parsePositiveIntInput("0"), null);
  assert.equal(parsePositiveIntInput("-1"), null);
  assert.equal(parsePositiveIntInput("abc"), null);
});

test("sanitizeSearchQuery supprime les caracteres risques", () => {
  const sanitized = sanitizeSearchQuery("1000500; DROP TABLE receipts --");
  assert.equal(sanitized.includes(";"), false);
  assert.equal(sanitized.includes("DROP"), true);
});

test("normalizeSku and isValidSku", () => {
  assert.equal(normalizeSku("  ABBISRED  "), "ABBISRED");
  assert.equal(isValidSku("ABBISRED"), true);
  assert.equal(isValidSku("BAD SKU"), true);
  assert.equal(isValidSku("BAD\nSKU"), false);
});

test("isShopifyGid verifie le format gid Shopify", () => {
  assert.equal(isShopifyGid("gid://shopify/Location/123456789"), true);
  assert.equal(isShopifyGid("gid://shopify/Metaobject/123"), true);
  assert.equal(isShopifyGid("Location/123"), false);
});
