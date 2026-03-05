export function formatRelativeSyncFr(lastSyncAt: string | undefined): string {
  if (!lastSyncAt) return "Aucune synchronisation récente.";
  const targetMs = Date.parse(lastSyncAt);
  if (!Number.isFinite(targetMs)) return "Aucune synchronisation récente.";
  const diffMs = Math.max(0, Date.now() - targetMs);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "À l'instant.";
  if (minutes < 60) return `Il y a ${minutes} min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h.`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days} jour(s).`;
}


