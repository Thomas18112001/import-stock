export type ReceiptIdentity = {
  gid: string;
  prestaOrderId: number;
  prestaReference: string;
};

export function findExistingReceiptByOrder<T extends ReceiptIdentity>(
  receipts: T[],
  orderId: number,
  orderReference: string,
): { receipt: T; duplicateBy: "id" | "reference" } | null {
  const byId = receipts.find((receipt) => receipt.prestaOrderId === orderId);
  if (byId) {
    return { receipt: byId, duplicateBy: "id" };
  }

  const normalizedReference = orderReference.trim();
  if (!normalizedReference) {
    return null;
  }

  const byReference = receipts.find(
    (receipt) => receipt.prestaReference.trim() === normalizedReference,
  );
  if (byReference) {
    return { receipt: byReference, duplicateBy: "reference" };
  }

  return null;
}

export function isStrictDuplicateForOrder<T extends ReceiptIdentity>(
  existing: { receipt: T; duplicateBy: "id" | "reference" } | null,
  orderId: number,
): boolean {
  if (!existing) return false;
  if (existing.duplicateBy === "id") return true;
  return existing.receipt.prestaOrderId === orderId;
}
