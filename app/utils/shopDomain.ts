import fs from "node:fs";
import path from "node:path";

export function shopFromHostParam(host: string | null): string | null {
  if (!host) return null;
  try {
    const decoded = Buffer.from(host, "base64url").toString("utf8").trim();
    if (!decoded) return null;
    if (decoded.endsWith(".myshopify.com")) return decoded;

    const storeMatch = decoded.match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
    if (storeMatch?.[1]) {
      return `${storeMatch[1]}.myshopify.com`;
    }
    return null;
  } catch {
    return null;
  }
}

export function readLinkedDevStoreFromProject(cwd = process.cwd()): string | null {
  try {
    const projectPath = path.join(cwd, ".shopify", "project.json");
    if (!fs.existsSync(projectPath)) return null;
    const raw = fs.readFileSync(projectPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, { dev_store_url?: string }>;
    const first = Object.values(parsed)[0]?.dev_store_url?.trim();
    return first && first.endsWith(".myshopify.com") ? first : null;
  } catch {
    return null;
  }
}

