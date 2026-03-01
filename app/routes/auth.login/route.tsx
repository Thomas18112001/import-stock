import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { readLinkedDevStoreFromProject, shopFromHostParam } from "../../utils/shopDomain";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopFromQuery = url.searchParams.get("shop");
  const shopFromHost = shopFromHostParam(url.searchParams.get("host"));
  const shopFromProject = process.env.NODE_ENV !== "production" ? readLinkedDevStoreFromProject() : null;
  const shop = shopFromQuery ?? shopFromHost ?? shopFromProject;
  const debug = process.env.DEBUG === "true";

  if (!shop) {
    if (debug) {
      console.info("[debug] auth.login missing shop", {
        path: url.pathname,
        host: url.searchParams.get("host") ?? null,
        shopFromHost,
        shopFromProject,
      });
    }
    return {
      ready: false,
      message:
        "Boutique introuvable. Ouvrez l'application depuis Shopify Admin pour lancer l'autorisation automatiquement.",
    };
  }

  const normalized = new URL(request.url);
  if (normalized.searchParams.get("shop") !== shop) {
    normalized.searchParams.set("shop", shop);
    throw redirect(`${normalized.pathname}?${normalized.searchParams.toString()}`);
  }

  const errors = loginErrorMessage(await login(request));
  if (errors.shop) {
    return {
      ready: false,
      message: `Autorisation Shopify non initialisee (${errors.shop}). Relancez depuis Shopify Admin.`,
    };
  }

  return { ready: true, message: "Redirection OAuth en cours..." };
};

export default function AuthLogin() {
  const data = useLoaderData<typeof loader>();
  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Connexion Shopify">
          <s-text>{data.message}</s-text>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
