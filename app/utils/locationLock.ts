export function isLocationLockedForReceipt(status: string, locationId: string): boolean {
  if (locationId.trim()) return true;
  return status !== "IMPORTED";
}

export function assertReceiptLocationMatch(receiptLocationId: string, requestedLocationId: string): void {
  const lockedLocationId = receiptLocationId.trim();
  if (!lockedLocationId) return;
  if (lockedLocationId !== requestedLocationId.trim()) {
    throw new Error("La boutique est verrouillée pour cette réception.");
  }
}


