export function makeTraceId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `tr-${Date.now().toString(36).slice(-5)}-${random}`;
}
