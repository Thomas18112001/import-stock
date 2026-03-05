import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as EmbeddedAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider, Box, Button, Frame, InlineStack, Text } from "@shopify/polaris";
import frTranslations from "@shopify/polaris/locales/fr.json";

import { AppLoader } from "../components/AppLoader";
import { authenticate } from "../shopify.server";
import { readLinkedDevStoreFromProject, shopFromHostParam } from "../utils/shopDomain";
import { withEmbeddedContext } from "../utils/embeddedPath";
import "../styles/app-loader.css";
import "../styles/cursor-behavior.css";

const CONTACT_EMAIL = "contact@woora.fr";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    if (error instanceof Response && error.status === 410) {
      const url = new URL(request.url);
      const shop =
        url.searchParams.get("shop") ??
        shopFromHostParam(url.searchParams.get("host")) ??
        readLinkedDevStoreFromProject() ??
        process.env.SHOP ??
        "";

      const params = new URLSearchParams();
      if (shop) params.set("shop", shop);
      const host = url.searchParams.get("host");
      if (host) params.set("host", host);
      const embedded = url.searchParams.get("embedded");
      if (embedded) params.set("embedded", embedded);
      throw redirect(`/auth/login${params.toString() ? `?${params.toString()}` : ""}`);
    }
    throw error;
  }
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function openMailClient() {
  const mailto = `mailto:${CONTACT_EMAIL}`;
  if (typeof window === "undefined") return;
  try {
    if (window.top) {
      window.top.location.href = mailto;
      return;
    }
  } catch {
    // Fallback below.
  }
  window.location.href = mailto;
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setIsBooting(false), 280);
    return () => window.clearTimeout(timeout);
  }, []);

  const showLoader = isBooting;
  const navHref = (path: string) => withEmbeddedContext(path, location.search, location.pathname);

  return (
    <EmbeddedAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={frTranslations}>
        <div className="wm-app">
        <NavMenu>
          <a href={navHref("/tableau-de-bord")}>Tableau de bord</a>
          <a href={navHref("/planification-stock")}>Planification stock</a>
          <a href={navHref("/stats-inventaire")}>Stats inventaire</a>
          <a href={navHref("/sante-inventaire")}>Santé inventaire</a>
          <a href={navHref("/fournisseurs")}>Fournisseurs</a>
          <a href={navHref("/alertes-inventaire")}>Alertes</a>
          <a href={navHref("/produits-en-reception")}>{"Produits en r\u00E9ception"}</a>
          <a href={navHref("/reassorts-magasin")}>{"R\u00E9assorts magasin"}</a>
          <a href={navHref("/aide-autorisations")}>Aide</a>
        </NavMenu>

        <AppLoader visible={showLoader} />

        <Frame>
          <Box minHeight="100vh" paddingBlockEnd="800">
            <Outlet />
            <Box paddingBlockStart="1000" paddingBlockEnd="800">
              <InlineStack align="center" blockAlign="center" gap="200">
                <img src="/logo-woora.png" alt="Woora" style={{ width: "180px", height: "auto" }} />
              </InlineStack>
              <Box paddingBlockStart="300">
                <InlineStack align="center" gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {"Application d\u00E9velopp\u00E9e par Woora \u00B7"}{" "}
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      target="_top"
                      rel="noopener noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        openMailClient();
                      }}
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      {CONTACT_EMAIL}
                    </a>
                  </Text>
                  <Button
                    size="micro"
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(CONTACT_EMAIL);
                      }
                    }}
                  >
                    Copier l&apos;email
                  </Button>
                </InlineStack>
              </Box>
            </Box>
          </Box>
        </Frame>
        </div>
      </PolarisAppProvider>
    </EmbeddedAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
