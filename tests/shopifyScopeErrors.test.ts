import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMissingScopeFromErrorMessage,
  toMissingScopeError,
} from "../app/utils/shopifyScopeErrors";

test("detectMissingScopeFromErrorMessage detects read_metaobject_definitions", () => {
  const message =
    "Access denied for metaobjectDefinitionByType field. Required access: `read_metaobject_definitions` access scope.";
  assert.equal(detectMissingScopeFromErrorMessage(message), "read_metaobject_definitions");
});

test("toMissingScopeError converts access denied into UX-safe scope error", () => {
  const message =
    "Access denied for metaobjectDefinitionByType field. Required access: `read_metaobject_definitions` access scope.";
  const converted = toMissingScopeError(new Error(message), "ensureMetaobjectDefinitions");
  assert.equal(converted?.missingScope, "read_metaobject_definitions");
  assert.match(converted?.message ?? "", /Autorisation manquante/i);
});

