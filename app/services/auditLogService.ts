import type { AdminClient } from "./auth.server";
import {
  createMetaobject,
  ensureMetaobjectDefinitions,
  getMetaTypes,
  listMetaobjectsConnection,
} from "./shopifyMetaobjects";

const AUDIT_PAGE_SIZE = 250;
const AUDIT_MAX_PAGES = 80;

export type AuditEntityType =
  | "sync"
  | "receipt"
  | "purchase_order"
  | "presta_order"
  | "system"
  | string;

export type AuditEventInput = {
  eventType: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  locationId?: string | null;
  prestaOrderId?: number | null;
  status?: "success" | "error" | "info" | "warning" | string | null;
  message?: string | null;
  payload?: unknown;
  actor?: string | null;
  createdAt?: string | null;
};

export type AuditLogEntry = {
  gid: string;
  eventType: string;
  entityType: string;
  entityId: string;
  locationId: string;
  prestaOrderId: number;
  status: string;
  message: string;
  payload: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function toInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function toIso(value?: string | null): string {
  const trimmed = cleanText(value);
  if (!trimmed) return new Date().toISOString();
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function toPayloadString(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

function buildAuditHandle(input: { eventType: string; entityType: string; entityId: string; createdAt: string }): string {
  const stable = `${input.eventType}-${input.entityType}-${input.entityId || "na"}-${Date.parse(input.createdAt)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `audit-${stable || "event"}-${suffix}`;
}

function toAuditEntry(node: {
  id: string;
  updatedAt: string;
  fields: Array<{ key: string; value: string | null }>;
}): AuditLogEntry {
  const find = (key: string) => node.fields.find((field) => field.key === key)?.value ?? "";
  return {
    gid: node.id,
    eventType: find("event_type"),
    entityType: find("entity_type"),
    entityId: find("entity_id"),
    locationId: find("location_id"),
    prestaOrderId: toInt(find("presta_order_id")),
    status: find("status"),
    message: find("message"),
    payload: find("payload"),
    actor: find("actor"),
    createdAt: find("created_at"),
    updatedAt: node.updatedAt,
  };
}

export async function logAuditEvent(admin: AdminClient, shopDomain: string, input: AuditEventInput): Promise<void> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);
  const createdAt = toIso(input.createdAt);
  const entityId = cleanText(input.entityId);
  await createMetaobject(admin, types.auditLog, buildAuditHandle({
    eventType: cleanText(input.eventType) || "event",
    entityType: cleanText(input.entityType) || "system",
    entityId,
    createdAt,
  }), [
    { key: "event_type", value: cleanText(input.eventType) || "event" },
    { key: "entity_type", value: cleanText(input.entityType) || "system" },
    { key: "entity_id", value: entityId },
    { key: "location_id", value: cleanText(input.locationId) },
    { key: "presta_order_id", value: String(Math.max(0, Math.trunc(Number(input.prestaOrderId ?? 0)))) },
    { key: "status", value: cleanText(input.status) || "info" },
    { key: "message", value: cleanText(input.message) },
    { key: "payload", value: toPayloadString(input.payload) },
    { key: "actor", value: cleanText(input.actor) },
    { key: "created_at", value: createdAt },
  ]);
}

export async function safeLogAuditEvent(admin: AdminClient, shopDomain: string, input: AuditEventInput): Promise<void> {
  try {
    await logAuditEvent(admin, shopDomain, input);
  } catch (error) {
    console.warn("[audit] failed to persist audit log", {
      eventType: input.eventType,
      entityType: input.entityType,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function listAuditEvents(
  admin: AdminClient,
  shopDomain: string,
  filters: {
    limit?: number;
    locationId?: string;
    entityType?: string;
    entityId?: string;
    prestaOrderId?: number;
    status?: string;
  } = {},
): Promise<AuditLogEntry[]> {
  await ensureMetaobjectDefinitions(admin, shopDomain);
  const types = await getMetaTypes(admin);

  const nodes: Array<{
    id: string;
    updatedAt: string;
    fields: Array<{ key: string; value: string | null }>;
  }> = [];
  let after: string | null = null;
  const seen = new Set<string>();

  for (let page = 0; page < AUDIT_MAX_PAGES; page += 1) {
    const connection = await listMetaobjectsConnection(admin, types.auditLog, AUDIT_PAGE_SIZE, after);
    nodes.push(...connection.nodes.map((node) => ({ id: node.id, updatedAt: node.updatedAt, fields: node.fields })));
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
      break;
    }
    if (seen.has(connection.pageInfo.endCursor)) {
      break;
    }
    seen.add(connection.pageInfo.endCursor);
    after = connection.pageInfo.endCursor;
  }

  const filtered = nodes
    .map((node) => toAuditEntry(node))
    .filter((entry) => (filters.locationId ? entry.locationId === filters.locationId : true))
    .filter((entry) => (filters.entityType ? entry.entityType === filters.entityType : true))
    .filter((entry) => (filters.entityId ? entry.entityId === filters.entityId : true))
    .filter((entry) => (typeof filters.prestaOrderId === "number" && filters.prestaOrderId > 0 ? entry.prestaOrderId === filters.prestaOrderId : true))
    .filter((entry) => (filters.status ? entry.status === filters.status : true))
    .sort((left, right) => {
      const leftMs = Date.parse(left.createdAt || left.updatedAt);
      const rightMs = Date.parse(right.createdAt || right.updatedAt);
      return rightMs - leftMs;
    });

  const limit = Number.isInteger(filters.limit) && (filters.limit ?? 0) > 0 ? (filters.limit as number) : 100;
  return filtered.slice(0, Math.min(limit, 500));
}
