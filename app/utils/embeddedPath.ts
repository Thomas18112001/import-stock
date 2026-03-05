const CONTEXT_KEYS = ["shop", "host", "embedded"] as const;
const EMBEDDED_CONTEXT_STORAGE_KEY = "wm_embedded_context_query";
const APP_ROOT_SEGMENTS = new Set([
  "reassorts-magasin",
  "produits-en-reception",
  "aide-autorisations",
  "auth",
  "actions",
  "api",
  "webhooks",
]);

type ContextKey = (typeof CONTEXT_KEYS)[number];
type EmbeddedContext = Partial<Record<ContextKey, string>>;

let cachedEmbeddedContext: EmbeddedContext = {};

function readParam(params: URLSearchParams, key: ContextKey): string {
  return (params.get(key) || "").trim();
}

function extractEmbeddedContext(search: string): EmbeddedContext {
  const params = new URLSearchParams(search);
  const context: EmbeddedContext = {};
  for (const key of CONTEXT_KEYS) {
    const value = readParam(params, key);
    if (value) context[key] = value;
  }
  return context;
}

function contextToSearch(context: EmbeddedContext): string {
  const params = new URLSearchParams();
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function hasContext(context: EmbeddedContext): boolean {
  return CONTEXT_KEYS.some((key) => Boolean(context[key]));
}

function readStoredContext(): EmbeddedContext {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(EMBEDDED_CONTEXT_STORAGE_KEY) ?? "";
    if (!raw) return {};
    return extractEmbeddedContext(raw);
  } catch {
    return {};
  }
}

function storeContext(search: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(EMBEDDED_CONTEXT_STORAGE_KEY, search);
  } catch {
    // no-op
  }
}

export function rememberEmbeddedContext(currentSearch: string): string {
  const current = extractEmbeddedContext(currentSearch);
  if (hasContext(current)) {
    cachedEmbeddedContext = { ...cachedEmbeddedContext, ...current };
    storeContext(contextToSearch(cachedEmbeddedContext));
    return contextToSearch(cachedEmbeddedContext);
  }

  const stored = readStoredContext();
  if (hasContext(stored)) {
    cachedEmbeddedContext = { ...cachedEmbeddedContext, ...stored };
  }
  return contextToSearch(cachedEmbeddedContext);
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function detectBasePath(currentPathname: string): string {
  const normalized = trimTrailingSlash(currentPathname || "/");
  if (!normalized || normalized === "/") return "";
  const segments = normalized.split("/").filter(Boolean);
  const appIndex = segments.findIndex((segment) => APP_ROOT_SEGMENTS.has(segment));
  if (appIndex > 0) {
    return `/${segments.slice(0, appIndex).join("/")}`;
  }
  if (appIndex === 0) {
    return "";
  }
  return `/${segments.join("/")}`;
}

function applyBasePath(pathname: string, basePath: string): string {
  if (!basePath) return pathname;
  if (pathname === "/") return basePath;
  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) return pathname;
  return `${basePath}${pathname}`;
}

export function withEmbeddedContext(path: string, currentSearch: string, currentPathname = "/"): string {
  if (!path.startsWith("/")) {
    return path;
  }

  const target = new URL(path, "https://embedded.local");
  const basePath = detectBasePath(currentPathname);
  target.pathname = applyBasePath(target.pathname, basePath);
  const remembered = rememberEmbeddedContext(currentSearch);
  const current = new URLSearchParams(remembered || currentSearch);

  for (const key of CONTEXT_KEYS) {
    if (target.searchParams.has(key)) continue;
    const value = readParam(current, key);
    if (value) target.searchParams.set(key, value);
  }

  return `${target.pathname}${target.search}${target.hash}`;
}
