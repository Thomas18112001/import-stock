import test from "node:test";
import assert from "node:assert/strict";
import { buildReauthPath, shouldTriggerReauth } from "../app/utils/reauth";

test("buildReauthPath encodes shop and scope", () => {
  const path = buildReauthPath("woora-app-2.myshopify.com", "read_metaobject_definitions");
  assert.match(path, /^\/auth\?/);
  assert.match(path, /shop=woora-app-2\.myshopify\.com/);
  assert.match(path, /scope=read_metaobject_definitions/);
  assert.match(path, /reauth=1/);
});

test("shouldTriggerReauth prevents loops when reauth=1 is already present", () => {
  const urlFirst = new URL("https://app.local/app");
  const urlReauth = new URL("https://app.local/app?reauth=1");
  assert.equal(shouldTriggerReauth(urlFirst), true);
  assert.equal(shouldTriggerReauth(urlReauth), false);
});

