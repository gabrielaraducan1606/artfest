// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/adminFairLabels.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { labelPdfQuery, receiveActionFor } from "./adminFairLabels.js";
import { pendingSteps } from "./posReceiveSheet.js";

test("Etichete: „Recepționează” doar pentru liniile trimise, eligibile; recepționatele arată starea, fără a doua recepție", () => {
  const base = { status: "SUBMITTED", declaredQty: 5, receivedQty: 0, registrationStatus: "APPROVED", actions: { canReceive: true } };
  assert.deepEqual(receiveActionFor(base), { kind: "receive", text: "" });
  assert.deepEqual(receiveActionFor({ ...base, status: "RECEIVED", receivedQty: 3 }), { kind: "received", text: "Recepționat: 3 / 5 buc." });
  assert.equal(receiveActionFor({ ...base, status: "REJECTED" }).kind, "received");
  assert.equal(receiveActionFor({ ...base, registrationStatus: "CANCELLED" }).kind, "none");
  assert.equal(receiveActionFor({ ...base, saleBlocked: { reason: "x" } }).kind, "none");
  assert.equal(receiveActionFor({ ...base, actions: { canReceive: false } }).kind, "none");
});

test("fișa din Etichete: fără pasul coș (doar preț + recepție); POS păstrează coșul", () => {
  assert.deepEqual(pendingSteps([], { priceChanged: true, withCart: false }), ["price", "receive"]);
  assert.deepEqual(pendingSteps(["price"], { priceChanged: true, withCart: false }), ["receive"]);
  assert.deepEqual(pendingSteps([], { priceChanged: false }), ["receive", "cart"]);
});

test("PDF: parametrii etichetei individuale (format + fotografie)", () => {
  assert.equal(labelPdfQuery({}), "");
  assert.equal(labelPdfQuery({ photo: true }), "?photo=1");
  assert.equal(labelPdfQuery({ layout: "promo", photo: true }), "?layout=promo&photo=1");
});
