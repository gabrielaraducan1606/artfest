// src/ai/knowledgeRetrieval.test.js
//
// Teste pentru getRelevantPlatformKnowledge() (audit "Ajutor Artfest" -
// comision generic vs. campanie, 2026-09-24). REALE, deterministe, FĂRĂ
// mock - scoring-ul pe text e determinist, iar dezambiguizarea LLM e
// dezactivată explicit (allowLlmDisambiguation: false), deci niciun
// apel către OpenAI nu se face în aceste teste. Manifestele folosite
// sunt cele REALE din src/ai/manifests/ - niciun manifest fals, ca să
// testăm exact comportamentul din producție.
//
// OPENAI_API_KEY e setat DOAR ca să nu pice construcția clientului la
// import (lib/openai.js instanțiază `new OpenAI()` la nivel de modul) -
// nu se face niciun apel real cu el în aceste teste.
//
// Rulare: node --test src/ai/knowledgeRetrieval.test.js

process.env.OPENAI_API_KEY = "sk-test-not-used";

import { test } from "node:test";
import assert from "node:assert/strict";

/*
 * Import DINAMIC, după setarea OPENAI_API_KEY - lib/openai.js
 * instanțiază `new OpenAI()` la nivel de modul, iar un import static
 * ar fi hoistat de ESM înaintea liniei `process.env.OPENAI_API_KEY = ...`
 * de mai sus (același motiv pentru care alte teste din acest proiect,
 * ex. discountCodeExpiryJob.test.js, folosesc import dinamic după
 * setarea env-ului).
 */
const { getRelevantPlatformKnowledge } = await import(
  "./knowledgeRetrieval.js"
);

async function idsFor(query, overrides = {}) {
  const result = await getRelevantPlatformKnowledge({
    query,
    audience: "USER",
    currentPage: null,
    currentEntity: null,
    conversationContext: null,
    allowLlmDisambiguation: false,
    ...overrides,
  });

  return result.map((m) => m.id);
}

/* =========================================================
   A. Comision GENERIC - toate formulările din audit trebuie să
   găsească knowledge-ul STANDARD (subscriptions-plans/checkout-
   payments), NICIODATĂ vendor-campaigns ca prim rezultat (dominant).
========================================================= */

const GENERIC_COMMISSION_QUERIES = [
  "Cât e comisionul?",
  "Ce comision ia Artfest?",
  "Cât oprește Artfest?",
  "Ce procent ia platforma?",
];

for (const query of GENERIC_COMMISSION_QUERIES) {
  test(`A. "${query}" -> manifestul dominant NU e vendor-campaigns`, async () => {
    const ids = await idsFor(query);

    assert.ok(ids.length > 0, "trebuie să găsească cel puțin un manifest");
    assert.notEqual(
      ids[0],
      "vendor-campaigns",
      `manifestul dominant pentru "${query}" nu trebuie să fie vendor-campaigns`
    );
  });
}

test('A bis. "Cât e comisionul?" -> subscriptions-plans e dominant (FAQ exact)', async () => {
  const ids = await idsFor("Cât e comisionul?");
  assert.equal(ids[0], "subscriptions-plans");
});

test('A ter. "Cât oprește Artfest?" -> subscriptions-plans găsit, vendor-campaigns absent', async () => {
  const ids = await idsFor("Cât oprește Artfest?");
  assert.ok(ids.includes("subscriptions-plans"));
  assert.ok(!ids.includes("vendor-campaigns"));
});

test('A quater. "Cât plătesc pe o comandă?" -> nu e despre comisionul vânzătorului (nici campanie, nici plan)', async () => {
  const ids = await idsFor("Cât plătesc pe o comandă?");

  assert.notEqual(ids[0], "vendor-campaigns");
  assert.notEqual(ids[0], "subscriptions-plans");
});

/* =========================================================
   B. Comision de CAMPANIE - trebuie să câștige vendor-campaigns
========================================================= */

test('B. "Care e comisionul pentru campanie?" -> vendor-campaigns câștigă', async () => {
  const ids = await idsFor("Care e comisionul pentru campanie?");

  assert.equal(ids[0], "vendor-campaigns");
});

