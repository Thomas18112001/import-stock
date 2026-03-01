import test from "node:test";
import assert from "node:assert/strict";
import { assertCronSecret } from "../app/services/cron-guard.server";

test("cron secret accepte le header X-CRON-SECRET", () => {
  const request = new Request("https://example.com/api/cron/sync", {
    headers: { "X-CRON-SECRET": "top-secret" },
  });

  assert.doesNotThrow(() => assertCronSecret(request, "top-secret"));
});

test("cron secret accepte la query cron_secret", () => {
  const request = new Request("https://example.com/api/cron/sync?cron_secret=top-secret");

  assert.doesNotThrow(() => assertCronSecret(request, "top-secret"));
});

test("cron secret refuse un secret absent ou invalide", () => {
  const missing = new Request("https://example.com/api/cron/sync");
  const wrong = new Request("https://example.com/api/cron/sync", {
    headers: { "X-CRON-SECRET": "wrong" },
  });

  assert.throws(
    () => assertCronSecret(missing, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
  assert.throws(
    () => assertCronSecret(wrong, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});
