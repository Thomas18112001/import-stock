const POS_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  Vary: "Origin, Access-Control-Request-Headers",
};

export function buildPosCorsHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(POS_CORS_HEADERS);
  if (extra) {
    const incoming = new Headers(extra);
    incoming.forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

export function jsonPos(data: unknown, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  const headers = buildPosCorsHeaders(responseInit.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers,
  });
}

export function posPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: buildPosCorsHeaders(),
  });
}
