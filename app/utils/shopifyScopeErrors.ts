import { REQUIRED_SHOPIFY_SCOPES } from "../config/shopifyScopes";

export class MissingShopifyScopeError extends Error {
  missingScope: string;
  operation?: string;

  constructor(missingScope: string, operation?: string, message?: string) {
    super(
      message ??
        `Autorisation manquante: ${missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
    );
    this.name = "MissingShopifyScopeError";
    this.missingScope = missingScope;
    this.operation = operation;
  }
}

export function detectMissingScopeFromErrorMessage(message: string): string | null {
  const lower = message.toLowerCase();
  if (!lower.includes("access denied")) return null;
  const match = message.match(/Required access:\s*`([^`]+)`/i);
  if (match?.[1]) return match[1];
  if (lower.includes("read_metaobject_definitions")) return "read_metaobject_definitions";
  return null;
}

export function toMissingScopeError(error: unknown, operation?: string): MissingShopifyScopeError | null {
  const message = error instanceof Error ? error.message : String(error);
  const missingScope = detectMissingScopeFromErrorMessage(message);
  if (!missingScope) return null;
  return new MissingShopifyScopeError(
    missingScope,
    operation,
    `Autorisation manquante: ${missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
  );
}

export function listExpectedScopesForLogs(): string {
  return REQUIRED_SHOPIFY_SCOPES.join(",");
}


