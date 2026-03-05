import {extend, Section, Stack, Text} from '@shopify/retail-ui-extensions';

const PRODUCT_DETAILS_TARGET = 'pos.product-details.block.render';

const LOCATION_GID_PREFIX = 'gid://shopify/Location/';
const INVENTORY_GID_PREFIX = 'gid://shopify/InventoryItem/';

function cleanText(value) {
  return String(value ?? '').trim();
}

function toDigits(value) {
  const text = cleanText(value);
  return /^\d+$/.test(text) ? text : '';
}

function toLocationGid(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (text.startsWith(LOCATION_GID_PREFIX)) return text;
  const digits = toDigits(text);
  return digits ? `${LOCATION_GID_PREFIX}${digits}` : '';
}

function toInventoryItemGid(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (text.startsWith(INVENTORY_GID_PREFIX)) return text;
  const digits = toDigits(text);
  return digits ? `${INVENTORY_GID_PREFIX}${digits}` : '';
}

function deepFindValues(root, allowedKeys, maxDepth = 5) {
  const hits = [];
  const seen = new WeakSet();

  function walk(value, depth) {
    if (!value || typeof value !== 'object' || depth > maxDepth) return;
    if (seen.has(value)) return;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (allowedKeys.has(key) && (typeof child === 'string' || typeof child === 'number')) {
        hits.push(String(child));
      }
      if (child && typeof child === 'object') {
        walk(child, depth + 1);
      }
    }
  }

  walk(root, 0);
  return hits;
}

function getSettings(api) {
  return api?.settings ?? api?.extension?.settings ?? {};
}

function getSession(api) {
  return api?.session?.currentSession ?? {};
}

function getShopDomain(api) {
  const settings = getSettings(api);
  const session = getSession(api);
  const fromSettings = cleanText(settings.shop_domain);
  const fromSession = cleanText(session.shopDomain);
  const fromDeep = deepFindValues(api, new Set(['shopDomain', 'shop_domain']), 3).map(cleanText).find(Boolean) || '';
  return fromSettings || fromSession || fromDeep;
}

function getLocationId(api) {
  const session = getSession(api);
  const candidates = [
    session.locationId,
    api?.location?.id,
    api?.locationId,
    ...deepFindValues(api, new Set(['locationId', 'location_id']), 3),
  ];
  for (const candidate of candidates) {
    const gid = toLocationGid(candidate);
    if (gid) return gid;
  }
  return '';
}

function getSku(api) {
  const candidates = [
    api?.productVariant?.sku,
    api?.data?.productVariant?.sku,
    api?.product?.selectedVariant?.sku,
    ...deepFindValues(api, new Set(['sku', 'SKU']), 5),
  ];
  for (const candidate of candidates) {
    const sku = cleanText(candidate);
    if (sku) return sku;
  }
  return '';
}

function getInventoryItemId(api) {
  const candidates = [
    api?.productVariant?.inventoryItemId,
    api?.productVariant?.inventoryItem?.id,
    api?.data?.productVariant?.inventoryItemId,
    api?.data?.productVariant?.inventoryItem?.id,
    api?.product?.selectedVariant?.inventoryItemId,
    ...deepFindValues(api, new Set(['inventoryItemId', 'inventory_item_id', 'inventoryItemGid']), 5),
  ];
  for (const candidate of candidates) {
    const gid = toInventoryItemGid(candidate);
    if (gid) return gid;
  }
  return '';
}

function ensureStatusLine(root, stack, content = 'Chargement...') {
  const line = root.createComponent(Text, {variant: 'body', color: 'TextSubdued'}, content);
  stack.appendChild(line);
  return line;
}

function formatDate(value) {
  if (!value) return '-';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('fr-FR') : '-';
}

async function fetchJson(url, token) {
  const headers = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });
  const body = await response.json();
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function loadIncomingForProduct(api, params) {
  const settings = getSettings(api);
  const session = getSession(api);
  const token = await api?.session?.getSessionToken?.();
  const apiBaseUrl = cleanText(settings.api_base_url).replace(/\/$/, '');
  const shopDomain = cleanText(settings.shop_domain) || cleanText(session.shopDomain) || cleanText(params.shopDomain);

  if (!params.locationId || (!params.sku && !params.inventoryItemId)) {
    return {
      ok: false,
      error: 'Infos insuffisantes (location/sku).',
    };
  }

  const query = new URLSearchParams();
  query.set('locationId', params.locationId);
  if (shopDomain) query.set('shop', shopDomain);
  if (params.sku) query.set('sku', params.sku);
  if (params.inventoryItemId) query.set('inventoryItemId', params.inventoryItemId);

  const endpoint = apiBaseUrl
    ? `${apiBaseUrl}/api/pos/incoming?${query.toString()}`
    : `/api/pos/incoming?${query.toString()}`;

  const body = await fetchJson(endpoint, token);
  return {ok: true, body};
}

extend(PRODUCT_DETAILS_TARGET, async (root, api) => {
  const section = root.createComponent(Section, {title: 'Entrant'});
  const stack = root.createComponent(Stack, {direction: 'vertical', spacing: 2});
  section.appendChild(stack);
  root.appendChild(section);

  const statusLine = ensureStatusLine(root, stack, 'Chargement...');
  const availableLine = root.createComponent(Text, {variant: 'body'}, 'Disponible boutique: -');
  const incomingLine = root.createComponent(Text, {variant: 'body'}, 'En arrivage: -');
  const etaLine = root.createComponent(Text, {variant: 'body'}, 'ETA: -');
  const metaLine = root.createComponent(Text, {variant: 'captionRegularTall', color: 'TextSubdued'}, '');
  stack.appendChild(availableLine);
  stack.appendChild(incomingLine);
  stack.appendChild(etaLine);
  stack.appendChild(metaLine);

  try {
    const sku = getSku(api);
    const inventoryItemId = getInventoryItemId(api);
    const locationId = getLocationId(api);
    const shopDomain = getShopDomain(api);

    const result = await loadIncomingForProduct(api, {
      sku,
      inventoryItemId,
      locationId,
      shopDomain,
    });

    if (!result.ok) {
      statusLine.replaceChildren(result.error);
      metaLine.replaceChildren(`SKU: ${sku || '-'} | Location: ${locationId || '-'}`);
      return;
    }

    const body = result.body;
    statusLine.replaceChildren(body.delayed ? 'Retard ETA détecté' : '');
    availableLine.replaceChildren(`Disponible boutique: ${Number(body.availableQty || 0)}`);
    incomingLine.replaceChildren(`En arrivage: ${Number(body.incomingQty || 0)}`);
    etaLine.replaceChildren(`ETA: ${formatDate(body.etaDate)}`);
    metaLine.replaceChildren(`SKU: ${sku || '-'} | Location: ${locationId || '-'}`);
  } catch (error) {
    statusLine.replaceChildren(error instanceof Error ? error.message : 'Erreur de chargement');
  }
});
