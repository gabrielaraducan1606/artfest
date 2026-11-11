// backend/src/integrations/adapters/woocommerce/adapter.js
//
// Adaptorul WooCommerce - implementează interfața comună a adaptoarelor
// (core/adapterRegistry.js) peste API-ul REST oficial (wc/v3).
//
// LIMITĂRI WooCommerce (documentate explicit):
//   - API-ul REST nu are o operație atomică de tip „scade cu N”: stocul se
//     scrie ca valoare ABSOLUTĂ (stock_quantity). Între citirea și scrierea
//     noastră, magazinul poate vinde (sau vânzătorul poate edita) - scrierea
//     noastră ar suprascrie acea modificare. Reducem fereastra (citire
//     imediat înainte de scriere, verificare după scriere, joburi
//     serializate pe aceeași unitate de stoc, reconciliere periodică), dar
//     NU o putem elimina; o modificare suprascrisă e corectată la
//     următoarea reconciliere doar dacă sursa principală o mai reflectă.
//   - Nu există versiune / ETag pe stoc: nu putem face compare-and-set.
//   - date_modified se schimbă la orice editare (nu doar la stoc).
//   - Webhook-urile se livrează „cel puțin o dată”, fără ordine garantată,
//     iar WooCommerce dezactivează un webhook după livrări eșuate repetate;
//     reconcilierea periodică acoperă evenimentele pierdute.
//   - Modificarea unei variații nu e garantat semnalată prin product.updated
//     pe toate versiunile WooCommerce - din nou, reconcilierea o prinde.
//   - Verificarea conexiunii confirmă doar dreptul de CITIRE; dreptul de
//     scriere se confirmă abia la prima scriere de stoc (cheile cu doar
//     „Read” sunt raportate atunci ca woocommerce_forbidden).
//   - Greutatea / dimensiunile produselor sunt în unitățile alese în
//     WooCommerce -> Setări -> Produse (implicit lbs / in la instalare!),
//     citite din /settings/products/woocommerce_weight_unit și
//     woocommerce_dimension_unit. Fără acces la setări (403 / 404) unitățile
//     rămân necunoscute și greutatea nu se preia (nu presupunem kg / cm).

import crypto from "node:crypto";

import { IntegrationError } from "../../core/errors.js";
import { createWooClient, WOO_MAX_PER_PAGE } from "./client.js";
import { mapWooProduct, mapWooStock } from "./mapper.js";

export const WOO_WEBHOOK_TOPICS = ["product.created", "product.updated", "product.deleted"];

const enc = encodeURIComponent;

function stockPath({ externalProductId, externalVariantId }) {
  return externalVariantId
    ? `/products/${enc(externalProductId)}/variations/${enc(externalVariantId)}`
    : `/products/${enc(externalProductId)}`;
}

/* ===================== webhook-uri (fără conexiune la magazin) ===================== */

const header = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Semnătura WooCommerce: base64(HMAC-SHA256(corpul brut, secretul webhook-ului)),
 * în antetul X-WC-Webhook-Signature. Comparare în timp constant.
 */
