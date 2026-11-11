// backend/src/integrations/core/adapterRegistry.js
//
// Platformele externe și adaptoarele lor. Fiecare adaptor implementează
// ACEEAȘI interfață, ca motorul (import, stoc, coadă, webhook-uri) să nu
// depindă de platformă:
//
//   platform, capabilities: { webhooks, variants, relativeStockAdjust }
//   testConnection()                         -> { ok, productCount, currency }
//   listProducts({ page, perPage })          -> { items: ExternalProduct[], page, total, totalPages }
//   getProduct(externalProductId)            -> ExternalProduct
//   getStock({ externalProductId, externalVariantId }) -> ExternalStock (+ modifiedAt)
//   setStock(ref, quantity)                  -> ExternalStock după scriere
//   registerWebhooks({ deliveryUrl, secret }) -> id-uri
//   unregisterWebhooks(ids)
//   verifyWebhook({ rawBody, headers, secret }) -> boolean
//   parseWebhook({ rawBody, headers })       -> { kind: "ping" } | { kind: "event", deliveryKey, topic, resourceId, parentId, payload }
//
// Formele ExternalProduct / ExternalStock: core/normalize.js.

import { createWooCommerceAdapter, parseWooWebhook, verifyWooWebhook } from "../adapters/woocommerce/adapter.js";
import { IntegrationError } from "./errors.js";
import { openCredentials } from "./connectionStore.js";

const PLATFORMS = {
  WOOCOMMERCE: {
    available: true,
    label: "WooCommerce",
    create: createWooCommerceAdapter,
    verifyWebhook: verifyWooWebhook,
    parseWebhook: parseWooWebhook,
    // câmpurile cerute la conectare (doar în backend; nu se întorc niciodată)
    credentialFields: ["consumerKey", "consumerSecret"],
  },
  SHOPIFY: { available: false, label: "Shopify" },
  EASYSALES: { available: false, label: "easySales" },
};

export function listPlatforms() {
  return Object.entries(PLATFORMS).map(([platform, def]) => ({ platform, label: def.label, available: def.available }));
}

export function getPlatform(platform) {
  const def = PLATFORMS[platform];
  if (!def) throw new IntegrationError("unknown_platform", "Platformă necunoscută.");
  if (!def.available) {
    throw new IntegrationError("platform_unavailable", `Conectarea ${def.label} nu este încă disponibilă.`, { status: 409 });
  }
  return def;
}

/**
 * Adaptorul pentru o conexiune salvată (credentialele se decriptează doar
 * aici, în memorie). `overrides` = dependențe injectate în teste (fetchImpl).
 */
export function adapterForConnection(connection, overrides = {}) {
  if (connection?.status === "DISCONNECTED") {
    throw new IntegrationError("connection_disconnected", "Magazinul este deconectat.", { status: 409 });
  }
  const def = getPlatform(connection.platform);
  return def.create({ connection, credentials: openCredentials(connection), ...overrides });
}
