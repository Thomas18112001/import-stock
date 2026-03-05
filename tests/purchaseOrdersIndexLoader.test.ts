import test from "node:test";
import assert from "node:assert/strict";
import { MissingShopifyScopeError } from "../app/utils/shopifyScopeErrors";

function ensurePurchaseOrdersLoaderEnv(): void {
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

async function loadRouteModule() {
  ensurePurchaseOrdersLoaderEnv();
  return import("../app/routes/app.purchase-orders._index");
}

test("loader Réassorts magasin retourne des données exploitables (smoke)", async () => {
  const route = await loadRouteModule();
  const result = await route.loadPurchaseOrdersIndexData({
    admin: {} as never,
    shop: "demo.myshopify.com",
    status: "",
    destinationLocationId: "",
    debug: false,
    deps: {
      listLocationsFn: async () => [{ id: "gid://shopify/Location/1", name: "Boutique Toulon" }],
      listPurchaseOrdersFn: async () => [
        {
          gid: "gid://shopify/Metaobject/1",
          number: "RS-2026-0001",
          supplierName: "DEPOT DWP",
          destinationLocationId: "gid://shopify/Location/1",
          destinationLocationName: "Boutique Toulon",
          issuedAt: "2026-03-04T08:00:00Z",
          expectedArrivalAt: "2026-03-05T08:00:00Z",
          status: "DRAFT",
          lineCount: 3,
          totalTtc: 120,
          currency: "EUR",
          updatedAt: "2026-03-04T08:00:00Z",
        },
      ],
      getPurchaseOrderDetailFn: async () => ({
        order: {
          destinationLocationId: "gid://shopify/Location/1",
          destinationLocationName: "Boutique Toulon",
        } as never,
        lines: [
          {
            sku: "SKU-1",
            quantityOrdered: 5,
            quantityReceived: 1,
            productTitle: "Produit test",
            variantTitle: "Taille M",
            imageUrl: "https://example.test/a.jpg",
          },
        ] as never,
        audit: [],
      }),
    },
  });

  assert.equal(result.loadError, null);
  assert.equal(result.scopeIssue, null);
  assert.equal(result.orders.length, 1);
  assert.equal(result.locations.length, 1);
  assert.equal(result.stockEntrant.totalReassorts, 0);
});

test("loader Réassorts magasin ne boucle pas en cas de scope manquant", async () => {
  const route = await loadRouteModule();
  const result = await route.loadPurchaseOrdersIndexData({
    admin: {} as never,
    shop: "demo.myshopify.com",
    status: "",
    destinationLocationId: "",
    debug: false,
    deps: {
      listLocationsFn: async () => [{ id: "gid://shopify/Location/1", name: "Boutique Toulon" }],
      listPurchaseOrdersFn: async () => {
        throw new MissingShopifyScopeError("read_metaobject_definitions");
      },
      getPurchaseOrderDetailFn: async () => ({
        order: {} as never,
        lines: [],
        audit: [],
      }),
    },
  });

  assert.equal(result.loadError, null);
  assert.equal(result.orders.length, 0);
  assert.equal(result.locations.length, 0);
  assert.equal(result.scopeIssue?.missingScope, "read_metaobject_definitions");
});

test("loader Réassorts magasin sort du chargement quand le backend tarde", async () => {
  const route = await loadRouteModule();
  const result = await route.loadPurchaseOrdersIndexData({
    admin: {} as never,
    shop: "demo.myshopify.com",
    status: "",
    destinationLocationId: "",
    debug: false,
    timeoutMs: 10,
    deps: {
      listLocationsFn: async () => [{ id: "gid://shopify/Location/1", name: "Boutique Toulon" }],
      listPurchaseOrdersFn: async () =>
        new Promise<never>(() => {
          // Intentionally unresolved to validate timeout safety.
        }),
      getPurchaseOrderDetailFn: async () => ({
        order: {} as never,
        lines: [],
        audit: [],
      }),
    },
  });

  assert.equal(result.orders.length, 0);
  assert.equal(result.scopeIssue, null);
  assert.match(result.loadError ?? "", /chargement des réassorts est trop long/i);
});

test("loader Réassorts magasin calcule le stock entrant pour les statuts en cours d'arrivage", async () => {
  const route = await loadRouteModule();
  const result = await route.loadPurchaseOrdersIndexData({
    admin: {} as never,
    shop: "demo.myshopify.com",
    status: "",
    destinationLocationId: "",
    debug: false,
    deps: {
      listLocationsFn: async () => [{ id: "gid://shopify/Location/1", name: "Boutique Toulon" }],
      listPurchaseOrdersFn: async () => [
        {
          gid: "gid://shopify/Metaobject/2",
          number: "RS-2026-0002",
          supplierName: "DEPOT DWP",
          destinationLocationId: "gid://shopify/Location/1",
          destinationLocationName: "Boutique Toulon",
          issuedAt: "2026-03-04T08:00:00Z",
          expectedArrivalAt: "2026-03-05T08:00:00Z",
          status: "INCOMING",
          lineCount: 2,
          totalTtc: 120,
          currency: "EUR",
          updatedAt: "2026-03-04T08:00:00Z",
        },
      ],
      getPurchaseOrderDetailFn: async () => ({
        order: {
          destinationLocationId: "gid://shopify/Location/1",
          destinationLocationName: "Boutique Toulon",
        } as never,
        lines: [
          {
            sku: "SKU-ENTRANT",
            quantityOrdered: 8,
            quantityReceived: 3,
            productTitle: "Body danse",
            variantTitle: "Noir / M",
            imageUrl: "",
          },
        ] as never,
        audit: [],
      }),
    },
  });

  assert.equal(result.stockEntrant.totalReassorts, 1);
  assert.equal(result.stockEntrant.totalLignes, 1);
  assert.equal(result.stockEntrant.totalUnites, 5);
  assert.equal(result.stockEntrant.produits[0]?.sku, "SKU-ENTRANT");
});
