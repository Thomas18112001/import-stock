import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

const legacyPrefix = "/app";

function normalizeLegacyPath(pathname: string): string {
  const withoutPrefix = pathname.startsWith(legacyPrefix)
    ? pathname.slice(legacyPrefix.length)
    : pathname;
  const normalized = withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
  return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const targetPath = normalizeLegacyPath(url.pathname);
  const target = `${targetPath}${url.search}`;
  throw redirect(target);
};

export default function LegacyAppRedirectRoute() {
  return null;
}
