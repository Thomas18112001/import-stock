const SHOPIFY_GID_PATTERN = /^gid:\/\/shopify\/[A-Za-z_]+\/\d+$/;
const SKU_ALLOWED_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function parsePositiveIntInput(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function sanitizeSearchQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .slice(0, 100);
}

export function sanitizeSort(raw: string, allowed: string[], fallback: string): string {
  return allowed.includes(raw) ? raw : fallback;
}

export function normalizeSku(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().slice(0, 80);
}

export function isValidSku(sku: string): boolean {
  return SKU_ALLOWED_PATTERN.test(sku);
}

export function isShopifyGid(value: string): boolean {
  return SHOPIFY_GID_PATTERN.test(value);
}
