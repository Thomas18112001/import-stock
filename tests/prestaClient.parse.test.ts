import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import {
  getText,
  parseOrderDetailXml,
  parseOrdersListXml,
} from "../app/services/prestaXmlParser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  trimValues: true,
});

function loadFixture(filename: string) {
  const filePath = path.resolve(process.cwd(), "tests", "fixtures", filename);
  return fs.readFileSync(filePath, "utf-8");
}

test("parseOrderDetailXml parses /api/orders/{id} payload", () => {
  const xml = loadFixture("presta-order-detail.xml");
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const order = parseOrderDetailXml(parsed);

  assert.equal(order.id, 1000500);
  assert.equal(order.customerId, 21749);
  assert.equal(order.reference, "ABC-1000500");
  assert.equal(order.dateAdd, "2026-02-27 10:15:00");
  assert.equal(order.dateUpd, "2026-02-27 10:16:00");
});

test("parseOrdersListXml parses /api/orders list payload", () => {
  const xml = loadFixture("presta-orders-list.xml");
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const orders = parseOrdersListXml(parsed);

  assert.equal(orders.length, 2);
  assert.equal(orders[0]?.id, 1000500);
  assert.equal(orders[0]?.customerId, 21749);
  assert.equal(orders[1]?.id, 1000501);
});

test("getText handles text and #text nodes", () => {
  assert.equal(getText("abc"), "abc");
  assert.equal(getText({ "#text": "def" }), "def");
  assert.equal(getText(123), "123");
});
