import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMissingPrestaConfigMessage,
  canSyncLocation,
  getBoutiqueMappingByLocationName,
} from "../app/config/boutiques";

test("mapping boutique Prestashop: Toulon configurée", () => {
  const mapping = getBoutiqueMappingByLocationName("Boutique Toulon");
  assert.equal(mapping?.prestaCustomerId, 21749);
  assert.equal(canSyncLocation("Boutique Toulon"), true);
});

test("mapping boutique Prestashop: Chicago non configurée", () => {
  const mapping = getBoutiqueMappingByLocationName("Boutique Chicago");
  assert.equal(mapping?.prestaCustomerId, null);
  assert.equal(canSyncLocation("Boutique Chicago"), false);
  assert.equal(
    buildMissingPrestaConfigMessage("Boutique Chicago"),
    `La boutique "Boutique Chicago" n'est pas encore configurée pour Prestashop BtoB. Configurez l'identifiant client avant de synchroniser.`,
  );
});