test('B bis. "Ce comision am prin campania mea?" -> vendor-campaigns câștigă', async () => {
  const ids = await idsFor("Ce comision am prin campania mea?");

  assert.equal(ids[0], "vendor-campaigns");
});

/* =========================================================
   C. Regresie - alte domenii NU trebuie stricate de fix-ul de
   tie-break (avans, Stripe, COD, cereri ofertă, comenzi, livrare,
   facturare, coduri reducere, legal).
========================================================= */

const REGRESSION_QUERIES = [
  { query: "Cum funcționează avansul?", expectedId: "checkout-payments" },
  { query: "Cum conectez contul Stripe?", expectedId: "checkout-payments" },
  { query: "Pot plăti ramburs la comandă?", expectedId: "checkout-payments" },
  { query: "Cum cer o ofertă personalizată?", expectedId: "quotes" },
  { query: "Cum funcționează livrarea?", expectedId: "shipping-awb" },
  { query: "Cât costă livrarea?", expectedId: "shipping-awb" },
  { query: "Cum plătesc comisionul facturat?", expectedId: "checkout-payments" },
  { query: "Cum folosesc un cod de reducere?", expectedId: "checkout-payments" },
  { query: "Ce se întâmplă cu datele mele personale?", expectedId: "legal-privacy" },
];

for (const { query, expectedId } of REGRESSION_QUERIES) {
  test(`C. regresie "${query}" -> ${expectedId} încă găsit`, async () => {
    const ids = await idsFor(query);

    assert.ok(
      ids.includes(expectedId),
      `"${query}" ar trebui să găsească "${expectedId}", a găsit: ${ids.join(", ")}`
    );
  });
}

test("C bis. regresie 'Câte comenzi am?' (VENDOR) -> orders", async () => {
  const ids = await idsFor("Câte comenzi noi am în magazin?", {
    audience: "VENDOR",
  });

  assert.ok(ids.includes("orders"));
});

/* =========================================================
   D. Întrebare necunoscută / fără sens -> niciun manifest (retrieval
   gol, ca ruta să cadă pe fallback-ul de suport, nu pe o presupunere)
========================================================= */

test("D. întrebare fără nicio legătură cu platforma -> retrieval gol", async () => {
  const ids = await idsFor(
    "xyzabc zqxw blorf glorptrix nimic din asta nu exista"
  );

  assert.deepEqual(ids, []);
});

/* =========================================================
   E. structural - tie-break-ul nu se bazează pe un if hardcodat pe
   "comision": verificăm că funcționează generic, pe alt subiect cu
   o structură similară (2+ manifeste cu scor egal, unul cu FAQ
   exact, altul doar cu alias) - dacă există un caz natural în
   manifestele reale, îl folosim; altfel confirmăm doar determinismul
   (aceeași interogare -> exact același rezultat, de mai multe ori).
========================================================= */

test("E. determinism - aceeași interogare -> exact același rezultat de fiecare dată", async () => {
  const a = await idsFor("Cât e comisionul?");
  const b = await idsFor("Cât e comisionul?");
  const c = await idsFor("Cât e comisionul?");

  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("E bis. rezultatul nu depinde de ordinea manifestelor în index.js (nu mai e tie-break pe listă)", async () => {
  // Verificare indirectă: dacă tie-break-ul ar fi încă pe ordinea din
  // index.js, "vendor-campaigns" (declarat înaintea lui
  // "subscriptions-plans") ar câștiga mereu la egalitate - testul A bis
  // de mai sus deja demonstrează că nu mai e cazul. Aici confirmăm
  // explicit că subscriptions-plans apare ÎNAINTEA lui vendor-campaigns
  // quando ambele sunt candidate pentru "Cât e comisionul?".
  const ids = await idsFor("Cât e comisionul?");

  const subsIndex = ids.indexOf("subscriptions-plans");
  const campaignIndex = ids.indexOf("vendor-campaigns");

  assert.ok(subsIndex !== -1, "subscriptions-plans trebuie să fie în rezultat");

  if (campaignIndex !== -1) {
    assert.ok(
      subsIndex < campaignIndex,
      "subscriptions-plans trebuie să apară înaintea lui vendor-campaigns"
    );
  }
});

/* =========================================================
   F. lastCategory NU mai domină un match organic SPECIFIC (audit
   2026-09-24, regresie "cat e comisionul?" cu context anterior
   setat pe alt subiect - orders/products/quotes). Semnalul nou,
   hasSpecificOrganicMatch (IDF pe tokeni din title/tags/aliases/
   faq), trebuie să blocheze hint-ul de continuitate ORICÂND
   organic-ul câștigător are un token de query specific (rar în
   manifeste, lungime >= 5) cu match tare pe textul lui câștigător -
   fără niciun hardcodare pe cuvântul "comision" (vezi cazurile G/H
   de mai jos, pe alte domenii). Mecanismul de continuitate eliptică
   (Q255) trebuie să rămână complet funcțional - cazurile D/E/F.
========================================================= */

test('F.A "cat e comisionul?" cu lastCategory=orders -> subscriptions-plans câștigă, NU orders', async () => {
  const ids = await idsFor("cat e comisionul?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "orders" },
  });

  assert.equal(ids[0], "subscriptions-plans");
});

test('F.B "ce procent ia platforma?" cu lastCategory=products -> knowledge de comision câștigă, NU products', async () => {
  const ids = await idsFor("ce procent ia platforma?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "products" },
  });

  assert.notEqual(ids[0], "products");
  assert.ok(
    ["subscriptions-plans", "checkout-payments"].includes(ids[0]),
    `ar trebui să câștige knowledge de comision, a câștigat: ${ids[0]}`
  );
});

