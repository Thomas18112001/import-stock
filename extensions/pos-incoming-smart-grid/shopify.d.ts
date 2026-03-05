import '@shopify/ui-extensions';

// @ts-expect-error -- POS extension runtime injects the shopify global for this module boundary.
declare module './src/Tile.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.home.tile.render').Api;
  const globalThis: { shopify: typeof shopify };
}

// @ts-expect-error -- POS extension runtime injects the shopify global for this module boundary.
declare module './src/Modal.jsx' {
  const shopify: import('@shopify/ui-extensions/pos.home.modal.render').Api;
  const globalThis: { shopify: typeof shopify };
}
