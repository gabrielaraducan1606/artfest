// Etapa 3 - modul de livrare per magazin la checkout (checkoutFulfillment.js):
// preselectarea Sameday prin Artfest, alegerea manuală păstrată, coș cu mai mulți
// vânzători, coș care nu se poate plăti integral cu cardul, tarif Sameday indisponibil
// (fără tariful de rezervă al magazinului), preț schimbat / manipulat, ramburs refuzat,
// compatibilitatea cu checkout-ul vechi. Fără DB, fără rețea (catalog + tarif simulate).
//
// Rulare: node --experimental-test-module-mocks --test src/services/shipping/checkoutFulfillment.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../../db.js", { namedExports: { prisma: {} } });
const F = await import("./checkoutFulfillment.js");
const { DeliverySelectionError, priceGroupShipping } = await import("./deliverySelection.js");

// produse CU greutate (coș complet => estimarea Sameday); coșurile fără greutate au teste separate
const group = (serviceId, vendorId, { fee = 1500, threshold = null, items = [{ price: 100, qty: 1, shippingWeightGrams: 500 }] } = {}) => ({
  serviceId,
  vendorId,
  estimatedShippingFeeCents: fee,
  freeShippingThresholdCents: threshold,
  shippingNotes: null,
  items,
});

const LOCKER = { oohId: 501, oohType: 0, method: "LOCKER", name: "easybox Test", address: "Str. Test 1", city: "Cluj-Napoca", county: "Cluj", postalCode: "400000", lat: 46.7, lng: 23.6, schedule: [], specialSchedule: [] };
const offline = async () => {
  throw new Error("nomenclator offline");
};
function catalog({ courierAvailable = true } = {}) {
  const calls = { getServices: 0, findOohFresh: 0 };
  return {
    calls,
    getServices: async () => {
      calls.getServices += 1;
      return { courierAvailable, services: courierAvailable ? { HOME: { id: 7 }, LOCKER: { id: 15 }, PUDO: { id: 16 } } : {} };
    },
    counties: offline,
    findCounty: offline,
    cities: offline,
    findCity: offline,
    findOoh: async (id) => (Number(id) === 501 ? LOCKER : null),
    findOohFresh: async (id) => {
      calls.findOohFresh += 1;
      return { loc: Number(id) === 501 ? LOCKER : null, source: "live" };
    },
  };
}
// tariful Sameday simulat: 18,90 lei la adresă, 12,50 lei la easybox
function pricer({ fail = false, source = "SAMEDAY", byMethod = { HOME: 1890, LOCKER: 1250, PUDO: 1350 } } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args.method);
    if (fail) throw Object.assign(new Error("timeout"), { fallbackReason: "timeout" });
    return { amountCents: byMethod[args.method], carrierCostCents: byMethod[args.method], source };
  };
  fn.calls = calls;
  return fn;
}
const ADDRESS = { firstName: "Ana", lastName: "Pop", name: "Ana Pop", phone: "0722000000", email: "ana@t.ro", county: "Cluj", city: "Cluj-Napoca", street: "Str. Test 1", postalCode: "400000" };
const available = (...ids) => ({ offered: true, cartCardCapable: true, byService: Object.fromEntries(ids.map((id) => [id, { offered: true, available: true }])) });
const OFF = { offered: false, cartCardCapable: false, byService: {} };

async function quote({ groups, selections = {}, availability, cat = catalog(), price = pricer(), placing = false, config = null }) {
  return F.quoteCheckoutShipping({ groups, selections, address: ADDRESS, availability, getCatalog: () => cat, pricer: price, placing, artfestConfig: config });
}
const byKey = (q, key) => q.shipments.find((s) => String(s.serviceId) === key);

test("Sameday oprit: fiecare magazin = exact calculul vechi (tariful magazinului), fără catalog / tarif Sameday", async () => {
  const cat = catalog();
  const price = pricer();
  const groups = [group("svc-a", "v-a"), group("svc-b", "v-b", { fee: 2000, threshold: 5000, items: [{ price: 60, qty: 1 }] })];
  const q = await quote({ groups, availability: OFF, cat, price, placing: true });
  assert.equal(cat.calls.getServices, 0);
  assert.equal(price.calls.length, 0);
  for (const g of groups) {
    const s = byKey(q, g.serviceId);
    const legacy = priceGroupShipping(g);
    assert.equal(s.price, legacy.priceCents / 100);
    assert.equal(s.qualifiesFreeShipping, legacy.qualifiesFreeShipping);
    assert.equal(s.method, "COURIER");
    assert.equal(s.delivery, null);
    assert.equal(s.fulfillment, null, "fără alegere explicită -> Shipment.fulfillment nu se scrie");
    assert.deepEqual(F.shipmentFulfillmentData(s), {});
    assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY, undefined);
  }
  assert.equal(q.totalShipping, 15 + 0);
  assert.equal(q.requiresCard, false);
});

