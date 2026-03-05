import nodemailer from "nodemailer";
import type { AdminClient } from "./auth.server";
import { safeLogAuditEvent } from "./auditLogService";
import { getAlertConfig, listAlertEvents, upsertAlertsFromPlanningRows } from "./inventoryAlertService";
import { buildPlanningRows } from "./inventoryPlanningService";
import { listLocations } from "./shopifyGraphql";
import { getShopMetafieldValue, setShopMetafields } from "./shopifyMetaobjects";

const METAFIELD_NAMESPACE = "wearmoi_stock_sync";
const KEY_INSTANT_SENT_OPEN = "alerts_instant_sent_open_keys";
const KEY_DAILY_LAST_AT = "alerts_digest_daily_last_at";
const KEY_WEEKLY_LAST_AT = "alerts_digest_weekly_last_at";
const DEFAULT_FROM = process.env.ALERT_EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || process.env.PO_EMAIL_FROM?.trim() || "";

type DispatchMode = "instant" | "daily" | "weekly";

export type AlertNotificationDispatchResult = {
  mode: DispatchMode;
  recipients: string[];
  refreshedLocations: string[];
  openAlertsCount: number;
  sentCount: number;
  sentDedupKeys: string[];
  skippedReason: string;
};

function cleanText(value?: string | null): string {
  return String(value ?? "").trim();
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseJsonArray(rawValue: string | null): string[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => cleanText(String(value))).filter(Boolean);
  } catch {
    return [];
  }
}

function isDailyDue(lastAt: string | null): boolean {
  if (!lastAt) return true;
  const ms = Date.parse(lastAt);
  if (!Number.isFinite(ms)) return true;
  const last = new Date(ms);
  const now = new Date();
  return (
    last.getUTCFullYear() !== now.getUTCFullYear() ||
    last.getUTCMonth() !== now.getUTCMonth() ||
    last.getUTCDate() !== now.getUTCDate()
  );
}

function isWeeklyDue(lastAt: string | null): boolean {
  if (!lastAt) return true;
  const ms = Date.parse(lastAt);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms >= 7 * 24 * 60 * 60 * 1000;
}

function buildAlertEmailBody(input: {
  shopDomain: string;
  mode: DispatchMode;
  alerts: Array<{ type: string; severity: string; sku: string; locationId: string; message: string; dedupKey: string }>;
}): string {
  const lines = [
    `Alertes inventaire (${input.mode}) - ${input.shopDomain}`,
    "",
    `Total alertes: ${input.alerts.length}`,
    "",
  ];

  for (const alert of input.alerts) {
    lines.push(`- [${alert.severity}] ${alert.type} | SKU ${alert.sku || "-"} | Location ${alert.locationId || "-"}`);
    lines.push(`  ${alert.message || "-"}`);
  }

  lines.push("");
  lines.push("Message automatique - application Import Stock Boutique.");
  return lines.join("\n");
}

async function sendAlertEmail(input: {
  recipients: string[];
  subject: string;
  body: string;
}): Promise<void> {
  const smtpHost = process.env.SMTP_HOST?.trim() || "";
  const smtpPortRaw = process.env.SMTP_PORT?.trim() || "587";
  const smtpUser = process.env.SMTP_USER?.trim() || "";
  const smtpPass = process.env.SMTP_PASS?.trim() || "";
  const smtpPort = Number(smtpPortRaw);

  if (!smtpHost || !smtpUser || !smtpPass || !DEFAULT_FROM || !Number.isFinite(smtpPort)) {
    throw new Error("Configuration SMTP incomplète pour l'envoi des alertes.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: DEFAULT_FROM,
    to: input.recipients.join(", "),
    subject: input.subject,
    text: input.body,
  });
}

