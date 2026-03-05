import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { withEmbeddedContext } from "../utils/embeddedPath";

type NavigationResult = { ok: boolean; error?: string };

export function useEmbeddedNavigate() {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const shopify = useAppBridge();

  return useCallback(
    (path: string): NavigationResult => {
      if (!path.startsWith("/")) {
        return { ok: false, error: "Chemin de navigation invalide" };
      }
      const contextualPath = withEmbeddedContext(path, location.search, location.pathname);
      try {
        const appBridgeNavigate = (shopify as { navigation?: { navigate?: (to: string) => void } })?.navigation
          ?.navigate;
        if (typeof appBridgeNavigate === "function") {
          appBridgeNavigate(contextualPath);
          return { ok: true };
        }
        routerNavigate(contextualPath);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Navigation impossible";
        try {
          shopify.toast.show("Navigation impossible");
        } catch {
          // no-op fallback
        }
        return { ok: false, error: message };
      }
    },
    [location.pathname, location.search, routerNavigate, shopify],
  );
}
