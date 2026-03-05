const WINDOW_MS = 10_000;
const lastSyncByShop = new Map<string, number>();

export function assertManualSyncRateLimit(shop: string): void {
  const now = Date.now();
  const lastHit = lastSyncByShop.get(shop) ?? 0;
  if (now - lastHit < WINDOW_MS) {
    throw new Error("Synchronisation trop fréquente. Réessayez dans quelques secondes.");
  }
  lastSyncByShop.set(shop, now);
}


