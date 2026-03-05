import test from "node:test";
import assert from "node:assert/strict";
import { loader } from "../app/routes/_index/route";

test("redirect racine n'utilise plus /app et pointe vers /reassorts-magasin", async () => {
  await assert.rejects(
    () =>
      loader({
        request: new Request("https://app.test/?shop=demo.myshopify.com&host=abc123&embedded=1"),
      } as never),
    (error: unknown) => {
      if (!(error instanceof Response)) return false;
      assert.equal(error.status, 302);
      assert.equal(
        error.headers.get("Location"),
        "reassorts-magasin?shop=demo.myshopify.com&host=abc123&embedded=1",
      );
      return true;
    },
  );
});
