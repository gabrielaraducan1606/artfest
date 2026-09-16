// src/services/homepageFeatureScheduler.test.js
//
// Teste deterministe pentru fix-urile din auditul de promoții
// (2026-09-15): notificare automată idempotentă a vendorului +
// timezone Europe/Bucharest centralizat. FĂRĂ DB real, FĂRĂ email
// real - node:test + mock.module, același tipar ca
// adminOrdersRoutes.refund.test.js.
//
// Rulare:
// node --experimental-test-module-mocks --test src/services/homepageFeatureScheduler.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5"; // niciodată contactat cu adevărat

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  BUCHAREST_TZ,
  getZonedDayRange,
  getZonedWeekRange,
  getZonedDayKey,
  getZonedWeekKey,
} from "../lib/bucharestDate.js";

import {
  getActiveHomepagePromotionsForProducts,
  calculateProductPromotionPricing,
} from "./productPromotionPrice.js";

/* =========================================================
   G. TIMEZONE - Europe/Bucharest, ancorat explicit, indiferent
   de fusul orar implicit al procesului Node (care, în testele
   locale, poate fi orice - nu presupunem nimic despre el).
========================================================= */

test("G1. getZonedDayRange: o oră din seara târzie România cade tot în ZIUA locală, chiar dacă în UTC e deja ziua următoare", () => {
  // 2026-06-15 23:30 ora României (EEST, UTC+3) = 2026-06-15T20:30:00Z
  const reference = new Date("2026-06-15T20:30:00.000Z");

  const range = getZonedDayRange(reference);

  // ziua locală e 15 iunie -> [15 iunie 00:00, 16 iunie 00:00) ora României
  assert.equal(range.startsAt.toISOString(), "2026-06-14T21:00:00.000Z");
  assert.equal(range.endsAt.toISOString(), "2026-06-15T21:00:00.000Z");
});

test("G2. getZonedDayKey: tranziția DST primăvara (2026-03-29, 03:00 EET -> 04:00 EEST) nu deplasează cheia zilei", () => {
  // 2026-03-28T23:59:00Z = 2026-03-29 01:59 ora României, ÎNAINTE de
  // tranziție (GMT+2/EET).
  const beforeTransition = new Date("2026-03-28T23:59:00.000Z");

  assert.equal(getZonedDayKey(beforeTransition), "2026-03-29");

  // 2026-03-29T01:30:00Z = 2026-03-29 04:30 ora României, DUPĂ
  // tranziție (GMT+3/EEST) - aceeași zi calendaristică locală.
  const afterTransition = new Date("2026-03-29T01:30:00.000Z");

  assert.equal(getZonedDayKey(afterTransition), "2026-03-29");

  // ziua următoare (30 martie, deja stabil în EEST)
  const nextDay = new Date("2026-03-29T21:30:00.000Z"); // 00:30 EEST, 30 martie

  assert.equal(getZonedDayKey(nextDay), "2026-03-30");
});

test("G2b. getZonedDayRange: intervalul zilei tranziției (2026-03-29) e calculat corect (offset-ul se ia la miezul nopții local, dinainte de tranziție)", () => {
  const reference = new Date("2026-03-28T23:59:00.000Z"); // 2026-03-29 01:59 EET

  const range = getZonedDayRange(reference);

  assert.equal(range.startsAt.toISOString(), "2026-03-28T22:00:00.000Z"); // 00:00 EET
  assert.equal(range.endsAt.toISOString(), "2026-03-29T21:00:00.000Z"); // 00:00 EEST (30 martie)
});

test("G3. getZonedWeekRange: săptămâna calendaristică (Luni-Duminică) e ancorată corect indiferent de ziua din săptămână a referinței", () => {
  // Miercuri, 2026-09-16 (ora României)
  const wednesday = new Date("2026-09-16T10:00:00.000Z");

  const range = getZonedWeekRange(wednesday);

  // Luni 2026-09-14 00:00 -> Luni 2026-09-21 00:00, ora României (EEST +3)
  assert.equal(range.startsAt.toISOString(), "2026-09-13T21:00:00.000Z");
  assert.equal(range.endsAt.toISOString(), "2026-09-20T21:00:00.000Z");
});

