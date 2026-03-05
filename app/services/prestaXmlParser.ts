export class PrestaParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrestaParsingError";
  }
}

export type PrestaOrder = {
  id: number;
  customerId: number;
  reference: string;
  currentState: string;
  dateAdd: string;
  dateUpd: string;
};

type XmlRecord = Record<string, unknown>;

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function getText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node).trim();
  if (typeof node === "object") {
    const rec = node as XmlRecord;
    if ("#text" in rec) return getText(rec["#text"]);
    if ("cdata" in rec) return getText(rec.cdata);
    if ("__cdata" in rec) return getText(rec.__cdata);
  }
  return "";
}

function parseOrderNode(node: unknown): PrestaOrder {
  const rec = (node ?? {}) as XmlRecord;
  const id = Number(getText(rec.id));
  const customerId = Number(getText(rec.id_customer));
  const reference = getText(rec.reference);
  const currentState = getText(rec.current_state);
  const dateAdd = getText(rec.date_add);
  const dateUpd = getText(rec.date_upd);

  if (!Number.isFinite(id) || id <= 0) {
    throw new PrestaParsingError(`Invalid Presta order id: ${getText(rec.id)}`);
  }
  if (!Number.isFinite(customerId) || customerId <= 0) {
    throw new PrestaParsingError(`Invalid Presta order customer id: ${getText(rec.id_customer)}`);
  }

  return { id, customerId, reference, currentState, dateAdd, dateUpd };
}

export function parseOrdersListXml(payload: XmlRecord): PrestaOrder[] {
  const ordersRoot = (payload.prestashop as { orders?: { order?: unknown } } | undefined)?.orders;
  const nodes = toArray(ordersRoot?.order);
  const parsed: PrestaOrder[] = [];
  for (const node of nodes) {
    try {
      parsed.push(parseOrderNode(node));
    } catch {
      // ignore malformed list rows
    }
  }
  return parsed;
}

export function parseOrderDetailXml(payload: XmlRecord): PrestaOrder {
  const node = (payload.prestashop as { order?: unknown } | undefined)?.order;
  if (!node) {
    throw new PrestaParsingError("Missing <prestashop><order> in detail payload");
  }
  return parseOrderNode(node);
}
