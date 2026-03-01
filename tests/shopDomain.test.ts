import test from "node:test";
import assert from "node:assert/strict";
import { shopFromHostParam } from "../app/utils/shopDomain";

test("shopFromHostParam handles myshopify host payload", () => {
  const payload = Buffer.from("woora-app-2.myshopify.com", "utf8").toString("base64url");
  assert.equal(shopFromHostParam(payload), "woora-app-2.myshopify.com");
});

test("shopFromHostParam handles admin.shopify.com/store payload", () => {
  const payload = Buffer.from("admin.shopify.com/store/woora-app-2", "utf8").toString("base64url");
  assert.equal(shopFromHostParam(payload), "woora-app-2.myshopify.com");
});

test("shopFromHostParam returns null on invalid payload", () => {
  assert.equal(shopFromHostParam("not-base64"), null);
});