test("G4. getZonedWeekKey: format ISO an-săptămână, consistent cu getZonedWeekRange", () => {
  const wednesday = new Date("2026-09-16T10:00:00.000Z");

  assert.equal(getZonedWeekKey(wednesday), "2026-W38");
});

test("G5. BUCHAREST_TZ e explicit Europe/Bucharest (nu depinde de TZ-ul procesului)", () => {
  assert.equal(BUCHAREST_TZ, "Europe/Bucharest");
});

/* =========================================================
   A/B/C. Prețul promoției HomepageFeature înainte / în interval /
   după interval - via getActiveHomepagePromotionsForProducts, cu
   `db` fake injectat direct (funcția reală acceptă `db`/`now` ca
   opțiuni - fără mock.module, testăm codul real de producție).
========================================================= */

function makeFakeDbWithFeature(feature) {
  return {
    homepageFeature: {
      findMany: async ({ where }) => {
        const now = where.startsAt.lte;

        const matches =
          new Date(feature.startsAt) <= now &&
          new Date(feature.endsAt) > now;

        return matches ? [feature] : [];
      },
    },
  };
}

const PRODUCT_OF_DAY_FEATURE = {
  id: "feature-1",
  type: "PRODUCT_OF_DAY",
  productId: "product-1",
  serviceId: null,
  startsAt: new Date("2026-09-15T21:00:00.000Z"), // 2026-09-16 00:00 România
  endsAt: new Date("2026-09-16T21:00:00.000Z"), // 2026-09-17 00:00 România
  platformDiscountPercent: 15,
  vendorDiscountPercent: 10,
  vendorDiscountStatus: "ACCEPTED",
};

const PRODUCT = {
  id: "product-1",
  serviceId: "service-1",
  priceCents: 10000,
  orderMode: "STANDARD",
};

test("A. ÎNAINTE de startsAt: promoția Produsul zilei NU se aplică (preț neschimbat)", async () => {
  const db = makeFakeDbWithFeature(PRODUCT_OF_DAY_FEATURE);
  const before = new Date("2026-09-15T18:00:00.000Z"); // înainte de 21:00Z

  const promotions = await getActiveHomepagePromotionsForProducts(
    [PRODUCT],
    { db, now: before }
  );

  assert.equal(promotions.size, 0);

  const pricing = calculateProductPromotionPricing(
    PRODUCT,
    promotions.get(PRODUCT.id) || null
  );

  assert.equal(pricing.hasDiscount, false);
  assert.equal(pricing.finalPriceCents, 10000);
});

test("B. ÎN interval [startsAt, endsAt): promoția se aplică, reducere totală = platformă + vendor (dacă vendorul a acceptat)", async () => {
  const db = makeFakeDbWithFeature(PRODUCT_OF_DAY_FEATURE);
  const during = new Date("2026-09-16T10:00:00.000Z"); // în interval

  const promotions = await getActiveHomepagePromotionsForProducts(
    [PRODUCT],
    { db, now: during }
  );

  assert.equal(promotions.size, 1);

  const pricing = calculateProductPromotionPricing(
    PRODUCT,
    promotions.get(PRODUCT.id)
  );

  assert.equal(pricing.hasDiscount, true);
  assert.equal(pricing.totalDiscountPercent, 25); // 15 + 10
  assert.equal(pricing.finalPriceCents, 7500); // 10000 * 0.75
});

test("C. DUPĂ endsAt: promoția NU mai se aplică (preț revine la normal)", async () => {
  const db = makeFakeDbWithFeature(PRODUCT_OF_DAY_FEATURE);
  const after = new Date("2026-09-17T00:00:00.000Z"); // exact la/după endsAt

  const promotions = await getActiveHomepagePromotionsForProducts(
    [PRODUCT],
    { db, now: after }
  );

  assert.equal(promotions.size, 0);

  const pricing = calculateProductPromotionPricing(
    PRODUCT,
    promotions.get(PRODUCT.id) || null
  );

  assert.equal(pricing.hasDiscount, false);
  assert.equal(pricing.finalPriceCents, 10000);
});

