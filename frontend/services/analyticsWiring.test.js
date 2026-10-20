// services/analyticsWiring.test.js
//
// Gărzi pe sursă (fără DOM) pentru locurile din care pleacă evenimentele:
// un singur begin_checkout, purchase doar din /multumim, add_to_cart doar
// după adăugarea reușită, fără push-uri paralele {event: …} în dataLayer.
//
// Rulare: node --test services/analyticsWiring.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

const sources = walk(join(root, "src")).map((file) => ({
  file,
  code: readFileSync(file, "utf8"),
}));

test("purchase / conversia Ads pleacă DOAR din /multumim (thankYouPurchase)", () => {
  const callers = sources
    .filter(({ code }) => /\btrackPurchase\b/.test(code))
    .map(({ file }) => file.replace(root, "").replace(/\\/g, "/"));

  // Thankyou.jsx îl pasează lui trackPurchaseOnce (thankYouPurchase.js),
  // care decide (COD / CARD confirmat) și deduplică per comandă
  assert.deepEqual(callers.sort(), [
    "src/pages/Checkout/Thankyou.jsx",
    "src/pages/Checkout/thankYouPurchase.js",
  ]);

  for (const { code } of sources) {
    assert.doesNotMatch(code, /["']event["']\s*,\s*["']conversion["']/);
    assert.doesNotMatch(code, /event:\s*["']purchase["']/);
  }
});

test("begin_checkout: o singură sursă (Checkout.jsx), nu și coșul", () => {
  assert.doesNotMatch(read("src/pages/Cart/Cart.jsx"), /trackBeginCheckout\(/);
  assert.match(read("src/pages/Checkout/Checkout.jsx"), /trackBeginCheckout\(/);
});

test("coș: add_to_cart nu mai e trimis ÎNAINTE de confirmarea cantității", () => {
  const cart = read("src/pages/Cart/Cart.jsx");
  assert.doesNotMatch(cart, /trackAddToCart\(row\.product\)/);
  assert.match(cart, /trackQtyChange\(row, row\?\.qty, confirmedQty\)/);
  assert.match(cart, /trackRemoveFromCart\(removedRow\)/);
  assert.match(cart, /trackViewCart\(rows/);
});

test("checkout: add_shipping_info / add_payment_info o dată per vizită", () => {
  const checkout = read("src/pages/Checkout/Checkout.jsx");
  assert.equal((checkout.match(/trackAddShippingInfo\(/g) || []).length, 1);
  assert.equal((checkout.match(/trackAddPaymentInfo\(/g) || []).length, 1);
  assert.match(checkout, /checkoutStepsTrackedRef\.current\.shipping = true/);
  assert.match(checkout, /checkoutStepsTrackedRef\.current\.payment = true/);
});

test("listări: add_to_cart după adăugarea reușită (nu înainte de API / coș guest)", () => {
  for (const [file, before] of [
    ["src/pages/Products/Products.jsx", 'new CustomEvent("cart:changed")'],
    ["src/pages/Vendor/ProfilMagazin/components/ProductCard.jsx", 'api("/api/cart/add"'],
    ["src/pages/Wishlist/Wishlist.jsx", 'res?.error === "cannot_add_own_product"'],
  ]) {
    const code = read(file);
    const tracked = code.indexOf("trackAddToCart(");
    assert.ok(tracked > 0, `${file}: lipsește add_to_cart`);
    assert.ok(code.indexOf(before) > 0 && code.indexOf(before) < tracked, `${file}: ordine greșită`);
  }
});

test("D6 /colectii/:slug: adăugare reală în coș (nu evenimentul mort cart:add-product), add_to_cart după succes", () => {
  const code = read("src/pages/Collections/PublicCollections.jsx");
  assert.doesNotMatch(code, /new CustomEvent\(\s*"cart:add-product"/);
  assert.match(code, /onAddToCart=\{\(\) => addToCart\(p\)\}/);

  const fn = code.slice(code.indexOf("const addToCart = useCallback"), code.indexOf("const productCards"));
  const tracked = fn.indexOf("trackAddToCart(");
  assert.ok(fn.indexOf('api("/api/cart/add"') < tracked);
  assert.ok(fn.lastIndexOf("addToGuestCart(") < tracked);
  assert.ok(fn.indexOf('new CustomEvent("cart:changed")') < tracked);
  // produsele configurabile merg pe pagina produsului, fără add_to_cart
  assert.ok(fn.indexOf("requiresConfiguration") < fn.indexOf('api("/api/cart/add"'));
});

test("niciun apel direct window.gtag(\"event\") în aplicație - totul prin analytics.js (acord + send_to)", () => {
  for (const { file, code } of sources) {
    assert.doesNotMatch(code, /window\.gtag\??\.?\(\s*["']event["']/, file);
  }
});

test("analytics.js: o singură cale de trimitere (fără pushToDataLayer paralel)", () => {
  const analytics = read("services/analytics.js");
  assert.doesNotMatch(analytics, /function pushToDataLayer/);
  // singurul obiect {event} permis e semnalul de consimțământ pentru GTM
  const objectEvents = [...analytics.matchAll(/event:\s*\n?\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(objectEvents, ["artfest_consent_update"]);
});
