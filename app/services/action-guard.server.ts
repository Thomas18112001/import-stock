type ActionKey = "sync" | "import" | "prepare" | "apply" | "receive" | "rollback";

const lastHitByKey = new Map<string, number>();

function normalizeIp(raw: string): string {
  if (!raw) return "unknown";
  return raw.split(",")[0]?.trim() || "unknown";
}

export function getClientIp(request: Request): string {
  return normalizeIp(
    request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "",
  );
}

export function assertActionRateLimit(
  action: ActionKey,
  shop: string,
  ip: string,
  windowMs = 4_000,
): void {
  const now = Date.now();
  const key = `${action}:${shop}:${ip}`;
  const last = lastHitByKey.get(key) ?? 0;
  if (now - last < windowMs) {
    throw new Error("Action trop fréquente. Réessayez dans quelques secondes.");
  }
  lastHitByKey.set(key, now);
}


