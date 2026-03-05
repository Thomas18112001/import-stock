import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveRequestPath } from "../app/utils/sensitivePath.server";

test("bloque les chemins sensibles", () => {
  assert.equal(isSensitiveRequestPath("/.env"), true);
  assert.equal(isSensitiveRequestPath("/.shopify/project.json"), true);
  assert.equal(isSensitiveRequestPath("/deploy/nginx/import-stock.woora.fr.conf"), true);
  assert.equal(isSensitiveRequestPath("/Dockerfile"), true);
});

test("autorise les chemins applicatifs standards", () => {
  assert.equal(isSensitiveRequestPath("/app"), false);
  assert.equal(isSensitiveRequestPath("/actions/synchroniser"), false);
  assert.equal(isSensitiveRequestPath("/favicon.ico"), false);
});
