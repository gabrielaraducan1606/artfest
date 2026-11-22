// src/pages/Vendor/Fair/fairInventoryErrors.test.js
// Rulare: node --test src/pages/Vendor/Fair/fairInventoryErrors.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryErrorMessage, isTechnicalMessage } from "./fairInventoryErrors.js";

const apiError = (status, data) => Object.assign(new Error(data?.message || data?.error || `Request failed (${status})`), { status, data });

test("mesajul serverului (în română) se păstrează, inclusiv la 500 trimis de backend", () => {
  assert.equal(inventoryErrorMessage(apiError(409, { error: "duplicate_variant", message: "Această variantă este deja în inventar." }), "x", { action: "save" }), "Această variantă este deja în inventar.");
  assert.equal(inventoryErrorMessage(apiError(500, { error: "server_error", message: "A apărut o eroare. Încearcă din nou." }), "x", { action: "save" }), "A apărut o eroare. Încearcă din nou.");
});

test("500 / 502 / 503 / 504 fără mesaj: rezultat necunoscut, reîncercare sigură, fără cod tehnic", () => {
  for (const status of [500, 502, 503, 504]) {
    const out = inventoryErrorMessage(apiError(status, status === 500 ? { error: "server_error" } : "<html>Bad gateway</html>"), "Nu am putut salva produsul.", { action: "save" });
    assert.match(out, /Nu am primit confirmarea salvării/);
    assert.match(out, new RegExp(`cod ${status}`));
    assert.match(out, /poate fi deja salvat/);
    assert.match(out, /nu se adaugă a doua oară/);
    assert.doesNotMatch(out, /server_error|Request failed|nu s-a salvat/i);
  }
});

test("fără răspuns (rețea): același mesaj sigur, fără cod", () => {
  const out = inventoryErrorMessage(new TypeError("Failed to fetch"), "x", { action: "save" });
  assert.match(out, /Nu am primit confirmarea salvării\. /);
  assert.doesNotMatch(out, /Failed to fetch/);
});

test("încărcare și alte operații: mesaje proprii", () => {
  assert.match(inventoryErrorMessage(apiError(502, null), "x", { action: "load" }), /Nu am putut încărca inventarul \(cod 502\)/);
  assert.match(inventoryErrorMessage(apiError(504, null), "x"), /Reîncarcă pagina și verifică inventarul/);
});

test("4xx fără mesaj: textul formularului, nu codul tehnic", () => {
  assert.equal(inventoryErrorMessage(apiError(400, { error: "invalid_inventory_item" }), "Nu am putut salva produsul.", { action: "save" }), "Nu am putut salva produsul.");
  assert.equal(inventoryErrorMessage(new Error("Alege produsul."), "x"), "Alege produsul.");
});

test("detectarea textelor tehnice", () => {
  assert.equal(isTechnicalMessage("server_error"), true);
  assert.equal(isTechnicalMessage("Request failed (502)"), true);
  assert.equal(isTechnicalMessage("A apărut o eroare. Încearcă din nou."), false);
});
