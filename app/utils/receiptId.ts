function normalizeReceiptId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Identifiant de réception manquant");
  }
  if (trimmed.startsWith("gid://")) {
    return trimmed;
  }
  try {
    const decoded = decodeURIComponent(trimmed);
    if (!decoded.trim()) {
      throw new Error("Identifiant de réception invalide");
    }
    return decoded.trim();
  } catch {
    throw new Error("Identifiant de réception invalide");
  }
}

export function encodeReceiptIdForUrl(receiptId: string): string {
  return encodeURIComponent(normalizeReceiptId(receiptId));
}

export function decodeReceiptIdFromUrl(param: string): string {
  return normalizeReceiptId(param);
}

// Backward-compatible aliases
export const encodeReceiptId = encodeReceiptIdForUrl;
export const decodeReceiptId = decodeReceiptIdFromUrl;
