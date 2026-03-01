import test from "node:test";
import assert from "node:assert/strict";
import {
  canAdjustSkuFromStatus,
  canApplyFromStatus,
  canRetirerStockFromStatus,
  skuAdjustLockedMessage,
} from "../app/utils/receiptStatus";

test("canApplyFromStatus allows apply only from READY", () => {
  assert.equal(canApplyFromStatus("READY"), true);
  assert.equal(canApplyFromStatus("IMPORTED"), false);
  assert.equal(canApplyFromStatus("BLOCKED"), false);
  assert.equal(canApplyFromStatus("APPLIED"), false);
  assert.equal(canApplyFromStatus("ROLLED_BACK"), false);
});

test("Ajuster les SKU est refusé quand la réception est APPLIED", () => {
  assert.equal(canAdjustSkuFromStatus("APPLIED"), false);
  assert.equal(canAdjustSkuFromStatus("READY"), true);
  assert.equal(
    skuAdjustLockedMessage(),
    "Le stock a déjà été ajouté. Les SKU ne peuvent plus être modifiés. Utilisez « Retirer le stock » si vous devez corriger.",
  );
});

test("Après APPLIED, seule l'action Retirer le stock reste autorisée", () => {
  assert.equal(canApplyFromStatus("APPLIED"), false);
  assert.equal(canRetirerStockFromStatus("APPLIED"), true);
  assert.equal(canRetirerStockFromStatus("READY"), false);
});
