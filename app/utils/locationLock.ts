export function isLocationLockedForReceipt(status: string, locationId: string): boolean {
  if (locationId.trim()) return true;
  return status !== "IMPORTED";
}
