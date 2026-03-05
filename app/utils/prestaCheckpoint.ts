export type PrestaCheckpoint = {
  dateUpd: string;
  orderId: number;
};

const PRESTA_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function isPrestaDateTime(value: string): boolean {
  return PRESTA_DATE_TIME_PATTERN.test(value.trim());
}

export function parsePrestaDateTimeToMs(value: string): number | null {
  const trimmed = value.trim();
  if (!isPrestaDateTime(trimmed)) return null;
  const iso = trimmed.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatPrestaDateTime(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function comparePrestaCheckpoint(a: PrestaCheckpoint, b: PrestaCheckpoint): number {
  const aDate = a.dateUpd.trim();
  const bDate = b.dateUpd.trim();
  if (aDate < bDate) return -1;
  if (aDate > bDate) return 1;
  if (a.orderId < b.orderId) return -1;
  if (a.orderId > b.orderId) return 1;
  return 0;
}

export function maxPrestaCheckpoint(a: PrestaCheckpoint, b: PrestaCheckpoint): PrestaCheckpoint {
  return comparePrestaCheckpoint(a, b) >= 0 ? a : b;
}

export function normalizePrestaCheckpoint(input: Partial<PrestaCheckpoint> | null | undefined): PrestaCheckpoint {
  const dateUpd = String(input?.dateUpd ?? "").trim();
  const orderId = Number(input?.orderId ?? 0);
  if (!isPrestaDateTime(dateUpd) || !Number.isInteger(orderId) || orderId < 0) {
    return { dateUpd: "1970-01-01 00:00:00", orderId: 0 };
  }
  return { dateUpd, orderId };
}

export function buildOrderCheckpoint(orderDateUpd: string, orderId: number): PrestaCheckpoint | null {
  const dateUpd = String(orderDateUpd ?? "").trim();
  if (!isPrestaDateTime(dateUpd)) return null;
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  return { dateUpd, orderId };
}

export function isOrderAfterCheckpoint(
  orderDateUpd: string,
  orderId: number,
  checkpoint: PrestaCheckpoint,
): boolean {
  const candidate = buildOrderCheckpoint(orderDateUpd, orderId);
  if (!candidate) return false;
  return comparePrestaCheckpoint(candidate, checkpoint) > 0;
}

export function computeCheckpointLookbackStart(
  checkpoint: PrestaCheckpoint,
  lookbackMinutes: number,
): string {
  const parsedMs = parsePrestaDateTimeToMs(checkpoint.dateUpd);
  if (parsedMs == null) return "1970-01-01 00:00:00";
  const safeLookback = Number.isFinite(lookbackMinutes) ? Math.max(0, Math.floor(lookbackMinutes)) : 0;
  return formatPrestaDateTime(new Date(parsedMs - safeLookback * 60_000));
}
