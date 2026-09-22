// Rulare: node --test src/services/influencerCollaboration.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COLLABORATION_EXPIRING_SOON_NOTICE,
  COLLABORATION_REVIEW_NOTICE,
  addMonthsUtc,
  bpsToPercent,
  computeCollaborationState,
  validateCollaborationExtension,
} from "./influencerCollaboration.js";

test("A. influencer activ, ziua 1: perioada corectă, status ACTIVE", () => {
  const activatedAt = new Date("2026-09-18T09:00:00.000Z");

  const state = computeCollaborationState({
    activatedAt,
    status: "ACTIVE",
    commissionBps: 2000,
    now: activatedAt,
  });

  assert.equal(state.collaborationStatus, "ACTIVE");
  assert.equal(state.collaborationStart.toISOString(), activatedAt.toISOString());
  assert.equal(state.collaborationEnd.toISOString(), "2026-12-18T09:00:00.000Z");
  assert.equal(state.periodMonths, 3);
});

test("B. 3 luni calculate corect, inclusiv la capătul lunii", () => {
  assert.equal(
    addMonthsUtc(new Date("2026-01-31T00:00:00.000Z"), 3).toISOString(),
    "2026-04-30T00:00:00.000Z"
  );

  assert.equal(
    addMonthsUtc(new Date("2026-09-18T00:00:00.000Z"), 3).toISOString(),
    "2026-12-18T00:00:00.000Z"
  );

  assert.equal(
    addMonthsUtc(new Date("2026-11-30T00:00:00.000Z"), 3).toISOString(),
    "2027-02-28T00:00:00.000Z"
  );
});

test("C. influencer expirat: status EXPIRED, daysUntilEnd negativ", () => {
  const activatedAt = new Date("2026-01-01T00:00:00.000Z");

  const state = computeCollaborationState({
    activatedAt,
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  assert.equal(state.collaborationStatus, "EXPIRED");
  assert.ok(state.daysUntilEnd < 0);
  assert.equal(state.expiringSoon, false);
});

test("D. procentul de remunerație se citește din commissionBps, cu formula existentă (bps/100)", () => {
  assert.equal(bpsToPercent(2000), 20);
  assert.equal(bpsToPercent(2500), 25);
  assert.equal(bpsToPercent(0), 0);
  assert.equal(bpsToPercent(null), 0);
  assert.equal(bpsToPercent(undefined), 0);

  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(state.commissionPercent, 20);
});

test("E. sub 14 zile până la expirare: expiringSoon + mesaj discret; peste 14 zile: fără mesaj", () => {
  const end = new Date("2026-12-18T00:00:00.000Z");

  const soon = computeCollaborationState({
    activatedAt: new Date("2026-09-18T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date(end.getTime() - 10 * 24 * 60 * 60 * 1000),
  });

  assert.equal(soon.expiringSoon, true);
  assert.equal(soon.expiringSoonNotice, COLLABORATION_EXPIRING_SOON_NOTICE);
  assert.ok(soon.daysUntilEnd <= 14 && soon.daysUntilEnd >= 0);

  const notSoon = computeCollaborationState({
    activatedAt: new Date("2026-09-18T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date(end.getTime() - 20 * 24 * 60 * 60 * 1000),
  });

  assert.equal(notSoon.expiringSoon, false);
  assert.equal(notSoon.expiringSoonNotice, null);

  // exact la 14 zile: încă discret (inclusiv), la 15 nu
  const exactly14 = computeCollaborationState({
    activatedAt: new Date("2026-09-18T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000),
  });
  assert.equal(exactly14.expiringSoon, true);
});

test("F. refresh (aceleași input-uri) => rezultat identic", () => {
  const input = {
    activatedAt: new Date("2026-09-18T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-10-01T00:00:00.000Z"),
  };

  const first = computeCollaborationState(input);
  const second = computeCollaborationState(input);

  assert.deepEqual(first, second);
});

test("status DISABLED este păstrat, NU suprascris cu ACTIVE/EXPIRED", () => {
  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "DISABLED",
    commissionBps: 2000,
    now: new Date("2026-01-15T00:00:00.000Z"), // în interiorul perioadei de 3 luni
  });

  assert.equal(state.collaborationStatus, "DISABLED");
  assert.equal(state.expiringSoon, false);
});

test("textul informativ este returnat de backend (sursă unică), nu inventat în frontend", () => {
  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(state.notice, COLLABORATION_REVIEW_NOTICE);
});

test("fără activatedAt: eșuează explicit, nu inventează o dată", () => {
  assert.throws(() =>
    computeCollaborationState({ activatedAt: null, status: "ACTIVE", commissionBps: 2000 })
  );
});

test("collaborationEndOverride are prioritate față de perioada implicită (InfluencerProfile.collaborationEndOverride)", () => {
  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-01-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2027-01-01T00:00:00.000Z"),
  });

  assert.equal(state.collaborationEnd.toISOString(), "2027-01-01T00:00:00.000Z");
});

/* ------------------- prelungirea colaborării (Admin) ------------------- */

test("B/C/D. prelungire +1/+3/+6 luni: se calculează de la collaborationEnd CURENT, nu de la createdAt", () => {
  const activatedAt = new Date("2026-01-01T00:00:00.000Z"); // implicit end: 2026-04-01
  const currentEnd = new Date("2026-04-01T00:00:00.000Z");

  for (const [months, expected] of [
    [1, "2026-05-01T00:00:00.000Z"],
    [3, "2026-07-01T00:00:00.000Z"],
    [6, "2026-10-01T00:00:00.000Z"],
  ]) {
    const proposed = addMonthsUtc(currentEnd, months);

    const state = computeCollaborationState({
      activatedAt,
      status: "ACTIVE",
      commissionBps: 2000,
      now: new Date("2026-02-01T00:00:00.000Z"),
      collaborationEndOverride: proposed,
    });

    assert.equal(state.collaborationEnd.toISOString(), expected, `+${months} luni`);
    // regula 5: NU createdAt + N luni (asta ar fi total diferit)
    assert.notEqual(state.collaborationEnd.toISOString(), addMonthsUtc(activatedAt, months).toISOString());
  }
});

test("prelungirea unui override existent pornește de la override-ul curent (nu de la implicit, nici de la createdAt)", () => {
  const activatedAt = new Date("2026-01-01T00:00:00.000Z"); // implicit ar fi 2026-04-01
  const firstOverride = new Date("2026-06-01T00:00:00.000Z"); // deja prelungit o dată

  const secondOverride = addMonthsUtc(firstOverride, 3);

  const state = computeCollaborationState({
    activatedAt,
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-02-01T00:00:00.000Z"),
    collaborationEndOverride: secondOverride,
  });

  assert.equal(state.collaborationEnd.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("E. dată custom: orice dată validă, ulterioară perioadei curente, e acceptată ca override", () => {
  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 2000,
    now: new Date("2026-01-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2028-12-25T00:00:00.000Z"),
  });

  assert.equal(state.collaborationEnd.toISOString(), "2028-12-25T00:00:00.000Z");
});

test("F. influencer EXPIRAT, prelungit peste azi: revine ACTIVE dacă status-ul contului e ACTIVE", () => {
  const activatedAt = new Date("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-05-01T00:00:00.000Z"); // după implicitul de 3 luni (expirat)

  const before = computeCollaborationState({ activatedAt, status: "ACTIVE", commissionBps: 2000, now });
  assert.equal(before.collaborationStatus, "EXPIRED");

  const after = computeCollaborationState({
    activatedAt,
    status: "ACTIVE",
    commissionBps: 2000,
    now,
    collaborationEndOverride: new Date("2026-08-01T00:00:00.000Z"),
  });

  assert.equal(after.collaborationStatus, "ACTIVE");
});

test("G. influencer DISABLED, prelungit: rămâne DISABLED (nu e reactivat automat de dată)", () => {
  const state = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "DISABLED",
    commissionBps: 2000,
    now: new Date("2026-05-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2026-08-01T00:00:00.000Z"),
  });

  assert.equal(state.collaborationStatus, "DISABLED");
});

