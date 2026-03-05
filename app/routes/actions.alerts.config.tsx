import type { ActionFunctionArgs } from "react-router";
import { safeLogAuditEvent } from "../services/auditLogService";
import { requireAdmin } from "../services/auth.server";
import { upsertAlertConfig, type AlertType } from "../services/inventoryAlertService";

const ALERT_TYPES: AlertType[] = ["LOW_STOCK", "OUT_OF_STOCK", "INCOMING_DELAY", "STOCKOUT_SOON", "OVERSTOCK", "SYNC_ERROR"];

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop, actor } = await requireAdmin(request);
    const form = await request.formData();

    const frequencyRaw = String(form.get("frequency") ?? "daily").trim().toLowerCase();
    const frequency =
      frequencyRaw === "instant" || frequencyRaw === "weekly" || frequencyRaw === "daily" ? frequencyRaw : "daily";

    const emailsRaw = String(form.get("emails") ?? "").trim();
    const emails = emailsRaw
      .split(/[,\n;]/g)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const stockoutSoonDays = Math.max(1, Math.trunc(Number(form.get("stockoutSoonDays") ?? "14")));
    const enabledTypes = ALERT_TYPES.filter((type) => String(form.get(`enabled:${type}`) ?? "") === "1");

    await upsertAlertConfig(admin, shop, {
      frequency,
      emails,
      enabledTypes: enabledTypes.length ? enabledTypes : ALERT_TYPES,
      stockoutSoonDays,
      updatedBy: actor,
    });

    await safeLogAuditEvent(admin, shop, {
      eventType: "alerts.config.updated",
      entityType: "alert_config",
      status: "success",
      actor,
      payload: {
        frequency,
        emailsCount: emails.length,
        stockoutSoonDays,
        enabledTypes,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur interne",
      },
      { status: 400 },
    );
  }
};

export default function AlertsConfigActionRoute() {
  return null;
}