export function verifyWooWebhook({ rawBody, headers, secret }) {
  const signature = String(header(headers, "x-wc-webhook-signature") || "");
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * La crearea unui webhook, WooCommerce trimite un „ping” nesemnat
 * (corp form-urlencoded webhook_id=…), fără antetul de topic.
 */
export function parseWooWebhook({ rawBody, headers }) {
  const topic = header(headers, "x-wc-webhook-topic");
  if (!topic) {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
    if (/^webhook_id=\d+$/.test(text.trim())) return { kind: "ping" };
    throw new IntegrationError("webhook_invalid", "Webhook WooCommerce necunoscut.", { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new IntegrationError("webhook_invalid", "Corpul webhook-ului nu este JSON valid.", { status: 400 });
  }

  const deliveryKey = String(header(headers, "x-wc-webhook-delivery-id") || "");
  if (!deliveryKey) throw new IntegrationError("webhook_invalid", "Lipsește identificatorul livrării.", { status: 400 });

  return {
    kind: "event",
    deliveryKey,
    topic: String(topic),
    resourceId: payload?.id !== undefined ? String(payload.id) : null,
    // variația are parent_id; produsul simplu / variabil nu
    parentId: payload?.parent_id ? String(payload.parent_id) : null,
    payload,
  };
}

/* ===================== adaptorul ===================== */

/**
 * @param {Object} options
 * @param {{ shopUrl: string }} options.connection
 * @param {{ consumerKey: string, consumerSecret: string, authMode?: string }} options.credentials
 */
export function createWooCommerceAdapter({ connection, credentials, fetchImpl, sleep }) {
  const client = createWooClient({
    shopUrl: connection.shopUrl,
    consumerKey: credentials?.consumerKey,
    consumerSecret: credentials?.consumerSecret,
    authMode: credentials?.authMode || "basic",
    fetchImpl,
    sleep,
  });

  // unitățile magazinului: o singură citire per adaptor (o cerere / un import)
  let unitsPromise = null;
  async function readUnitSetting(id) {
    try {
      const value = (await client.get(`/settings/products/${id}`))?.value;
      return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
    } catch (error) {
      if (error?.code === "woocommerce_forbidden" || error?.code === "woocommerce_not_found") return null;
      throw error;
    }
  }
  function storeUnits() {
    if (!unitsPromise) {
      unitsPromise = Promise.all([readUnitSetting("woocommerce_weight_unit"), readUnitSetting("woocommerce_dimension_unit")])
        .then(([weight, dimension]) => ({ weight, dimension }))
        .catch((error) => {
          unitsPromise = null;
          throw error;
        });
    }
    return unitsPromise;
  }

  async function loadProduct(product) {
    const variations =
      product?.type === "variable" ? await client.getAll(`/products/${enc(product.id)}/variations`) : [];
    return mapWooProduct(product, variations, await storeUnits());
  }

  return {
    platform: "WOOCOMMERCE",
    capabilities: { webhooks: true, variants: true, relativeStockAdjust: false },

    /** Citire: confirmă cheile și accesul la produse; moneda magazinului. */
    async testConnection() {
      const products = await client.getPage("/products", { perPage: 1 });
      let currency = null;
      try {
        currency = (await client.get("/data/currencies/current"))?.code || null;
      } catch (error) {
        if (error?.code !== "woocommerce_forbidden" && error?.code !== "woocommerce_not_found") throw error;
      }
      return { ok: true, productCount: products.total, currency };
    },

    /** O pagină de produse (cu variațiile fiecărui produs variabil). */
    async listProducts({ page = 1, perPage = 20, status = "publish" } = {}) {
      const result = await client.getPage("/products", { page, perPage: Math.min(perPage, WOO_MAX_PER_PAGE), query: { status } });
      const items = [];
      for (const product of result.items) items.push(await loadProduct(product));
      return { items, page: result.page, total: result.total, totalPages: result.totalPages };
    },

    /** Unitățile de greutate / dimensiuni ale magazinului (null = necunoscută). */
    getStoreUnits: storeUnits,

    async getProduct(externalProductId) {
      return loadProduct(await client.get(`/products/${enc(externalProductId)}`));
    },

    /** Stocul unei unități (produs simplu, produs părinte sau variație). */
    async getStock(ref) {
      return mapWooStock(await client.get(stockPath(ref)));
    },

    /**
     * Scrie stocul ABSOLUT și citește înapoi valoarea rezultată (vezi
     * limitările de mai sus). Variațiile cu stocul părintelui se scriu pe
     * produsul părinte (ref fără externalVariantId).
     */
    async setStock(ref, quantity) {
      const qty = Math.trunc(Number(quantity));
      if (!Number.isFinite(qty)) throw new IntegrationError("invalid_stock_quantity", "Cantitate de stoc invalidă.");
      const updated = await client.put(stockPath(ref), { manage_stock: true, stock_quantity: qty });
      return mapWooStock(updated);
    },

    async registerWebhooks({ deliveryUrl, secret }) {
      const ids = [];
      for (const topic of WOO_WEBHOOK_TOPICS) {
        const created = await client.post("/webhooks", { name: `Artfest ${topic}`, topic, delivery_url: deliveryUrl, secret, status: "active" });
        ids.push(String(created.id));
      }
      return ids;
    },

    async unregisterWebhooks(ids = []) {
      for (const id of ids) {
        try {
          await client.delete(`/webhooks/${enc(id)}`, { force: true });
        } catch (error) {
          if (error?.code !== "woocommerce_not_found") throw error;
        }
      }
    },

    verifyWebhook: verifyWooWebhook,
    parseWebhook: parseWooWebhook,
  };
}
