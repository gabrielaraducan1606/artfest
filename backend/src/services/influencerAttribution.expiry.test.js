// Regula: dacă collaborationStatus !== ACTIVE, influencerul NU mai poate fi
// candidat pentru o atribuire NOUĂ (link ?ref= sau cod de reducere).
// Nu modifică prioritatea codului, last-click, multi-vendor, câmpurile de
// pe Shipment sau formula de comision - acelea rămân neatinse (vezi
// chekoutRoutes.js, commissionCalc.js, nemodificate în acest task).
//
// Rulare: node --test src/services/influencerAttribution.expiry.test.js

process.env.JWT_SECRET = "test-secret";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveInfluencerAttribution,
  resolveInfluencerAttributionByInfluencerId,
} from "./influencerAttribution.js";

import { signInfluencerAttributionToken } from "./influencerAttributionToken.js";

function influencerRow(overrides = {}) {
  return {
    id: "inf-1",
    referralCode: "INF1",
    commissionBps: 2000,
    status: "ACTIVE",
    createdAt: new Date(), // azi - în interiorul celor 3 luni implicite
    collaborationEndOverride: null,
    ...overrides,
  };
}

function fakeDb(row) {
  return {
    influencerProfile: {
      async findFirst() {
        return row;
      },
      async findUnique() {
        return row;
      },
    },
  };
}

const token = signInfluencerAttributionToken({
  influencerId: "inf-1",
  referralCode: "INF1",
});

test("A. link ?ref= (ACTIVE): atribuirea funcționează", async () => {
  const result = await resolveInfluencerAttribution({
    token,
    db: fakeDb(influencerRow()),
  });

  assert.ok(result);
  assert.equal(result.influencerId, "inf-1");
  assert.equal(result.commissionBpsSnapshot, 2000);
});

test("B. link ?ref= (EXPIRED): zero atribuire nouă", async () => {
  const result = await resolveInfluencerAttribution({
    token,
    db: fakeDb(
      influencerRow({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
    ),
  });

  assert.equal(result, null);
});

test("C. cod de reducere (ACTIVE): atribuirea funcționează", async () => {
  const result = await resolveInfluencerAttributionByInfluencerId({
    influencerId: "inf-1",
    db: fakeDb(influencerRow()),
  });

  assert.ok(result);
  assert.equal(result.influencerId, "inf-1");
});

test("D. cod de reducere (EXPIRED): zero atribuire nouă", async () => {
  const result = await resolveInfluencerAttributionByInfluencerId({
    influencerId: "inf-1",
    db: fakeDb(
      influencerRow({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
    ),
  });

  assert.equal(result, null);
});

test("K. prelungit -> ACTIVE: atribuirea (link și cod) funcționează din nou", async () => {
  const extended = influencerRow({
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2099-01-01T00:00:00.000Z"),
  });

  const viaLink = await resolveInfluencerAttribution({ token, db: fakeDb(extended) });
  const viaCode = await resolveInfluencerAttributionByInfluencerId({
    influencerId: "inf-1",
    db: fakeDb(extended),
  });

  assert.ok(viaLink);
  assert.ok(viaCode);
});

test("L. DISABLED: refuzat, chiar dacă perioada nu a expirat sau a fost prelungită", async () => {
  const disabled = influencerRow({
    status: "DISABLED",
    collaborationEndOverride: new Date("2099-01-01T00:00:00.000Z"),
  });

  const viaLink = await resolveInfluencerAttribution({ token, db: fakeDb(disabled) });
  const viaCode = await resolveInfluencerAttributionByInfluencerId({
    influencerId: "inf-1",
    db: fakeDb(disabled),
  });

  assert.equal(viaLink, null);
  assert.equal(viaCode, null);
});

test("comportamentul existent (neschimbat): fără commissionBps acceptat -> fără atribuire", async () => {
  const result = await resolveInfluencerAttributionByInfluencerId({
    influencerId: "inf-1",
    db: fakeDb(influencerRow({ commissionBps: 0 })),
  });

  assert.equal(result, null);
});

test("comportamentul existent (neschimbat): token invalid/expirat -> fail-open, fără eroare", async () => {
  const result = await resolveInfluencerAttribution({
    token: "not-a-real-token",
    db: fakeDb(influencerRow()),
  });

  assert.equal(result, null);
});
