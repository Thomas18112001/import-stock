import type { AdminClient } from "./auth.server";
import type { PlanningRow } from "./inventoryPlanningService";
import {
  ensureMetaobjectDefinitions,
  fieldValue,
  getMetaTypes,
  getMetaobjectByHandle,
  listMetaobjects,
  updateMetaobject,
  upsertMetaobjectByHandle,
} from "./shopifyMetaobjects";

export type AlertType = "LOW_STOCK" | "OUT_OF_STOCK" | "INCOMING_DELAY" | "STOCKOUT_SOON" | "OVERSTOCK" | "SYNC_ERROR";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export type AlertConfig = {
  frequency: "instant" | "daily" | "weekly";
  emails: string[];
  enabledTypes: AlertType[];
  stockoutSoonDays: number;
  updatedBy: string;
  updatedAt: string;
};

export type AlertEvent = {
  id: string;
  handle: string;
  dedupKey: string;
  type: AlertType;
  status: AlertStatus;
  severity: "info" | "warning" | "critical";
  locationId: string;
  sku: string;
  message: string;
  payload: string;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  resolvedAt: string;
  updatedAt: string;
};

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  frequency: "daily",
  emails: [],
  enabledTypes: ["LOW_STOCK", "OUT_OF_STOCK", "INCOMING_DELAY", "STOCKOUT_SOON", "OVERSTOCK", "SYNC_ERROR"],
  stockoutSoonDays: 14,
  updatedBy: "system",
  updatedAt: "",
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function normalizeSku(value: string): string {
  return cleanText(value).toUpperCase();
}

function parseAlertType(rawValue: string): AlertType {
  const normalized = cleanText(rawValue).toUpperCase();
  const allowed: AlertType[] = ["LOW_STOCK", "OUT_OF_STOCK", "INCOMING_DELAY", "STOCKOUT_SOON", "OVERSTOCK", "SYNC_ERROR"];
  return allowed.includes(normalized as AlertType) ? (normalized as AlertType) : "SYNC_ERROR";
}

function parseAlertStatus(rawValue: string): AlertStatus {
  const normalized = cleanText(rawValue).toUpperCase();
  if (normalized === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (normalized === "RESOLVED") return "RESOLVED";
  return "OPEN";
}

function toNonNegativeInt(rawValue: string, fallback = 0): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function toCsv(values: string[]): string {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(",");
}

function parseCsv(rawValue: string): string[] {
  return cleanText(rawValue)
    .split(",")
    .map((value) => cleanText(value))
    .filter(Boolean);
}

function locationToken(locationId: string): string {
  const last = cleanText(locationId).split("/").pop() || cleanText(locationId);
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "location";
}

function skuToken(sku: string): string {
  return normalizeSku(sku)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sku";
}

function alertDedupKey(type: AlertType, locationId: string, sku: string): string {
  return `${type}:${locationToken(locationId)}:${skuToken(sku)}`;
}

function alertHandleFromDedupKey(dedupKey: string): string {
  return `alert-${dedupKey.toLowerCase().replace(/[^a-z0-9:-]/g, "-").replace(/:/g, "-")}`;
}

function parseAlertEvent(node: {
  id: string;
  handle: string;
  type: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): AlertEvent {
  const find = (key: string) => fieldValue(node, key);
  return {
    id: node.id,
    handle: node.handle,
    dedupKey: cleanText(find("dedup_key")),
    type: parseAlertType(find("type")),
    status: parseAlertStatus(find("status")),
    severity: (cleanText(find("severity")) as AlertEvent["severity"]) || "warning",
    locationId: cleanText(find("location_id")),
    sku: normalizeSku(find("sku")),
    message: cleanText(find("message")),
    payload: cleanText(find("payload")),
    firstTriggeredAt: cleanText(find("first_triggered_at")),
    lastTriggeredAt: cleanText(find("last_triggered_at")),
    resolvedAt: cleanText(find("resolved_at")),
    updatedAt: node.updatedAt,
  };
}

export async function getAlertConfig(admin: AdminClient, shopDomain: string): Promise<AlertConfig> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const existing = await getMetaobjectByHandle(admin, types.alertConfig, "default");

  if (!existing) {
    return DEFAULT_ALERT_CONFIG;
  }

  const find = (key: string) => fieldValue(existing, key);
  const frequencyRaw = cleanText(find("frequency")).toLowerCase();
  const frequency =
    frequencyRaw === "instant" || frequencyRaw === "weekly" || frequencyRaw === "daily" ? frequencyRaw : "daily";

  const enabledTypes = parseCsv(find("enabled_types"))
    .map((value) => parseAlertType(value))
    .filter((value, index, array) => array.indexOf(value) === index);

  return {
    frequency,
    emails: parseCsv(find("emails")),
    enabledTypes: enabledTypes.length ? enabledTypes : DEFAULT_ALERT_CONFIG.enabledTypes,
    stockoutSoonDays: Math.max(1, toNonNegativeInt(find("stockout_soon_days"), DEFAULT_ALERT_CONFIG.stockoutSoonDays)),
    updatedBy: cleanText(find("updated_by")),
    updatedAt: cleanText(find("updated_at")),
  };
}

export async function upsertAlertConfig(
  admin: AdminClient,
  shopDomain: string,
  input: {
    frequency: "instant" | "daily" | "weekly";
    emails: string[];
    enabledTypes: AlertType[];
    stockoutSoonDays: number;
    updatedBy?: string;
  },
): Promise<void> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  const emails = input.emails.map((email) => cleanText(email)).filter(Boolean);
  const enabledTypes = input.enabledTypes.filter(Boolean);

  await upsertMetaobjectByHandle(admin, types.alertConfig, "default", [
    { key: "frequency", value: input.frequency },
    { key: "emails", value: toCsv(emails) },
    { key: "enabled_types", value: toCsv(enabledTypes) },
    { key: "stockout_soon_days", value: String(Math.max(1, Math.trunc(Number(input.stockoutSoonDays || 14)))) },
    { key: "updated_by", value: cleanText(input.updatedBy) || "user" },
    { key: "updated_at", value: new Date().toISOString() },
  ]);
}

