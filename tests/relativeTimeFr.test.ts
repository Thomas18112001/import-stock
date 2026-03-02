import test from "node:test";
import assert from "node:assert/strict";
import { formatRelativeSyncFr } from "../app/utils/relativeTimeFr";

test("wording FR: format relatif synchronisation", () => {
  assert.equal(formatRelativeSyncFr(undefined), "Aucune synchronisation récente.");
  assert.equal(formatRelativeSyncFr("invalid-date"), "Aucune synchronisation récente.");
});

test("wording FR: affiche minutes/heures", () => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(formatRelativeSyncFr(thirtyMinAgo), "Il y a 30 min.");
  assert.equal(formatRelativeSyncFr(twoHoursAgo), "Il y a 2 h.");
});
