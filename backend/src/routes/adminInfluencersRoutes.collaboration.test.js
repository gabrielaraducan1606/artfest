// Admin Influencers: perioada de colaborare (collaborationStatus,
// collaborationStart, collaborationEnd, expiringSoon, commissionPercent)
// trebuie să vină EXACT din services/influencerCollaboration.js
// (computeCollaborationState + bpsToPercent), fără niciun calcul propriu
// în rută sau în frontend.
//
// Fake DB minimal, scris pentru acest fișier (același stil ca
// depositAfterCancel.test.js), NU testkit/fakePrisma.js (relații diferite,
// nu merită generalizat pentru un singur endpoint de admin).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/adminInfluencersRoutes.collaboration.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const ADMIN_ID = "admin-1";

let profiles = [];
let invites = [];

const fakePrisma = {
  user: {
    async findUnique({ where }) {
      if (where.id === ADMIN_ID) {
        return { id: ADMIN_ID, role: "ADMIN", email: "admin@t.ro" };
      }
      if (where.id === "user-1") {
        return { id: "user-1", role: "USER", email: "ana@t.ro" };
      }
      return null;
    },
  },
  influencerProfile: {
    async findMany() {
      return profiles;
    },
    async findUnique({ where }) {
      return profiles.find((p) => p.id === where.id) || null;
    },
    async update({ where, data }) {
      const profile = profiles.find((p) => p.id === where.id);
      if (!profile) throw new Error("not found");
      Object.assign(profile, data);
      return profile;
    },
  },
  influencerInvite: {
    async findMany() {
      return invites;
    },
  },
};

function inviteFixture(overrides = {}) {
  return {
    id: "invite-1",
    name: "Maria Candidat",
    email: "maria@t.ro",
    referralCode: "MARIA1",
    commissionBps: 0,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

mock.module("../db.js", { namedExports: { prisma: fakePrisma } });

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, _res, next) {
      // implicit ADMIN_ID; testul de autorizare (L) trimite alt id prin header
      req.user = { sub: req.headers["x-test-user"] || ADMIN_ID };
      next();
    },
  },
});

mock.module("../lib/mailer.js", {
  namedExports: {
    async sendInfluencerInviteEmail() {},
  },
});

mock.module("../services/influencerEarnings.js", {
  namedExports: {
    async getInfluencerConfirmedTotals() {
      return { ordersCount: 0, salesAmount: 0, confirmedEarningsAmount: 0 };
    },
  },
});

mock.module("../services/r2Storage.js", {
  namedExports: {
    async getSignedDownloadUrl() {
      return null;
    },
  },
});

function profileFixture(overrides = {}) {
  return {
    id: "inf-1",
    userId: "user-1",
    displayName: "Ana Influencer",
    referralCode: "ANA1",
    commissionBps: 2000,
    status: "ACTIVE",
    instagramUrl: null,
    tiktokUrl: null,
    facebookUrl: null,
    websiteUrl: null,
    notes: null,
    createdAt: new Date("2026-09-18T09:00:00.000Z"),
    updatedAt: new Date("2026-09-18T09:00:00.000Z"),
    collaborationEndOverride: null,
    user: {
      id: "user-1",
      email: "ana@t.ro",
      name: "Ana",
      firstName: "Ana",
      lastName: "Pop",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: new Date("2026-09-18T09:00:00.000Z"),
      UserConsent: [],
    },
    commissionAgreements: [],
    _count: { clicks: 0 },
    ...overrides,
  };
}

let server;
let base;

before(async () => {
  const router = (await import("./adminInfluencersRoutes.js")).default;

  const app = express();
  app.use(express.json());
  app.use("/api/admin/influencers", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  profiles = [];
  invites = [];
});

async function list() {
  const res = await fetch(`${base}/api/admin/influencers`);
  return { status: res.status, body: await res.json() };
}

async function extend(id, collaborationEnd, { asUser } = {}) {
  const headers = { "content-type": "application/json" };
  if (asUser) headers["x-test-user"] = asUser;

  const res = await fetch(`${base}/api/admin/influencers/${id}/collaboration`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ collaborationEnd }),
  });
  return { status: res.status, body: await res.json() };
}

test("A. influencer activ: collaborationStatus ACTIVE, perioadă din helperul comun", async () => {
  profiles = [profileFixture()];

  const { status, body } = await list();

  assert.equal(status, 200);
  const [item] = body.items;

  assert.ok(item.collaboration);
  assert.equal(item.collaboration.collaborationStatus, "ACTIVE");
  assert.equal(
    new Date(item.collaboration.collaborationStart).toISOString(),
    "2026-09-18T09:00:00.000Z"
  );
  assert.equal(
    new Date(item.collaboration.collaborationEnd).toISOString(),
    "2026-12-18T09:00:00.000Z"
  );
  assert.equal(item.collaboration.periodMonths, 3);
});

