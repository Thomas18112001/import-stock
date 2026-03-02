import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDeltas,
  canDeleteReceiptStatus,
  isDuplicateApplyStatus,
} from "../app/utils/stockOps";

test("aggregateDeltas additionne les deltas par SKU+inventoryItem", () => {
  const lines = [
    { sku: "ABBISRED", inventoryItemId: "gid://shopify/InventoryItem/1", delta: 10 },
    { sku: "ABBISRED", inventoryItemId: "gid://shopify/InventoryItem/1", delta: 5 },
    { sku: "ERINXSWHI", inventoryItemId: "gid://shopify/InventoryItem/2", delta: 3 },
  ];
  const aggregated = aggregateDeltas(lines);

  assert.equal(aggregated.length, 2);
  assert.equal(
    aggregated.find((line) => line.sku === "ABBISRED")?.delta,
    15,
  );
});

test("isDuplicateApplyStatus bloque un second apply", () => {
  assert.equal(isDuplicateApplyStatus("READY"), false);
  assert.equal(isDuplicateApplyStatus("APPLIED"), true);
  assert.equal(isDuplicateApplyStatus("BLOCKED"), true);
});

test("aggregateDeltas conserve les deltas negatifs (rollback vers stock negatif autorise)", () => {
  const lines = [
    { sku: "ABBISRED", inventoryItemId: "gid://shopify/InventoryItem/1", delta: -1 },
    { sku: "ABBISRED", inventoryItemId: "gid://shopify/InventoryItem/1", delta: 0 },
  ];
  const aggregated = aggregateDeltas(lines);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0]?.delta, -1);
});

test("canDeleteReceiptStatus interdit suppression apres application", () => {
  assert.equal(canDeleteReceiptStatus("IMPORTED"), true);
  assert.equal(canDeleteReceiptStatus("READY"), true);
  assert.equal(canDeleteReceiptStatus("APPLIED"), false);
});
