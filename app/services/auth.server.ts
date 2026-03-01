import { authenticate } from "../shopify.server";
import { parseScopes, REQUIRED_SHOPIFY_SCOPES } from "../config/shopifyScopes";

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function requireAdmin(request: Request): Promise<{
  admin: AdminClient;
  shop: string;
  actor: string;
}> {
  const debug = process.env.DEBUG === "true";
  const pathname = new URL(request.url).pathname;

  let auth:
    | Awaited<ReturnType<typeof authenticate.admin>>
    | never;
  try {
    auth = await authenticate.admin(request);
  } catch (error) {
    if (debug) {
      if (error instanceof Response) {
        console.info("[debug] auth missing session", {
          path: pathname,
          status: error.status,
          redirectTo: error.headers.get("Location") ?? null,
        });
      } else {
        console.info("[debug] auth error", {
          path: pathname,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    throw error;
  }

  const sessionShop = auth.session.shop;
  const session = auth.session as {
    email?: string | null;
    userId?: string | number | bigint | null;
    shop: string;
  };
  const actor =
    session.email ??
    (session.userId ? String(session.userId) : session.shop);
  if (debug) {
    console.info("[debug] auth session ok", {
      path: pathname,
      shop: sessionShop,
      expectedScopes: REQUIRED_SHOPIFY_SCOPES.join(","),
      grantedScopes: parseScopes(process.env.SCOPES).join(","),
    });
  }
  return {
    admin: auth.admin as AdminClient,
    shop: sessionShop,
    actor,
  };
}
