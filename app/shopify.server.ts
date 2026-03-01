import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { MemorySessionStorage } from "@shopify/shopify-app-session-storage-memory";
import { REQUIRED_SHOPIFY_SCOPES, REQUIRED_SHOPIFY_SCOPES_CSV, resolveAuthScopes } from "./config/shopifyScopes";
import "./env.server";

function resolveAppUrl(): string {
  const shopifyAppUrl = (process.env.SHOPIFY_APP_URL ?? "").trim();
  const appUrl = (process.env.APP_URL ?? "").trim();
  const resolvedAppUrl = shopifyAppUrl || appUrl;

  if (process.env.NODE_ENV === "production" && !resolvedAppUrl) {
    throw new Error(
      "Missing app URL in production: define SHOPIFY_APP_URL (recommended) or APP_URL.",
    );
  }

  return resolvedAppUrl;
}

const resolvedScopes = resolveAuthScopes(process.env.SCOPES);
const appUrl = resolveAppUrl();
if (process.env.NODE_ENV === "production" && appUrl.includes("example.com")) {
  throw new Error(
    "Invalid application URL in production: contains example.com. Define SHOPIFY_APP_URL/APP_URL with your real domain.",
  );
}
if (process.env.DEBUG === "true") {
  console.info("[debug] shopify auth scopes", {
    envScopes: process.env.SCOPES ?? "",
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
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: resolvedScopes,
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new MemorySessionStorage(),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
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