test("B. influencer expirat: collaborationStatus EXPIRED", async () => {
  profiles = [
    profileFixture({
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), // acum ~200 zile
    }),
  ];

  const { body } = await list();
  const [item] = body.items;

  assert.equal(item.collaboration.collaborationStatus, "EXPIRED");
  assert.ok(item.collaboration.daysUntilEnd < 0);
});

test("C. influencer DISABLED: statusul real e păstrat, NU suprascris cu ACTIVE doar fiindcă perioada nu a expirat", async () => {
  profiles = [
    profileFixture({
      status: "DISABLED",
      createdAt: new Date(), // în plină perioadă de 3 luni
    }),
  ];

  const { body } = await list();
  const [item] = body.items;

  assert.equal(item.status, "DISABLED");
  assert.equal(item.collaboration.collaborationStatus, "DISABLED");
});

test("D. expiringSoon: badge doar sub 14 zile până la expirare, pentru conturi active", async () => {
  const end14 = 10; // zile rămase
  profiles = [
    profileFixture({
      id: "inf-soon",
      createdAt: new Date(
        Date.now() - (91 - end14) * 24 * 60 * 60 * 1000
      ),
    }),
    profileFixture({
      id: "inf-not-soon",
      createdAt: new Date(),
    }),
  ];

  const { body } = await list();
  const soon = body.items.find((i) => i.id === "inf-soon");
  const notSoon = body.items.find((i) => i.id === "inf-not-soon");

  assert.equal(soon.collaboration.expiringSoon, true);
  assert.ok(soon.collaboration.expiringSoonNotice);
  assert.equal(notSoon.collaboration.expiringSoon, false);
  assert.equal(notSoon.collaboration.expiringSoonNotice, null);
});

test("E. procentul de remunerație vine din commissionBps, cu bpsToPercent (nu recalculat separat)", async () => {
  profiles = [profileFixture({ commissionBps: 2500 })];

  const { body } = await list();
  const [item] = body.items;

  assert.equal(item.collaboration.commissionPercent, 25);
  // aceeași valoare ca restul câmpurilor deja existente în răspuns
  assert.equal(item.commissionSharePercent, 25);
});

test("F. refresh: aceleași date de intrare produc EXACT același rezultat", async () => {
  profiles = [profileFixture()];

  const first = await list();
  const second = await list();

  assert.deepEqual(first.body.items[0].collaboration, second.body.items[0].collaboration);
});

test("invitațiile (fără profil activat încă) nu primesc o perioadă inventată", async () => {
  profiles = [profileFixture()];
  invites = [inviteFixture()];

  const { body } = await list();
  const inviteItems = body.items.filter((i) => i.type === "INVITE");

  assert.equal(inviteItems.length, 1);
  assert.ok(inviteItems.every((i) => i.collaboration === null));
});

/* =========================================================
   PATCH /:id/collaboration - "Prelungește colaborarea"
   (numerotarea A-L de mai jos e cea din cerința de prelungire)
========================================================= */

test("Prelungire A. fără override: implicit createdAt + 3 luni (neschimbat de acest endpoint)", async () => {
  profiles = [profileFixture()];

  const { body } = await list();
  const [item] = body.items;

  assert.equal(item.collaboration.collaborationEnd.slice(0, 10), "2026-12-18");
});

test("Prelungire B/C/D. +1/+3/+6 luni: pornesc de la collaborationEnd CURENT, salvate ca override", async () => {
  for (const [months, expected] of [
    [1, "2027-01-18"],
    [3, "2027-03-18"],
    [6, "2027-06-18"],
  ]) {
    profiles = [profileFixture()];

    const { body: before } = await list();
    const currentEnd = new Date(before.items[0].collaboration.collaborationEnd);
    const proposed = new Date(
      Date.UTC(currentEnd.getUTCFullYear(), currentEnd.getUTCMonth() + months, currentEnd.getUTCDate())
    );

    const { status, body } = await extend("inf-1", proposed.toISOString());

    assert.equal(status, 200, `+${months} luni`);
    assert.equal(body.collaboration.collaborationEnd.slice(0, 10), expected, `+${months} luni`);

    const { body: after } = await list();
    assert.equal(after.items[0].collaboration.collaborationEnd.slice(0, 10), expected);
  }
});

