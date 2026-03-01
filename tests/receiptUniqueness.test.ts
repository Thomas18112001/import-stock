import test from "node:test";
import assert from "node:assert/strict";
import { findExistingReceiptByOrder, isStrictDuplicateForOrder } from "../app/utils/receiptUniqueness";

const fixtures = [
  { gid: "gid://shopify/Metaobject/1", prestaOrderId: 1000500, prestaReference: "REF-1000500" },
  { gid: "gid://shopify/Metaobject/2", prestaOrderId: 1000501, prestaReference: "REF-1000501" },
];

test("findExistingReceiptByOrder matches duplicate by presta id first", () => {
  const result = findExistingReceiptByOrder(fixtures, 1000500, "OTHER-REF");
  assert.equal(result?.duplicateBy, "id");
  assert.equal(result?.receipt.gid, "gid://shopify/Metaobject/1");
});

test("findExistingReceiptByOrder matches duplicate by presta reference", () => {
  const result = findExistingReceiptByOrder(fixtures, 9999999, "REF-1000501");
  assert.equal(result?.duplicateBy, "reference");
  assert.equal(result?.receipt.gid, "gid://shopify/Metaobject/2");
});

test("findExistingReceiptByOrder returns null when no duplicate", () => {
  const result = findExistingReceiptByOrder(fixtures, 2000000, "REF-2000000");
  assert.equal(result, null);
});

test("second import of same presta id is refused (duplicate guard)", () => {
  const firstImport = findExistingReceiptByOrder(fixtures, 1000500, "REF-1000500");
  assert.equal(firstImport?.duplicateBy, "id");
  assert.equal(Boolean(firstImport), true);
});

test("reference collision with different presta id is not a strict duplicate", () => {
  const collision = findExistingReceiptByOrder(fixtures, 9999999, "REF-1000501");
  assert.equal(collision?.duplicateBy, "reference");
  assert.equal(isStrictDuplicateForOrder(collision, 9999999), false);
});