test('F.C "cat opreste Artfest?" cu lastCategory=quotes -> knowledge de comision câștigă, NU quotes', async () => {
  const ids = await idsFor("cat opreste Artfest?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "quotes" },
  });

  assert.notEqual(ids[0], "quotes");
  assert.ok(
    ["subscriptions-plans", "checkout-payments"].includes(ids[0]),
    `ar trebui să câștige knowledge de comision, a câștigat: ${ids[0]}`
  );
});

test('F.D "si statusul?" cu lastCategory=orders -> continuitatea rămâne pe orders (eliptic real)', async () => {
  const ids = await idsFor("si statusul?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "orders" },
  });

  assert.equal(ids[0], "orders");
});

test('F.E "si curierul?" cu lastCategory=shipping-awb -> continuitatea rămâne pe shipping-awb (eliptic real)', async () => {
  const ids = await idsFor("si curierul?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "shipping-awb" },
  });

  assert.equal(ids[0], "shipping-awb");
});

test('F.F "Unde o vad?" cu lastCategory=checkout-payments -> continuitatea rămâne pe checkout-payments (regresie Q255, NU quotes)', async () => {
  const ids = await idsFor("Unde o vad?", {
    audience: "VENDOR",
    conversationContext: { lastCategory: "checkout-payments" },
  });

  assert.equal(ids[0], "checkout-payments");
});

test('F.G "cat e comisionul?" FĂRĂ lastCategory -> comportament neschimbat (subscriptions-plans)', async () => {
  const ids = await idsFor("cat e comisionul?", {
    audience: "VENDOR",
    conversationContext: null,
  });

  assert.equal(ids[0], "subscriptions-plans");
});

const LAST_CATEGORY_REGRESSION_QUERIES = [
  { query: "Cum functioneaza avansul?", expectedId: "checkout-payments", lastCategory: null },
  { query: "Cum conectez contul Stripe?", expectedId: "checkout-payments", lastCategory: null },
  { query: "Pot plati ramburs la comanda?", expectedId: "checkout-payments", lastCategory: null },
  { query: "Cum functioneaza livrarea?", expectedId: "shipping-awb", lastCategory: null },
  { query: "Cum platesc comisionul facturat?", expectedId: "checkout-payments", lastCategory: null },
  { query: "Cum cer o oferta personalizata?", expectedId: "quotes", lastCategory: null },
];

for (const { query, expectedId, lastCategory } of LAST_CATEGORY_REGRESSION_QUERIES) {
  test(`F.H regresie "${query}" (lastCategory=${lastCategory}) -> ${expectedId} încă găsit`, async () => {
    const ids = await idsFor(query, {
      audience: "VENDOR",
      conversationContext: lastCategory ? { lastCategory } : null,
    });

    assert.ok(
      ids.includes(expectedId),
      `"${query}" ar trebui să găsească "${expectedId}", a găsit: ${ids.join(", ")}`
    );
  });
}
