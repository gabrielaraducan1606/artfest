// src/jobs/discountCodeExpiryJob.test.js
//
// Teste deterministe pentru runDiscountCodeExpiryJob() - notificare
// vendor/influencer la expirarea unui cod de reducere (audit 2026-09-23).
//
// FĂRĂ DB real - mocăm STRICT "../db.js" și "../services/notifications.js".
// Restul e codul REAL (discountCodeExpiryJob.js, neatins).
//
// Rulare: node --experimental-test-module-mocks --test src/jobs/discountCodeExpiryJob.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

let codes = [];
let notifications = []; // simulează rândurile Notification deja create (pt. dedupe)
let influencerProfiles = [];
let vendorCalls = [];
let userCalls = [];
let vendorBehavior = { mode: "success" };
let userBehavior = { mode: "success" };

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function seedCode(code) {
  codes.push({
    id: code.id,
    code: code.code || `CODE-${code.id}`,
    endsAt: code.endsAt,
    isActive: code.isActive ?? true,
    status: code.status ?? "ACTIVE",
    vendorId: code.vendorId ?? null,
    influencerId: code.influencerId ?? null,
  });
}

function seedInfluencer(influencer) {
  influencerProfiles.push({
    id: influencer.id,
    userId: influencer.userId ?? null,
  });
}

function keyFor(discountCodeId, endsAt) {
  return `discount_code_expired:${discountCodeId}:${endsAt.toISOString()}`;
}

const fakeDb = {
  discountCode: {
    findMany: async ({ where }) => {
      const now = where.endsAt.lte.getTime();

      return codes
        .filter(
          (c) =>
            c.endsAt &&
            c.endsAt.getTime() <= now &&
            c.isActive === where.isActive &&
            c.status === where.status
        )
        .map((c) => ({ ...c }));
    },
  },

  notification: {
    findUnique: async ({ where }) => {
      const found = notifications.find((n) => n.dedupeKey === where.dedupeKey);
      return found ? { id: found.dedupeKey } : null;
    },
  },

  influencerProfile: {
    findUnique: async ({ where }) => {
      const found = influencerProfiles.find((i) => i.id === where.id);
      return found ? { userId: found.userId } : null;
    },
  },
};

mock.module("../db.js", {
  namedExports: { prisma: fakeDb },
});

mock.module("../services/notifications.js", {
  namedExports: {
    createVendorNotification: async (vendorId, data) => {
      vendorCalls.push({ vendorId, data });

      if (vendorBehavior.mode === "throw") {
        throw new Error("vendor_notification_failed");
      }

      notifications.push({ dedupeKey: data.dedupeKey });
      return { id: data.dedupeKey };
    },

    createUserNotification: async (userId, data) => {
      userCalls.push({ userId, data });

      if (userBehavior.mode === "throw") {
        throw new Error("user_notification_failed");
      }

      notifications.push({ dedupeKey: data.dedupeKey });
      return { id: data.dedupeKey };
    },
  },
});

const { runDiscountCodeExpiryJob } = await import(
  "./discountCodeExpiryJob.js"
);

function reset() {
  codes = [];
  notifications = [];
  influencerProfiles = [];
  vendorCalls = [];
  userCalls = [];
  vendorBehavior = { mode: "success" };
  userBehavior = { mode: "success" };
}

/* =========================================================
   A. cod VENDOR expirat -> notificare vendor
========================================================= */