export async function dispatchAlertNotifications(
  admin: AdminClient,
  shopDomain: string,
  input: {
    locationId?: string | null;
    force?: boolean;
    dryRun?: boolean;
    actor?: string;
  } = {},
): Promise<AlertNotificationDispatchResult> {
  const config = await getAlertConfig(admin, shopDomain);
  const mode = config.frequency;
  const recipients = config.emails.filter(isEmailLike);
  const actor = cleanText(input.actor) || "system";

  if (!recipients.length) {
    return {
      mode,
      recipients: [],
      refreshedLocations: [],
      openAlertsCount: 0,
      sentCount: 0,
      sentDedupKeys: [],
      skippedReason: "Aucun destinataire email configuré.",
    };
  }

  const locations = await listLocations(admin);
  const selectedLocations = input.locationId
    ? locations.filter((location) => location.id === input.locationId)
    : locations;

  const refreshedLocations: string[] = [];
  for (const location of selectedLocations) {
    const { rows } = await buildPlanningRows(admin, shopDomain, {
      locationId: location.id,
      rangeDays: 30,
      status: "all",
      limit: 250,
    });
    await upsertAlertsFromPlanningRows(admin, shopDomain, {
      locationId: location.id,
      rows,
      config,
    });
    refreshedLocations.push(location.id);
  }

  const openAlerts = await listAlertEvents(admin, shopDomain, {
    status: "OPEN",
    locationId: input.locationId || undefined,
    limit: 500,
  });
  if (!openAlerts.length) {
    return {
      mode,
      recipients,
      refreshedLocations,
      openAlertsCount: 0,
      sentCount: 0,
      sentDedupKeys: [],
      skippedReason: "Aucune alerte ouverte.",
    };
  }

  const openDedupKeys = new Set(openAlerts.map((alert) => alert.dedupKey));
  const nowIso = new Date().toISOString();

  if (mode === "instant") {
    const rawSent = await getShopMetafieldValue(admin, METAFIELD_NAMESPACE, KEY_INSTANT_SENT_OPEN);
    const sentSet = new Set(parseJsonArray(rawSent));

    // Drop dedup keys no longer open to allow re-notification after a resolve/reopen cycle.
    for (const key of Array.from(sentSet)) {
      if (!openDedupKeys.has(key)) sentSet.delete(key);
    }

    const pending = openAlerts.filter((alert) => !sentSet.has(alert.dedupKey));
    if (!pending.length) {
      await setShopMetafields(admin, [
        {
          namespace: METAFIELD_NAMESPACE,
          key: KEY_INSTANT_SENT_OPEN,
          type: "json",
          value: JSON.stringify(Array.from(sentSet).sort()),
        },
      ]);
      return {
        mode,
        recipients,
        refreshedLocations,
        openAlertsCount: openAlerts.length,
        sentCount: 0,
        sentDedupKeys: [],
        skippedReason: "Aucune nouvelle alerte à notifier (anti-spam).",
      };
    }

    const body = buildAlertEmailBody({
      shopDomain,
      mode,
      alerts: pending.map((alert) => ({
        type: alert.type,
        severity: alert.severity,
        sku: alert.sku,
        locationId: alert.locationId,
        message: alert.message,
        dedupKey: alert.dedupKey,
      })),
    });
    if (!input.dryRun) {
      await sendAlertEmail({
        recipients,
        subject: `[Alerte instantanée] ${pending.length} alerte(s) inventaire`,
        body,
      });
      for (const alert of pending) {
        sentSet.add(alert.dedupKey);
      }
      await setShopMetafields(admin, [
        {
          namespace: METAFIELD_NAMESPACE,
          key: KEY_INSTANT_SENT_OPEN,
          type: "json",
          value: JSON.stringify(Array.from(sentSet).sort()),
        },
      ]);
    }

    await safeLogAuditEvent(admin, shopDomain, {
      eventType: "alerts.email.instant",
      entityType: "alert_email",
      status: "success",
      actor,
      payload: {
        recipients,
        sentCount: pending.length,
        dryRun: Boolean(input.dryRun),
      },
    });

    return {
      mode,
      recipients,
      refreshedLocations,
      openAlertsCount: openAlerts.length,
      sentCount: pending.length,
      sentDedupKeys: pending.map((alert) => alert.dedupKey),
      skippedReason: "",
    };
  }

  const digestKey = mode === "daily" ? KEY_DAILY_LAST_AT : KEY_WEEKLY_LAST_AT;
  const lastDigestAt = await getShopMetafieldValue(admin, METAFIELD_NAMESPACE, digestKey);
  const due = input.force ? true : mode === "daily" ? isDailyDue(lastDigestAt) : isWeeklyDue(lastDigestAt);
  if (!due) {
    return {
      mode,
      recipients,
      refreshedLocations,
      openAlertsCount: openAlerts.length,
      sentCount: 0,
      sentDedupKeys: [],
      skippedReason: "Digest non dû (anti-spam fréquence).",
    };
  }

  const body = buildAlertEmailBody({
    shopDomain,
    mode,
    alerts: openAlerts.map((alert) => ({
      type: alert.type,
      severity: alert.severity,
      sku: alert.sku,
      locationId: alert.locationId,
      message: alert.message,
      dedupKey: alert.dedupKey,
    })),
  });
  if (!input.dryRun) {
    await sendAlertEmail({
      recipients,
      subject: `[Digest ${mode}] ${openAlerts.length} alerte(s) inventaire ouvertes`,
      body,
    });
    await setShopMetafields(admin, [
      {
        namespace: METAFIELD_NAMESPACE,
        key: digestKey,
        type: "single_line_text_field",
        value: nowIso,
      },
    ]);
  }

  await safeLogAuditEvent(admin, shopDomain, {
    eventType: `alerts.email.${mode}`,
    entityType: "alert_email",
    status: "success",
    actor,
    payload: {
      recipients,
      sentCount: openAlerts.length,
      dryRun: Boolean(input.dryRun),
    },
  });

  return {
    mode,
    recipients,
    refreshedLocations,
    openAlertsCount: openAlerts.length,
    sentCount: openAlerts.length,
    sentDedupKeys: openAlerts.map((alert) => alert.dedupKey),
    skippedReason: "",
  };
}