test("B2. vendor NU a acceptat reducerea (PENDING): se aplică DOAR reducerea de platformă", async () => {
  const feature = {
    ...PRODUCT_OF_DAY_FEATURE,
    vendorDiscountStatus: "PENDING",
  };

  const db = makeFakeDbWithFeature(feature);
  const during = new Date("2026-09-16T10:00:00.000Z");

  const promotions = await getActiveHomepagePromotionsForProducts(
    [PRODUCT],
    { db, now: during }
  );

  const pricing = calculateProductPromotionPricing(
    PRODUCT,
    promotions.get(PRODUCT.id)
  );

  assert.equal(pricing.totalDiscountPercent, 15); // doar platformă
  assert.equal(pricing.finalPriceCents, 8500);
});

/* =========================================================
   D/E. Notificarea vendorului - EXACT o dată la creare, iar o
   reîncercare (retry / buton "Retrimite") NU duplică notificarea
   sau emailul. Testăm notifyVendorAboutFeatureCreated direct, cu
   ./notifications.js și ../lib/mailer.js mock.module-ate (fake
   STATEFUL pentru notificare, ca să dovedim dedup real la nivelul
   acelui strat), plus ../db.js pentru update-urile
   vendorNotifiedAt/vendorEmailedAt.
========================================================= */

function makeFakeHomepageFeatureDb() {
  const updates = [];

  return {
    homepageFeature: {
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
    },
    __updates: updates,
  };
}

/*
 * Fake STATEFUL pentru notifyVendorOnHomepageFeatureCreated -
 * simulează exact garanția reală (upsert pe dedupeKey în
 * notifications.js): a doua chemare pentru ACELAȘI featureId
 * NU creează un al doilea rând, doar întoarce aceeași notificare.
 */
function makeFakeNotifyModule() {
  const store = new Map();
  const calls = [];

  const notifyVendorOnHomepageFeatureCreated = async (featureId) => {
    calls.push(featureId);

    if (store.has(featureId)) {
      return store.get(featureId);
    }

    const notification = { id: `notif_${featureId}`, featureId };
    store.set(featureId, notification);
    return notification;
  };

  return { notifyVendorOnHomepageFeatureCreated, calls, store };
}

function makeFakeMailerModule() {
  const calls = [];

  const sendHomepageFeatureSelectedEmail = async (payload) => {
    calls.push(payload);

    if (payload.to === "fail@example.com") {
      throw new Error("smtp_down");
    }

    return { ok: true };
  };

  return { sendHomepageFeatureSelectedEmail, calls };
}

async function loadSchedulerWithMocks({ db, notifyModule, mailerModule }) {
  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: db },
  });

  const moduleMockNotifications = mock.module("./notifications.js", {
    namedExports: {
      notifyVendorOnHomepageFeatureCreated:
        notifyModule.notifyVendorOnHomepageFeatureCreated,
    },
  });

  const moduleMockMailer = mock.module("../lib/mailer.js", {
    namedExports: {
      sendHomepageFeatureSelectedEmail:
        mailerModule.sendHomepageFeatureSelectedEmail,
    },
  });

  const mod = await import(
    `./homepageFeatureScheduler.js?t=${Date.now()}-${Math.random()}`
  );

  return {
    notifyVendorAboutFeatureCreated: mod.notifyVendorAboutFeatureCreated,
    restore: () => {
      moduleMockDb.restore();
      moduleMockNotifications.restore();
      moduleMockMailer.restore();
    },
  };
}

function makeFeatureFixture(overrides = {}) {
  return {
    id: "feature-vendor-test",
    type: "PRODUCT_OF_DAY",
    startsAt: new Date("2026-09-16T00:00:00.000Z"),
    endsAt: new Date("2026-09-17T00:00:00.000Z"),
    platformDiscountPercent: 15,
    vendorNotifiedAt: null,
    vendorEmailedAt: null,
    vendorEmailError: null,
    product: { title: "Produs test" },
    vendor: {
      id: "vendor-1",
      userId: "user-1",
      displayName: "Atelier Test",
      email: "vendor@example.com",
      user: { email: "vendor@example.com", firstName: "Ana", lastName: "Pop" },
    },
    ...overrides,
  };
}