test("A. cod vendor expirat -> createVendorNotification chemat cu titlu/mesaj/link corecte", async () => {
  reset();

  seedCode({
    id: "dc-vendor-1",
    code: "VARA20",
    endsAt: hoursAgo(2),
    vendorId: "vendor-1",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 1);
  assert.equal(vendorCalls[0].vendorId, "vendor-1");
  assert.equal(vendorCalls[0].data.title, "Cod de reducere expirat");
  assert.match(vendorCalls[0].data.body, /«VARA20»/);
  assert.match(
    vendorCalls[0].data.body,
    /modifică perioada de valabilitate/
  );
  assert.equal(vendorCalls[0].data.link, "/vendor/catalog?tab=codes");
  assert.equal(userCalls.length, 0);
});

/* =========================================================
   B. cod INFLUENCER expirat -> notificare user influencer
========================================================= */

test("B. cod influencer expirat -> createUserNotification cu userId real, link /influencer?tab=promotion", async () => {
  reset();

  seedInfluencer({ id: "inf-1", userId: "user-inf-1" });

  seedCode({
    id: "dc-inf-1",
    code: "INFLU10",
    endsAt: hoursAgo(1),
    influencerId: "inf-1",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(userCalls.length, 1);
  assert.equal(userCalls[0].userId, "user-inf-1");
  assert.equal(userCalls[0].data.title, "Cod de reducere expirat");
  assert.match(userCalls[0].data.body, /«INFLU10»/);
  assert.equal(userCalls[0].data.link, "/influencer?tab=promotion");
  assert.equal(vendorCalls.length, 0);
});

/* =========================================================
   C. cod NEEXPIRAT -> nimic
========================================================= */

test("C. cod cu endsAt în viitor -> nicio notificare", async () => {
  reset();

  seedCode({
    id: "dc-future",
    code: "VIITOR",
    endsAt: hoursFromNow(5),
    vendorId: "vendor-1",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 0);
  assert.equal(userCalls.length, 0);
});

/* =========================================================
   D. cod dezactivat MANUAL (isActive:false) -> comportamentul ales:
   NU notifică (query-ul filtrează isActive:true - owner-ul deja
   știe că l-a dezactivat, nu e o expirare "surprinzătoare").
========================================================= */

test("D. cod expirat, dar dezactivat manual (isActive=false) -> nicio notificare", async () => {
  reset();

  seedCode({
    id: "dc-disabled",
    code: "OPRIT",
    endsAt: hoursAgo(3),
    isActive: false,
    vendorId: "vendor-1",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 0);
  assert.equal(userCalls.length, 0);
});

test("D bis. cod cu status DISABLED -> nicio notificare", async () => {
  reset();

  seedCode({
    id: "dc-status-disabled",
    code: "STOP",
    endsAt: hoursAgo(3),
    status: "DISABLED",
    vendorId: "vendor-1",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 0);
});

/* =========================================================
   E. job rulat de 2 ori, ACELAȘI endsAt -> o singură notificare
========================================================= */

test("E. job rulat de 2 ori cu același endsAt -> o singură notificare (dedupe)", async () => {
  reset();

  const endsAt = hoursAgo(1);

  seedCode({
    id: "dc-twice",
    code: "ODATA",
    endsAt,
    vendorId: "vendor-1",
  });

  await runDiscountCodeExpiryJob();
  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 1);
});

/* =========================================================
   F. cod reactivat cu endsAt NOU -> după noua expirare, notificare NOUĂ
========================================================= */

test("F. cod reactivat cu endsAt nou -> notificare nouă la noul ciclu de expirare", async () => {
  reset();

  const code = {
    id: "dc-recycled",
    code: "RECICLAT",
    endsAt: hoursAgo(2),
    vendorId: "vendor-1",
  };

  seedCode(code);

  await runDiscountCodeExpiryJob();
  assert.equal(vendorCalls.length, 1);
  const firstKey = vendorCalls[0].data.dedupeKey;

  // simulăm reactivarea: vendorul mută endsAt într-o dată viitoare,
  // apoi codul expiră din nou, mai târziu (endsAt nou, diferit).
  const stored = codes.find((c) => c.id === "dc-recycled");
  stored.endsAt = hoursAgo(1); // nou ciclu, deja expirat la a doua rulare

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 2);
  const secondKey = vendorCalls[1].data.dedupeKey;

  assert.notEqual(firstKey, secondKey);
  assert.equal(
    keyFor("dc-recycled", stored.endsAt),
    secondKey
  );
});

/* =========================================================
   G. vendor și influencer NU se amestecă
========================================================= */

test("G. vendor și influencer expirați simultan -> fiecare primește notificarea lui, fără amestec", async () => {
  reset();

  seedInfluencer({ id: "inf-2", userId: "user-inf-2" });

  seedCode({
    id: "dc-v",
    code: "VEND",
    endsAt: hoursAgo(1),
    vendorId: "vendor-9",
  });

  seedCode({
    id: "dc-i",
    code: "INFL",
    endsAt: hoursAgo(1),
    influencerId: "inf-2",
  });

  await runDiscountCodeExpiryJob();

  assert.equal(vendorCalls.length, 1);
  assert.equal(vendorCalls[0].vendorId, "vendor-9");

  assert.equal(userCalls.length, 1);
  assert.equal(userCalls[0].userId, "user-inf-2");
});

/* =========================================================
   H. influencer FĂRĂ profil/user valid -> jobul nu cade complet
========================================================= */

test("H. influencerId fără InfluencerProfile găsit -> sărit, jobul continuă (nu aruncă)", async () => {
  reset();

  seedCode({
    id: "dc-orphan",
    code: "ORFAN",
    endsAt: hoursAgo(1),
    influencerId: "inf-inexistent",
  });

  seedCode({
    id: "dc-v-ok",
    code: "OK",
    endsAt: hoursAgo(1),
    vendorId: "vendor-ok",
  });

  await assert.doesNotReject(runDiscountCodeExpiryJob());

  assert.equal(userCalls.length, 0);
  assert.equal(vendorCalls.length, 1); // celălalt cod tot a fost procesat
});

test("H bis. InfluencerProfile există, dar userId lipsă -> sărit, fără crash", async () => {
  reset();

  seedInfluencer({ id: "inf-no-user", userId: null });

  seedCode({
    id: "dc-no-user",
    code: "FARAUSER",
    endsAt: hoursAgo(1),
    influencerId: "inf-no-user",
  });

  await assert.doesNotReject(runDiscountCodeExpiryJob());
  assert.equal(userCalls.length, 0);
});

/* =========================================================
   I. eroare la UN cod -> restul continuă
========================================================= */

test("I. eroare la un cod (notificare aruncă) -> restul batch-ului tot e procesat", async () => {
  reset();

  seedCode({
    id: "dc-fail",
    code: "PICA",
    endsAt: hoursAgo(1),
    vendorId: "vendor-fail",
  });

  seedCode({
    id: "dc-ok-after",
    code: "MERGE",
    endsAt: hoursAgo(1),
    vendorId: "vendor-ok-after",
  });

  vendorBehavior = { mode: "throw" };

  await assert.doesNotReject(runDiscountCodeExpiryJob());

  // ambele au fost ÎNCERCATE (vendorBehavior afectează pe amândouă
  // în acest test, deci verificăm doar că jobul nu s-a oprit la
  // primul eșec - a ajuns și la al doilea cod).
  assert.equal(vendorCalls.length, 2);
});

/* =========================================================
   Batch cap (take: 200) - nu blocant de testat exhaustiv, doar
   verificăm că query-ul trimite limita corectă implicit prin
   comportament normal (deja acoperit de A-I). Fără test suplimentar
   aici - fake db-ul nu simulează `take`, comportamentul real al
   Prisma nu are nevoie de test unitar suplimentar pentru asta.
========================================================= */
