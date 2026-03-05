import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { readLinkedDevStoreFromProject, shopFromHostParam } from "../../utils/shopDomain";
import { clearReauthGuardCookie } from "../../utils/reauth";

type AuthLoginData = {
  message: string;
};

function isOauthInstallRedirect(location: string): boolean {
  return location.includes("admin.shopify.com") && location.includes("/oauth/install");
}

function buildExitIframePath(exitIframe: string): string {
  const params = new URLSearchParams({ exitIframe });
  return `/auth/exit-iframe?${params.toString()}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = String(formData.get("shop") ?? "").trim();

  if (!shop) {
    throw redirect("/auth/login");
  }

  throw redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop");
  const shopFromHost = shopFromHostParam(url.searchParams.get("host"));
  const shopFromProject =
    process.env.NODE_ENV !== "production" ? readLinkedDevStoreFromProject() : null;
  const shopFromEnv = process.env.NODE_ENV === "production" ? process.env.SHOP || null : null;
  const shop = shopFromQuery ?? shopFromHost ?? shopFromProject ?? shopFromEnv;

  if (!shop) {
    return {
      message:
        "Boutique introuvable. Ouvrez l'application depuis Shopify Admin pour lancer l'autorisation automatiquement.",
    } satisfies AuthLoginData;
  }

  // Keep `shop` in query for a deterministic OAuth entrypoint.
  if (url.searchParams.get("shop") !== shop) {
    const normalized = new URL(request.url);
    normalized.searchParams.set("shop", shop);
    throw redirect(`${normalized.pathname}?${normalized.searchParams.toString()}`);
  }

  const isEmbedded =
    url.searchParams.get("embedded") === "1" || Boolean(url.searchParams.get("host"));
  const postAuthParams = new URLSearchParams();
  postAuthParams.set("shop", shop);
  const host = url.searchParams.get("host");
  if (host) postAuthParams.set("host", host);
  if (isEmbedded) postAuthParams.set("embedded", "1");
  const postAuthPath = `/reassorts-magasin?${postAuthParams.toString()}`;

  try {
    const errors = loginErrorMessage(await login(request));
    if (errors.shop) {
      return {
        message: `Autorisation Shopify non initialisée (${errors.shop}). Relancez depuis Shopify Admin.`,
      } satisfies AuthLoginData;
    }

    throw redirect(postAuthPath, {
      headers: {
        "Set-Cookie": clearReauthGuardCookie(),
      },
    });
  } catch (error) {
    if (!(error instanceof Response)) {
      throw error;
    }

    const location = error.headers.get("Location");
    if (!location) {
      throw error;
    }

    if (isEmbedded || isOauthInstallRedirect(location)) {
      throw redirect(buildExitIframePath(location), {
        headers: {
          "Set-Cookie": clearReauthGuardCookie(),
        },
      });
    }

    throw redirect(location, {
      headers: {
        "Set-Cookie": clearReauthGuardCookie(),
      },
    });
  }
};

export default function AuthLogin() {
  const data = useLoaderData<typeof loader>() as AuthLoginData | undefined;
  const message = data?.message ?? "";

  return (
    <main style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      <p>{message || "Redirection OAuth en cours..."}</p>
    </main>
  );
}


