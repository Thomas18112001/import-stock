type NodeEnv = "development" | "test" | "production";

type CoreEnv = {
  nodeEnv: NodeEnv;
  port: number;
  prestaBaseUrl: string;
  prestaAllowedHost: string;
  prestaWsKey: string;
  prestaBoutiqueCustomerId: number;
  shopifyDefaultLocationName: string;
  syncBatchSize: number;
  syncMaxPerRun: number;
  cronSecret: string | null;
  debug: boolean;
};

type ShopifyEnv = {
  nodeEnv: NodeEnv;
  port: number;
  shopifyApiKey: string;
  shopifyApiSecret: string;
  shopifyAppUrl: string;
  scopesCsv: string;
  shop: string | null;
};

export type StartupEnv = CoreEnv &
  ShopifyEnv & {
    appUrl: string;
  };

type ValidateMode = {
  includeCore: boolean;
  includeShopify: boolean;
};

function readEnv(key: string): string | null {
  const raw = process.env[key];
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function parseNodeEnv(errors: string[]): NodeEnv {
  const raw = readEnv("NODE_ENV");
  if (!raw) return "production";
  if (raw === "development" || raw === "test" || raw === "production") return raw;
  errors.push(`- NODE_ENV must be one of: development, test, production (received "${raw}")`);
  return "production";
}

function parsePort(errors: string[]): number {
  const raw = readEnv("PORT");
  if (!raw) return 3000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`- PORT must be a positive integer (received "${raw}")`);
    return 3000;
  }
  return value;
}

function requireString(key: string, errors: string[]): string {
  const value = readEnv(key);
  if (!value) {
    errors.push(`- Missing required environment variable: ${key}`);
    return "";
  }
  return value;
}

function parsePositiveInt(key: string, errors: string[]): number {
  const raw = requireString(key, errors);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`- ${key} must be a positive integer (received "${raw || "<empty>"}")`);
    return 0;
  }
  return value;
}

function resolveAppUrl(nodeEnv: NodeEnv, errors: string[]): string {
  const shopifyAppUrl = readEnv("SHOPIFY_APP_URL");
  const appUrl = readEnv("APP_URL");
  const resolved = shopifyAppUrl || appUrl;

  if (!resolved) {
    errors.push("- Missing required environment variable: SHOPIFY_APP_URL (or APP_URL fallback)");
    return "";
  }

  let normalized = "";
  try {
    normalized = normalizeUrl(resolved);
  } catch {
    errors.push(`- Invalid URL for SHOPIFY_APP_URL/APP_URL: "${resolved}"`);
    return "";
  }

  if (nodeEnv === "production" && !normalized.startsWith("https://")) {
    errors.push("- SHOPIFY_APP_URL/APP_URL must use https in production");
  }
  if (nodeEnv === "production" && normalized.includes("example.com")) {
    errors.push("- SHOPIFY_APP_URL/APP_URL cannot contain example.com in production");
  }

  return normalized;
}

