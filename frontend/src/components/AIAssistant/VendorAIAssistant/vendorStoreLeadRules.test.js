// src/components/AIAssistant/VendorAIAssistant/vendorStoreLeadRules.test.js
//
// Teste pure pentru "Magazinul meu" -> "Îmbunătățește magazinul"
// (Vendor Assistant, conectare flow, 2026-09-23) - reguli deterministe,
// FĂRĂ rețea/DOM. Comportamentul de rețea (fetch/retry/navigare/CTA
// click) e acoperit de infrastructura deja existentă - nu se poate
// testa din VendorAssistant.jsx (.jsx), consistent cu restul
// proiectului (vezi vendorQuoteLeadCards.test.js/vendorOrderLeadCards.test.js).
//
// Rulare: node --test src/components/AIAssistant/VendorAIAssistant/vendorStoreLeadRules.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildVendorStoreSuggestions,
  isVendorStoreComplete,
  buildVendorStoreSnapshot,
} from "./vendorStoreLeadRules.js";

function makeCompleteSnapshot(overrides = {}) {
  return {
    isActive: true,
    logoUrl: "https://cdn.example.com/logo.png",
    about: "Facem ceramică lucrată manual, inspirată din tradiția românească.",
    productsCount: 8,
    activeProductsCount: 8,
    stripeChargesEnabled: true,
    billingComplete: true,
    unansweredQuotesCount: 0,
    newOrdersCount: 0,
    products: Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      category: "home_ceramica-lut",
      color: "pink_dusty",
      materialMain: "clay",
      occasionTags: ["birthday"],
      availability: "READY",
      images: ["a.jpg", "b.jpg"],
      description: "Descriere completă.",
      acceptsCustom: false,
      customSchema: [],
      isActive: true,
      isHidden: false,
    })),
    ...overrides,
  };
}

/* =========================================================
   A. magazin complet -> nicio sugestie
========================================================= */

test("A. magazin complet -> 0 sugestii, isVendorStoreComplete = true", () => {
  const snapshot = makeCompleteSnapshot();

  assert.deepEqual(buildVendorStoreSuggestions(snapshot), []);
  assert.equal(isVendorStoreComplete(snapshot), true);
});

/* =========================================================
   B. fără logo
========================================================= */

test("B. fără logo -> sugestie HIGH 'Adaugă un logo', CTA edit-store", () => {
  const snapshot = makeCompleteSnapshot({ logoUrl: null });
  const suggestions = buildVendorStoreSuggestions(snapshot);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].id, "store-missing-logo");
  assert.equal(suggestions[0].priority, "HIGH");
  assert.equal(suggestions[0].cta.action, "edit-store");
});

/* =========================================================
   C. fără descriere
========================================================= */

test("C. fără descriere -> sugestie HIGH, CTA edit-store", () => {
  const snapshot = makeCompleteSnapshot({ about: "   " });
  const suggestions = buildVendorStoreSuggestions(snapshot);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].id, "store-missing-description");
  assert.equal(suggestions[0].priority, "HIGH");
});

/* =========================================================
   D. fără produse (0 produse active)
========================================================= */

test("D. 0 produse active -> sugestie HIGH 'Adaugă cel puțin un produs activ'", () => {
  const snapshot = makeCompleteSnapshot({
    productsCount: 0,
    activeProductsCount: 0,
    products: [],
  });

  const suggestions = buildVendorStoreSuggestions(snapshot);
  const found = suggestions.find((s) => s.id === "store-no-active-products");

  assert.ok(found);
  assert.equal(found.priority, "HIGH");
  assert.equal(found.cta.action, "add-product");
});

/* =========================================================
   E. produse fără categorie
========================================================= */

test("E. produse fără categorie -> sugestie MEDIUM cu numărul corect, CTA edit-products", () => {
  const snapshot = makeCompleteSnapshot({
    products: [
      { ...makeCompleteSnapshot().products[0], category: null },
      { ...makeCompleteSnapshot().products[0], category: "" },
      makeCompleteSnapshot().products[0],
    ],
  });

  const suggestions = buildVendorStoreSuggestions(snapshot);
  const found = suggestions.find(
    (s) => s.id === "products-missing-category"
  );

  assert.ok(found);
  assert.equal(found.priority, "MEDIUM");
  assert.match(found.reason, /2 produse/);
  assert.equal(found.cta.action, "edit-products");
});

/* =========================================================
   F. SOLD_OUT
========================================================= */

