import { env } from "../env.server";

const lastHitByKey = new Map<string, number>();
const WINDOW_MS = 60_000;

function readCronToken(request: Request): string {
  return (request.headers.get("X-CRON-SECRET") ?? "").trim();
}

export function assertCronSecret(request: Request, expectedSecret: string | null): void {
  if (!expectedSecret) {
    throw new Response("cron disabled: missing CRON_SECRET", { status: 503 });
  }

  const token = readCronToken(request);
  if (!token || token !== expectedSecret) {
    throw new Response("unauthorized", { status: 401 });
  }
}

export function assertCronAccess(request: Request): void {
  assertCronSecret(request, env.cronSecret);

  const key = "sync-cron";
  const now = Date.now();
  const lastHit = lastHitByKey.get(key) ?? 0;
  if (now - lastHit < WINDOW_MS) {
    throw new Response("Too many requests", { status: 429 });
  }
  lastHitByKey.set(key, now);
}
