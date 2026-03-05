import "@shopify/ui-extensions/preact";
import {render} from 'preact';

export default async () => {
  render(<Extension />, document.body);
}

function Extension() {
  const {i18n} = shopify;

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeBase(value) {
    let raw = cleanText(value);
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) {
      raw = `https://${raw}`;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return '';
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
    } catch {
      return '';
    }
  }

  function readConfiguredApiBase() {
    const candidates = [
      shopify?.settings?.api_base_url,
      shopify?.settings?.apiBaseUrl,
      shopify?.settings?.value?.api_base_url,
      shopify?.settings?.value?.apiBaseUrl,
      shopify?.extension?.settings?.api_base_url,
      shopify?.extension?.settings?.apiBaseUrl,
      shopify?.extension?.settings?.value?.api_base_url,
      shopify?.extension?.settings?.value?.apiBaseUrl,
      shopify?.config?.settings?.api_base_url,
      shopify?.config?.settings?.apiBaseUrl,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeBase(candidate);
      if (normalized) return normalized;
    }
    return '';
  }

  async function openModal() {
    const apiBase = readConfiguredApiBase();
    if (apiBase && shopify?.storage?.set) {
      try {
        await shopify.storage.set('wm_api_base_url', apiBase);
      } catch {
        // Ignore storage failures.
      }
    }
    shopify.action.presentModal();
  }

  return (
    <s-tile
      heading={i18n.translate('tile_heading')}
      subheading={i18n.translate('tile_subheading')}
      onClick={() => {
        void openModal();
      }}
    />
  );
}
