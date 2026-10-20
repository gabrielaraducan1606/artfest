// services/analytics.test.js
//
// Teste pentru services/analytics.js FĂRĂ rețea: `window.gtag` e un spion
// local (nimic nu pleacă spre GA4 / Google Ads / Meta), consimțământul e
// mocat. Verifică: o singură cale de trimitere (fără duplicate în
// dataLayer), parametrii evenimentelor, conversia Ads doar cu
// consimțământ + domeniu de producție, același transaction_id peste tot,
// traficul intern.
//
// Rulare: node --experimental-test-module-mocks --test services/analytics.test.js

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let consent = { analytics: true, marketing: true };

mock.module("../src/lib/cookieConsent.js", {
  namedExports: {
    readConsent: () => ({ necessary: true, ...consent }),
  },
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

let calls;
let fbqCalls;

function installWindow(hostname = "www.artfest.ro") {
  calls = [];
  fbqCalls = [];
  const dataLayer = [];
  const fbq = (...args) => fbqCalls.push(args);

  globalThis.localStorage = memoryStorage();
  globalThis.window = {
    location: { hostname },
    dataLayer,
    gtag: (...args) => {
      calls.push(args);
      dataLayer.push(args);
    },
    fbq,
    addEventListener() {},
    removeEventListener() {},
  };
}

const analytics = await import("./analytics.js");

const events = (name) =>
  calls.filter((c) => c[0] === "event" && c[1] === name);

beforeEach(() => {
  consent = { analytics: true, marketing: true };
  installWindow();
});

test("o singură cale: fiecare eveniment intră O DATĂ în dataLayer (fără obiect {event} duplicat)", () => {
  analytics.trackViewContent({ id: "p1", title: "Produs", price: 10 });

  assert.equal(events("view_item").length, 1);
  assert.equal(window.dataLayer.length, 1);
  assert.ok(
    !window.dataLayer.some((entry) => entry && entry.event === "view_item"),
    "fără push {event: 'view_item'} în paralel"
  );
});

test("view_item: currency, value, items[item_id, item_name, price, quantity]", () => {
  analytics.trackViewContent({ id: "p1", title: "Produs", price: 49.9, currency: "RON" });
  const [, , params] = events("view_item")[0];

  assert.equal(params.currency, "RON");
  assert.equal(params.value, 49.9);
  assert.deepEqual(params.items, [
    { item_id: "p1", item_name: "Produs", price: 49.9, quantity: 1 },
  ]);
});

test("add_to_cart: value = preț × cantitate", () => {
  analytics.trackAddToCart({ id: "p1", title: "Produs", price: 20 }, { quantity: 3 });
  const [, , params] = events("add_to_cart")[0];

  assert.equal(params.value, 60);
  assert.equal(params.items[0].quantity, 3);
});

test("remove_from_cart: un rând cu unitățile eliminate / mai multe rânduri într-un singur eveniment", () => {
  const row = { productId: "p1", qty: 5, product: { title: "A", price: 10 } };
  analytics.trackRemoveFromCart(row, { quantity: 2 });
  analytics.trackRemoveFromCart([
    row,
    { productId: "p2", qty: 1, product: { title: "B", price: 7 } },
  ]);

  const [first, second] = events("remove_from_cart");
  assert.equal(first[2].value, 20);
  assert.equal(first[2].items[0].quantity, 2);
  assert.equal(second[2].items.length, 2);
  assert.equal(second[2].value, 57);
});

test("view_cart / begin_checkout: nu se trimit pentru coș gol", () => {
  analytics.trackViewCart([]);
  analytics.trackBeginCheckout(0, { items: [] });
  assert.equal(calls.length, 0);
});

test("begin_checkout / add_shipping_info / add_payment_info: items + value cu transport", () => {
  const items = [{ productId: "p1", title: "A", price: 100, qty: 1 }];

  analytics.trackBeginCheckout(115, { items, currency: "RON" });
  analytics.trackAddShippingInfo(115, { items });
  analytics.trackAddPaymentInfo(115, { items, paymentType: "COD" });

  assert.equal(events("begin_checkout")[0][2].value, 115);
  assert.equal(events("add_shipping_info")[0][2].shipping_tier, "curier");
  assert.equal(events("add_payment_info")[0][2].payment_type, "ramburs");
});

const ORDER = {
  id: "ord_1",
  total: 215,
  shippingTotal: 15,
  currency: "RON",
  items: [
    { productId: "a1", title: "A1", price: 120, qty: 1 },
    { productId: "b1", title: "B1", price: 40, qty: 2 },
  ],
};

test("purchase (producție + marketing acceptat): GA4 purchase + O conversie Ads, același transaction_id", () => {
  assert.equal(analytics.trackPurchase(ORDER), true);

  const purchase = events("purchase");
  const conversion = events("conversion");

  assert.equal(purchase.length, 1);
  assert.equal(conversion.length, 1);

  assert.equal(purchase[0][2].transaction_id, "ord_1");
  assert.equal(purchase[0][2].value, 215);
  assert.equal(purchase[0][2].shipping, 15);
  assert.equal(purchase[0][2].items.length, 2);

  assert.equal(conversion[0][2].send_to, analytics.GOOGLE_ADS_PURCHASE_CONVERSION_ID);
  assert.equal(conversion[0][2].transaction_id, "ord_1");
  assert.equal(conversion[0][2].value, 215);
  assert.equal(conversion[0][2].currency, "RON");
});

test("purchase fără consimțământ de marketing: GA4 da (Consent Mode), conversie Ads și Meta NU", () => {
  consent = { analytics: true, marketing: false };

  analytics.trackPurchase(ORDER);

  assert.equal(events("purchase").length, 1);
  assert.equal(events("conversion").length, 0);
  assert.equal(fbqCalls.filter((c) => c[0] === "track").length, 0);
});

test("purchase pe localhost / preview: NICIO conversie Ads (nu poluăm contul de producție)", () => {
  installWindow("localhost");
  analytics.trackPurchase(ORDER);
  assert.equal(events("conversion").length, 0);

  installWindow("artfest-git-main.vercel.app");
  analytics.trackPurchase(ORDER);
  assert.equal(events("conversion").length, 0);
});

test("purchase invalid (total 0 / fără id): nimic trimis", () => {
  assert.equal(analytics.trackPurchase({ id: "x", total: 0 }), false);
  assert.equal(analytics.trackPurchase({ total: 50 }), false);
  assert.equal(calls.length, 0);
});

test("D4: fiecare eveniment GA4 are send_to = proprietatea GA4 (nu ajunge la Google Ads)", () => {
  analytics.trackViewContent({ id: "p1", title: "A", price: 1 });
  analytics.trackAddToCart({ id: "p1", title: "A", price: 1 });
  analytics.trackPurchase(ORDER);

  for (const name of ["view_item", "add_to_cart", "purchase"]) {
    assert.equal(events(name)[0][2].send_to, "G-Z6L2YX2Q7W", name);
  }
  // conversia Ads rămâne singurul eveniment către AW
  assert.equal(events("conversion")[0][2].send_to, analytics.GOOGLE_ADS_PURCHASE_CONVERSION_ID);
});

test("D3 BASIC: fără acord pentru statistici NU intră niciun eveniment GA4 în dataLayer (nimic retroactiv)", () => {
  consent = { analytics: false, marketing: false };

  analytics.trackViewContent({ id: "p1", title: "A", price: 1 });
  analytics.trackAddToCart({ id: "p1", title: "A", price: 1 });
  analytics.trackViewCart([{ productId: "p1", qty: 1, product: { price: 1 } }]);
  analytics.trackBeginCheckout(10, { items: [{ productId: "p1", price: 10, qty: 1 }] });
  analytics.trackPurchase(ORDER);
  analytics.trackEvent("ambassador_link_copy");

  assert.equal(calls.length, 0);
  assert.equal(window.dataLayer.length, 0);
});

test("D3 BASIC: doar marketing -> conversia Ads da, evenimentul GA4 purchase NU", () => {
  consent = { analytics: false, marketing: true };
  analytics.trackPurchase(ORDER);

  assert.equal(events("purchase").length, 0);
  assert.equal(events("conversion").length, 1);
});

test("D3: acord în banner -> consent update, apoi încărcarea tagurilor, apoi semnalul GTM", () => {
  let handler;
  const order = [];
  window.addEventListener = (name, fn) => {
    if (name === "cookie:consent") handler = fn;
  };
  window.artfestApplyConsentTags = (c) => order.push(["load", c.analytics, c.marketing]);
  window.gtag = (...args) => {
    calls.push(args);
    if (args[0] === "consent") order.push(["consent", args[1]]);
  };
  const originalPush = window.dataLayer.push.bind(window.dataLayer);
  window.dataLayer.push = (entry) => {
    if (entry?.event) order.push(["event", entry.event]);
    return originalPush(entry);
  };

  consent = { analytics: false, marketing: false };
  analytics.setupAnalyticsConsentListener();
  order.length = 0;

  handler({ detail: { analytics: true, marketing: true } });

  assert.deepEqual(order, [
    ["consent", "update"],
    ["load", true, true],
    ["event", "artfest_consent_update"],
  ]);
});

test("schimbare consimțământ: consent update către Google + eveniment GTM artfest_consent_update", () => {
  let handler;
  window.addEventListener = (name, fn) => {
    if (name === "cookie:consent") handler = fn;
  };

  consent = { analytics: false, marketing: false };
  analytics.setupAnalyticsConsentListener();
  calls.length = 0;
  window.dataLayer.length = 0;

  handler({ detail: { analytics: true, marketing: false } });

  const update = calls.find((c) => c[0] === "consent" && c[1] === "update");
  assert.deepEqual(update[2], {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  const gtmEvent = window.dataLayer.find((e) => e && e.event === "artfest_consent_update");
  assert.deepEqual(gtmEvent, {
    event: "artfest_consent_update",
    consent_analytics: true,
    consent_marketing: false,
  });
});

test("trafic intern: admin/vendor -> traffic_type=internal, reținut pe dispozitiv; client -> doar user_role", () => {
  analytics.setAnalyticsIdentity({ role: "USER" });
  assert.ok(!calls.some((c) => c[0] === "set" && c[1]?.traffic_type));
  assert.deepEqual(
    calls.find((c) => c[0] === "set" && c[1] === "user_properties")[2],
    { user_role: "customer" }
  );

  calls.length = 0;
  analytics.setAnalyticsIdentity({ role: "VENDOR" });
  assert.ok(calls.some((c) => c[0] === "set" && c[1]?.traffic_type === "internal"));
  assert.equal(localStorage.getItem("artfest:analytics-internal"), "1");

  // același dispozitiv, după logout: rămâne marcat
  calls.length = 0;
  analytics.setAnalyticsIdentity(null);
  assert.ok(calls.some((c) => c[0] === "set" && c[1]?.traffic_type === "internal"));
});
