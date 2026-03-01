import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_SHOPIFY_SCOPES, parseScopes, resolveAuthScopes } from "../app/config/shopifyScopes";

test("resolveAuthScopes falls back to required scopes when SCOPES is empty", () => {
  const resolved = resolveAuthScopes("");
  assert.deepEqual(resolved, [...REQUIRED_SHOPIFY_SCOPES]);
});

test("resolveAuthScopes keeps explicit scopes from env", () => {
  const resolved = resolveAuthScopes("read_metaobjects,write_metaobjects");
  assert.deepEqual(resolved, ["read_metaobjects", "write_metaobjects"]);
});

test("parseScopes trims and filters empty values", () => {
  const parsed = parseScopes(" read_metaobjects, ,write_metaobjects  ");
  assert.deepEqual(parsed, ["read_metaobjects", "write_metaobjects"]);
});
