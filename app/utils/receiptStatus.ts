export function canApplyFromStatus(status: string): boolean {
  return status === "READY";
}

export function canAdjustSkuFromStatus(status: string): boolean {
  return status !== "APPLIED" && status !== "INCOMING";
}

export function canReceiveFromStatus(status: string): boolean {
  return status === "INCOMING";
}

export function canRetirerStockFromStatus(status: string): boolean {
  return status === "APPLIED";
}

export function skuAdjustLockedMessage(): string {
  return "La réception est déjà en cours d'arrivage ou validée. Les SKU ne peuvent plus être modifiés.";
}


