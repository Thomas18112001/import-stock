import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("auth/login", "routes/auth.login/route.tsx"),
  route("auth/*", "routes/auth.$.tsx"),

  route("webhooks/app/scopes_update", "routes/webhooks.app.scopes_update.tsx"),
  route("webhooks/app/uninstalled", "routes/webhooks.app.uninstalled.tsx"),

  route("actions/synchroniser", "routes/actions.sync.tsx"),
  route("actions/synchroniser/cron", "routes/actions.sync.cron.tsx"),
  route("actions/importer-par-id", "routes/actions.importById.tsx"),
  route("actions/boutiques/selectionner", "routes/actions.location.select.tsx"),
  route("actions/debug/purger-receptions", "routes/actions.debug.purgeReceipts.tsx"),
  route("actions/debug/purger-reassorts", "routes/actions.debug.purgePurchaseOrders.tsx"),
  route(
    "actions/produits-en-reception/:receiptGid/mettre-en-cours-d-arrivage",
    "routes/actions.receipts.$receiptGid.apply.tsx",
  ),
  route("actions/produits-en-reception/:receiptGid/supprimer", "routes/actions.receipts.$receiptGid.delete.tsx"),
  route("actions/produits-en-reception/:receiptGid/preparer", "routes/actions.receipts.$receiptGid.prepare.tsx"),
  route(
    "actions/produits-en-reception/:receiptGid/recu-en-boutique",
    "routes/actions.receipts.$receiptGid.receive.tsx",
  ),
  route(
    "actions/produits-en-reception/:receiptGid/annuler-reception",
    "routes/actions.receipts.$receiptGid.rollback.tsx",
  ),
  route(
    "actions/produits-en-reception/:receiptGid/basculer-ignorer",
    "routes/actions.receipts.$receiptGid.toggle-skip.tsx",
  ),

  route("actions/reassorts-magasin/creer", "routes/actions.purchase-orders.create.tsx"),
  route("actions/reassorts-magasin/purger", "routes/actions.purchase-orders.purge.tsx"),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/dupliquer",
    "routes/actions.purchase-orders.$purchaseOrderGid.duplicate.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/annuler",
    "routes/actions.purchase-orders.$purchaseOrderGid.cancel.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/supprimer",
    "routes/actions.purchase-orders.$purchaseOrderGid.delete.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/mettre-en-cours-d-arrivage",
    "routes/actions.purchase-orders.$purchaseOrderGid.validate-transfer.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/recu-en-boutique",
    "routes/actions.purchase-orders.$purchaseOrderGid.receive.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/modifier-eta",
    "routes/actions.purchase-orders.$purchaseOrderGid.update-eta.tsx",
  ),
  route(
    "actions/reassorts-magasin/:purchaseOrderGid/envoyer",
    "routes/actions.purchase-orders.$purchaseOrderGid.send.tsx",
  ),
  route("actions/planification/seuils", "routes/actions.planning.thresholds.tsx"),
  route("actions/planification/creer-po", "routes/actions.planning.create-po.tsx"),
  route("actions/fournisseurs", "routes/actions.suppliers.tsx"),
  route("actions/alertes/configuration", "routes/actions.alerts.config.tsx"),
  route("actions/alertes/statut", "routes/actions.alerts.status.tsx"),

  route("api/cron/synchroniser", "routes/api.cron.sync.tsx"),
  route("api/cron/alertes", "routes/api.cron.alerts.tsx"),
  route("api/debug/sync-presta", "routes/api.debug.presta-sync.tsx"),
  route("api/pos/incoming", "routes/api.pos.incoming.tsx"),
  route("api/pos/incoming-search", "routes/api.pos.incoming-search.tsx"),
  route("api/sales/agg", "routes/api.sales.agg.tsx"),
  route("api/sales/rate", "routes/api.sales.rate.tsx"),
  route("api/inventory/sales-rate", "routes/api.inventory.sales-rate.tsx"),
  route("api/inventory/forecast", "routes/api.inventory.forecast.tsx"),
  route("api/reassorts", "routes/api.reassorts.tsx"),
  route("api/reassorts/from-prestashop-order", "routes/api.reassorts.from-prestashop-order.tsx"),
  route("api/reassorts/pdf", "routes/api.reassorts.pdf.tsx"),
  route("api/reassorts/:restockId/pdf", "routes/api.reassorts.$restockId.pdf.tsx"),
  route("api/reassorts-magasin/:purchaseOrderGid/pdf", "routes/api.purchase-orders.$purchaseOrderGid.pdf.tsx"),

  route("app/*", "routes/legacy.app-redirect.tsx"),

  layout("routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("tableau-de-bord", "routes/app.tableau-de-bord.tsx"),
    route("planification-stock", "routes/app.planification-stocks.tsx"),
    route("stats-inventaire", "routes/app.stats-inventaire.tsx"),
    route("fournisseurs", "routes/app.fournisseurs.tsx"),
    route("sante-inventaire", "routes/app.inventory-health.tsx"),
    route("alertes-inventaire", "routes/app.alertes-inventaire.tsx"),
    route("aide-autorisations", "routes/app.help.scopes.tsx"),
    route("produits-en-reception", "routes/app.receipts.tsx", [
      index("routes/app.receipts._index.tsx"),
      route(":receiptIdEnc", "routes/app.receipts.$receiptIdEnc.tsx"),
    ]),
    route("reassorts-magasin", "routes/app.purchase-orders.tsx", [
      index("routes/app.purchase-orders._index.tsx"),
      route("nouveau", "routes/app.purchase-orders.new.tsx"),
      route(":purchaseOrderIdEnc", "routes/app.purchase-orders.$purchaseOrderIdEnc.tsx"),
    ]),
    route(":legacySection", "routes/legacy.section-redirect.tsx"),
  ]),
] satisfies RouteConfig;