test("magazin eligibil, fără alegere: Sameday PRESELECTAT, cu ambele prețuri afișate", async () => {
  const q = await quote({ groups: [group("svc-a", "v-a")], availability: available("svc-a") });
  const s = byKey(q, "svc-a");
  assert.equal(s.selectedFulfillment, "ARTFEST_SAMEDAY");
  assert.equal(s.preselected, true);
  assert.equal(s.price, 18.9);
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.price, 18.9);
  assert.deepEqual(s.fulfillmentOptions.ARTFEST_SAMEDAY.paymentMethods, ["CARD"]);
  assert.deepEqual(s.fulfillmentOptions.ARTFEST_SAMEDAY.methods, ["HOME", "LOCKER", "PUDO"]);
  assert.equal(s.fulfillmentOptions.VENDOR_COURIER.price, 15);
  assert.deepEqual(s.fulfillmentOptions.VENDOR_COURIER.paymentMethods, ["COD", "CARD"]);
  assert.equal(q.requiresCard, true);
  assert.equal(s.delivery.pricingSource, "SAMEDAY");
});

test("alegerea manuală a curierului magazinului e păstrată la recalculare (fără revenire automată la Sameday)", async () => {
  const sel = { "svc-a": { fulfillment: "VENDOR_COURIER" } };
  for (let i = 0; i < 3; i += 1) {
    const s = byKey(await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a") }), "svc-a");
    assert.equal(s.selectedFulfillment, "VENDOR_COURIER");
    assert.equal(s.preselected, false);
    assert.equal(s.price, 15);
    // prețul Sameday rămâne vizibil, pentru comparație
    assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.price, 18.9);
  }
});

test("Sameday ales manual, cu easybox: metoda și locația validate, prețul easybox", async () => {
  const q = await quote({ groups: [group("svc-a", "v-a")], selections: { "svc-a": { fulfillment: "ARTFEST_SAMEDAY", method: "LOCKER", oohId: 501 } }, availability: available("svc-a") });
  const s = byKey(q, "svc-a");
  assert.equal(s.selectedFulfillment, "ARTFEST_SAMEDAY");
  assert.equal(s.method, "LOCKER");
  assert.equal(s.price, 12.5);
  assert.equal(s.delivery.oohId, 501);
});

test("mai mulți vânzători: fiecare magazin cu metoda lui; doar magazinul cu opțiunea activă primește Sameday", async () => {
  const groups = [group("svc-a", "v-a"), group("svc-b", "v-b")];
  const q = await quote({ groups, availability: available("svc-a") });
  assert.equal(byKey(q, "svc-a").selectedFulfillment, "ARTFEST_SAMEDAY");
  assert.equal(byKey(q, "svc-b").selectedFulfillment, "VENDOR_COURIER");
  assert.equal(byKey(q, "svc-b").fulfillmentOptions.ARTFEST_SAMEDAY, undefined);
  assert.equal(q.totalShipping, 33.9);
});

test("coș mixt cu un vânzător fără Stripe: Sameday NU e selectabil, explicat; curierul magazinului rămâne", async () => {
  const availability = { offered: true, cartCardCapable: false, byService: { "svc-a": { offered: true, available: false, reason: "cart_not_card_capable", message: "plata cu cardul nu e disponibilă" } } };
  const price = pricer();
  const q = await quote({ groups: [group("svc-a", "v-a"), group("svc-b", "v-b")], availability, price });
  const s = byKey(q, "svc-a");
  assert.equal(s.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.available, false);
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.reason, "cart_not_card_capable");
  assert.equal(price.calls.length, 0, "fără estimare Sameday când nu se poate alege");
  assert.equal(q.requiresCard, false);
});

test("Sameday ales, apoi coșul nu mai poate fi plătit cu cardul: fără schimbare tăcută (quote cere reconfirmare, plasarea 409)", async () => {
  const availability = { offered: true, cartCardCapable: false, byService: { "svc-a": { offered: true, available: false, reason: "cart_not_card_capable" } } };
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY" } };
  const s = byKey(await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability }), "svc-a");
  assert.equal(s.selectedFulfillment, null);
  assert.equal(s.price, null);
  assert.equal(s.samedayUnavailable.code, "cart_not_card_capable");
  await assert.rejects(quote({ groups: [group("svc-a", "v-a")], selections: sel, availability, placing: true }), (e) => e instanceof DeliverySelectionError && e.code === "sameday_unavailable" && e.httpStatus === 409);
});

