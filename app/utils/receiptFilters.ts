type ReceiptWithLocation = {
  locationId: string;
};

export function filterReceiptsForSelectedLocation<T extends ReceiptWithLocation>(
  receipts: T[],
  selectedLocationId: string,
  includeLegacyUnassigned: boolean,
): T[] {
  if (!selectedLocationId) return receipts;
  return receipts.filter((receipt) => {
    if (receipt.locationId === selectedLocationId) return true;
    if (includeLegacyUnassigned && !receipt.locationId) return true;
    return false;
  });
}
