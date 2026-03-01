import test from "node:test";
import assert from "node:assert/strict";
import { filterReceiptsForSelectedLocation } from "../app/utils/receiptFilters";

test("filtrage boutique: Chicago n'inclut pas les imports legacy sans location", () => {
  const receipts = [
    { locationId: "gid://shopify/Location/toulon" },
    { locationId: "gid://shopify/Location/chicago" },
    { locationId: "" },
  ];
  const filtered = filterReceiptsForSelectedLocation(receipts, "gid://shopify/Location/chicago", false);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].locationId, "gid://shopify/Location/chicago");
});

test("filtrage boutique: Toulon peut inclure les imports legacy sans location", () => {
  const receipts = [
    { locationId: "gid://shopify/Location/toulon" },
    { locationId: "gid://shopify/Location/chicago" },
    { locationId: "" },
  ];
  const filtered = filterReceiptsForSelectedLocation(receipts, "gid://shopify/Location/toulon", true);
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filtered.map((r) => r.locationId),
    ["gid://shopify/Location/toulon", ""],
  );
});