test("tarif Sameday indisponibil / timeout: NICIODATĂ tariful magazinului ca preț Sameday", async () => {
  const price = pricer({ fail: true });
  // fără alegere: preselectarea cade pe curierul magazinului, opțiunea Sameday apare indisponibilă
  const auto = byKey(await quote({ groups: [group("svc-a", "v-a")], availability: available("svc-a"), price }), "svc-a");
  assert.equal(auto.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(auto.fulfillmentOptions.ARTFEST_SAMEDAY.available, false);
  assert.equal(auto.fulfillmentOptions.ARTFEST_SAMEDAY.price, null);
  // Sameday ales: magazinul fără preț + reconfirmare; la plasare 409
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY" } };
  const chosen = byKey(await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a"), price }), "svc-a");
  assert.equal(chosen.price, null);
  assert.equal(chosen.priceUnavailable, true);
  assert.equal(chosen.samedayUnavailable.code, "sameday_price_unavailable");
  await assert.rejects(quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a"), price, placing: true }), (e) => e.code === "sameday_price_unavailable" && e.httpStatus === 409);
  // altă sursă decât Sameday (ex. regulă internă) -> respins
  const other = byKey(await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a"), price: pricer({ source: "ARTFEST_RULE" }) }), "svc-a");
  assert.equal(other.samedayUnavailable.code, "sameday_price_unavailable");
});

test("pragul de transport gratuit al magazinului NU se aplică la Sameday prin Artfest", async () => {
  const g = group("svc-a", "v-a", { threshold: 5000, items: [{ price: 100, qty: 1, shippingWeightGrams: 500 }] });
  const s = byKey(await quote({ groups: [g], availability: available("svc-a") }), "svc-a");
  assert.equal(s.fulfillmentOptions.VENDOR_COURIER.price, 0);
  assert.equal(s.fulfillmentOptions.VENDOR_COURIER.qualifiesFreeShipping, true);
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.price, 18.9);
  assert.equal(s.qualifiesFreeShipping, false);
});

test("plasare: fără alegere explicită = checkout vechi (fără preselectare, fără apel Sameday), fulfillment null", async () => {
  const price = pricer();
  const s = byKey(await quote({ groups: [group("svc-a", "v-a")], availability: available("svc-a"), price, placing: true }), "svc-a");
  assert.equal(s.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(s.fulfillment, null);
  assert.equal(price.calls.length, 0);
});

test("plasare Sameday: revalidare live a locației, snapshot pentru AWB, Shipment.fulfillment = ARTFEST_SAMEDAY", async () => {
  const cat = catalog();
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY", method: "LOCKER", oohId: 501, expectedShippingCents: 1250 } };
  const q = await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a"), cat, placing: true });
  const s = byKey(q, "svc-a");
  assert.equal(cat.calls.findOohFresh, 1);
  assert.deepEqual(F.shipmentFulfillmentData(s), { fulfillment: "ARTFEST_SAMEDAY" });
  assert.equal(s.delivery.courierProvider, "SAMEDAY");
  assert.doesNotThrow(() => F.assertPlacementCompatible({ quote: q, selections: sel, paymentMethod: "CARD" }));
});

test("ramburs cu Sameday prin Artfest -> respins; ramburs cu curierul magazinului -> permis", async () => {
  const groups = [group("svc-a", "v-a"), group("svc-b", "v-b")];
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY" }, "svc-b": { fulfillment: "VENDOR_COURIER" } };
  const q = await quote({ groups, selections: sel, availability: available("svc-a", "svc-b"), placing: true });
  assert.throws(() => F.assertPlacementCompatible({ quote: q, selections: sel, paymentMethod: "COD" }), (e) => e.code === "sameday_requires_card" && e.groupKey === "svc-a");
  const vendorOnly = { "svc-a": { fulfillment: "VENDOR_COURIER" }, "svc-b": { fulfillment: "VENDOR_COURIER" } };
  const q2 = await quote({ groups, selections: vendorOnly, availability: available("svc-a", "svc-b"), placing: true });
  assert.doesNotThrow(() => F.assertPlacementCompatible({ quote: q2, selections: vendorOnly, paymentMethod: "COD" }));
  assert.deepEqual(F.shipmentFulfillmentData(byKey(q2, "svc-a")), { fulfillment: "VENDOR_COURIER" });
});

test("tarif schimbat între quote și plasare / preț manipulat de client -> 409 cu prețul real, nimic acceptat din frontend", async () => {
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY", expectedShippingCents: 1890 } };
  const q = await quote({ groups: [group("svc-a", "v-a")], selections: sel, availability: available("svc-a"), price: pricer({ byMethod: { HOME: 2190 } }), placing: true });
  assert.throws(
    () => F.assertPlacementCompatible({ quote: q, selections: sel, paymentMethod: "CARD" }),
    (e) => e.code === "shipping_price_changed" && e.httpStatus === 409 && e.extra.price === 21.9
  );
  const cheat = { "svc-a": { fulfillment: "VENDOR_COURIER", expectedShippingCents: 1 } };
  const q2 = await quote({ groups: [group("svc-a", "v-a")], selections: cheat, availability: available("svc-a"), placing: true });
  assert.equal(byKey(q2, "svc-a").price, 15, "prețul rămâne cel calculat pe server");
  assert.throws(() => F.assertPlacementCompatible({ quote: q2, selections: cheat, paymentMethod: "COD" }), (e) => e.code === "shipping_price_changed");
});

test("selecții manipulate: fulfillment necunoscut ignorat; easybox cu curierul magazinului refuzat la plasare; Sameday fără opțiune activă refuzat", async () => {
  assert.equal(F.readFulfillmentSelection({ fulfillment: "FREE_SHIPPING" }).fulfillment, null);
  assert.equal(F.readFulfillmentSelection({ expectedShippingCents: -5 }).expectedShippingCents, null);
  await assert.rejects(
    quote({ groups: [group("svc-a", "v-a")], selections: { "svc-a": { method: "LOCKER", oohId: 501 } }, availability: available("svc-a"), placing: true }),
    (e) => e.code === "delivery_method_unavailable"
  );
  await assert.rejects(
    quote({ groups: [group("svc-a", "v-a")], selections: { "svc-a": { fulfillment: "VENDOR_COURIER", method: "PUDO", oohId: 501 } }, availability: available("svc-a"), placing: true }),
    (e) => e.code === "delivery_method_unavailable"
  );
  await assert.rejects(
    quote({ groups: [group("svc-b", "v-b")], selections: { "svc-b": { fulfillment: "ARTFEST_SAMEDAY" } }, availability: available("svc-a"), placing: true }),
    (e) => e.code === "sameday_unavailable" && e.httpStatus === 409
  );
});

test("catalog Sameday indisponibil: opțiunea Sameday indisponibilă, curierul magazinului neafectat", async () => {
  const s = byKey(await quote({ groups: [group("svc-a", "v-a")], availability: available("svc-a"), cat: catalog({ courierAvailable: false }), price: pricer({ fail: true }) }), "svc-a");
  assert.equal(s.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(s.price, 15);
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.available, false);
});

test("gardă: checkout-ul nu mai decide Sameday prin comutatorul vechi (checkoutMode.js)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../routes/chekoutRoutes.js", import.meta.url), "utf8");
  assert.equal(/isSamedayCheckoutActive|from "..\/services\/shipping\/checkoutMode\.js"/.test(src), false);
  assert.match(src, /checkoutSamedayAvailability\(\{ groups \}\)/);
});

/* ===================== tariful simplu Artfest pentru coșurile fără greutate ===================== */

const { configsFromRows } = await import("./artfestSamedayConfig.js");
const { shipmentDeliveryCreate } = await import("./deliverySelection.js");
const NO_WEIGHT = [{ price: 100, qty: 1 }];
// tarif Admin de test doar la adresă (sumă FICTIVĂ, doar pentru test)
const artfest = () => configsFromRows([{ method: "HOME", amountCents: 2490 }]);

test("coș fără greutate + tarif Admin la adresă: prețul Artfest, fără apel Sameday, salvat pe livrare cu sursa lui", async () => {
  const price = pricer();
  const s = byKey(await quote({ groups: [group("svc-a", "v-a", { items: NO_WEIGHT })], availability: available("svc-a"), price, config: artfest() }), "svc-a");
  assert.equal(s.selectedFulfillment, "ARTFEST_SAMEDAY");
  assert.equal(s.price, 24.9);
  assert.equal(price.calls.length, 0, "fără estimare Sameday (și fără greutate inventată)");
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.standardRate, true);
  assert.deepEqual(s.fulfillmentOptions.ARTFEST_SAMEDAY.methods, ["HOME"], "easybox / Point fără tarif nu se oferă");
  const created = shipmentDeliveryCreate(s.delivery).delivery.create;
  assert.equal(created.shippingCost, "24.90");
  assert.equal(created.pricingSource, "ARTFEST_RULE");
  assert.equal(created.fallbackReason, "parcel_weight_unknown");
  assert.equal(created.carrierCost, null, "fără cost de curier inventat");
});

