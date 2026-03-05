import test from "node:test";
import assert from "node:assert/strict";
import {
  comparePrestaCheckpoint,
  computeCheckpointLookbackStart,
  formatPrestaDateTime,
  isOrderAfterCheckpoint,
  normalizePrestaCheckpoint,
} from "../app/utils/prestaCheckpoint";

test("comparePrestaCheckpoint uses date then id", () => {
  assert.equal(
    comparePrestaCheckpoint(
      { dateUpd: "2026-03-01 10:00:00", orderId: 100 },
      { dateUpd: "2026-03-01 10:00:00", orderId: 101 },
    ) < 0,
    true,
  );
  assert.equal(
    comparePrestaCheckpoint(
      { dateUpd: "2026-03-01 11:00:00", orderId: 1 },
      { dateUpd: "2026-03-01 10:59:59", orderId: 999999 },
    ) > 0,
    true,
  );
});

test("computeCheckpointLookbackStart subtracts minutes", () => {
  const start = computeCheckpointLookbackStart({ dateUpd: "2026-03-01 10:00:00", orderId: 100 }, 60);
  assert.equal(start, "2026-03-01 09:00:00");
});

test("isOrderAfterCheckpoint respects tuple ordering", () => {
  const checkpoint = { dateUpd: "2026-03-01 10:00:00", orderId: 100 };
  assert.equal(isOrderAfterCheckpoint("2026-03-01 10:00:00", 100, checkpoint), false);
  assert.equal(isOrderAfterCheckpoint("2026-03-01 10:00:00", 101, checkpoint), true);
  assert.equal(isOrderAfterCheckpoint("2026-03-01 09:59:59", 999, checkpoint), false);
});

test("normalizePrestaCheckpoint falls back for invalid input", () => {
  assert.deepEqual(normalizePrestaCheckpoint({ dateUpd: "bad", orderId: -1 }), {
    dateUpd: "1970-01-01 00:00:00",
    orderId: 0,
  });
});

test("formatPrestaDateTime outputs canonical UTC format", () => {
  const value = formatPrestaDateTime(new Date("2026-03-01T10:05:06.000Z"));
  assert.equal(value, "2026-03-01 10:05:06");
});
