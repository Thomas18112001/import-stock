import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as EmbeddedAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Box, Frame, InlineStack, Link, Text } from "@shopify/polaris";
import frTranslations from "@shopify/polaris/locales/fr.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <EmbeddedAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={frTranslations}>
        <Frame>
          <Box minHeight="100vh" paddingBlockEnd="800">
            <Outlet />
            <Box paddingBlockStart="1000" paddingBlockEnd="800">
              <InlineStack align="center" blockAlign="center" gap="200">
                <img src="/logo-woora.png" alt="Woora" style={{ width: "180px", height: "auto" }} />
              </InlineStack>
              <Box paddingBlockStart="300">
                <InlineStack align="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Application développée par{" "}
                    <Link url="mailto:contact@woora.fr" removeUnderline>
                      Woora
                    </Link>
                  </Text>
                </InlineStack>
              </Box>
            </Box>
          </Box>
        </Frame>
      </PolarisAppProvider>
    </EmbeddedAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
