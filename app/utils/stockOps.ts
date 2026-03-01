import { canApplyFromStatus } from "./receiptStatus";

export type DeltaLine = {
  sku: string;
  inventoryItemId: string;
  delta: number;
};

export function aggregateDeltas(lines: DeltaLine[]): DeltaLine[] {
  const aggregated = new Map<string, DeltaLine>();
  for (const line of lines) {
    const key = `${line.inventoryItemId}::${line.sku}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.delta += line.delta;
      continue;
    }
    aggregated.set(key, { ...line });
  }
  return [...aggregated.values()].filter((line) => line.delta !== 0);
}

export function isDuplicateApplyStatus(status: string): boolean {
  return !canApplyFromStatus(status);
}

export function canDeleteReceiptStatus(status: string): boolean {
  return status !== "APPLIED";
}

export function findNegativeRollbackSkus(
  currentByInventoryItemId: Map<string, number>,
  rollbackLines: Array<{ sku: string; inventoryItemId: string; delta: number }>,
): string[] {
  return rollbackLines
    .filter((line) => (currentByInventoryItemId.get(line.inventoryItemId) ?? 0) + line.delta < 0)
    .map((line) => line.sku);
}