test("D. la creare: notificarea in-app și emailul pleacă EXACT o dată, iar vendorNotifiedAt/vendorEmailedAt se completează", async () => {
  const db = makeFakeHomepageFeatureDb();
  const notifyModule = makeFakeNotifyModule();
  const mailerModule = makeFakeMailerModule();

  const { notifyVendorAboutFeatureCreated, restore } =
    await loadSchedulerWithMocks({ db, notifyModule, mailerModule });

  try {
    const feature = makeFeatureFixture();

    const result = await notifyVendorAboutFeatureCreated(feature);

    assert.equal(result.ok, true);
    assert.equal(result.notificationSent, true);
    assert.equal(result.emailSent, true);
    assert.ok(result.vendorNotifiedAt instanceof Date);
    assert.ok(result.vendorEmailedAt instanceof Date);

    assert.equal(notifyModule.calls.length, 1);
    assert.equal(mailerModule.calls.length, 1);
    assert.equal(mailerModule.calls[0].to, "vendor@example.com");

    // ambele câmpuri au fost persistate în DB (2 update-uri distincte)
    const notifiedUpdate = db.__updates.find((u) => "vendorNotifiedAt" in u.data);
    const emailedUpdate = db.__updates.find((u) => "vendorEmailedAt" in u.data);

    assert.ok(notifiedUpdate);
    assert.ok(emailedUpdate);
  } finally {
    restore();
  }
});

test("E. retry (ex. buton „Retrimite” după ce vendorul a fost deja contactat): NU se creează a doua notificare/email", async () => {
  const db = makeFakeHomepageFeatureDb();
  const notifyModule = makeFakeNotifyModule();
  const mailerModule = makeFakeMailerModule();

  const { notifyVendorAboutFeatureCreated, restore } =
    await loadSchedulerWithMocks({ db, notifyModule, mailerModule });

  try {
    const feature = makeFeatureFixture();

    const first = await notifyVendorAboutFeatureCreated(feature);

    // simulăm reîncărcarea feature-ului din DB după primul apel
    // (exact ce face ruta /:id/send-notification înainte de retry)
    const reloaded = makeFeatureFixture({
      vendorNotifiedAt: first.vendorNotifiedAt,
      vendorEmailedAt: first.vendorEmailedAt,
    });

    const second = await notifyVendorAboutFeatureCreated(reloaded);

    // notificarea in-app rămâne idempotentă (upsert pe dedupeKey în
    // stratul real) - a doua chemare tot "reușește", dar NU a produs
    // un al doilea rând în magazinul de notificări (store.size === 1)
    assert.equal(notifyModule.store.size, 1);
    assert.equal(second.notificationSent, true);

    // emailul NU mai pleacă a doua oară - deja trimis
    assert.equal(second.emailSkipped, true);
    assert.equal(second.emailSent, false);
    assert.equal(mailerModule.calls.length, 1); // tot 1, nu 2

    assert.deepEqual(second.vendorEmailedAt, first.vendorEmailedAt);
  } finally {
    restore();
  }
});

test("E2. emailul eșuează: vendorEmailedAt NU se completează, dar notificarea in-app tot a fost trimisă (nu blochează generarea)", async () => {
  const db = makeFakeHomepageFeatureDb();
  const notifyModule = makeFakeNotifyModule();
  const mailerModule = makeFakeMailerModule();

  const { notifyVendorAboutFeatureCreated, restore } =
    await loadSchedulerWithMocks({ db, notifyModule, mailerModule });

  try {
    const feature = makeFeatureFixture({
      vendor: {
        id: "vendor-2",
        userId: "user-2",
        displayName: "Atelier Fail",
        email: "fail@example.com",
        user: { email: "fail@example.com" },
      },
    });

    const result = await notifyVendorAboutFeatureCreated(feature);

    assert.equal(result.notificationSent, true);
    assert.equal(result.emailSent, false);
    assert.equal(result.vendorEmailedAt, null);
    assert.ok(result.emailError);
    assert.equal(result.vendorEmailError, "smtp_down");

    // dacă emailul e reîncercat mai târziu cu succes (ex. adresa
    // corectată), notificarea in-app NU trebuie retrimisă a doua oară
    // - deja avem vendorNotifiedAt setat, deci store-ul rămâne la 1.
    const retryFeature = makeFeatureFixture({
      vendorNotifiedAt: result.vendorNotifiedAt,
      vendorEmailedAt: null,
      vendor: {
        id: "vendor-2",
        userId: "user-2",
        displayName: "Atelier Fail",
        email: "vendor-fixed@example.com",
        user: { email: "vendor-fixed@example.com" },
      },
    });

    const retryResult = await notifyVendorAboutFeatureCreated(retryFeature);

    assert.equal(retryResult.emailSent, true);
    assert.ok(retryResult.vendorEmailedAt instanceof Date);
    assert.equal(notifyModule.store.size, 1); // tot o singură notificare in-app
    assert.equal(notifyModule.calls.length, 2); // apelat de 2 ori, dar idempotent
  } finally {
    restore();
  }
});

