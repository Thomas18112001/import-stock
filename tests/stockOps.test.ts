import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDeltas,
  canDeleteReceiptStatus,
  findNegativeRollbackSkus,
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

test("findNegativeRollbackSkus detecte les SKU qui passeraient en negatif", () => {
  const current = new Map<string, number>([
    ["gid://shopify/InventoryItem/1", 4],
    ["gid://shopify/InventoryItem/2", 0],
  ]);
  const rollbackLines = [
    { sku: "ABBISRED", inventoryItemId: "gid://shopify/InventoryItem/1", delta: -2 },
    { sku: "ERINXSWHI", inventoryItemId: "gid://shopify/InventoryItem/2", delta: -1 },
  ];
  const negativeSkus = findNegativeRollbackSkus(current, rollbackLines);
  assert.deepEqual(negativeSkus, ["ERINXSWHI"]);
});

test("canDeleteReceiptStatus interdit suppression apres application", () => {
  assert.equal(canDeleteReceiptStatus("IMPORTED"), true);
  assert.equal(canDeleteReceiptStatus("READY"), true);
  assert.equal(canDeleteReceiptStatus("APPLIED"), false);
});
