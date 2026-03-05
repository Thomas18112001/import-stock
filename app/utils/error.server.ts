export function toPublicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback;
  }

  const message = error.message.trim();
  if (/ledger document uri/i.test(message)) {
    return "Le stock entrant nécessite un document de référence inventaire. Réessayez après mise à jour ou contactez le support.";
  }

  const looksTechnical = /shopify graphql|http \d{3}|access denied|forbidden|invalid url|graphqlrequest/i.test(message);
  if (process.env.NODE_ENV === "production" && looksTechnical) {
    return fallback;
  }
  return message;
}

