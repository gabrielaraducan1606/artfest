// Rulare: node --test src/pages/SecretSanta/secretSanta.test.js
//
// Ce vede fiecare vizitator pe /secret-santa și precompletarea formularului.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SS_RULES, initialForm, pageMode, participantsLabel } from "./secretSanta.js";

const OPEN = { title: "Secret Santa", registrationOpen: true, drawn: false };
const DRAWN = { title: "Secret Santa", registrationOpen: false, drawn: true };
const VENDOR = { role: "VENDOR" };

test("vizitatori: fără ediție, neautentificat, client", () => {
  assert.equal(pageMode({ edition: null, now: Date.parse("2026-12-01T00:00:00Z") }), "no_edition");
  assert.equal(pageMode({ edition: null, now: Date.parse("2026-11-14T12:00:00Z") }), "not_yet_open");
  assert.equal(pageMode({ edition: OPEN, me: null }), "login");
  assert.equal(pageMode({ edition: DRAWN, me: null }), "missed");
  assert.equal(pageMode({ edition: OPEN, me: { role: "USER" } }), "not_vendor");
});

test("vânzător: neeligibil, formular, înscris, închis", () => {
  assert.equal(pageMode({ edition: OPEN, me: VENDOR, vendorState: null }), "loading");
  assert.equal(pageMode({ edition: OPEN, me: VENDOR, vendorState: { edition: OPEN, eligible: false } }), "not_eligible");
  assert.equal(pageMode({ edition: OPEN, me: VENDOR, vendorState: { edition: OPEN, eligible: true } }), "form");
  assert.equal(
    pageMode({ edition: OPEN, me: VENDOR, vendorState: { edition: OPEN, eligible: true, registration: {} } }),
    "registered"
  );
  const closed = { ...OPEN, registrationOpen: false };
  assert.equal(pageMode({ edition: closed, me: VENDOR, vendorState: { edition: closed, eligible: true } }), "closed");
});

test("după extragere: participantul vede Secret Santa-ul lui, ceilalți nu", () => {
  assert.equal(pageMode({ edition: DRAWN, me: VENDOR, vendorState: { edition: DRAWN, eligible: true, registration: {} } }), "my_santa");
  assert.equal(pageMode({ edition: DRAWN, me: VENDOR, vendorState: { edition: DRAWN, eligible: true } }), "missed");
});

test("formularul se precompletează din cont sau din înscrierea existentă", () => {
  const fresh = initialForm({ stores: [{ id: "s1", name: "A" }], defaults: { email: "a@test.ro", phone: "07" } });
  assert.equal(fresh.storeId, "s1");
  assert.equal(fresh.email, "a@test.ro");
  assert.equal(fresh.dataNotice, false);

  const edit = initialForm({
    stores: [{ id: "s1", name: "A" }, { id: "s2", name: "B" }],
    registration: { storeName: "B", recipientName: "Ana", email: "x@test.ro", city: "Buzău" },
  });
  assert.equal(edit.storeId, "s2");
  assert.equal(edit.recipientName, "Ana");
  assert.equal(edit.dataNotice, false); // confirmarea se reface la fiecare salvare
});

test("cinci reguli și etichete corecte", () => {
  assert.equal(SS_RULES.length, 5);
  assert.equal(participantsLabel(1), "1 vânzător înscris");
  assert.equal(participantsLabel(5), "5 vânzători înscriși");
  assert.equal(participantsLabel(20), "20 de vânzători înscriși");
  assert.equal(participantsLabel(105), "105 vânzători înscriși");
});

test("ediție publicată cu înscrieri programate -> „Înscrierile încep pe …”", async () => {
  const { withEdition } = await import("./secretSanta.js");
  const scheduled = { status: "OPEN", registrationOpen: false, registrationOpensAt: "2026-11-16T22:00:00.000Z" };
  const before = Date.parse("2026-11-15T10:00:00Z");
  assert.equal(pageMode({ edition: scheduled, me: null, now: before }), "not_yet_open");
  assert.equal(pageMode({ edition: scheduled, me: VENDOR, vendorState: null, now: before }), "not_yet_open");
  assert.equal(withEdition("/api/x", "TEST_A"), "/api/x?edition=TEST_A");
  assert.equal(withEdition("/api/x", null), "/api/x");
});

test("butonul „Testează înscrierea”: doar ADMIN și doar înainte de 17 noiembrie 2026", async () => {
  const { adminTestAvailable } = await import("./secretSanta.js");
  const before = Date.parse("2026-11-16T21:59:00Z");
  const after = Date.parse("2026-11-16T22:00:00Z"); // 17 nov 00:00 ora României
  assert.equal(adminTestAvailable({ role: "ADMIN" }, before), true);
  assert.equal(adminTestAvailable({ role: "ADMIN" }, after), false);
  assert.equal(adminTestAvailable({ role: "VENDOR" }, before), false);
  assert.equal(adminTestAvailable(null, before), false);
});
