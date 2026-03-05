export function sanitizeUrlForLogs(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("ws_key")) {
      url.searchParams.set("ws_key", "***");
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl.replace(/ws_key=[^&]+/g, "ws_key=***");
  }
}

export function debugLog(message: string, meta?: Record<string, unknown>) {
  const debugEnabled =
    typeof process !== "undefined" &&
    typeof process.env !== "undefined" &&
    process.env.DEBUG === "true";
  if (!debugEnabled) return;
  if (meta) {
    console.info(`[debug] ${message}`, meta);
  } else {
    console.info(`[debug] ${message}`);
  }
}
