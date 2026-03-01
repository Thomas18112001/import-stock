import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

type NavigationResult = { ok: boolean; error?: string };

export function useEmbeddedNavigate() {
  const routerNavigate = useNavigate();
  const shopify = useAppBridge();

  return useCallback(
    (path: string): NavigationResult => {
      if (!path.startsWith("/")) {
        return { ok: false, error: "Chemin de navigation invalide" };
      }
      try {
        const appBridgeNavigate = (shopify as { navigation?: { navigate?: (to: string) => void } })?.navigation
          ?.navigate;
        if (typeof appBridgeNavigate === "function") {
          appBridgeNavigate(path);
          return { ok: true };
        }
        routerNavigate(path);
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
    [routerNavigate, shopify],
  );
}
