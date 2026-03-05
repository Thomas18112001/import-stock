import test from "node:test";
import assert from "node:assert/strict";

function ensurePrestaEnv(): void {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_ALLOWED_HOST = process.env.PRESTA_ALLOWED_HOST || "btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
}

test("getOrderDetails lit les lignes depuis /api/order_details", async () => {
  ensurePrestaEnv();
  const { getOrderDetails } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  const calls: string[] = [];
  const xml = `
    <prestashop>
      <order_details>
        <order_detail>
          <product_reference><![CDATA[WMVESSAL35]]></product_reference>
          <product_quantity><![CDATA[15]]></product_quantity>
        </order_detail>
        <order_detail>
          <product_reference><![CDATA[WMVESSAL36]]></product_reference>
          <product_quantity><![CDATA[3]]></product_quantity>
        </order_detail>
      </order_details>
    </prestashop>
  `;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }) as typeof global.fetch;

  try {
    const lines = await getOrderDetails(1000650);
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /\/api\/order_details/);
    assert.deepEqual(lines, [
      { sku: "WMVESSAL35", qty: 15 },
      { sku: "WMVESSAL36", qty: 3 },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("getOrderDetails fallback sur /api/orders/{id} si /api/order_details est vide", async () => {
  ensurePrestaEnv();
  const { getOrderDetails } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  const calls: string[] = [];
  const xmlOrderDetailsEmpty = `<prestashop><order_details></order_details></prestashop>`;
  const xmlOrderAssociations = `
    <prestashop>
      <order>
        <id><![CDATA[1000650]]></id>
        <associations>
          <order_rows>
            <order_row>
              <product_reference><![CDATA[WMVESSAL41]]></product_reference>
              <product_quantity><![CDATA[15]]></product_quantity>
            </order_row>
            <order_row>
              <product_reference><![CDATA[WMVESSAL42]]></product_reference>
              <product_quantity><![CDATA[7]]></product_quantity>
            </order_row>
          </order_rows>
        </associations>
      </order>
    </prestashop>
  `;
  let callIndex = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    callIndex += 1;
    const body = callIndex === 1 ? xmlOrderDetailsEmpty : xmlOrderAssociations;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }) as typeof global.fetch;

  try {
    const lines = await getOrderDetails(1000650);
    assert.equal(calls.length, 2);
    assert.match(calls[0] ?? "", /\/api\/order_details/);
    assert.match(calls[1] ?? "", /\/api\/orders\/1000650/);
    assert.deepEqual(lines, [
      { sku: "WMVESSAL41", qty: 15 },
      { sku: "WMVESSAL42", qty: 7 },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("getOrderDetails conserve les lignes sans référence en générant un SKU fallback", async () => {
  ensurePrestaEnv();
  const { getOrderDetails } = await import("../app/services/prestaClient");
  const originalFetch = global.fetch;
  const xml = `
    <prestashop>
      <order_details>
        <order_detail>
          <product_id><![CDATA[123]]></product_id>
          <product_attribute_id><![CDATA[456]]></product_attribute_id>
          <product_quantity><![CDATA[2]]></product_quantity>
        </order_detail>
      </order_details>
    </prestashop>
  `;
  global.fetch = (async () =>
    new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    })) as typeof global.fetch;

  try {
    const lines = await getOrderDetails(1000650);
    assert.deepEqual(lines, [{ sku: "PRESTA-123-456", qty: 2 }]);
  } finally {
    global.fetch = originalFetch;
  }
});
