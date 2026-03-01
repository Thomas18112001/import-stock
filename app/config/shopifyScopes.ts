export const REQUIRED_SHOPIFY_SCOPES = [
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
  "read_locations",
  "read_products",
  "read_inventory",
  "write_inventory",
] as const;

export const REQUIRED_SHOPIFY_SCOPES_CSV = REQUIRED_SHOPIFY_SCOPES.join(",");

export function parseScopes(rawScopes: string | undefined | null): string[] {
  if (!rawScopes) return [];
  return rawScopes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveAuthScopes(rawScopes: string | undefined | null): string[] {
  const parsed = parseScopes(rawScopes);
  return parsed.length ? parsed : [...REQUIRED_SHOPIFY_SCOPES];
}
