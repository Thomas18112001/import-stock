const BLOCKED_EXACT_PATHS = new Set([
  "/.env",
  "/dockerfile",
  "/ecosystem.config.cjs",
  "/package-lock.json",
]);

export function isSensitiveRequestPath(pathname: string): boolean {
  const normalized = pathname.trim().toLowerCase();
  if (!normalized) return false;
  if (BLOCKED_EXACT_PATHS.has(normalized)) return true;
  if (normalized.startsWith("/.shopify")) return true;
  if (normalized.startsWith("/deploy")) return true;
  if (normalized.startsWith("/logs")) return true;
  if (/^\/\.(?!well-known)/.test(normalized)) return true;
  return false;
}