test("Prelungire: a doua prelungire pornește de la override-ul deja setat, nu de la createdAt", async () => {
  profiles = [profileFixture()];

  const first = await extend("inf-1", "2027-01-18T09:00:00.000Z");
  assert.equal(first.status, 200);

  const second = await extend("inf-1", "2027-04-18T09:00:00.000Z");
  assert.equal(second.status, 200);
  assert.equal(second.body.collaboration.collaborationEnd.slice(0, 10), "2027-04-18");

  // dacă ar fi pornit greșit de la createdAt, rezultatul ar fi complet diferit
  const { body } = await list();
  assert.equal(body.items[0].collaboration.collaborationEnd.slice(0, 10), "2027-04-18");
});

test("Prelungire E. dată custom validă e acceptată ca override", async () => {
  profiles = [profileFixture()];

  const { status, body } = await extend("inf-1", "2028-05-01T00:00:00.000Z");

  assert.equal(status, 200);
  assert.equal(body.collaboration.collaborationEnd.slice(0, 10), "2028-05-01");
});

test("Prelungire: date invalide sunt respinse (invalidă / înainte de start / nu e ulterioară end-ului curent)", async () => {
  profiles = [profileFixture()];

  const invalid = await extend("inf-1", "nu-e-o-data");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "invalid_date");

  const beforeStart = await extend("inf-1", "2020-01-01T00:00:00.000Z");
  assert.equal(beforeStart.status, 400);
  assert.equal(beforeStart.body.error, "collaboration_end_before_start");

  const notAfterCurrent = await extend("inf-1", "2026-10-01T00:00:00.000Z"); // înainte de 2026-12-18 implicit
  assert.equal(notAfterCurrent.status, 400);
  assert.equal(notAfterCurrent.body.error, "collaboration_end_not_after_current");

  // niciuna dintre respingeri nu a modificat profilul
  const { body } = await list();
  assert.equal(body.items[0].collaboration.collaborationEnd.slice(0, 10), "2026-12-18");
});

test("Prelungire F. influencer EXPIRAT: prelungirea îl readuce ACTIVE (status contului rămâne ACTIVE)", async () => {
  profiles = [
    profileFixture({
      createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
    }),
  ];

  const before = await list();
  assert.equal(before.body.items[0].collaboration.collaborationStatus, "EXPIRED");

  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { status, body } = await extend("inf-1", future);

  assert.equal(status, 200);
  assert.equal(body.collaboration.collaborationStatus, "ACTIVE");

  const after = await list();
  assert.equal(after.body.items[0].collaboration.collaborationStatus, "ACTIVE");
});

test("Prelungire G. influencer DISABLED: prelungirea NU îl reactivează automat", async () => {
  profiles = [profileFixture({ status: "DISABLED" })];

  const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { status, body } = await extend("inf-1", future);

  assert.equal(status, 200);
  assert.equal(body.collaboration.collaborationStatus, "DISABLED");

  const after = await list();
  assert.equal(after.body.items[0].status, "DISABLED");
  assert.equal(after.body.items[0].collaboration.collaborationStatus, "DISABLED");
});

test("Prelungire H. commissionBps rămâne exact cel existent (nu e atins de prelungire)", async () => {
  profiles = [profileFixture({ commissionBps: 3300 })];

  const { body } = await extend("inf-1", "2028-01-01T00:00:00.000Z");

  assert.equal(body.collaboration.commissionPercent, 33);
  assert.equal(profiles[0].commissionBps, 3300);

  const { body: listBody } = await list();
  assert.equal(listBody.items[0].commissionBps, 3300);
  assert.equal(listBody.items[0].commissionSharePercent, 33);
});

test("Prelungire K. persistă: al doilea GET, fără nicio nouă prelungire, arată aceeași dată", async () => {
  profiles = [profileFixture()];

  await extend("inf-1", "2027-06-18T00:00:00.000Z");

  const first = await list();
  const second = await list();

  assert.equal(first.body.items[0].collaboration.collaborationEnd, second.body.items[0].collaboration.collaborationEnd);
  assert.equal(first.body.items[0].collaboration.collaborationEnd.slice(0, 10), "2027-06-18");
});

test("Prelungire L. doar ADMIN: neautentificat/non-admin nu poate prelungi", async () => {
  profiles = [profileFixture()];

  const asStranger = await extend("inf-1", "2027-06-18T00:00:00.000Z", { asUser: "necunoscut" });
  assert.equal(asStranger.status, 401);

  const asUser = await extend("inf-1", "2027-06-18T00:00:00.000Z", { asUser: "user-1" });
  assert.equal(asUser.status, 403);

  // niciuna dintre încercări nu a modificat profilul
  const { body } = await list();
  assert.equal(body.items[0].collaboration.collaborationEnd.slice(0, 10), "2026-12-18");
});

test("Prelungire: influencer inexistent => 404", async () => {
  profiles = [profileFixture()];

  const { status, body } = await extend("nu-exista", "2027-06-18T00:00:00.000Z");

  assert.equal(status, 404);
  assert.equal(body.error, "influencer_not_found");
});
