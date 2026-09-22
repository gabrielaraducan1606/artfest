// Rulare: node --test src/services/influencerCollaborationGate.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collaborationGateErrorBody,
  resolveCollaborationGate,
} from "./influencerCollaborationGate.js";

const profile = (overrides = {}) => ({
  createdAt: new Date(), // "azi" - în interiorul celor 3 luni implicite
  status: "ACTIVE",
  commissionBps: 2000,
  collaborationEndOverride: null,
  ...overrides,
});

test("ACTIVE (în interiorul celor 3 luni implicite): permite activitate comercială nouă", () => {
  const { canStartNewCommercialActivity, collaboration } = resolveCollaborationGate(
    profile()
  );

  assert.equal(canStartNewCommercialActivity, true);
  assert.equal(collaboration.collaborationStatus, "ACTIVE");
});

test("EXPIRED: refuză activitate comercială nouă", () => {
  const { canStartNewCommercialActivity, collaboration } = resolveCollaborationGate(
    profile({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
  );

  assert.equal(canStartNewCommercialActivity, false);
  assert.equal(collaboration.collaborationStatus, "EXPIRED");
});

test("prelungit (collaborationEndOverride în viitor): redevine ACTIVE", () => {
  const { canStartNewCommercialActivity, collaboration } = resolveCollaborationGate(
    profile({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      collaborationEndOverride: new Date("2099-01-01T00:00:00.000Z"),
    })
  );

  assert.equal(canStartNewCommercialActivity, true);
  assert.equal(collaboration.collaborationStatus, "ACTIVE");
});

test("DISABLED: refuză activitate comercială nouă, chiar dacă perioada nu a expirat", () => {
  const { canStartNewCommercialActivity, collaboration } = resolveCollaborationGate(
    profile({ status: "DISABLED" })
  );

  assert.equal(canStartNewCommercialActivity, false);
  assert.equal(collaboration.collaborationStatus, "DISABLED");
});

test("DISABLED + prelungit: rămâne blocat (prelungirea datei NU reactivează un cont dezactivat)", () => {
  const { canStartNewCommercialActivity, collaboration } = resolveCollaborationGate(
    profile({
      status: "DISABLED",
      collaborationEndOverride: new Date("2099-01-01T00:00:00.000Z"),
    })
  );

  assert.equal(canStartNewCommercialActivity, false);
  assert.equal(collaboration.collaborationStatus, "DISABLED");
});

test("corpul de eroare distinge DISABLED de colaborare expirată", () => {
  const disabled = resolveCollaborationGate(profile({ status: "DISABLED" }));
  const expired = resolveCollaborationGate(
    profile({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
  );

  assert.equal(
    collaborationGateErrorBody(disabled.collaboration).error,
    "influencer_disabled"
  );

  assert.equal(
    collaborationGateErrorBody(expired.collaboration).error,
    "collaboration_not_active"
  );

  // corpul include starea recalculată, ca frontend-ul să nu mai facă un al doilea request
  assert.ok(collaborationGateErrorBody(expired.collaboration).collaboration);
});
