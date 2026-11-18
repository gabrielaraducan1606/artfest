// Rulare: node --test src/pages/Checkout/delivery/fulfillmentSelection.test.js
// Etapa 3 - alegerea „Sameday prin Artfest” / „Curierul magazinului” în checkout
// (logica fără React): preselectarea venită de la server, alegerea manuală păstrată,
// fără schimbare tăcută când Sameday devine indisponibil, payload-ul de quote / plasare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuotedFulfillment,
  buildSelectionsPayload,
  chooseFulfillment,
  effectiveSelection,
  mergeDeliveryOptions,
  samedayGroupKeys,
  sanitizeSelection,
} from "./deliveryState.js";
import { buildPlaceSelections, buildQuoteRequest, quotedShipping, readQuote } from "./shippingQuote.js";

const METHODS = ["HOME", "LOCKER", "PUDO"];
const LOC = { id: 501, type: "LOCKER", name: "easybox Test", address: "Str. Test 1", city: "Cluj-Napoca" };

const serverQuote = {
  shipments: [
    {
      serviceId: "s1",
      price: 18.9,
      selectedFulfillment: "ARTFEST_SAMEDAY",
      preselected: true,
      fulfillmentOptions: {
        ARTFEST_SAMEDAY: { available: true, price: 18.9, methods: ["HOME", "LOCKER"], paymentMethods: ["CARD"] },
        VENDOR_COURIER: { available: true, price: 15, qualifiesFreeShipping: false },
      },
    },
    { serviceId: "s2", price: 0, qualifiesFreeShipping: true, selectedFulfillment: "VENDOR_COURIER", fulfillmentOptions: { VENDOR_COURIER: { price: 0, qualifiesFreeShipping: true } } },
  ],
};

test("readQuote: modul ales, preselectarea și prețul fiecărei opțiuni", () => {
  const byGroup = readQuote(serverQuote);
  assert.equal(byGroup.s1.selectedFulfillment, "ARTFEST_SAMEDAY");
  assert.equal(byGroup.s1.preselected, true);
  assert.equal(byGroup.s1.options.ARTFEST_SAMEDAY.price, 18.9);
  assert.deepEqual(byGroup.s1.options.ARTFEST_SAMEDAY.methods, ["HOME", "LOCKER"]);
  assert.equal(byGroup.s1.options.VENDOR_COURIER.price, 15);
  assert.equal(byGroup.s2.options.ARTFEST_SAMEDAY, undefined);
  assert.equal(byGroup.s2.qualifiesFreeShipping, true);
});

test("preselectarea serverului devine alegerea magazinului; fără schimbare -> același obiect", () => {
  const byGroup = readQuote(serverQuote);
  const next = applyQuotedFulfillment({}, byGroup);
  assert.equal(next.s1.fulfillment, "ARTFEST_SAMEDAY");
  assert.equal(next.s1.userChosen, false);
  assert.equal(next.s2.fulfillment, "VENDOR_COURIER");
  assert.equal(applyQuotedFulfillment(next, byGroup), next, "stabil (fără bucle de render)");
  assert.deepEqual(samedayGroupKeys(["s1", "s2"], next), ["s1"]);
});

test("alegerea manuală a clientului NU e suprascrisă de preselectare la recalculare", () => {
  const manual = chooseFulfillment({}, "s1", "VENDOR_COURIER");
  assert.deepEqual(manual.s1, { method: "HOME", location: null, fulfillment: "VENDOR_COURIER", userChosen: true });
  const after = applyQuotedFulfillment(manual, readQuote(serverQuote));
  assert.equal(after.s1.fulfillment, "VENDOR_COURIER");
  assert.deepEqual(samedayGroupKeys(["s1"], after), []);
});

test("Sameday devenit indisponibil: alegerea rămâne (reconfirmare), magazinul blocat cu mesaj", () => {
  const sel = { s1: { method: "HOME", location: null, fulfillment: "ARTFEST_SAMEDAY", userChosen: false } };
  const data = {
    shipments: [
      {
        serviceId: "s1",
        price: null,
        priceUnavailable: true,
        priceUnavailableMessage: "Sameday indisponibil",
        selectedFulfillment: null,
        samedayUnavailable: { code: "sameday_unavailable", message: "Sameday indisponibil" },
        fulfillmentOptions: { VENDOR_COURIER: { price: 15 } },
      },
    ],
  };
  const byGroup = readQuote(data);
  assert.equal(applyQuotedFulfillment(sel, byGroup), sel, "nicio schimbare tăcută");
  assert.equal(byGroup.s1.samedayUnavailable.code, "sameday_unavailable");
  assert.equal(quotedShipping({ status: "ready", byGroup, missing: [] }, "s1").pending, "blocked");
});

test("payload quote: modul trimis doar când e ales de client sau e Sameday; easybox doar cu Sameday", () => {
  const sel = {
    s1: { method: "LOCKER", location: LOC, fulfillment: "ARTFEST_SAMEDAY", userChosen: true },
    s2: { method: "HOME", location: null, fulfillment: "VENDOR_COURIER", userChosen: false },
    s3: { method: "HOME", location: null, fulfillment: "VENDOR_COURIER", userChosen: true },
  };
  assert.deepEqual(buildSelectionsPayload(["s1", "s2", "s3", "s4"], sel, METHODS), {
    s1: { method: "LOCKER", oohId: 501, fulfillment: "ARTFEST_SAMEDAY" },
    s2: { method: "HOME" },
    s3: { method: "HOME", fulfillment: "VENDOR_COURIER" },
    s4: { method: "HOME" },
  });
  // curierul magazinului nu poate avea easybox, nici dintr-o stare manipulată
  assert.equal(sanitizeSelection({ method: "LOCKER", location: LOC, fulfillment: "VENDOR_COURIER" }).method, "HOME");
  assert.equal(sanitizeSelection({ fulfillment: "GRATUIT" }).fulfillment, undefined);
});

