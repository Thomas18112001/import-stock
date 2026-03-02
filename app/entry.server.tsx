import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { isSensitiveRequestPath } from "./utils/sensitivePath.server";

export const streamTimeout = 5000;

function applySecurityHeaders(responseHeaders: Headers): void {
  const csp = [
    "default-src 'self' https://cdn.shopify.com",
    "script-src 'self' 'unsafe-inline' https://cdn.shopify.com",
    "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://cdn.shopify.com",
    "connect-src 'self' https://admin.shopify.com https://*.myshopify.com",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
  responseHeaders.set("Content-Security-Policy", csp);
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  const requestPath = new URL(request.url).pathname;
  if (isSensitiveRequestPath(requestPath)) {
    return new Response("Not found", { status: 404 });
  }
  addDocumentResponseHeaders(request, responseHeaders);
  applySecurityHeaders(responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (process.env.NODE_ENV !== "production") {
            console.error(error);
          }
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
