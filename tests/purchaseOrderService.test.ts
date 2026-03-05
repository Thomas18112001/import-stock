import test from "node:test";
import assert from "node:assert/strict";

import { computePurchaseOrderTotals } from "../app/services/purchaseOrderService";

test("computePurchaseOrderTotals additionne et arrondit correctement", () => {
  const totals = computePurchaseOrderTotals([
    { lineTotalHt: 10.005, lineTaxAmount: 2.001, lineTotalTtc: 12.006 },
    { lineTotalHt: 19.994, lineTaxAmount: 3.998, lineTotalTtc: 23.992 },
  ]);

  assert.deepEqual(totals, {
    subtotalHt: 30,
    taxTotal: 6,
    totalTtc: 36,
  });
});
