import test from "node:test";
import assert from "node:assert/strict";
import { toShopifyDateTime } from "../app/utils/dateTime";

test("toShopifyDateTime converts Presta datetime format", () => {
  assert.equal(toShopifyDateTime("2026-02-26 16:59:35"), "2026-02-26T16:59:35");
});

test("toShopifyDateTime keeps already valid Shopify datetime", () => {
  assert.equal(toShopifyDateTime("2026-02-26T16:59:35"), "2026-02-26T16:59:35");
});

test("toShopifyDateTime returns null on invalid input", () => {
  assert.equal(toShopifyDateTime("invalid"), null);
});
