import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("garde-fou: suppression réception bloquée si réassort lié", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "app/services/receiptService.ts"),
    "utf8",
  );

  assert.match(source, /hasRestockLinkedToReceipt/);
  assert.match(source, /Supprimez le réassort d'abord/i);
});
