const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(500 * (attempt + 1));
        attempt += 1;
        continue;
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(300 * (attempt + 1));
        attempt += 1;
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      await sleep(300 * (attempt + 1));
      attempt += 1;
    }
  }

  throw new Error(`Request failed after retries: ${String(lastError)}`);
}

export async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error("Response body too large");
    }
    chunks.push(value);
  }

  let text = "";
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}
