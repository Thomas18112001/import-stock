import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertReceiptLocationMatch } from "../app/utils/locationLock";
import { canApplyFromStatus, canAdjustSkuFromStatus } from "../app/utils/receiptStatus";
import { findExistingReceiptByOrder, isStrictDuplicateForOrder } from "../app/utils/receiptUniqueness";
import { canDeleteReceiptStatus } from "../app/utils/stockOps";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("apply cible uniquement la location verrouillée", () => {
  assert.doesNotThrow(() =>
    assertReceiptLocationMatch("gid://shopify/Location/123", "gid://shopify/Location/123"),
  );
  assert.throws(
    () => assertReceiptLocationMatch("gid://shopify/Location/123", "gid://shopify/Location/999"),
    /verrouillée/i,
  );
});

test("anti doublon import + anti double apply", () => {
  const receipts = [{ gid: "gid://shopify/Metaobject/1", prestaOrderId: 1001, prestaReference: "REF-1001" }];
  const duplicate = findExistingReceiptByOrder(receipts, 1001, "REF-1001");
  assert.equal(duplicate?.duplicateBy, "id");
  assert.equal(isStrictDuplicateForOrder(duplicate, 1001), true);

  assert.equal(canApplyFromStatus("READY"), true);
  assert.equal(canApplyFromStatus("INCOMING"), false);
  assert.equal(canApplyFromStatus("APPLIED"), false);
});

test("persistance boutique entre pages: selectedLocationId prioritaire", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");

  assert.match(dashboardSource, /data\.syncState\.selectedLocationId/);
  assert.match(receiptsSource, /syncState\.selectedLocationId/);
});

test("Ajuster les SKU impossible si EN ARRIVAGE/APPLIQUÉE: UI + backend guard", () => {
  assert.equal(canAdjustSkuFromStatus("INCOMING"), false);
  assert.equal(canAdjustSkuFromStatus("APPLIED"), false);

  const detailSource = readFile("app/routes/app.receipts.$receiptIdEnc.tsx");
  const serviceSource = readFile("app/services/receiptService.ts");
  assert.match(detailSource, /showDiagnosticCard/);
  assert.match(detailSource, /disabled=\{!canAdjustSku\}/);
  assert.match(serviceSource, /if \(!canAdjustSkuFromStatus\(receipt\.status\)\)/);
});

test("suppression import impossible si EN ARRIVAGE/APPLIQUÉE avec message FR", () => {
  assert.equal(canDeleteReceiptStatus("INCOMING"), false);
  assert.equal(canDeleteReceiptStatus("APPLIED"), false);
  const source = readFile("app/services/receiptService.ts");
  assert.match(source, /Impossible de supprimer une réception avec un flux de stock en cours ou appliqué/);
});

test("navigation 'Ouvrir' vers le détail réception", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");
  assert.match(dashboardSource, /\/produits-en-reception\/\$\{receiptIdEnc\}/);
  assert.match(receiptsSource, /\/produits-en-reception\/\$\{receiptIdEnc\}/);
});
