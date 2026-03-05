import type { ActionFunctionArgs } from "react-router";
import { requireAdmin } from "../services/auth.server";
import { markAlertStatus, type AlertStatus } from "../services/inventoryAlertService";

function parseStatus(rawValue: string): AlertStatus {
  const normalized = rawValue.trim().toUpperCase();
  if (normalized === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (normalized === "RESOLVED") return "RESOLVED";
  return "OPEN";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ ok: false, error: `Méthode ${request.method} non autorisée.` }, { status: 405 });
  }

  try {
    const { admin, shop } = await requireAdmin(request);
    const form = await request.formData();
    const dedupKey = String(form.get("dedupKey") ?? "").trim();
    const status = parseStatus(String(form.get("status") ?? "OPEN"));

    if (!dedupKey) {
      return Response.json({ ok: false, error: "dedupKey requis." }, { status: 400 });
    }

    await markAlertStatus(admin, shop, { dedupKey, status });
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

export default function AlertStatusActionRoute() {
  return null;
}
