import test from "node:test";
import assert from "node:assert/strict";
import { selectApplicableStockLines } from "../app/utils/stockValidation";

test("selectApplicableStockLines keeps only resolved, positive, non-skipped lines", () => {
  const lines = [
    { sku: "ABBISRED", qty: 15, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/1" },
    { sku: "ERINXSWHI", qty: 3, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/2" },
    { sku: "MAGDMBUR", qty: 0, status: "RESOLVED", inventoryItemGid: "gid://shopify/InventoryItem/3" },
    { sku: "MISSING1", qty: 2, status: "MISSING", inventoryItemGid: "" },
  ] as const;

  const selected = selectApplicableStockLines([...lines], ["ERINXSWHI"]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.sku, "ABBISRED");
});