/* =========================================================
   F. Vendorul poate seta reducerea IMEDIAT după ce a fost
   notificat (vendorNotifiedAt setat) - PATCH
   /api/vendor/homepage-features/:id/discount. Router-ul real,
   montat pe Express real, cu ../db.js și ../api/auth.js
   mock.module-ate (fără DB real, fără auth JWT real).
========================================================= */

function makeFakeVendorFeatureDb(feature) {
  const store = new Map([[feature.id, { ...feature }]]);

  return {
    homepageFeature: {
      findFirst: async ({ where, select }) => {
        const row = store.get(where.id);

        if (!row || row.vendorId !== where.vendorId) {
          return null;
        }

        if (!select) return { ...row };

        const out = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = row[key];
        }
        return out;
      },
      update: async ({ where, data }) => {
        const row = store.get(where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    __store: store,
  };
}

async function startVendorFeatureServer({ db, userVendorId = "vendor-1" }) {
  const moduleMockDb = mock.module("../db.js", {
    namedExports: { prisma: db },
  });

  const moduleMockAuth = mock.module("../api/auth.js", {
    namedExports: {
      authRequired: (req, _res, next) => {
        req.user = { sub: "user-1", vendorId: userVendorId };
        next();
      },
      enforceTokenVersion: (_req, _res, next) => next(),
      requireRole: () => (_req, _res, next) => next(),
    },
  });

  const mod = await import(
    `../routes/vendorHomepageFeatureRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  const app = express();
  app.use(express.json());
  app.use("/api/vendor/homepage-features", mod.default);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve) => server.close(resolve)),
    restore: () => {
      moduleMockDb.restore();
      moduleMockAuth.restore();
    },
  };
}

test("F1. vendorul POATE seta reducerea imediat după ce a fost notificat (vendorNotifiedAt setat)", async () => {
  const feature = {
    id: "feature-f1",
    vendorId: "vendor-1",
    type: "PRODUCT_OF_DAY",
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3600_000),
    platformDiscountPercent: 15,
    vendorDiscountPercent: 0,
    vendorDiscountStatus: "PENDING",
    vendorNotifiedAt: new Date(), // notificat automat la creare
    vendorEmailedAt: null,
    product: null,
    service: null,
  };

  const db = makeFakeVendorFeatureDb(feature);
  const { baseUrl, stop, restore } = await startVendorFeatureServer({ db });

  try {
    const res = await fetch(
      `${baseUrl}/api/vendor/homepage-features/${feature.id}/discount`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorDiscountPercent: 10 }),
      }
    );

    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.feature.vendorDiscountPercent, 10);
    assert.equal(body.feature.vendorDiscountStatus, "ACCEPTED");
    assert.equal(db.__store.get(feature.id).vendorDiscountStatus, "ACCEPTED");
  } finally {
    restore();
    await stop();
  }
});

test("F2. vendorul NU poate seta reducerea dacă NU a fost încă notificat (vendorNotifiedAt/vendorEmailedAt ambele null)", async () => {
  const feature = {
    id: "feature-f2",
    vendorId: "vendor-1",
    type: "PRODUCT_OF_DAY",
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3600_000),
    platformDiscountPercent: 15,
    vendorDiscountPercent: 0,
    vendorDiscountStatus: "PENDING",
    vendorNotifiedAt: null,
    vendorEmailedAt: null,
    product: null,
    service: null,
  };

  const db = makeFakeVendorFeatureDb(feature);
  const { baseUrl, stop, restore } = await startVendorFeatureServer({ db });

  try {
    const res = await fetch(
      `${baseUrl}/api/vendor/homepage-features/${feature.id}/discount`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorDiscountPercent: 10 }),
      }
    );

    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.code, "VENDOR_NOT_CONTACTED");
  } finally {
    restore();
    await stop();
  }
});