test("H. prelungirea nu modifică formula de remunerație (commissionPercent rămâne bpsToPercent(commissionBps))", () => {
  const withoutExtension = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 3300,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  const withExtension = computeCollaborationState({
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    commissionBps: 3300,
    now: new Date("2026-01-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2030-01-01T00:00:00.000Z"),
  });

  assert.equal(withoutExtension.commissionPercent, 33);
  assert.equal(withExtension.commissionPercent, 33);
});

/* -------------------- validateCollaborationExtension -------------------- */

test("validateCollaborationExtension: dată invalidă / lipsă", () => {
  assert.deepEqual(
    validateCollaborationExtension({
      collaborationEnd: "nu-e-o-data",
      collaborationStart: new Date("2026-01-01"),
      currentCollaborationEnd: new Date("2026-04-01"),
    }),
    { valid: false, code: "invalid_date" }
  );

  assert.equal(
    validateCollaborationExtension({
      collaborationEnd: "",
      collaborationStart: new Date("2026-01-01"),
      currentCollaborationEnd: new Date("2026-04-01"),
    }).valid,
    false
  );
});

test("validateCollaborationExtension: noua dată trebuie să fie după collaborationStart", () => {
  const result = validateCollaborationExtension({
    collaborationEnd: "2025-12-31T00:00:00.000Z",
    collaborationStart: new Date("2026-01-01T00:00:00.000Z"),
    currentCollaborationEnd: new Date("2026-04-01T00:00:00.000Z"),
  });

  assert.deepEqual(result, { valid: false, code: "collaboration_end_before_start" });
});

test("validateCollaborationExtension: noua dată trebuie să fie după collaborationEnd CURENT (nu doar după start)", () => {
  const result = validateCollaborationExtension({
    collaborationEnd: "2026-02-01T00:00:00.000Z", // e după start, dar înainte de end-ul curent
    collaborationStart: new Date("2026-01-01T00:00:00.000Z"),
    currentCollaborationEnd: new Date("2026-04-01T00:00:00.000Z"),
  });

  assert.deepEqual(result, { valid: false, code: "collaboration_end_not_after_current" });
});

test("validateCollaborationExtension: o dată validă, ulterioară, e acceptată", () => {
  const result = validateCollaborationExtension({
    collaborationEnd: "2026-07-01T00:00:00.000Z",
    collaborationStart: new Date("2026-01-01T00:00:00.000Z"),
    currentCollaborationEnd: new Date("2026-04-01T00:00:00.000Z"),
  });

  assert.equal(result.valid, true);
  assert.equal(result.date.toISOString(), "2026-07-01T00:00:00.000Z");
});
