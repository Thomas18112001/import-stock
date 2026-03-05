import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

const ALIAS_BY_PATHNAME: Record<string, string> = {
  "/dashboard": "/tableau-de-bord",
  "/stats": "/stats-inventaire",
  "/planning": "/planification-stock",
  "/planification-stocks": "/planification-stock",
  "/inventory-health": "/sante-inventaire",
  "/alerts": "/alertes-inventaire",
  "/alertes": "/alertes-inventaire",
  "/suppliers": "/fournisseurs",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const canonicalPath = ALIAS_BY_PATHNAME[url.pathname] || "/tableau-de-bord";
  throw redirect(`${canonicalPath}${url.search}`);
};

export default function LegacySectionRedirectRoute() {
  return null;
}