export async function listAlertEvents(
  admin: AdminClient,
  shopDomain: string,
  filters: {
    status?: AlertStatus | "ALL";
    locationId?: string;
    type?: AlertType | "ALL";
    limit?: number;
  } = {},
): Promise<AlertEvent[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const rows = (await listMetaobjects(admin, types.alertEvent)).map(parseAlertEvent);

  const filtered = rows
    .filter((row) => (filters.status && filters.status !== "ALL" ? row.status === filters.status : true))
    .filter((row) => (filters.locationId ? row.locationId === filters.locationId : true))
    .filter((row) => (filters.type && filters.type !== "ALL" ? row.type === filters.type : true))
    .sort((a, b) => Date.parse(b.lastTriggeredAt || b.updatedAt) - Date.parse(a.lastTriggeredAt || a.updatedAt));

  const limit = Math.max(1, Math.min(500, Math.trunc(Number(filters.limit || 200))));
  return filtered.slice(0, limit);
}

export async function markAlertStatus(
  admin: AdminClient,
  shopDomain: string,
  input: {
    dedupKey: string;
    status: AlertStatus;
  },
): Promise<void> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const existing = await getMetaobjectByHandle(admin, types.alertEvent, alertHandleFromDedupKey(input.dedupKey));
  if (!existing) {
    throw new Error("Alerte introuvable.");
  }

  await updateMetaobject(admin, existing.id, [
    { key: "status", value: input.status },
    { key: "resolved_at", value: input.status === "RESOLVED" ? new Date().toISOString() : "" },
    { key: "last_triggered_at", value: new Date().toISOString() },
  ]);
}

export async function upsertAlertsFromPlanningRows(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId: string;
    rows: PlanningRow[];
    config?: AlertConfig | null;
  },
): Promise<{ upserted: number }> {
  const config = input.config ?? (await getAlertConfig(admin, shopDomain));
  const enabled = new Set(config.enabledTypes);

  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  let upserted = 0;

  for (const row of input.rows) {
    const candidates: Array<{
      type: AlertType;
      severity: AlertEvent["severity"];
      message: string;
      payload: Record<string, unknown>;
    }> = [];

    if (row.outOfStock) {
      candidates.push({
        type: "OUT_OF_STOCK",
        severity: "critical",
        message: `${row.sku} est en rupture sur la boutique active.`,
        payload: { availableQty: row.availableQty, incomingQty: row.incomingQty },
      });
    }

    if (row.underMin && !row.outOfStock) {
      candidates.push({
        type: "LOW_STOCK",
        severity: "warning",
        message: `${row.sku} est sous le seuil minimum (${row.minQty}).`,
        payload: { availableQty: row.availableQty, minQty: row.minQty },
      });
    }

    if (row.overStock) {
      candidates.push({
        type: "OVERSTOCK",
        severity: "warning",
        message: `${row.sku} dépasse le seuil maximum (${row.maxQty}).`,
        payload: { availableQty: row.availableQty, maxQty: row.maxQty },
      });
    }

    if (row.stockoutDays != null && row.stockoutDays <= config.stockoutSoonDays) {
      candidates.push({
        type: "STOCKOUT_SOON",
        severity: row.stockoutDays <= 7 ? "critical" : "warning",
        message: `${row.sku}: ${row.stockoutLabel}.`,
        payload: { stockoutDays: row.stockoutDays, stockoutDate: row.stockoutDate },
      });
    }

    if (row.incomingQty > 0 && row.etaDate) {
      const etaMs = Date.parse(row.etaDate);
      if (Number.isFinite(etaMs) && etaMs < Date.now()) {
        candidates.push({
          type: "INCOMING_DELAY",
          severity: "warning",
          message: `${row.sku}: ETA dépassée pour l'arrivage en cours.`,
          payload: { etaDate: row.etaDate, incomingQty: row.incomingQty },
        });
      }
    }

    for (const candidate of candidates) {
      if (!enabled.has(candidate.type)) continue;
      const dedupKey = alertDedupKey(candidate.type, input.locationId, row.sku);
      const nowIso = new Date().toISOString();

      const existing = await getMetaobjectByHandle(admin, types.alertEvent, alertHandleFromDedupKey(dedupKey));
      const firstTriggeredAt = existing ? cleanText(fieldValue(existing, "first_triggered_at")) || nowIso : nowIso;

      await upsertMetaobjectByHandle(admin, types.alertEvent, alertHandleFromDedupKey(dedupKey), [
        { key: "dedup_key", value: dedupKey },
        { key: "type", value: candidate.type },
        { key: "status", value: "OPEN" },
        { key: "severity", value: candidate.severity },
        { key: "location_id", value: input.locationId },
        { key: "sku", value: normalizeSku(row.sku) },
        { key: "message", value: candidate.message },
        { key: "payload", value: JSON.stringify(candidate.payload) },
        { key: "first_triggered_at", value: firstTriggeredAt },
        { key: "last_triggered_at", value: nowIso },
        { key: "resolved_at", value: "" },
      ]);

      upserted += 1;
    }
  }

  return { upserted };
}
