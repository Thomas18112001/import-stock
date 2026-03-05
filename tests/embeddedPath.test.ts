import test from "node:test";
import assert from "node:assert/strict";
import { withEmbeddedContext } from "../app/utils/embeddedPath";

test("withEmbeddedContext conserve shop/host/embedded pour éviter les boucles auth", () => {
  const path = withEmbeddedContext("/reassorts-magasin", "?shop=demo.myshopify.com&host=abc123&embedded=1");
  assert.equal(path, "/reassorts-magasin?shop=demo.myshopify.com&host=abc123&embedded=1");
});

test("withEmbeddedContext n'écrase pas les paramètres déjà présents", () => {
  const path = withEmbeddedContext(
    "/reassorts-magasin?shop=custom.myshopify.com",
    "?shop=demo.myshopify.com&host=abc123&embedded=1",
  );
  assert.match(path, /^\/reassorts-magasin\?/);
  assert.match(path, /shop=custom\.myshopify\.com/);
  assert.match(path, /host=abc123/);
  assert.match(path, /embedded=1/);
});

test("withEmbeddedContext réutilise le contexte mémorisé si l'URL courante est vide", () => {
  const first = withEmbeddedContext("/tableau-de-bord", "?shop=demo.myshopify.com&host=abc123&embedded=1");
  assert.equal(first, "/tableau-de-bord?shop=demo.myshopify.com&host=abc123&embedded=1");

  const second = withEmbeddedContext("/reassorts-magasin", "");
  assert.equal(second, "/reassorts-magasin?shop=demo.myshopify.com&host=abc123&embedded=1");
});

test("withEmbeddedContext préfixe le basePath quand l'app est sous un sous-chemin", () => {
  const path = withEmbeddedContext(
    "/reassorts-magasin",
    "?shop=demo.myshopify.com&host=abc123&embedded=1",
    "/import-stock-boutique-dev/produits-en-reception",
  );
  assert.equal(
    path,
    "/import-stock-boutique-dev/reassorts-magasin?shop=demo.myshopify.com&host=abc123&embedded=1",
  );
});