test("coș fără greutate fără tarif Admin: Sameday indisponibil, curierul magazinului neafectat; ales explicit -> 409", async () => {
  const none = configsFromRows([]);
  const g = () => [group("svc-a", "v-a", { items: NO_WEIGHT })];
  const s = byKey(await quote({ groups: g(), availability: available("svc-a"), config: none }), "svc-a");
  assert.equal(s.selectedFulfillment, "VENDOR_COURIER");
  assert.equal(s.price, 15);
  assert.equal(s.fulfillmentOptions.ARTFEST_SAMEDAY.available, false);
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY" } };
  assert.equal(byKey(await quote({ groups: g(), selections: sel, availability: available("svc-a"), config: none }), "svc-a").priceUnavailable, true);
  await assert.rejects(quote({ groups: g(), selections: sel, availability: available("svc-a"), config: none, placing: true }), (e) => e.code === "sameday_no_method" && e.httpStatus === 409);
});

test("metodă fără tarif (easybox) aleasă pentru coș fără greutate: indisponibilă, adresa rămâne; plasarea 409", async () => {
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY", method: "LOCKER", oohId: 501 } };
  const g = () => [group("svc-a", "v-a", { items: NO_WEIGHT })];
  const s = byKey(await quote({ groups: g(), selections: sel, availability: available("svc-a"), config: artfest() }), "svc-a");
  assert.equal(s.priceUnavailable, true);
  assert.deepEqual(s.fulfillmentOptions.ARTFEST_SAMEDAY.methods, ["HOME"]);
  await assert.rejects(quote({ groups: g(), selections: sel, availability: available("svc-a"), config: artfest(), placing: true }), (e) => e.code === "sameday_method_unavailable" && e.httpStatus === 409);
});