test("F. produse SOLD_OUT -> sugestie MEDIUM, numărare corectă (singular/plural)", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshotOne = makeCompleteSnapshot({
    products: [{ ...base, availability: "SOLD_OUT" }, base],
  });

  const one = buildVendorStoreSuggestions(snapshotOne).find(
    (s) => s.id === "products-sold-out"
  );

  assert.ok(one);
  assert.match(one.reason, /^1 produs este/);

  const snapshotTwo = makeCompleteSnapshot({
    products: [
      { ...base, availability: "SOLD_OUT" },
      { ...base, availability: "SOLD_OUT" },
    ],
  });

  const two = buildVendorStoreSuggestions(snapshotTwo).find(
    (s) => s.id === "products-sold-out"
  );

  assert.match(two.reason, /^2 produse sunt/);
});

/* =========================================================
   G. Stripe inactiv
========================================================= */

test("G. Stripe inactiv -> sugestie HIGH 'Activează plata cu cardul'", () => {
  const snapshot = makeCompleteSnapshot({ stripeChargesEnabled: false });
  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "store-stripe-inactive"
  );

  assert.ok(found);
  assert.equal(found.priority, "HIGH");
  assert.equal(found.cta.action, "vendor-payouts");
});

/* =========================================================
   H. billing incomplet
========================================================= */

test("H. billing incomplet -> sugestie HIGH 'Completează datele de facturare'", () => {
  const snapshot = makeCompleteSnapshot({ billingComplete: false });
  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "store-billing-incomplete"
  );

  assert.ok(found);
  assert.equal(found.priority, "HIGH");
  assert.equal(found.cta.action, "vendor-billing");
});

/* =========================================================
   I. cereri fără răspuns
========================================================= */

test("I. cereri SUBMITTED fără ofertă -> sugestie HIGH cu numărul corect", () => {
  const snapshot = makeCompleteSnapshot({ unansweredQuotesCount: 3 });
  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "store-unanswered-quotes"
  );

  assert.ok(found);
  assert.equal(found.priority, "HIGH");
  assert.match(found.reason, /3 cereri/);
  assert.equal(found.cta.action, "received-quotes");
});

test("I bis. comenzi noi neprocesate -> sugestie HIGH, CTA vendor-orders", () => {
  const snapshot = makeCompleteSnapshot({ newOrdersCount: 1 });
  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "store-new-orders"
  );

  assert.ok(found);
  assert.equal(found.priority, "HIGH");
  assert.match(found.reason, /^Ai 1 comandă nouă/);
  assert.equal(found.cta.action, "vendor-orders");
});

/* =========================================================
   J. personalizare incompletă (regula obiectivă aprobată)
========================================================= */

test("J. acceptsCustom=true + customSchema gol -> sugestie MEDIUM", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshot = makeCompleteSnapshot({
    products: [
      { ...base, acceptsCustom: true, customSchema: [] },
      base,
    ],
  });

  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "products-incomplete-personalization"
  );

  assert.ok(found);
  assert.equal(found.priority, "MEDIUM");
  assert.match(found.reason, /1 produs are personalizarea/);
});

test("J bis. acceptsCustom=true + customSchema completă -> NU declanșează regula", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshot = makeCompleteSnapshot({
    products: [
      {
        ...base,
        acceptsCustom: true,
        customSchema: [{ key: "text", label: "Text personalizat" }],
      },
    ],
  });

  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "products-incomplete-personalization"
  );

  assert.equal(found, undefined);
});

test("J ter. acceptsCustom=false -> NU declanșează regula, indiferent de customSchema", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshot = makeCompleteSnapshot({
    products: [{ ...base, acceptsCustom: false, customSchema: [] }],
  });

  const found = buildVendorStoreSuggestions(snapshot).find(
    (s) => s.id === "products-incomplete-personalization"
  );

  assert.equal(found, undefined);
});

/* =========================================================
   K. ordonare HIGH -> MEDIUM -> LOW
========================================================= */

test("K. ordonare: toate sugestiile HIGH înaintea celor MEDIUM/LOW", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshot = makeCompleteSnapshot({
    logoUrl: null, // HIGH
    products: [
      { ...base, category: null }, // MEDIUM
      { ...base, description: "" }, // LOW
    ],
    productsCount: 2,
  });

  const suggestions = buildVendorStoreSuggestions(snapshot, 10);
  const priorities = suggestions.map((s) => s.priority);

  const firstMediumIndex = priorities.indexOf("MEDIUM");
  const firstLowIndex = priorities.indexOf("LOW");
  const lastHighIndex = priorities.lastIndexOf("HIGH");

  assert.ok(lastHighIndex < firstMediumIndex);
  assert.ok(firstMediumIndex < firstLowIndex);
});

/* =========================================================
   L. maximum 5 sugestii
========================================================= */

