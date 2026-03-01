export type StockLineInput = {
  sku: string;
  qty: number;
  status: "RESOLVED" | "MISSING" | "SKIPPED";
  inventoryItemGid: string;
};

export function selectApplicableStockLines(
  lines: StockLineInput[],
  skippedSkus: string[],
): StockLineInput[] {
  const skipped = new Set(skippedSkus);
  return lines.filter(
    (line) =>
      line.status === "RESOLVED" &&
      !skipped.has(line.sku) &&
      line.qty > 0 &&
      Boolean(line.inventoryItemGid),
  );
}
