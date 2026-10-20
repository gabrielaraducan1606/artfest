// src/pages/Checkout/checkoutForm.test.js
// Rulare: node --test src/pages/Checkout/checkoutForm.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RO_COUNTIES_FALLBACK,
  filterCounties,
  getPaymentRecoveryPath,
  isCardUnavailableError,
  isValidRoPhone,
  matchCounty,
  normalizeRoPhone,
  sanitizePhoneInput,
} from "./checkoutForm.js";

/* =========================================================
   Telefon
========================================================= */

test("telefon: +40 / 0040 / 40 -> 07xxxxxxxx (autocompletare mobil)", () => {
  assert.equal(normalizeRoPhone("+40712345678"), "0712345678");
  assert.equal(normalizeRoPhone("+40 712 345 678"), "0712345678");
  assert.equal(normalizeRoPhone("0040712345678"), "0712345678");
  assert.equal(normalizeRoPhone("40712345678"), "0712345678");
  assert.equal(normalizeRoPhone("+40 (0)712 345 678"), "0712345678");
  assert.equal(normalizeRoPhone("0712 345 678"), "0712345678");
});

test("telefon: regresie - nu mai produce numărul greșit 4071234567", () => {
  assert.notEqual(normalizeRoPhone("+40712345678"), "4071234567");
  assert.equal(isValidRoPhone("4071234567"), false);
});

test("telefon: validare", () => {
  assert.equal(isValidRoPhone("0712345678"), true);
  assert.equal(isValidRoPhone("+40 712 345 678"), true);
  assert.equal(isValidRoPhone("0040712345678"), true);
  assert.equal(isValidRoPhone("071234567"), false);
  assert.equal(isValidRoPhone(""), false);
  assert.equal(isValidRoPhone("+359888123456"), false);
});

test("telefon: câmpul permite tastarea lui +40 (nu taie + și nu limitează la 10)", () => {
  assert.equal(sanitizePhoneInput("+40 712 345 678"), "+40 712 345 678");
  assert.equal(sanitizePhoneInput("+4"), "+4");
  assert.equal(sanitizePhoneInput("07a12"), "0712");
  assert.ok(sanitizePhoneInput("1".repeat(40)).length <= 20);
});

/* =========================================================
   Județ
========================================================= */

const API_COUNTIES = RO_COUNTIES_FALLBACK.map((c) => ({ ...c }));

test("județ: nume tastat fără a alege din listă este potrivit automat", () => {
  assert.equal(matchCounty("Cluj", API_COUNTIES)?.code, "CJ");
  assert.equal(matchCounty("cluj ", API_COUNTIES)?.code, "CJ");
  assert.equal(matchCounty("Iasi", API_COUNTIES)?.code, "IS");
  assert.equal(matchCounty("Iași", API_COUNTIES)?.code, "IS");
  assert.equal(matchCounty("Bistrita Nasaud", API_COUNTIES)?.code, "BN");
  assert.equal(matchCounty("bistrița-năsăud", API_COUNTIES)?.code, "BN");
  assert.equal(matchCounty("Satu Mare", API_COUNTIES)?.code, "SM");
  assert.equal(matchCounty("Județul Timiș", API_COUNTIES)?.code, "TM");
  assert.equal(matchCounty("jud. Prahova", API_COUNTIES)?.code, "PH");
});

test("județ: coduri și București", () => {
  assert.equal(matchCounty("CJ", API_COUNTIES)?.code, "CJ");
  assert.equal(matchCounty("b", API_COUNTIES)?.code, "B");
  assert.equal(matchCounty("Bucuresti", API_COUNTIES)?.code, "B");
  assert.equal(matchCounty("Municipiul București", API_COUNTIES)?.code, "B");
  assert.equal(matchCounty("Sector 3", API_COUNTIES)?.code, "B");
});

test("județ: prefix neambiguu se potrivește, prefix ambiguu NU", () => {
  assert.equal(matchCounty("Consta", API_COUNTIES)?.code, "CT");
  assert.equal(matchCounty("Bra", API_COUNTIES), null); // Brăila / Brașov
  assert.equal(matchCounty("Xyz", API_COUNTIES), null);
  assert.equal(matchCounty("", API_COUNTIES), null);
});

test("județ: fallback local când API-ul nu a întors nimic", () => {
  assert.equal(RO_COUNTIES_FALLBACK.length, 42);
  assert.equal(matchCounty("Cluj", [])?.code, "CJ");
  assert.equal(matchCounty("Cluj", undefined)?.code, "CJ");
});

