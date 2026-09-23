// src/utils/discountCodeAttribution.test.js
//
// Rulare: node --test src/utils/discountCodeAttribution.test.js
//
// Modul pur (sessionStorage) - shim minimal in-memory pentru
// `sessionStorage`, ca sa nu depinda de un mediu de browser real.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

globalThis.sessionStorage = makeMemoryStorage();

const {
  getStoredDiscountCodeAttribution,
  storeDiscountCodeAttribution,
  clearStoredDiscountCodeAttribution,
} = await import("./discountCodeAttribution.js");

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

/* =========================================================
   Write / read de bază - cod de influencer
========================================================= */
test("cod de influencer: se salveaza si se citeste corect, cu type dedus", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
  });

  const hint = getStoredDiscountCodeAttribution();

  assert.deepEqual(hint, {
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
    type: "INFLUENCER",
  });
});

/* =========================================================
   Write / read de bază - cod de vendor
========================================================= */
test("cod de vendor: se salveaza si se citeste corect, cu type dedus", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-2",
    code: "VENDCODE10",
    influencerId: null,
    vendorId: "vendor-x",
  });

  const hint = getStoredDiscountCodeAttribution();

  assert.equal(hint.type, "VENDOR");
  assert.equal(hint.vendorId, "vendor-x");
  assert.equal(hint.influencerId, null);
});

/* =========================================================
   Nu salveaza mai mult decat necesar - estimatedDiscountAmountCents
   etc. (daca sunt trimise din greseala) nu ajung in storage.
========================================================= */
test("nu persista campuri in plus fata de cele necesare atribuirii", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
    estimatedDiscountAmountCents: 5000,
    effectiveDiscountPercent: 10,
  });

  const hint = getStoredDiscountCodeAttribution();

  assert.deepEqual(Object.keys(hint).sort(), [
    "code",
    "discountCodeId",
    "influencerId",
    "type",
    "vendorId",
  ]);
});

/* =========================================================
   Cod valid FARA owner (influencerId/vendorId absente) => sterge
   orice hint anterior, nu scrie unul gol.
========================================================= */
test("cod valid fara owner: sterge orice hint anterior, nu scrie unul gol", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
  });

  assert.ok(getStoredDiscountCodeAttribution());

  storeDiscountCodeAttribution({
    discountCodeId: "dc-platform",
    code: "PLATFORM10",
    influencerId: null,
    vendorId: null,
  });

  assert.equal(getStoredDiscountCodeAttribution(), null);
});

/* =========================================================
   F. cod A introdus -> eliminat (fara stergere hint) -> cod B
   introdus => B inlocuieste hint-ul lui A (ultimul cod VALID
   castiga).
========================================================= */
test("F. cod A apoi cod B (ambele valide, cu owner diferit): B inlocuieste hint-ul lui A", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-a",
    code: "CODEA",
    influencerId: "influencer-a",
    vendorId: null,
  });

  // "Elimină" pe cod NU atinge hint-ul (simulăm - removeDiscountCode
  // din Cart.jsx/Checkout.jsx nu cheamă acest modul deloc).
  assert.equal(getStoredDiscountCodeAttribution().influencerId, "influencer-a");

  storeDiscountCodeAttribution({
    discountCodeId: "dc-b",
    code: "CODEB",
    influencerId: null,
    vendorId: "vendor-b",
  });

  const hint = getStoredDiscountCodeAttribution();
  assert.equal(hint.discountCodeId, "dc-b");
  assert.equal(hint.vendorId, "vendor-b");
  assert.equal(hint.influencerId, null);
});

/* =========================================================
   G. Dupa plasarea cu succes a comenzii, hint-ul e sters explicit.
========================================================= */
test("G. clearStoredDiscountCodeAttribution sterge hint-ul (apelat dupa comanda plasata cu succes)", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
  });

  assert.ok(getStoredDiscountCodeAttribution());

  clearStoredDiscountCodeAttribution();

  assert.equal(getStoredDiscountCodeAttribution(), null);
});

/* =========================================================
   H. Fara niciun hint salvat -> read intoarce null (comportament
   implicit, neschimbat).
========================================================= */
test("H. fara hint salvat: read intoarce null", () => {
  assert.equal(getStoredDiscountCodeAttribution(), null);
});

/* =========================================================
   hint invalid (JSON corupt in storage) -> read degradeaza la
   null, nu arunca.
========================================================= */
test("JSON corupt in sessionStorage: read intoarce null, nu arunca", () => {
  globalThis.sessionStorage.setItem(
    "artfest.discountCodeAttribution",
    "{not valid json"
  );

  assert.doesNotThrow(() => getStoredDiscountCodeAttribution());
  assert.equal(getStoredDiscountCodeAttribution(), null);
});

/* =========================================================
   write(null) -> sterge hint-ul existent (echivalent cu "fara owner").
========================================================= */
test("storeDiscountCodeAttribution(null): sterge hint-ul existent", () => {
  storeDiscountCodeAttribution({
    discountCodeId: "dc-1",
    code: "INFCODE10",
    influencerId: "influencer-1",
    vendorId: null,
  });

  storeDiscountCodeAttribution(null);

  assert.equal(getStoredDiscountCodeAttribution(), null);
});
