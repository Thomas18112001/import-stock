import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function ensureApiEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test-key";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test-secret";
  process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.test";
  process.env.SCOPES =
    process.env.SCOPES ||
    "read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_locations,read_products,read_inventory,write_inventory";
}

async function loadFromPrestaApiModule() {
  ensureApiEnv();
  return import("../app/routes/api.reassorts.from-prestashop-order");
}

async function loadListApiModule() {
  ensureApiEnv();
  return import("../app/routes/api.reassorts");
}

test("API from-prestashop valide le payload requis", async () => {
  const mod = await loadFromPrestaApiModule();

  assert.throws(
    () =>
      mod.normalizeReassortFromPrestashopPayload({
        prestashopOrderId: null,
        destinationLocationId: "",
        lines: [],
      }),
    /commande prestashop obligatoire|destination obligatoire|aucune ligne/i,
  );
});

test("API from-prestashop reste idempotente via upsert (2e appel sans doublon)", async () => {
  const mod = await loadFromPrestaApiModule();
  const payload = mod.normalizeReassortFromPrestashopPayload({
    prestashopOrderId: 100650,
    orderReference: "CQFIQRBHA",
    destinationLocationId: "gid://shopify/Location/1",
    lines: [{ sku: "WMVESSAL35", quantity: 15 }],
  });

  const store = new Map<string, { id: string; number: string }>();
  let seq = 1;
  const upsertFn = async (_admin: unknown, _shop: string, input: { prestaOrderId: number; destinationLocationId: string }) => {
    const key = `${input.prestaOrderId}:${input.destinationLocationId}`;
    if (!store.has(key)) {
      store.set(key, {
        id: `gid://shopify/Metaobject/${seq}`,
        number: `RS-2026-${String(seq).padStart(4, "0")}`,
      });
      seq += 1;
      const createdEntry = store.get(key)!;
      return {
        purchaseOrderGid: createdEntry.id,
        number: createdEntry.number,
        status: "INCOMING" as const,
        created: true,
        lines: [{ sku: "WMVESSAL35", quantityOrdered: 15, quantityReceived: 0 }],
      };
    }
    const existing = store.get(key)!;
    return {
      purchaseOrderGid: existing.id,
      number: existing.number,
      status: "INCOMING" as const,
      created: false,
      lines: [{ sku: "WMVESSAL35", quantityOrdered: 15, quantityReceived: 0 }],
    };
  };

  const first = await mod.upsertReassortFromPrestashopPayload({
    admin: {} as never,
    shop: "demo.myshopify.com",
    actor: "test@woora.fr",
    payload,
    deps: {
      upsertFn: upsertFn as never,
    },
  });

  const second = await mod.upsertReassortFromPrestashopPayload({
    admin: {} as never,
    shop: "demo.myshopify.com",
    actor: "test@woora.fr",
    payload,
    deps: {
      upsertFn: upsertFn as never,
    },
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.purchaseOrderGid, second.purchaseOrderGid);
  assert.equal(store.size, 1);
});

test("API liste des réassorts retourne les champs métier attendus", async () => {
  const mod = await loadListApiModule();
  const data = await mod.loadReassortsApiData({
    admin: {} as never,
    shop: "demo.myshopify.com",
    status: "",
    destinationLocationId: "",
    deps: {
      listPurchaseOrdersFn: async () => [
        {
          gid: "gid://shopify/Metaobject/1",
          number: "RS-2026-0001",
          supplierName: "DEPOT DWP",
          destinationLocationId: "gid://shopify/Location/1",
          destinationLocationName: "Boutique Toulon",
          issuedAt: "2026-03-04T08:00:00Z",
          expectedArrivalAt: "",
          status: "INCOMING",
          lineCount: 2,
          totalTtc: 0,
          currency: "EUR",
          updatedAt: "2026-03-04T08:00:00Z",
        },
      ],
    },
  });

  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].numero, "RS-2026-0001");
  assert.equal(data.items[0].nbArticles, 2);
});

test("UI smoke: le détail réception expose l'accès direct au réassort et au PDF", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "app/routes/app.receipts.$receiptIdEnc.tsx"),
    "utf8",
  );

  assert.match(source, /Réassort créé:/);
  assert.match(source, /Ouvrir le réassort/);
  assert.match(source, /\/api\/reassorts\/pdf\?id=\$\{restockOrderIdEnc\}/);
});
