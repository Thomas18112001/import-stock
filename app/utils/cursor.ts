export function resolveLatestCursor(current: number, candidate?: number): number {
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    return current;
  }
  return Math.max(current, candidate);
}
