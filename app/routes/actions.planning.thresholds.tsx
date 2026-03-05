import type { ActionFunctionArgs } from "react-router";
import { safeLogAuditEvent } from "../services/auditLogService";
import { requireAdmin } from "../services/auth.server";
import {
  copyThresholdOverrides,
  resetThresholdOverride,
  upsertThresholdGlobal,
  upsertThresholdOverride,
} from "../services/inventoryThresholdService";
import { parseNonNegativeIntInput } from "../utils/validators";

function parseRequiredText(value: FormDataEntryValue | null, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${label} obligatoire.`);
  }
  return normalized;
}

function parseCsvInt(rawValue: string, label: string, lineNumber: number): number {
  const normalized = String(rawValue ?? "").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Ligne ${lineNumber}: ${label} invalide.`);
  }
  return Math.trunc(parsed);
}

function parseThresholdCsvRows(rawValue: string): Array<{
  sku: string;
  minQty: number;
  maxQty: number;
  safetyStock: number;
  targetCoverageDays: number;
}> {
  const lines = String(rawValue ?? "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const firstCells = lines[0].split(delimiter).map((cell) => cell.trim().toLowerCase());
  const hasHeader = firstCells.some((cell) => cell === "sku");

  const startIndex = hasHeader ? 1 : 0;
  const rows: Array<{
    sku: string;
    minQty: number;
    maxQty: number;
    safetyStock: number;
    targetCoverageDays: number;
  }> = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = lines[index].split(delimiter).map((cell) => cell.trim());
    const sku = String(cells[0] ?? "").trim();
    if (!sku) {
      throw new Error(`Ligne ${lineNumber}: SKU obligatoire.`);
    }

    rows.push({
      sku,
      minQty: parseCsvInt(cells[1] ?? "", "minQty", lineNumber),
      maxQty: parseCsvInt(cells[2] ?? "", "maxQty", lineNumber),
      safetyStock: parseCsvInt(cells[3] ?? "", "safetyStock", lineNumber),
      targetCoverageDays: Math.max(1, parseCsvInt(cells[4] ?? "", "targetCoverageDays", lineNumber) || 30),
    });
  }

  return rows;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop, actor } = await requireAdmin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "").trim();

    if (intent === "upsert_global") {
      const sku = parseRequiredText(form.get("sku"), "SKU");
      const minQty = parseNonNegativeIntInput(form.get("minQty")) ?? 0;
      const maxQty = parseNonNegativeIntInput(form.get("maxQty")) ?? 0;
      const safetyStock = parseNonNegativeIntInput(form.get("safetyStock")) ?? 0;
      const targetCoverageDays = parseNonNegativeIntInput(form.get("targetCoverageDays")) ?? 30;

      await upsertThresholdGlobal(admin, shop, {
        sku,
        minQty,
        maxQty,
        safetyStock,
        targetCoverageDays,
        updatedBy: actor,
      });

      await safeLogAuditEvent(admin, shop, {
        eventType: "threshold.global.upsert",
        entityType: "threshold",
        status: "success",
        actor,
        payload: { sku, minQty, maxQty, safetyStock, targetCoverageDays },
      });

      return Response.json({ ok: true, mode: "global" });
    }

    if (intent === "bulk_upsert_global_csv") {
      const csv = String(form.get("csv") ?? "");
      const rows = parseThresholdCsvRows(csv);
      if (!rows.length) {
        return Response.json({ ok: false, error: "Aucune ligne CSV exploitable." }, { status: 400 });
      }

      for (const row of rows) {
        await upsertThresholdGlobal(admin, shop, {
          sku: row.sku,
          minQty: row.minQty,
          maxQty: row.maxQty,
          safetyStock: row.safetyStock,
          targetCoverageDays: row.targetCoverageDays,
          updatedBy: actor,
        });
      }

      await safeLogAuditEvent(admin, shop, {
        eventType: "threshold.global.bulk_upsert",
        entityType: "threshold",
        status: "success",
        actor,
        payload: { imported: rows.length },
      });

      return Response.json({ ok: true, mode: "global_csv", imported: rows.length });
    }

    if (intent === "upsert_override") {
      const sku = parseRequiredText(form.get("sku"), "SKU");
      const locationId = parseRequiredText(form.get("locationId"), "locationId");
      const minQty = parseNonNegativeIntInput(form.get("minQty")) ?? 0;
      const maxQty = parseNonNegativeIntInput(form.get("maxQty")) ?? 0;
      const safetyStock = parseNonNegativeIntInput(form.get("safetyStock")) ?? 0;
      const targetCoverageDays = parseNonNegativeIntInput(form.get("targetCoverageDays")) ?? 30;

      await upsertThresholdOverride(admin, shop, {
        sku,
        locationId,
        minQty,
        maxQty,
        safetyStock,
        targetCoverageDays,
        updatedBy: actor,
      });

      await safeLogAuditEvent(admin, shop, {
        eventType: "threshold.override.upsert",
        entityType: "threshold",
        locationId,
        status: "success",
        actor,
        payload: { sku, minQty, maxQty, safetyStock, targetCoverageDays },
      });

      return Response.json({ ok: true, mode: "override" });
    }

    if (intent === "reset_override") {
      const sku = parseRequiredText(form.get("sku"), "SKU");
      const locationId = parseRequiredText(form.get("locationId"), "locationId");
      const deleted = await resetThresholdOverride(admin, shop, { sku, locationId });

      await safeLogAuditEvent(admin, shop, {
        eventType: "threshold.override.reset",
        entityType: "threshold",
        locationId,
        status: "success",
        actor,
        payload: { sku, deleted },
      });

      return Response.json({ ok: true, deleted });
    }

    if (intent === "copy_overrides") {
      const fromLocationId = parseRequiredText(form.get("fromLocationId"), "fromLocationId");
      const toLocationId = parseRequiredText(form.get("toLocationId"), "toLocationId");

      const result = await copyThresholdOverrides(admin, shop, {
        fromLocationId,
        toLocationId,
        updatedBy: actor,
      });

      await safeLogAuditEvent(admin, shop, {
        eventType: "threshold.override.copy",
        entityType: "threshold",
        locationId: toLocationId,
        status: "success",
        actor,
        payload: { fromLocationId, toLocationId, copied: result.copied },
      });

      return Response.json({ ok: true, copied: result.copied });
    }

    return Response.json({ ok: false, error: "Intent non pris en charge." }, { status: 400 });
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

export default function ThresholdActionsRoute() {
  return null;
}
