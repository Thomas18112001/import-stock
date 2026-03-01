const SHOPIFY_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function toShopifyDateTime(presta: string): string | null {
  const normalized = presta.trim().replace(" ", "T");
  if (!SHOPIFY_DATETIME_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

export function toShopifyNowDateTime(date = new Date()): string {
  return date.toISOString().slice(0, 19);
}
