// Rulare: node --test src/pages/Vendor/Produse/hooks/customizationQuantity.test.js
//
// Verificarea cantității la produse personalizate cu mai multe fotografii:
// reguli locale, când se cere AI-ul, când se întreabă clientul, fallback.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyQuantityLocally,
  countCustomizationPhotos,
  decideQuantityCheck,
  fetchQuantityKind,
  photosLabel,
  productsLabel,
} from "./customizationQuantity.js";

const photos = (n) => Array.from({ length: n }, (_, i) => `https://cdn.test/customizations/${i}.jpg`);
const SCHEMA = [
  { key: "poze", label: "Fotografii", type: "photo" },
  { key: "coperta", label: "Copertă", type: "image" },
  { key: "text", label: "Mesaj", type: "text" },
];

test("numără câmpul cu cele mai multe fotografii, fără să adune câmpurile", () => {
  assert.equal(countCustomizationPhotos(SCHEMA, { poze: photos(20), coperta: photos(5)[0], text: "x" }), 20);
  // o singură fotografie (valoare veche, string) - compatibil
  assert.equal(countCustomizationPhotos(SCHEMA, { poze: photos(1)[0] }), 1);
  assert.equal(countCustomizationPhotos(SCHEMA, {}), 0);
});

test("1) 1 fotografie, cantitate 1 -> continuă normal", () => {
  assert.equal(decideQuantityCheck({ photoCount: 1, qty: 1, localKind: "per_photo" }), "proceed");
});

test("2) 20 fotografii, cantitate 1, magneți -> întreabă (fără AI)", () => {
  const localKind = classifyQuantityLocally({ title: "Magneți foto personalizați" });
  assert.equal(localKind, "per_photo");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 1, localKind }), "ask");
});

test("3) 20 fotografii, cantitate 20 (sau mai multă) -> continuă normal", () => {
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 20, localKind: "per_photo" }), "proceed");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 40, localKind: "per_photo" }), "proceed");
});

test("4) 10 fotografii pentru un colaj -> un singur produs, fără întrebare", () => {
  const localKind = classifyQuantityLocally({ title: "Tablou colaj cu fotografiile voastre" });
  assert.equal(localKind, "single_product");
  assert.equal(decideQuantityCheck({ photoCount: 10, qty: 1, localKind }), "proceed");
  assert.equal(classifyQuantityLocally({ title: "Album foto", description: "până la 40 de fotografii" }), "single_product");
});

test("produs ambiguu -> cere AI; AI decide sau, neclar, întrebăm clientul", () => {
  const localKind = classifyQuantityLocally({ title: "Cadou personalizat", description: "Trimite-ne pozele" });
  assert.equal(localKind, "ambiguous");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 1, localKind }), "need_ai");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 1, localKind, aiKind: "single_product" }), "proceed");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 1, localKind, aiKind: "per_photo" }), "ask");
  assert.equal(decideQuantityCheck({ photoCount: 20, qty: 1, localKind, aiKind: "unclear" }), "ask");
});

test("semnale contradictorii -> ambiguu (nu ghicim)", () => {
  assert.equal(classifyQuantityLocally({ title: "Colaj din magneți foto" }), "ambiguous");
});

test("7) AI indisponibil: eroare, 429, timeout -> unclear (fără să blocheze)", async () => {
  assert.equal(await fetchQuantityKind("p1", { fetchImpl: async () => { throw new Error("net"); } }), "unclear");
  assert.equal(await fetchQuantityKind("p1", { fetchImpl: async () => ({ ok: false, status: 429 }) }), "unclear");
  assert.equal(
    await fetchQuantityKind("p1", {
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("abort")))),
    }),
    "unclear"
  );
  assert.equal(
    await fetchQuantityKind("p1", { fetchImpl: async () => ({ ok: true, json: async () => ({ kind: "inventat" }) }) }),
    "unclear"
  );
});

test("cererea AI trimite doar id-ul produsului (fără fotografii)", async () => {
  let seen = null;
  const kind = await fetchQuantityKind("p 1", {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ kind: "per_photo" }) };
    },
  });
  assert.equal(kind, "per_photo");
  assert.equal(seen.url, "/api/public/customization-quantity/p%201");
  assert.equal(seen.init.body, undefined);
});

test("textele: 20 de fotografii / 1 produs / 5 produse", () => {
  assert.equal(photosLabel(20), "20 de fotografii");
  assert.equal(photosLabel(5), "5 fotografii");
  assert.equal(productsLabel(1), "1 produs");
  assert.equal(productsLabel(20), "20 de produse");
  assert.equal(productsLabel(5), "5 produse");
});
