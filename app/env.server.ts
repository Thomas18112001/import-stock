type RequiredKey =
  | "PRESTA_BASE_URL"
  | "PRESTA_WS_KEY"
  | "PRESTA_BOUTIQUE_CUSTOMER_ID"
  | "SHOPIFY_DEFAULT_LOCATION_NAME"
  | "SYNC_BATCH_SIZE"
  | "SYNC_MAX_PER_RUN";

type OptionalKey = "CRON_SECRET";
type OptionalRuntimeKey = "DEBUG";

function requireEnv(key: RequiredKey): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function getOptionalEnv(key: OptionalKey): string | null {
  const value = process.env[key];
  if (!value || !value.trim()) return null;
  return value.trim();
}

function getOptionalRuntimeEnv(key: OptionalRuntimeKey): string | null {
  const value = process.env[key];
  if (!value || !value.trim()) return null;
  return value.trim();
}

function parsePositiveInt(key: RequiredKey): number {
  const raw = requireEnv(key);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }
  return value;
}

function normalizedBaseUrl(urlValue: string): string {
  const parsed = new URL(urlValue);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export const env = {
  prestaBaseUrl: normalizedBaseUrl(requireEnv("PRESTA_BASE_URL")),
  prestaWsKey: requireEnv("PRESTA_WS_KEY"),
  prestaBoutiqueCustomerId: parsePositiveInt("PRESTA_BOUTIQUE_CUSTOMER_ID"),
  shopifyDefaultLocationName: requireEnv("SHOPIFY_DEFAULT_LOCATION_NAME"),
  syncBatchSize: parsePositiveInt("SYNC_BATCH_SIZE"),
  syncMaxPerRun: parsePositiveInt("SYNC_MAX_PER_RUN"),
  // CRON_SECRET is only required to enable /actions/sync/cron.
  // In production, set CRON_SECRET explicitly; if missing, cron endpoint returns 503.
  cronSecret: getOptionalEnv("CRON_SECRET"),
  debug: getOptionalRuntimeEnv("DEBUG") === "true",
} as const;

if (env.syncBatchSize > env.syncMaxPerRun) {
  throw new Error("SYNC_BATCH_SIZE cannot be greater than SYNC_MAX_PER_RUN");
}
