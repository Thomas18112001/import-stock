import "@shopify/ui-extensions/preact";
/* eslint-disable react/prop-types */
import {render} from "preact";
import {useEffect, useMemo, useState} from "preact/hooks";

const HARD_FALLBACK_BASES = ["https://city-contain-amy-warning.trycloudflare.com"];

export default async () => {
  render(<Extension />, document.body);
};

function cleanUiLabel(value) {
  return String(value || "")
    .replace(/\bVignette POS pour les produits en arrivage\b/gi, "")
    .replace(/\bpar\s+Import Stock Boutique DEV\b/gi, "")
    .replace(/\bImport Stock Boutique DEV\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTransferRef(value) {
  const cleaned = cleanUiLabel(value);
  if (!cleaned) return "-";
  const matched = cleaned.match(/RS-\d{4}-\d{3,}/i);
  return matched ? matched[0].toUpperCase() : cleaned;
}

function formatDate(value) {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleDateString("fr-FR", {day: "2-digit", month: "short"}).replace(".", "").toUpperCase();
}

function getEtaBadge(item) {
  const eta = formatDate(item?.etaDate);
  if (item?.delayed) return {label: "RETARD", tone: "critical"};
  if (eta !== "-") return {label: `ETA ${eta}`, tone: "info"};
  return {label: "ETA —", tone: "neutral"};
}

function getItemKey(item, index) {
  return String(item?.id || item?.variantId || item?.inventoryItemId || item?.sku || `item-${index}`);
}

function IncomingRow({item}) {
  const title = cleanUiLabel(item?.productTitle || item?.sku || "Produit");
  const sku = cleanUiLabel(item?.sku || "-");
  const variant = cleanUiLabel(item?.variantTitle || "Variante standard");
  const sourceRef = normalizeTransferRef(item?.sources?.[0]?.number);
  const availableQty = Number(item?.availableQty || 0);
  const incomingQty = Number(item?.incomingQty || 0);
  const minQty = Number(item?.minQty || 0);
  const maxQty = Number(item?.maxQty || 0);
  const coverageDays = Number.isFinite(Number(item?.coverageDays)) ? Number(item?.coverageDays) : null;
  const stockoutDays = Number.isFinite(Number(item?.stockoutDays)) ? Number(item?.stockoutDays) : null;
  const eta = getEtaBadge(item);

  return (
    <s-box border="small-100 subdued" borderRadius="base" padding="base" background="base">
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
          <s-text type="strong">{title}</s-text>
          <s-badge tone={eta.tone}>{eta.label}</s-badge>
        </s-stack>

        <s-text color="subdued">{variant}</s-text>

        <s-stack direction="inline" gap="small">
          <s-box inlineSize="49%" background="subdued" borderRadius="base" padding="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type="inventory" tone={availableQty > 0 ? "success" : "critical"} />
                <s-text tone={availableQty > 0 ? "success" : "critical"}>Stock magasin</s-text>
              </s-stack>
              <s-text type="strong" tone={availableQty > 0 ? "success" : "critical"}>{availableQty} pcs</s-text>
            </s-stack>
          </s-box>
          <s-box inlineSize="49%" background="subdued" borderRadius="base" padding="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type="delivery" tone="info" />
                <s-text tone="info">En arrivage</s-text>
              </s-stack>
              <s-text type="strong" tone="info">{incomingQty} pcs</s-text>
            </s-stack>
          </s-box>
        </s-stack>

        <s-box background="subdued" borderRadius="base" padding="base">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small">
            <s-text type="small" color="subdued">
              Seuils {minQty} / {maxQty > 0 ? maxQty : "-"}
            </s-text>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-text type="small" color="subdued">
                Couverture {coverageDays == null ? "-" : `${coverageDays} j`}
              </s-text>
              <s-text type="small" tone={stockoutDays != null && stockoutDays <= 7 ? "critical" : "neutral"}>
                Rupture {stockoutDays == null ? "-" : `${stockoutDays} j`}
              </s-text>
            </s-stack>
          </s-stack>
        </s-box>

        <s-divider />

        <s-stack direction="block" gap="none">
          <s-text type="small" color="subdued">SKU: {sku}</s-text>
          <s-text type="small" color="subdued">REF: {sourceRef}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function Extension() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);

  const incomingItems = useMemo(() => {
    return items
      .filter((item) => Number(item?.incomingQty || 0) > 0)
      .filter((item) => {
        const needle = cleanUiLabel(query).toLowerCase();
        if (!needle) return true;
        const sourceNumber = cleanUiLabel(item?.sources?.[0]?.number || "");
        const haystack = cleanUiLabel(
          `${item?.productTitle || ""} ${item?.variantTitle || ""} ${item?.sku || ""} ${sourceNumber}`,
        ).toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        const delayedA = a?.delayed ? 1 : 0;
        const delayedB = b?.delayed ? 1 : 0;
        if (delayedA !== delayedB) return delayedB - delayedA;
        return Number(b?.incomingQty || 0) - Number(a?.incomingQty || 0);
      });
  }, [items, query]);

  const totalIncomingQty = useMemo(() => {
    return incomingItems.reduce((sum, item) => sum + Number(item?.incomingQty || 0), 0);
  }, [incomingItems]);

  useEffect(() => {
    let cancelled = false;

    function cleanText(value) {
      return String(value || "").trim();
    }

    function isHttpsUrl(value) {
      return /^https:\/\//i.test(cleanText(value));
    }

    function normalizeBase(value, keepPath = false) {
      let raw = cleanText(value);
      if (!raw) return "";
      if (!/^https?:\/\//i.test(raw) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)) {
        raw = `https://${raw}`;
      }
      try {
        const url = new URL(raw);
        if (url.protocol !== "https:") return "";
        const pathname = keepPath ? url.pathname.replace(/\/$/, "") : "";
        return `${url.protocol}//${url.host}${pathname}`;
      } catch {
        return "";
      }
    }

    function collectUrlCandidates(root, maxDepth = 3) {
      const out = [];
      const seen = new WeakSet();

      function walk(node, depth) {
        if (!node || depth > maxDepth) return;
        if (typeof node === "string") {
          if (isHttpsUrl(node)) out.push(node);
          return;
        }
        if (typeof node !== "object") return;
        if (seen.has(node)) return;
        seen.add(node);
        for (const value of Object.values(node)) {
          walk(value, depth + 1);
        }
      }

      walk(root, 0);
      return out;
    }

    function unique(values) {
      return Array.from(new Set(values.filter(Boolean)));
    }

    function readShopDomain() {
      const sessionDomain = cleanText(shopify?.session?.currentSession?.shopDomain);
      const shopDomain = cleanText(shopify?.shop?.myshopifyDomain);
      return sessionDomain || shopDomain;
    }

    function decodeJwtPayload(token) {
      const raw = cleanText(token);
      if (!raw.includes(".")) return null;
      const parts = raw.split(".");
      if (parts.length < 2) return null;
      try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
        return JSON.parse(atob(padded));
      } catch {
        return null;
      }
    }

    function readShopDomainFromToken(token) {
      const payload = decodeJwtPayload(token);
      if (!payload || typeof payload !== "object") return "";
      const dest = cleanText(payload.dest);
      if (dest) {
        try {
          return cleanText(new URL(dest).hostname);
        } catch {
          // Ignore.
        }
      }
      const iss = cleanText(payload.iss);
      if (iss) {
        try {
          return cleanText(new URL(iss).hostname);
        } catch {
          // Ignore.
        }
      }
      return "";
    }

    function readLocationGid() {
      const locationNumericId = Number(shopify?.session?.currentSession?.locationId || 0);
      if (Number.isInteger(locationNumericId) && locationNumericId > 0) {
        return `gid://shopify/Location/${locationNumericId}`;
      }
      return "";
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
        shopify?.configuration?.settings?.api_base_url,
        shopify?.configuration?.settings?.apiBaseUrl,
      ];

      const deepConfigured = collectUrlCandidates(
        {
          settings: shopify?.settings,
          extensionSettings: shopify?.extension?.settings,
          configSettings: shopify?.config?.settings,
          configurationSettings: shopify?.configuration?.settings,
        },
        6,
      );

      for (const candidate of candidates) {
        const base = normalizeBase(candidate, true);
        if (base) return base;
      }
      for (const candidate of deepConfigured) {
        const base = normalizeBase(candidate, true);
        if (base) return base;
      }
      return "";
    }

    async function readStoredApiBase() {
      if (!shopify?.storage?.get) return "";
      try {
        return normalizeBase(await shopify.storage.get("wm_api_base_url"), true);
      } catch {
        return "";
      }
    }

    async function buildApiBaseCandidates() {
      const configured = readConfiguredApiBase();
      const stored = await readStoredApiBase();
      const discovered = [
        shopify?.applicationUrl,
        shopify?.app?.applicationUrl,
        shopify?.config?.applicationUrl,
        shopify?.extension?.applicationUrl,
        shopify?.session?.currentSession?.appUrl,
        shopify?.session?.currentSession?.storeUrl,
        shopify?.session?.currentSession?.origin,
        ...collectUrlCandidates(shopify, 4),
      ]
        .map((value) => normalizeBase(value, false))
        .filter(Boolean);

      return unique([configured, stored, ...discovered, ...HARD_FALLBACK_BASES]);
    }

    async function readToken() {
      const fn = shopify?.session?.getSessionToken;
      if (typeof fn !== "function") return "";
      return cleanText(await fn());
    }

    async function load() {
      setLoading(true);
      setError("");
      const attemptedBases = [];

      try {
        const token = await readToken();
        const shopDomain = readShopDomain() || readShopDomainFromToken(token);
        const locationId = readLocationGid();

        if (!locationId) {
          throw new Error("Impossible d'identifier la localisation POS active.");
        }

        const params = new URLSearchParams();
        params.set("locationId", locationId);
        params.set("q", "");
        params.set("limit", "100");
        if (shopDomain) params.set("shop", shopDomain);

        const path = `/api/pos/incoming-search?${params.toString()}`;
        const headers = {
          Accept: "application/json",
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        };
        const bases = await buildApiBaseCandidates();
        const endpoints = [path, ...bases.map((base) => `${base.replace(/\/$/, "")}${path}`)];

        let loadedBody = null;
        let lastError = "";

        for (const endpoint of endpoints) {
          attemptedBases.push(endpoint);
          try {
            const response = await fetch(endpoint, {method: "GET", headers});
            let body = null;
            try {
              body = await response.json();
            } catch {
              body = null;
            }

            if (response.ok && body?.ok !== false) {
              loadedBody = body;
              if (shopify?.storage?.set && endpoint.startsWith("https://")) {
                try {
                  const parsed = new URL(endpoint);
                  await shopify.storage.set("wm_api_base_url", `${parsed.protocol}//${parsed.host}`);
                } catch {
                  // Ignore.
                }
              }
              break;
            }
            lastError = body?.error || `HTTP ${response.status}`;
          } catch (requestError) {
            lastError = requestError instanceof Error ? requestError.message : "Erreur reseau";
          }
        }

        if (!loadedBody) {
          const tested = attemptedBases.slice(0, 3).join(" | ");
          throw new Error(
            `Connexion API impossible (${lastError || "reseau"}). Base testee: ${tested || "aucune"}`,
          );
        }

        if (cancelled) return;
        const nextItems = Array.isArray(loadedBody?.items) ? loadedBody.items : [];
        setItems(nextItems);
      } catch (loadError) {
        if (!cancelled) {
          setItems([]);
          setError(loadError instanceof Error ? loadError.message : "Erreur de chargement");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <s-page heading="Produits en arrivage" subheading="Arrivages boutique">
      <s-scroll-box>
        <s-stack direction="block" gap="small" padding="small">
          {totalIncomingQty > 0 ? (
            <s-section>
              <s-banner heading={`${totalIncomingQty} pièces en arrivage`} tone="info" />
            </s-section>
          ) : null}

          <s-section>
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-search-field
                placeholder="Rechercher un produit ou SKU"
                value={query}
                onInput={(event) => setQuery(cleanUiLabel(event?.currentTarget?.value))}
              />
              {query ? (
                <s-button variant="secondary" tone="neutral" onClick={() => setQuery("")}>
                  Effacer
                </s-button>
              ) : null}
            </s-stack>
          </s-section>

          <s-section heading="PRODUITS EN COURS D'ARRIVAGE">
            {loading ? <s-text tone="info">Chargement…</s-text> : null}
            {!loading && error ? <s-text tone="critical">{error}</s-text> : null}
            {!loading && !error && incomingItems.length === 0 ? (
              <s-text tone="neutral">
                {query ? "Aucun produit trouvé." : "Aucun produit en arrivage pour cette boutique."}
              </s-text>
            ) : null}

            {!loading && !error ? (
              <s-stack direction="block" gap="small">
                {incomingItems.map((item, index) => (
                  <s-box key={getItemKey(item, index)}>
                    <IncomingRow item={item} />
                  </s-box>
                ))}
              </s-stack>
            ) : null}
          </s-section>
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