test("quote cu easybox fără locație: cerut ca adresă, dar cu modul Sameday păstrat", () => {
  const sel = { s1: { method: "LOCKER", location: null, fulfillment: "ARTFEST_SAMEDAY", userChosen: true } };
  const { body, missing } = buildQuoteRequest({ groupKeys: ["s1"], selections: sel, methods: METHODS, address: {} });
  assert.deepEqual(missing, ["s1"]);
  assert.deepEqual(body.selections.s1, { method: "HOME", fulfillment: "ARTFEST_SAMEDAY" });
});

test("payload plasare: modul explicit pentru fiecare magazin + prețul văzut de client, în bani", () => {
  const byGroup = readQuote(serverQuote);
  const selections = applyQuotedFulfillment({}, byGroup);
  const payload = buildPlaceSelections({ groupKeys: ["s1", "s2"], selections, methods: METHODS, quote: { status: "ready", byGroup } });
  assert.deepEqual(payload.s1, { method: "HOME", fulfillment: "ARTFEST_SAMEDAY", expectedShippingCents: 1890 });
  assert.deepEqual(payload.s2, { method: "HOME", fulfillment: "VENDOR_COURIER", expectedShippingCents: 0 });
});

test("alegere Sameday păstrează metoda / locația Sameday; trecerea la curier le șterge", () => {
  const start = { s1: { method: "LOCKER", location: LOC, fulfillment: "ARTFEST_SAMEDAY", userChosen: true } };
  assert.equal(chooseFulfillment(start, "s1", "ARTFEST_SAMEDAY").s1.method, "LOCKER");
  const vendor = chooseFulfillment(start, "s1", "VENDOR_COURIER");
  assert.equal(effectiveSelection(vendor, "s1", METHODS).method, "HOME");
  assert.equal(vendor.s1.location, null);
});

test("opțiunile de livrare: artfestSameday păstrat; cererea eșuată nu schimbă structura", () => {
  const ok = mergeDeliveryOptions(null, { ok: true, enabled: false, artfestSameday: true, methods: [{ method: "HOME" }, { method: "LOCKER" }] });
  assert.equal(ok.artfestSameday, true);
  assert.equal(ok.enabled, false);
  const failed = mergeDeliveryOptions(ok, { ok: false });
  assert.equal(failed.artfestSameday, true);
  assert.deepEqual(failed.methods.map((m) => m.method), ["HOME"]);
});

test("regresie: Easybox ales fără locație -> cerere nouă de quote (prețul devine „Alege locația”)", async () => {
  const { quoteRequestKey } = await import("./shippingQuote.js");
  const home = { s1: { method: "HOME", location: null, fulfillment: "ARTFEST_SAMEDAY", userChosen: false } };
  const locker = { s1: { method: "LOCKER", location: null, fulfillment: "ARTFEST_SAMEDAY", userChosen: true } };
  const a = buildQuoteRequest({ groupKeys: ["s1"], selections: home, methods: METHODS, address: {} });
  const b = buildQuoteRequest({ groupKeys: ["s1"], selections: locker, methods: METHODS, address: {} });
  assert.deepEqual(a.body, b.body, "același corp trimis serverului");
  assert.notEqual(quoteRequestKey({ isGuest: true, cartKey: "c", request: a }), quoteRequestKey({ isGuest: true, cartKey: "c", request: b }));
  assert.equal(quotedShipping({ status: "ready", byGroup: { s1: { price: 18.9 } }, missing: b.missing }, "s1").pending, "location");
});

test("Sameday ales, apoi oprit global (checkout revine la forma veche): alegerea NU e ignorată în tăcere", async () => {
  const { staleSamedayGroupKeys, STALE_SAMEDAY_MESSAGE } = await import("./deliveryState.js");
  const sel = {
    s1: { method: "LOCKER", location: LOC, fulfillment: "ARTFEST_SAMEDAY", userChosen: true },
    s2: { method: "HOME", location: null, fulfillment: "VENDOR_COURIER", userChosen: false },
  };
  // Sameday oprit, răspuns reușit al serverului -> magazinul cu Sameday cere reconfirmare
  assert.deepEqual(staleSamedayGroupKeys({ deliveryEnabled: false, optionsFetched: true, groupKeys: ["s1", "s2"], selections: sel }), ["s1"]);
  // încă fără răspuns de la server / Sameday încă activ (quote-ul tratează indisponibilitatea) -> nimic
  assert.deepEqual(staleSamedayGroupKeys({ deliveryEnabled: false, optionsFetched: false, groupKeys: ["s1"], selections: sel }), []);
  assert.deepEqual(staleSamedayGroupKeys({ deliveryEnabled: true, optionsFetched: true, groupKeys: ["s1"], selections: sel }), []);
  // după reconfirmare (curierul magazinului ales explicit) -> nimic de reconfirmat
  const confirmed = chooseFulfillment(sel, "s1", "VENDOR_COURIER");
  assert.deepEqual(staleSamedayGroupKeys({ deliveryEnabled: false, optionsFetched: true, groupKeys: ["s1", "s2"], selections: confirmed }), []);
  assert.match(STALE_SAMEDAY_MESSAGE, /nu mai este disponibilă/);
});
