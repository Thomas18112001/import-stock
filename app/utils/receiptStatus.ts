export function canApplyFromStatus(status: string): boolean {
  return status === "READY";
}

export function canAdjustSkuFromStatus(status: string): boolean {
  return status !== "APPLIED";
}

export function canRetirerStockFromStatus(status: string): boolean {
  return status === "APPLIED";
}

export function skuAdjustLockedMessage(): string {
  return "Le stock a déjà été ajouté. Les SKU ne peuvent plus être modifiés. Utilisez « Retirer le stock » si vous devez corriger.";
}
