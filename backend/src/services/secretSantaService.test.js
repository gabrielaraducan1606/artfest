// Rulare: node --test src/services/secretSantaService.test.js
//
// Secret Santa: siguranța extragerii, confidențialitatea datelor de livrare,
// verificarea participanților și retrimiterea emailurilor. Fără DB reală,
// fără emailuri reale (db și sendEmail sunt simulate).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAssignments,
  drawEdition,
  getVendorState,
  registerVendor,
  sendAssignmentEmails,
  validateRegistration,
} from "./secretSantaService.js";

function checkDerangement(ids, pairs) {
  assert.equal(pairs.length, ids.length);
  assert.deepEqual(new Set(pairs.map((p) => p.giverId)), new Set(ids));
  assert.deepEqual(new Set(pairs.map((p) => p.receiverId)), new Set(ids));
  for (const pair of pairs) assert.notEqual(pair.giverId, pair.receiverId);
}

test("extragerea: fiecare dă și primește exact un cadou, nimeni nu se extrage pe sine", () => {
  for (let n = 2; n <= 60; n += 1) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    for (let run = 0; run < 25; run += 1) checkDerangement(ids, buildAssignments(ids));
  }
});

test("extragerea: de la 3 participanți nu există perechi reciproce", () => {
  const ids = ["a", "b", "c", "d", "e"];
  for (let run = 0; run < 200; run += 1) {
    const pairs = buildAssignments(ids);
    const giverOf = Object.fromEntries(pairs.map((p) => [p.receiverId, p.giverId]));
    for (const pair of pairs) assert.notEqual(giverOf[pair.giverId], pair.receiverId);
  }
});

test("extragerea: minim doi participanți, fără duplicate", () => {
  assert.throws(() => buildAssignments([]), { code: "not_enough_participants" });
  assert.throws(() => buildAssignments(["a"]), { code: "not_enough_participants" });
  assert.throws(() => buildAssignments(["a", "a", "b"]), { code: "duplicate_participants" });
});

function fakeDrawDb({ status = "CLOSED", participants = ["p1", "p2", "p3"] } = {}) {
  const state = { edition: { id: "e1", key: "SECRET_SANTA_2026", status }, created: [] };
  const tx = {
    secretSantaEdition: {
      updateMany: async ({ where, data }) => {
        if (state.edition.status !== where.status) return { count: 0 };
        Object.assign(state.edition, data);
        return { count: 1 };
      },
    },
    secretSantaParticipant: { findMany: async () => participants.map((id) => ({ id })) },
    secretSantaAssignment: {
      createMany: async ({ data }) => {
        state.created.push(...data);
        return { count: data.length };
      },
    },
  };
  return {
    state,
    db: {
      secretSantaEdition: { findUnique: async () => ({ ...state.edition }) },
      $transaction: (fn) => fn(tx),
    },
  };
}

test("extragerea cere confirmarea cu cheia ediției și înscrieri închise", async () => {
  const { db } = fakeDrawDb();
  await assert.rejects(drawEdition({ db, editionId: "e1", confirm: "da" }), { code: "confirmation_required" });
  const open = fakeDrawDb({ status: "OPEN" });
  await assert.rejects(drawEdition({ db: open.db, editionId: "e1", confirm: "SECRET_SANTA_2026" }), {
    code: "registration_not_closed",
  });
});

test("extragerea se salvează o singură dată; a doua încercare e refuzată", async () => {
  const { db, state } = fakeDrawDb();
  const result = await drawEdition({ db, editionId: "e1", adminUserId: "admin1", confirm: "SECRET_SANTA_2026" });
  assert.equal(result.assignments, 3);
  assert.equal(state.edition.status, "DRAWN");
  checkDerangement(["p1", "p2", "p3"], state.created);
  await assert.rejects(drawEdition({ db, editionId: "e1", confirm: "SECRET_SANTA_2026" }), { code: "already_drawn" });
  assert.equal(state.created.length, 3);
});

