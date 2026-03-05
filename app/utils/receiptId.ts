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

function toBase64Url(value: string): string {
  const maybeBuffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  const base64 =
    maybeBuffer
      ? maybeBuffer.from(value, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(value)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const maybeBuffer = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  const decoded =
    maybeBuffer
      ? maybeBuffer.from(padded, "base64").toString("utf8")
      : decodeURIComponent(escape(atob(padded)));
  return decoded;
}

export function encodeReceiptIdForUrl(receiptId: string): string {
  const trimmed = String(receiptId ?? "").trim();
  if (trimmed.startsWith("b64_")) {
    return trimmed;
  }
  return `b64_${toBase64Url(normalizeReceiptId(trimmed))}`;
}

export function decodeReceiptIdFromUrl(param: string): string {
  const raw = String(param ?? "").trim();
  if (raw.startsWith("b64_")) {
    const payload = raw.slice(4);
    if (!payload) {
      throw new Error("Identifiant de réception invalide");
    }
    return normalizeReceiptId(fromBase64Url(payload));
  }
  return normalizeReceiptId(raw);
}

export const encodeReceiptId = encodeReceiptIdForUrl;
export const decodeReceiptId = decodeReceiptIdFromUrl;
