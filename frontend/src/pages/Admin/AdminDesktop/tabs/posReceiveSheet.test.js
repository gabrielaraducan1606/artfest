// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/posReceiveSheet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSimilarProducts, pendingSteps, sheetBlockReason, validateSheet } from "./posReceiveSheet.js";
import { cameraResultAction } from "./posCamera.js";

const line = { status: "SUBMITTED", declaredQty: 5, receivedQty: 0, registrationStatus: "APPROVED", eligibility: { eligible: true } };

test("fișa: cantitatea în limita declarată, confirmare explicită, preț final opțional", () => {
  assert.deepEqual(validateSheet({ qtyText: "3", priceText: "120", confirmed: true }, line), { ok: true, fields: {}, qty: 3, priceCents: 12000 });
  assert.match(validateSheet({ qtyText: "6", confirmed: true }, line).fields.qty, /Cel mult 5 buc.*Suplimentează stocul/);
  assert.ok(validateSheet({ qtyText: "0", confirmed: true }, line).fields.qty);
  assert.match(validateSheet({ qtyText: "3", confirmed: false }, line).fields.confirm, /Confirmă că ai primit fizic 3 buc/);
  assert.equal(validateSheet({ qtyText: "3", priceText: "", confirmed: true }, line).priceCents, null);
  assert.ok(validateSheet({ qtyText: "3", priceText: "abc", confirmed: true }, line).fields.price);
});

test("fișa: participanți neeligibili, produse blocate / neeligibile refuzate", () => {
  assert.equal(sheetBlockReason(line), null);
  assert.match(sheetBlockReason({ ...line, registrationStatus: "CANCELLED" }), /Participarea vânzătorului nu este activă/);
  assert.match(sheetBlockReason({ ...line, saleBlocked: { reason: "verificare" } }), /blocat de la vânzare: verificare/);
  assert.match(sheetBlockReason({ ...line, eligibility: { eligible: false, reasons: ["Produs ascuns."] } }), /nu este eligibil.*Produs ascuns/);
  assert.match(sheetBlockReason({ ...line, status: "CANCELLED" }), /nu poate fi recepționată/);
});

test("reluare: pașii reușiți nu se repetă; prețul doar dacă s-a schimbat", () => {
  assert.deepEqual(pendingSteps([], { priceChanged: true }), ["price", "receive", "cart"]);
  assert.deepEqual(pendingSteps([], { priceChanged: false }), ["receive", "cart"]);
  assert.deepEqual(pendingSteps(["price", "receive"], { priceChanged: true }), ["cart"]);
  assert.deepEqual(pendingSteps(["price", "receive", "cart"], { priceChanged: true }), []);
});

test("produse asemănătoare la participant (fără diacritice), fără anulate", () => {
  const lines = [
    { id: "1", title: "Înger din lut", status: "SUBMITTED" },
    { id: "2", title: "Glob pictat roșu", status: "RECEIVED" },
    { id: "3", title: "Îngeraș pictat", status: "CANCELLED" },
    { id: "4", title: "Cană", status: "RECEIVED" },
  ];
  assert.deepEqual(findSimilarProducts(lines, "inger alb").map((l) => l.id), ["1"]);
  assert.deepEqual(findSimilarProducts(lines, "Glob pictat").map((l) => l.id), ["2"]);
  assert.deepEqual(findSimilarProducts(lines, "de"), []);
});

test("camera: predarea către fișă / „Cod negăsit” închide fereastra", () => {
  assert.equal(cameraResultAction({ ok: false, handoff: true, message: "Produs în inventar, nerecepționat" }), "added");
  assert.equal(cameraResultAction({ ok: false, message: "Lipsă stoc" }), "retry");
});
