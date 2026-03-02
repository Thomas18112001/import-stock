import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getShopifyEnv, validateStartupEnv } from "./config/env";
import { REQUIRED_SHOPIFY_SCOPES, REQUIRED_SHOPIFY_SCOPES_CSV, parseScopes } from "./config/shopifyScopes";
validateStartupEnv();
const shopifyEnv = getShopifyEnv();
const resolvedScopes = parseScopes(shopifyEnv.scopesCsv);
const appUrl = shopifyEnv.shopifyAppUrl;
const sessionDbPath = process.env.SHOPIFY_SESSION_DB_PATH || "./data/shopify_sessions.sqlite";
mkdirSync(dirname(sessionDbPath), { recursive: true });
if (process.env.DEBUG === "true") {
  console.info("[debug] shopify auth scopes", {
    envScopes: shopifyEnv.scopesCsv,
    resolvedScopes: resolvedScopes.join(","),
    expectedScopes: REQUIRED_SHOPIFY_SCOPES.join(","),
    appUrl,
  });
  if (!resolvedScopes.length) {
    console.info("[debug] shopify auth scopes warning", {
      message:
        "SCOPES env is empty. Run: shopify app config link, shopify app deploy, shopify app dev clean, then reinstall app.",
      required_scopes: REQUIRED_SHOPIFY_SCOPES_CSV,
    });
  }
}

const shopify = shopifyApp({
  apiKey: shopifyEnv.shopifyApiKey,
  apiSecretKey: shopifyEnv.shopifyApiSecret,
  // Keep this explicit to avoid silent defaults drifting across releases.
  // Update after checking supported values in node_modules/@shopify/shopify-api/dist/ts/lib/types.d.ts.
  apiVersion: ApiVersion.January26,
  scopes: resolvedScopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new SQLiteSessionStorage(sessionDbPath),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: false,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