test("extragere simultană: doar prima trece de tranziția CLOSED -> DRAWN", async () => {
  const { db, state } = fakeDrawDb();
  const results = await Promise.allSettled([
    drawEdition({ db, editionId: "e1", confirm: "SECRET_SANTA_2026" }),
    drawEdition({ db, editionId: "e1", confirm: "SECRET_SANTA_2026" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(state.created.length, 3);
});

test("un singur participant: extragerea eșuează, nu se creează atribuiri", async () => {
  const { db, state } = fakeDrawDb({ participants: ["p1"] });
  await assert.rejects(drawEdition({ db, editionId: "e1", confirm: "SECRET_SANTA_2026" }), {
    code: "not_enough_participants",
  });
  assert.equal(state.created.length, 0);
});

const RECEIVER = {
  storeName: "Atelier B",
  recipientName: "Ana B",
  phone: "0711111111",
  county: "Buzău",
  city: "Buzău",
  address: "Str. X 1",
  postalCode: "120001",
  preferences: "ceramică",
};

function fakeVendorDb({ role = "VENDOR", userStatus = "ACTIVE", services = [{ id: "s1", title: "Atelier A" }], edition } = {}) {
  const calls = { created: null, assignmentSelects: [] };
  return {
    calls,
    db: {
      user: { findUnique: async () => ({ id: "u1", role, status: userStatus, email: "a@test.ro" }) },
      vendor: {
        findUnique: async () => ({ id: "v1", displayName: "A", isActive: true, anonymizedAt: null, phone: null, services }),
      },
      secretSantaEdition: {
        findFirst: async () => edition ?? { id: "e1", key: "K", status: "OPEN", registrationClosesAt: null, shipByAt: null },
      },
      secretSantaParticipant: {
        count: async () => 2,
        findUnique: async () => (edition?.status === "DRAWN" ? { id: "pA", storeName: "Atelier A", ...RECEIVER, email: "a@test.ro" } : null),
        create: async ({ data }) => {
          calls.created = data;
          return data;
        },
      },
      secretSantaAssignment: {
        findUnique: async ({ where, select }) => {
          calls.assignmentSelects.push(select);
          if (where.giverId) return { awb: null, courierName: null, shippedAt: null, receiver: RECEIVER };
          return { awb: "AWB123", courierName: "Curier", shippedAt: new Date() };
        },
      },
    },
  };
}

const VALID = {
  recipientName: "Ana Pop",
  email: "ana@test.ro",
  phone: "0722 123 456",
  county: "Buzău",
  city: "Buzău",
  address: "Str. Unirii 10, bl. A",
  postalCode: "120001",
  dataNotice: true,
};

test("înscrierea: doar vânzători activi cu magazin", async () => {
  await assert.rejects(registerVendor({ db: fakeVendorDb({ role: "USER" }).db, userId: "u1", body: VALID }), {
    code: "vendor_only",
  });
  await assert.rejects(registerVendor({ db: fakeVendorDb({ services: [] }).db, userId: "u1", body: VALID }), {
    code: "not_eligible",
  });
  await assert.rejects(registerVendor({ db: fakeVendorDb({ userStatus: "SUSPENDED" }).db, userId: "u1", body: VALID }), {
    code: "not_eligible",
  });
});

test("înscrierea: închisă, câmpuri invalide, magazin străin", async () => {
  const closed = fakeVendorDb({ edition: { id: "e1", key: "K", status: "CLOSED" } });
  await assert.rejects(registerVendor({ db: closed.db, userId: "u1", body: VALID }), { code: "registration_closed" });

  const { db, calls } = fakeVendorDb();
  await assert.rejects(registerVendor({ db, userId: "u1", body: { ...VALID, dataNotice: false } }), (error) => {
    assert.ok(error.fields.dataNotice);
    return true;
  });
  await assert.rejects(registerVendor({ db, userId: "u1", body: { ...VALID, storeId: "magazinul-altcuiva" } }), {
    code: "invalid_fields",
  });

  await registerVendor({ db, userId: "u1", body: { ...VALID, vendorId: "alt-vendor" } });
  assert.equal(calls.created.vendorId, "v1"); // vendorId doar din sesiune
  assert.equal(calls.created.storeName, "Atelier A");
});

test("validarea: telefon, cod poștal, adresă", () => {
  assert.throws(() => validateRegistration({ ...VALID, phone: "123", postalCode: "12" }), (error) => {
    assert.ok(error.fields.phone && error.fields.postalCode);
    return true;
  });
  assert.equal(validateRegistration(VALID).phone, "0722 123 456");
});

test("confidențialitate: expeditorul vede doar destinatarul lui, destinatarul nu vede expeditorul", async () => {
  const { db, calls } = fakeVendorDb({ edition: { id: "e1", key: "K", status: "DRAWN" } });
  const state = await getVendorState({ db, userId: "u1" });
  assert.equal(state.giving.recipient.recipientName, "Ana B");
  assert.deepEqual(Object.keys(state.incoming).sort(), ["awb", "courierName", "shipped", "shippedAt"]);
  // interogarea pentru coletul primit nu cere deloc expeditorul
  const incomingSelect = calls.assignmentSelects.find((select) => !select.receiver);
  assert.equal(incomingSelect.giver, undefined);
  assert.equal(incomingSelect.giverId, undefined);
});

test("înainte de extragere nu se expun date de livrare ale altora", async () => {
  const { db } = fakeVendorDb();
  const state = await getVendorState({ db, userId: "u1" });
  assert.equal(state.giving, null);
  assert.equal(state.incoming, null);
});

test("emailuri: eșecurile rămân de retrimis, fără să refacă extragerea", async () => {
  const assignments = [
    { id: "a1", emailSentAt: null, giver: { email: "x@test.ro", recipientName: "X", userId: "u1" }, receiver: RECEIVER },
    { id: "a2", emailSentAt: null, giver: { email: "y@test.ro", recipientName: "Y", userId: "u2" }, receiver: RECEIVER },
  ];
  const db = {
    secretSantaEdition: { findUnique: async () => ({ id: "e1", status: "DRAWN", title: "Secret Santa", shipByAt: null }) },
    secretSantaAssignment: {
      findMany: async () => assignments.filter((a) => !a.emailSentAt),
      update: async ({ where, data }) => Object.assign(assignments.find((a) => a.id === where.id), data),
    },
  };
  let failY = true;
  const sent = [];
  const sendEmail = async (payload) => {
    if (payload.to === "y@test.ro" && failY) throw Object.assign(new Error("down"), { code: "provider_down" });
    sent.push(payload);
  };

  const first = await sendAssignmentEmails({ db, editionId: "e1", sendEmail, appUrl: "https://artfest.test" });
  assert.deepEqual([first.sent, first.failed], [1, 1]);
  assert.equal(assignments[1].emailError, "provider_down");
  assert.equal(sent[0].link, "https://artfest.test/secret-santa");
  assert.equal(sent[0].idempotencyKey, "secret-santa-assignment:a1");

  failY = false;
  const retry = await sendAssignmentEmails({ db, editionId: "e1", sendEmail });
  assert.deepEqual([retry.sent, retry.failed], [1, 0]);
  assert.equal(sent.length, 2); // x nu primește a doua oară
  assert.equal(assignments[1].emailError, null);
});

/* ---------- ediție de test + deschidere programată ---------- */

import { isRegistrationOpen, resolveEdition } from "./secretSantaService.js";

test("ediția de test nu apare public; o cheie oficială nu poate fi cerută ca test", async () => {
  let where = null;
  const db = {
    secretSantaEdition: {
      findFirst: async (args) => {
        where = args.where;
        return null;
      },
      findUnique: async ({ where: w }) => ({ id: "t1", key: w.key, status: "OPEN" }),
    },
  };
  await resolveEdition(db, null);
  assert.deepEqual(where.NOT, { key: { startsWith: "TEST", mode: "insensitive" } });
  assert.equal((await resolveEdition(db, "TEST_SECRET_SANTA_1")).id, "t1");
  assert.equal(await resolveEdition(db, "SECRET_SANTA_2026"), null);
});

test("ediția oficială 2026: înscrierile nu se deschid înainte de 17 noiembrie", () => {
  const edition = { key: "SECRET_SANTA_2026", status: "OPEN", registrationClosesAt: null };
  assert.equal(isRegistrationOpen(edition, new Date("2026-11-16T21:59:00Z")), false);
  assert.equal(isRegistrationOpen(edition, new Date("2026-11-16T22:00:00Z")), true); // 17 nov 00:00 ora României
  assert.equal(isRegistrationOpen({ ...edition, status: "DRAFT" }, new Date("2026-11-20T10:00:00Z")), false);
});

test("ediția de test: emailurile sunt doar simulate", async () => {
  const updates = [];
  const db = {
    secretSantaEdition: { findUnique: async () => ({ id: "t1", key: "TEST_SECRET_SANTA_1", status: "DRAWN" }) },
    secretSantaAssignment: {
      findMany: async () => [{ id: "a1", giver: { email: "x@test.ro" }, receiver: {} }],
      update: async (args) => updates.push(args),
    },
  };
  let realSends = 0;
  const result = await sendAssignmentEmails({ db, editionId: "t1", sendEmail: async () => (realSends += 1) });
  assert.equal(realSends, 0);
  assert.equal(result.simulated, 1);
  assert.equal(updates[0].data.emailError, "simulated_test");
});

test("formular de probă ADMIN: salvează doar în ediția TEST, cu participant intern; închis după 17 noiembrie", async () => {
  const { registerAdminTestForm } = await import("./secretSantaService.js");
  const calls = { vendorCreate: null, participant: null, userUpdates: 0 };
  const db = {
    secretSantaEdition: { upsert: async ({ where }) => ({ id: "test-ed", key: where.key, status: "OPEN" }) },
    vendor: {
      findFirst: async () => null,
      create: async ({ data }) => {
        calls.vendorCreate = data;
        return { id: "test-vendor" };
      },
    },
    user: { update: async () => (calls.userUpdates += 1) },
    secretSantaParticipant: {
      findUnique: async () => null,
      create: async ({ data }) => (calls.participant = data),
    },
  };
  const before = new Date("2026-11-15T10:00:00Z");
  await registerAdminTestForm({ db, adminUserId: "admin1", body: { ...VALID, storeId: "test-store-2" }, now: before });
  assert.equal(calls.participant.editionId, "test-ed");
  assert.equal(calls.participant.vendorId, "test-vendor");
  assert.equal(calls.participant.storeName, "Magazin de test Artfest 2");
  assert.equal(calls.vendorCreate.isActive, false); // vendor intern inactiv, fără cont
  assert.equal(calls.vendorCreate.userId, undefined);
  assert.equal(calls.userUpdates, 0); // niciun rol schimbat
  await assert.rejects(
    registerAdminTestForm({ db, adminUserId: "admin1", body: VALID, now: new Date("2026-11-16T22:00:00Z") }),
    { code: "test_form_closed" }
  );
});
