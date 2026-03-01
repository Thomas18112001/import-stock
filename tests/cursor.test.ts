import test from "node:test";
import assert from "node:assert/strict";
import { resolveLatestCursor } from "../app/utils/cursor";

test("resolveLatestCursor keeps current for invalid candidate", () => {
  assert.equal(resolveLatestCursor(100, undefined), 100);
  assert.equal(resolveLatestCursor(100, -1), 100);
});

test("resolveLatestCursor returns max cursor", () => {
  assert.equal(resolveLatestCursor(100, 150), 150);
  assert.equal(resolveLatestCursor(200, 150), 200);
});