test("L. maximum 5 sugestii implicit, chiar dacă se declanșează mai multe reguli", () => {
  const snapshot = makeCompleteSnapshot({
    isActive: false, // HIGH
    logoUrl: null, // HIGH
    about: "", // HIGH
    stripeChargesEnabled: false, // HIGH
    billingComplete: false, // HIGH
    unansweredQuotesCount: 2, // HIGH
    newOrdersCount: 1, // HIGH
  });

  const suggestions = buildVendorStoreSuggestions(snapshot);
  assert.equal(suggestions.length, 5);
  assert.ok(suggestions.every((s) => s.priority === "HIGH"));
});

test("L bis. limit custom respectat", () => {
  const snapshot = makeCompleteSnapshot({
    isActive: false,
    logoUrl: null,
    about: "",
  });

  const suggestions = buildVendorStoreSuggestions(snapshot, 2);
  assert.equal(suggestions.length, 2);
});

/* =========================================================
   M. CTA corect pentru fiecare sugestie
========================================================= */

test("M. fiecare sugestie are cta.action și cta.label nevide", () => {
  const base = makeCompleteSnapshot().products[0];

  const snapshot = makeCompleteSnapshot({
    isActive: false,
    logoUrl: null,
    about: "",
    activeProductsCount: 0,
    stripeChargesEnabled: false,
    billingComplete: false,
    unansweredQuotesCount: 1,
    newOrdersCount: 1,
    productsCount: 3,
    products: [
      { ...base, category: null },
      { ...base, acceptsCustom: true, customSchema: [] },
      { ...base, availability: "SOLD_OUT" },
      { ...base, images: ["a.jpg"] },
      { ...base, description: "" },
    ],
  });

  const suggestions = buildVendorStoreSuggestions(snapshot, 20);

  assert.ok(suggestions.length > 0);

  for (const suggestion of suggestions) {
    assert.ok(
      typeof suggestion.cta?.action === "string" &&
        suggestion.cta.action.length > 0,
      `lipsă cta.action pentru ${suggestion.id}`
    );

    assert.ok(
      typeof suggestion.cta?.label === "string" &&
        suggestion.cta.label.length > 0,
      `lipsă cta.label pentru ${suggestion.id}`
    );

    assert.ok(
      typeof suggestion.title === "string" && suggestion.title.length > 0
    );

    assert.ok(
      typeof suggestion.reason === "string" && suggestion.reason.length > 0
    );
  }
});

/* =========================================================
   N. structural - buildVendorStoreSnapshot mapează STRICT ce vine
   din endpointuri, fără recalculare/inventare
========================================================= */

test("N. buildVendorStoreSnapshot mapează câmpurile brute din cele 4 surse", () => {
  const snapshot = buildVendorStoreSnapshot({
    dashboard: {
      vendor: {
        logoUrl: "vendor-logo.png",
        about: "Vendor about",
        stripeChargesEnabled: true,
      },
      services: [
        {
          isActive: true,
          profile: {
            logoUrl: "service-logo.png",
            about: "Service about",
          },
        },
      ],
    },
    billing: { cui: "RO123" },
    products: [
      { id: "p1", isActive: true, isHidden: false },
      { id: "p2", isActive: false, isHidden: false },
      { id: "p3", isActive: true, isHidden: true },
    ],
    unansweredQuotesCount: 2,
    newOrdersCount: 1,
  });

  // profil serviciu are prioritate față de vendor (mai specific)
  assert.equal(snapshot.logoUrl, "service-logo.png");
  assert.equal(snapshot.about, "Service about");
  assert.equal(snapshot.isActive, true);
  assert.equal(snapshot.stripeChargesEnabled, true);
  assert.equal(snapshot.billingComplete, true);
  assert.equal(snapshot.productsCount, 3);
  assert.equal(snapshot.activeProductsCount, 1); // doar p1: active + nu hidden
  assert.equal(snapshot.unansweredQuotesCount, 2);
  assert.equal(snapshot.newOrdersCount, 1);
});

test("N bis. buildVendorStoreSnapshot - billing null -> billingComplete=false, fără crash pe input gol", () => {
  const snapshot = buildVendorStoreSnapshot({});

  assert.equal(snapshot.billingComplete, false);
  assert.equal(snapshot.isActive, false);
  assert.equal(snapshot.logoUrl, null);
  assert.equal(snapshot.productsCount, 0);
  assert.deepEqual(snapshot.products, []);
});

/* =========================================================
   O. determinism
========================================================= */

test("O. buildVendorStoreSuggestions e determinist (același input -> același output)", () => {
  const snapshot = makeCompleteSnapshot({ logoUrl: null });

  const a = buildVendorStoreSuggestions(snapshot);
  const b = buildVendorStoreSuggestions(snapshot);

  assert.deepEqual(a, b);
});