test("coșuri mixte, separat pe magazine: greutăți complete -> estimare; un produs fără greutate -> tariful Admin", async () => {
  const price = pricer();
  const groups = [
    group("svc-a", "v-a"),
    group("svc-b", "v-b", { items: [{ price: 50, qty: 1, shippingWeightGrams: 400 }, { price: 30, qty: 2 }] }),
    group("svc-c", "v-c", { fee: null, items: NO_WEIGHT }),
  ];
  const q = await quote({ groups, availability: available("svc-a", "svc-b"), price, config: artfest() });
  assert.equal(byKey(q, "svc-a").delivery.pricingSource, "SAMEDAY");
  assert.equal(byKey(q, "svc-a").price, 18.9);
  assert.equal(byKey(q, "svc-b").delivery.pricingSource, "ARTFEST_RULE");
  assert.equal(byKey(q, "svc-b").price, 24.9);
  assert.equal(price.calls.length, 1);
  assert.equal(byKey(q, "svc-c").priceUnavailable, true, "magazinul fără tarif propriu nu primește 0 lei");
  assert.equal(q.totalShipping, 43.8);
});

test("curierul magazinului: tarif lipsă != transport gratuit; 0 lei ales explicit și pragul atins rămân gratuite", async () => {
  let s = byKey(await quote({ groups: [group("svc-a", "v-a", { fee: null })], availability: OFF }), "svc-a");
  assert.equal(s.priceUnavailable, true);
  assert.equal(s.fulfillmentOptions.VENDOR_COURIER.available, false);
  await assert.rejects(quote({ groups: [group("svc-a", "v-a", { fee: null })], availability: OFF, placing: true }), (e) => e.code === "vendor_shipping_price_missing" && e.httpStatus === 409);
  s = byKey(await quote({ groups: [group("svc-a", "v-a", { fee: 0 })], availability: OFF }), "svc-a");
  assert.equal(s.price, 0);
  s = byKey(await quote({ groups: [group("svc-a", "v-a", { fee: null, threshold: 5000 })], availability: OFF }), "svc-a");
  assert.equal(s.price, 0);
  assert.equal(s.qualifiesFreeShipping, true);
});

test("tariful Admin schimbat după ce clientul a văzut prețul: plasarea cere reconfirmarea (409, prețul nou)", async () => {
  const sel = { "svc-a": { fulfillment: "ARTFEST_SAMEDAY", expectedShippingCents: 2490 } };
  const nou = configsFromRows([{ method: "HOME", amountCents: 2990 }]);
  const q = await quote({ groups: [group("svc-a", "v-a", { items: NO_WEIGHT })], selections: sel, availability: available("svc-a"), config: nou, placing: true });
  assert.throws(() => F.assertPlacementCompatible({ quote: q, selections: sel, paymentMethod: "CARD" }), (e) => e.code === "shipping_price_changed" && e.extra.price === 29.9);
});