test("județ: lista locală e identică cu cea din backend (geoRoutes.js)", () => {
  const source = readFileSync(
    new URL("../../../../backend/src/routes/geoRoutes.js", import.meta.url),
    "utf8"
  );
  const backend = [...source.matchAll(/\{\s*code:\s*"([A-Z]+)",\s*name:\s*"([^"]+)"\s*\}/g)]
    .map(([, code, name]) => `${code}:${name}`)
    .sort();
  const local = RO_COUNTIES_FALLBACK.map((c) => `${c.code}:${c.name}`).sort();
  assert.deepEqual(local, backend);
});

test("județ: filtrarea listei ignoră diacriticele", () => {
  assert.deepEqual(
    filterCounties(API_COUNTIES, "iasi").map((c) => c.code),
    ["IS"]
  );
  assert.equal(filterCounties(API_COUNTIES, "").length, 42);
  assert.deepEqual(filterCounties([], "cluj"), []);
});

/* =========================================================
   Recuperare după eșecul plății
========================================================= */

test("plată eșuată după crearea comenzii (user) -> pagina comenzii", () => {
  const error = {
    status: 500,
    data: { error: "payment_init_failed", orderId: "ord_1" },
  };
  assert.equal(getPaymentRecoveryPath(error), "/comanda/ord_1?payment=failed");
});

test("plată eșuată după crearea comenzii (guest) -> pagina publică, cu token", () => {
  const error = {
    status: 500,
    data: {
      error: "guest_payment_init_failed",
      orderId: "ord 2",
      guestAccessToken: "tok&1",
    },
  };
  assert.equal(
    getPaymentRecoveryPath(error),
    "/comanda-guest/ord%202?token=tok%261&payment=failed"
  );
});

test("eroare fără comandă creată -> fără redirecționare (rămâne în checkout)", () => {
  assert.equal(getPaymentRecoveryPath({ data: { error: "insufficient_stock" } }), null);
  assert.equal(getPaymentRecoveryPath(new Error("network")), null);
  assert.equal(getPaymentRecoveryPath(null), null);
});

test("vendor fără Stripe înainte de comandă -> trecere pe ramburs, nu redirecționare", () => {
  const error = { status: 400, data: { error: "vendor_stripe_not_active" }, code: "vendor_stripe_not_active" };
  assert.equal(isCardUnavailableError(error), true);
  assert.equal(getPaymentRecoveryPath(error), null);

  // aceeași eroare DUPĂ crearea comenzii (are orderId) -> recuperare, nu COD
  const after = { data: { error: "vendor_stripe_not_active", orderId: "ord_3" } };
  assert.equal(isCardUnavailableError(after), false);
  assert.equal(getPaymentRecoveryPath(after), "/comanda/ord_3?payment=failed");
});

/* =========================================================
   Gardă pe Checkout.jsx (fără DOM): comportamentele reparate
========================================================= */

const checkoutSource = readFileSync(
  new URL("./Checkout.jsx", import.meta.url),
  "utf8"
);

test("Checkout.jsx: butonul de plasare NU e dezactivat pentru formular invalid", () => {
  assert.doesNotMatch(checkoutSource, /disabled=\{placing \|\| !isFormBasicallyValid\}/);
  assert.match(checkoutSource, /onClick=\{placeOrder\}\s*disabled=\{placing \|\| items\.length === 0\}/);
});

test("Checkout.jsx: telefonul nu mai e trunchiat la 10 cifre", () => {
  assert.doesNotMatch(checkoutSource, /maxLength=\{10\}/);
  assert.doesNotMatch(checkoutSource, /normalizeDigits\([^)]*phone[^)]*\)\.slice\(0, 10\)/);
});

test("Checkout.jsx: placeOrder rezolvă județul tastat și recuperează plata eșuată", () => {
  const placeOrder = checkoutSource.slice(
    checkoutSource.indexOf("async function placeOrder()"),
    checkoutSource.indexOf("if (loading) {", checkoutSource.indexOf("async function placeOrder()"))
  );
  assert.match(placeOrder, /resolveFormForSubmit\(\)/);
  assert.match(placeOrder, /getPaymentRecoveryPath\(e\)/);
  assert.match(placeOrder, /isCardUnavailableError\(e\)/);
  assert.match(checkoutSource, /setCounties\(RO_COUNTIES_FALLBACK\)/);
});