function validateEnv(mode: ValidateMode): StartupEnv {
  const errors: string[] = [];
  const nodeEnv = parseNodeEnv(errors);
  const port = parsePort(errors);

  let prestaBaseUrl = "";
  let prestaAllowedHost = "";
  let prestaWsKey = "";
  let prestaBoutiqueCustomerId = 0;
  let shopifyDefaultLocationName = "";
  let syncBatchSize = 0;
  let syncMaxPerRun = 0;
  let cronSecret: string | null = null;
  let debug = false;

  if (mode.includeCore) {
    const prestaBaseUrlRaw = requireString("PRESTA_BASE_URL", errors);
    prestaAllowedHost = readEnv("PRESTA_ALLOWED_HOST") ?? "btob.wearmoi.com";
    if (!/^[a-z0-9.-]+$/i.test(prestaAllowedHost)) {
      errors.push(`- PRESTA_ALLOWED_HOST has invalid format (received "${prestaAllowedHost}")`);
    }
    if (prestaBaseUrlRaw) {
      try {
        const normalized = normalizeUrl(prestaBaseUrlRaw);
        const parsed = new URL(normalized);
        if (parsed.hostname !== prestaAllowedHost) {
          errors.push(
            `- PRESTA_BASE_URL host must exactly match PRESTA_ALLOWED_HOST (${prestaAllowedHost}), received "${parsed.hostname}"`,
          );
        }
        prestaBaseUrl = normalized;
      } catch {
        errors.push(`- PRESTA_BASE_URL must be a valid absolute URL (received "${prestaBaseUrlRaw}")`);
      }
    }
    prestaWsKey = requireString("PRESTA_WS_KEY", errors);
    prestaBoutiqueCustomerId = parsePositiveInt("PRESTA_BOUTIQUE_CUSTOMER_ID", errors);
    shopifyDefaultLocationName = requireString("SHOPIFY_DEFAULT_LOCATION_NAME", errors);
    syncBatchSize = parsePositiveInt("SYNC_BATCH_SIZE", errors);
    syncMaxPerRun = parsePositiveInt("SYNC_MAX_PER_RUN", errors);
    if (syncBatchSize > 0 && syncMaxPerRun > 0 && syncBatchSize > syncMaxPerRun) {
      errors.push("- SYNC_BATCH_SIZE cannot be greater than SYNC_MAX_PER_RUN");
    }
    cronSecret = readEnv("CRON_SECRET");
    debug = readEnv("DEBUG") === "true";
  }

  let shopifyApiKey = "";
  let shopifyApiSecret = "";
  let shopifyAppUrl = "";
  let scopesCsv = "";
  let shop: string | null = null;

  if (mode.includeShopify) {
    shopifyApiKey = requireString("SHOPIFY_API_KEY", errors);
    shopifyApiSecret = requireString("SHOPIFY_API_SECRET", errors);
    shopifyAppUrl = resolveAppUrl(nodeEnv, errors);
    scopesCsv = requireString("SCOPES", errors);
    shop = readEnv("SHOP");
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n${errors.join("\n")}`);
  }

  return {
    nodeEnv,
    port,
    prestaBaseUrl,
    prestaAllowedHost,
    prestaWsKey,
    prestaBoutiqueCustomerId,
    shopifyDefaultLocationName,
    syncBatchSize,
    syncMaxPerRun,
    cronSecret,
    debug,
    shopifyApiKey,
    shopifyApiSecret,
    shopifyAppUrl,
    scopesCsv,
    shop,
    appUrl: shopifyAppUrl,
  };
}

let coreEnvCache: CoreEnv | null = null;
let shopifyEnvCache: ShopifyEnv | null = null;
let startupEnvCache: StartupEnv | null = null;

export function getCoreEnv(): CoreEnv {
  if (!coreEnvCache) {
    const validated = validateEnv({ includeCore: true, includeShopify: false });
    coreEnvCache = {
      nodeEnv: validated.nodeEnv,
      port: validated.port,
      prestaBaseUrl: validated.prestaBaseUrl,
      prestaAllowedHost: validated.prestaAllowedHost,
      prestaWsKey: validated.prestaWsKey,
      prestaBoutiqueCustomerId: validated.prestaBoutiqueCustomerId,
      shopifyDefaultLocationName: validated.shopifyDefaultLocationName,
      syncBatchSize: validated.syncBatchSize,
      syncMaxPerRun: validated.syncMaxPerRun,
      cronSecret: validated.cronSecret,
      debug: validated.debug,
    };
  }
  return coreEnvCache;
}

export function getShopifyEnv(): ShopifyEnv {
  if (!shopifyEnvCache) {
    const validated = validateEnv({ includeCore: false, includeShopify: true });
    shopifyEnvCache = {
      nodeEnv: validated.nodeEnv,
      port: validated.port,
      shopifyApiKey: validated.shopifyApiKey,
      shopifyApiSecret: validated.shopifyApiSecret,
      shopifyAppUrl: validated.shopifyAppUrl,
      scopesCsv: validated.scopesCsv,
      shop: validated.shop,
    };
  }
  return shopifyEnvCache;
}

export function validateStartupEnv(): StartupEnv {
  if (!startupEnvCache) {
    startupEnvCache = validateEnv({ includeCore: true, includeShopify: true });
  }
  return startupEnvCache;
}
