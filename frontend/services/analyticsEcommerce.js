// services/analyticsEcommerce.js
//
// Construcția payload-urilor GA4 ecommerce (fără window / gtag) - testată
// în analyticsEcommerce.test.js. Toate evenimentele (view_item,
// add_to_cart, remove_from_cart, view_cart, begin_checkout,
// add_shipping_info, add_payment_info, purchase) folosesc ACELAȘI format
// de item, cu item_id = Product.id - identic cu g:id din feed-ul Google
// Merchant (backend/src/routes/googleShoppingFeed.js), ca Performance Max
// să lege evenimentele de produsele din feed.

export const DEFAULT_CURRENCY = "RON";

export const PRODUCTION_HOSTS = ["artfest.ro", "www.artfest.ro"];

// rolurile al căror trafic e marcat traffic_type=internal în GA4
export const INTERNAL_ROLES = ["ADMIN", "VENDOR"];

export const INTERNAL_TRAFFIC_STORAGE_KEY = "artfest:analytics-internal";

export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/*
 * Prețul unitar EFECTIV plătit (cu reducerile publice aplicate), în lei.
 * Ordinea: price explicit (deja calculat pentru afișare) > finalPriceCents
 * > priceCents > unitPrice; la fel pentru `product` imbricat (rânduri de coș).
 */
export function resolveUnitPrice(source) {
  if (!source || typeof source !== "object") return 0;

  const product = source.product || {};

  const lei = firstFinite(source.price, source.unitPrice, product.price);
  if (lei !== null) return round2(lei);

  const cents = firstFinite(
    source.finalPriceCents,
    source.priceCents,
    product.finalPriceCents,
    product.priceCents
  );
  return cents !== null ? round2(cents / 100) : 0;
}

function resolveQuantity(source, explicit) {
  const q = firstFinite(explicit, source?.quantity, source?.qty, source?._localQty);
  return q !== null && q >= 1 ? Math.floor(q) : 1;
}

/*
 * Produsele personalizabile: aceeași Product.id poate apărea de mai multe
 * ori în coș, cu configurații diferite (configurationKey). item_variant
 * le distinge în rapoarte fără a trimite textul personalizării (poate
 * conține nume / date personale).
 */
function resolveVariant(source) {
  const key = source?.configurationKey;
  if (!key || key === "default") return undefined;
  return "personalizat";
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

/*
 * Un item GA4 dintr-un produs (pagina de produs, card), un rând de coș
 * ({ productId, qty, product }), un item de checkout ({ productId, title,
 * price, qty }) sau un item de comandă ({ productId, title, price, qty }).
 * Fără id -> null (GA4 cere item_id sau item_name; fără id nu se leagă de
 * feed, deci nu îl trimitem).
 */
export function buildItem(source, options = {}) {
  if (!source || typeof source !== "object") return null;

  const product = source.product || {};

  const id = source.productId || product.id || source.id;
  if (!id) return null;

  return compact({
    item_id: String(id),
    item_name: String(source.title || product.title || source.name || ""),
    item_brand:
      options.brand ??
      (source.vendorName ||
        source.storeName ||
        product.vendorName ||
        product.storeName ||
        undefined),
    item_category:
      options.category ?? (source.category || product.category || undefined),
    item_variant: options.variant ?? resolveVariant(source),
    index: Number.isInteger(options.index) ? options.index : undefined,
    price: options.price !== undefined ? round2(options.price) : resolveUnitPrice(source),
    quantity: resolveQuantity(source, options.quantity),
  });
}

export function buildItems(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry, index) => buildItem(entry, { index }))
    .filter(Boolean);
}

export function sumItemsValue(items) {
  return round2(
    (items || []).reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    )
  );
}

/*
 * Payload ecommerce standard: currency + value + items. `value` explicit
 * (ex. totalul comenzii, cu transport) are prioritate; altfel suma itemilor.
 */
export function buildEcommercePayload({ items, value, currency, ...extra } = {}) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const explicit = firstFinite(value);

  return compact({
    currency: currency || DEFAULT_CURRENCY,
    value: explicit !== null ? round2(explicit) : sumItemsValue(safeItems),
    items: safeItems,
    ...extra,
  });
}

/*
 * purchase: transaction_id = Order.id (cuid, unic și stabil - același în
 * GA4, în conversia Google Ads și în Meta). value = Order.total din
 * backend (produse + transport - reduceri), shipping separat.
 */
export function buildPurchasePayload(order) {
  const transactionId = String(order?.id || "").trim();
  const total = firstFinite(order?.total);

  if (!transactionId || total === null || total <= 0) return null;

  const shipping = firstFinite(order?.shippingTotal, order?.shipping);

  return buildEcommercePayload({
    transaction_id: transactionId,
    value: total,
    currency: order?.currency || DEFAULT_CURRENCY,
    items: buildItems(order?.items),
    shipping: shipping !== null ? round2(shipping) : undefined,
    coupon: order?.coupon || undefined,
  });
}

/* =========================================================
   Mediu și trafic intern
========================================================= */

export function isProductionHost(hostname) {
  return PRODUCTION_HOSTS.includes(String(hostname || "").toLowerCase());
}

export function isInternalRole(role) {
  return INTERNAL_ROLES.includes(String(role || "").toUpperCase());
}

// valoare NE-personală pentru segmentare (user property user_role)
export function getUserRoleLabel(me) {
  const role = String(me?.role || "").toUpperCase();
  if (role === "ADMIN") return "admin";
  if (role === "VENDOR") return "vendor";
  if (role === "INFLUENCER") return "influencer";
  if (role === "USER") return "customer";
  return "guest";
}

/*
 * Gardă „o singură dată per cheie” (ex. begin_checkout o dată per vizită
 * în checkout, chiar dacă efectul React rulează de mai multe ori).
 */
export function createOnceGuard() {
  const seen = new Set();
  return (key) => {
    const k = String(key ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}
