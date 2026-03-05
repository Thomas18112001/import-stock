import test from "node:test";
import assert from "node:assert/strict";
import {
  canAdjustSkuFromStatus,
  canApplyFromStatus,
  canReceiveFromStatus,
  canRetirerStockFromStatus,
  skuAdjustLockedMessage,
} from "../app/utils/receiptStatus";

test("canApplyFromStatus allows apply only from READY", () => {
  assert.equal(canApplyFromStatus("READY"), true);
  assert.equal(canApplyFromStatus("IMPORTED"), false);
  assert.equal(canApplyFromStatus("BLOCKED"), false);
  assert.equal(canApplyFromStatus("INCOMING"), false);
  assert.equal(canApplyFromStatus("APPLIED"), false);
  assert.equal(canApplyFromStatus("ROLLED_BACK"), false);
});

test("canReceiveFromStatus allows receive only from INCOMING", () => {
  assert.equal(canReceiveFromStatus("INCOMING"), true);
  assert.equal(canReceiveFromStatus("READY"), false);
  assert.equal(canReceiveFromStatus("APPLIED"), false);
});

test("Ajuster les SKU est refusé quand la réception est INCOMING ou APPLIED", () => {
  assert.equal(canAdjustSkuFromStatus("INCOMING"), false);
  assert.equal(canAdjustSkuFromStatus("APPLIED"), false);
  assert.equal(canAdjustSkuFromStatus("READY"), true);
  assert.equal(
    skuAdjustLockedMessage(),
    "La réception est déjà en cours d'arrivage ou validée. Les SKU ne peuvent plus être modifiés.",
  );
});

test("Après APPLIED, seule l'action Retirer le stock reste autorisée", () => {
  assert.equal(canApplyFromStatus("APPLIED"), false);
  assert.equal(canRetirerStockFromStatus("APPLIED"), true);
  assert.equal(canRetirerStockFromStatus("INCOMING"), false);
  assert.equal(canRetirerStockFromStatus("READY"), false);
});
