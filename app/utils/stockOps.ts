import { canApplyFromStatus } from "./receiptStatus";

export type DeltaLine = {
  sku: string;
  inventoryItemId: string;
  delta: number;
};

export type JournalLine = {
  sku: string;
  inventoryItemId: string;
  qtyDelta: number;
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

export function invertJournalDeltas(lines: JournalLine[]): DeltaLine[] {
  return aggregateDeltas(
    lines.map((line) => ({
      sku: line.sku,
      inventoryItemId: line.inventoryItemId,
      delta: -line.qtyDelta,
    })),
  );
}

export function isDuplicateApplyStatus(status: string): boolean {
  return !canApplyFromStatus(status);
}

export function canDeleteReceiptStatus(status: string): boolean {
  return status !== "APPLIED";
}
