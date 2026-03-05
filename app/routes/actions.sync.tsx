import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { assertManualSyncRateLimit } from "../services/manual-sync-guard.server";
import { resolveManualSyncDayRange, syncRun } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { isShopifyGid } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "").trim();
  const syncDayRaw = String(form.get("syncDay") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }
  try {
    const manualDayRange = resolveManualSyncDayRange(syncDayRaw);
    assertActionRateLimit("sync", shop, getClientIp(request), 5_000);
    assertManualSyncRateLimit(shop);
    const result = await syncRun(admin, shop, true, locationId, { syncDay: manualDayRange?.day ?? null });
    await safeLogAuditEvent(admin, shop, {
      eventType: "sync.manual.triggered",
      entityType: "sync",
      entityId: locationId,
      locationId,
      status: "success",
      message: "Synchronisation manuelle executee",
      payload: {
        imported: result.imported,
        syncDay: result.syncDay ?? null,
      },
    });
    return Response.json({
      ok: true,
      imported: result.imported,
      syncDay: result.syncDay ?? null,
      locationId: result.locationId,
      lastPrestaOrderId: result.lastPrestaOrderId,
      lastSyncAt: result.lastSyncAt,
    });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: "sync.manual.error",
      entityType: "sync",
      entityId: locationId,
      locationId,
      status: "error",
      message: error instanceof Error ? error.message : "Erreur sync manuelle",
      payload: {
        syncDay: syncDayRaw || null,
      },
    });
    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur de synchronisation.") },
      { status: 400 },
    );
  }
};



