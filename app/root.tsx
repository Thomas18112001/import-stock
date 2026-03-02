import type { LinksFunction, MetaFunction } from "react-router";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: polarisStyles }];
export const meta: MetaFunction = () => [{ title: "Import Stock Boutique" }];

export default function App() {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/wearmoi-favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/wearmoi-app-icon.png" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isProd = process.env.NODE_ENV === "production";
  const statusText = isRouteErrorResponse(error) ? `${error.status}` : "500";
  const details =
    !isProd && error instanceof Error
      ? error.message
      : "Une erreur est survenue. Veuillez recharger l'application.";

  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Erreur application</title>
      </head>
      <body>
        <main style={{ padding: "1rem", fontFamily: "sans-serif" }}>
          <h1>Erreur {statusText}</h1>
          <p>{details}</p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
