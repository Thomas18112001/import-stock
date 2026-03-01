export function buildReauthPath(shop: string, missingScope: string): string {
  const params = new URLSearchParams({
    shop,
    reauth: "1",
    reason: "missing_scope",
    scope: missingScope,
  });
  return `/auth?${params.toString()}`;
}

export function shouldTriggerReauth(url: URL): boolean {
  return url.searchParams.get("reauth") !== "1";
}

