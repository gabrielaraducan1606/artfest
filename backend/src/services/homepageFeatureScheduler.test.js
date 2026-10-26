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

/*
 * platformDiscountPercent: 0 - explicit, câmp legacy IGNORAT de
 * homepageFeatureToPromotion() (audit 2026-09-28). Singura valoare
 * care contează pentru discount e vendorDiscountPercent, condiționată
 * de vendorDiscountStatus === "ACCEPTED". Fixture-ul nu mai lasă o
 * valoare nenulă "moartă" pe platformDiscountPercent, ca să nu sugereze
 * că ar mai avea vreun efect.
 */
const PRODUCT_OF_DAY_FEATURE = {
  id: "feature-1",
  type: "PRODUCT_OF_DAY",
  productId: "product-1",
  serviceId: null,
  startsAt: new Date("2026-09-15T21:00:00.000Z"), // 2026-09-16 00:00 România
  endsAt: new Date("2026-09-16T21:00:00.000Z"), // 2026-09-17 00:00 România
  platformDiscountPercent: 0,
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

test("B. ÎN interval [startsAt, endsAt): promoția se aplică, reducerea e STRICT cea a vendorului (audit 2026-09-28 - Artfest nu mai contribuie financiar)", async () => {
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

  /*
   * REGULĂ NOUĂ (audit 2026-09-28): platformDiscountPercent (0, în
   * fixture) e câmp legacy, complet ignorat - discountul real e DOAR
   * ce a acceptat vendorul (10%), 100% suportat de el.
   */
  assert.equal(pricing.totalDiscountPercent, 10);
  assert.equal(pricing.platformDiscountPercent, 0);
  assert.equal(pricing.vendorDiscountPercent, 10);
  assert.equal(pricing.finalPriceCents, 9000); // 10000 * 0.90
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

test("B2. vendor NU a acceptat reducerea (PENDING): NICIUN discount (audit 2026-09-28 - Artfest nu mai inventează un discount pe cheltuiala proprie)", async () => {
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

  /*
   * REGULĂ NOUĂ: fără acceptul vendorului, NU mai există "doar
   * reducerea de platformă" - platformDiscountPercent (legacy, 0 în
   * fixture) e complet ignorat, deci promoția nu produce niciun discount.
   */
  assert.equal(promotions.size, 0);

  const pricing = calculateProductPromotionPricing(
    PRODUCT,
    promotions.get(PRODUCT.id) || null
  );

  assert.equal(pricing.hasDiscount, false);
  assert.equal(pricing.totalDiscountPercent, 0);
  assert.equal(pricing.finalPriceCents, 10000);
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

// emailul e PROGRAMAT (3 zile înainte, 09:00 RO): pentru fixture-ul de pe
// 16 sep e scadent între 13 sep 09:00 și începutul promovării
const DUE_NOW = new Date("2026-09-14T08:00:00.000Z");

function makeFeatureFixture(overrides = {}) {
  return {
    id: "feature-vendor-test",
    type: "PRODUCT_OF_DAY",
    startsAt: new Date("2026-09-16T00:00:00.000Z"),
    endsAt: new Date("2026-09-17T00:00:00.000Z"),
    // legacy, ignorat de homepageFeatureToPromotion() - irelevant pentru
    // aceste teste de notificare, dar 0 explicit ca să nu sugereze
    // vreun efect financiar (audit 2026-09-28).
    platformDiscountPercent: 0,
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

    const result = await notifyVendorAboutFeatureCreated(feature, { now: DUE_NOW });

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

    const first = await notifyVendorAboutFeatureCreated(feature, { now: DUE_NOW });

    // simulăm reîncărcarea feature-ului din DB după primul apel
    // (exact ce face ruta /:id/send-notification înainte de retry)
    const reloaded = makeFeatureFixture({
      vendorNotifiedAt: first.vendorNotifiedAt,
      vendorEmailedAt: first.vendorEmailedAt,
    });

    const second = await notifyVendorAboutFeatureCreated(reloaded, { now: DUE_NOW });

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

    const result = await notifyVendorAboutFeatureCreated(feature, { now: DUE_NOW });

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

    const retryResult = await notifyVendorAboutFeatureCreated(retryFeature, { now: DUE_NOW });

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
    // legacy, ignorat - vezi PRODUCT_OF_DAY_FEATURE mai sus.
    platformDiscountPercent: 0,
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
    // legacy, ignorat - vezi PRODUCT_OF_DAY_FEATURE mai sus.
    platformDiscountPercent: 0,
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

/* =========================================================
   H. Email PROGRAMAT: Produsul zilei -3 zile, Artizanul săptămânii
   -7 zile, 09:00 ora României; job idempotent; conținut nou.
========================================================= */

// Produsul zilei pe 10 oct 2026 (00:00 ora României = 2026-10-09T21:00Z)
const POD_OCT_10 = { id: "pod-10", type: "PRODUCT_OF_DAY", startsAt: new Date("2026-10-09T21:00:00.000Z"), endsAt: new Date("2026-10-10T21:00:00.000Z") };
// Artizanul săptămânii luni 12 oct - duminică 18 oct 2026
const AOW_OCT_12 = { id: "aow-12", type: "ARTISAN_OF_WEEK", startsAt: new Date("2026-10-11T21:00:00.000Z"), endsAt: new Date("2026-10-18T21:00:00.000Z") };

async function loadPureScheduler() {
  const db = makeFakeHomepageFeatureDb();
  return loadSchedulerWithMocks({ db, notifyModule: makeFakeNotifyModule(), mailerModule: makeFakeMailerModule() });
}

test("H1. data trimiterii: Produsul zilei 10 oct -> 7 oct 09:00; Artizanul săptămânii luni 12 oct -> luni 5 oct 09:00 (ora României)", async () => {
  const { restore } = await loadPureScheduler();
  const mod = await import(`./homepageFeatureScheduler.js?h1=${Math.random()}`);
  try {
    assert.equal(mod.computeFeatureEmailSendAt(POD_OCT_10).toISOString(), "2026-10-07T06:00:00.000Z"); // 09:00 EEST
    assert.equal(mod.computeFeatureEmailSendAt(AOW_OCT_12).toISOString(), "2026-10-05T06:00:00.000Z"); // luni 09:00
    // iarna (EET, UTC+2): 09:00 = 07:00Z
    const winter = { type: "PRODUCT_OF_DAY", startsAt: new Date("2026-12-09T22:00:00.000Z") }; // 10 dec 00:00 RO
    assert.equal(mod.computeFeatureEmailSendAt(winter).toISOString(), "2026-12-07T07:00:00.000Z");
  } finally {
    restore();
  }
});

test("H2. plan: înainte de sendAt = programat; după = scadent; promovare începută / produs inactiv = fără email", async () => {
  const { restore } = await loadPureScheduler();
  const mod = await import(`./homepageFeatureScheduler.js?h2=${Math.random()}`);
  const feature = makeFeatureFixture({ ...POD_OCT_10, productId: "p1", vendorId: "vendor-1" });
  try {
    assert.equal(mod.planFeatureEmail(feature, new Date("2026-10-07T05:59:00Z")).reason, "scheduled");
    assert.equal(mod.planFeatureEmail(feature, new Date("2026-10-07T06:00:00Z")).reason, "due");
    // programată după momentul normal (ex. pe 9 oct), dar înainte de start -> imediat
    assert.equal(mod.planFeatureEmail(feature, new Date("2026-10-09T15:00:00Z")).sendNow, true);
    assert.equal(mod.planFeatureEmail(feature, new Date("2026-10-09T21:00:00Z")).reason, "started");
    const inactive = makeFeatureFixture({ ...POD_OCT_10, product: { title: "x", isActive: false } });
    assert.equal(mod.planFeatureEmail(inactive, new Date("2026-10-08T10:00:00Z")).reason, "ineligible");
    const hidden = makeFeatureFixture({ ...POD_OCT_10, product: { title: "x", isHidden: true } });
    assert.equal(mod.planFeatureEmail(hidden, new Date("2026-10-08T10:00:00Z")).reason, "ineligible");
  } finally {
    restore();
  }
});

test("H3. la creare ÎNAINTE de termen: notificare in-app imediat, emailul NU pleacă (programat)", async () => {
  const db = makeFakeHomepageFeatureDb();
  const notifyModule = makeFakeNotifyModule();
  const mailerModule = makeFakeMailerModule();
  const { notifyVendorAboutFeatureCreated, restore } = await loadSchedulerWithMocks({ db, notifyModule, mailerModule });
  try {
    const feature = makeFeatureFixture({ ...POD_OCT_10 });
    const result = await notifyVendorAboutFeatureCreated(feature, { now: new Date("2026-10-01T10:00:00Z") });

    assert.equal(result.notificationSent, true);
    assert.equal(result.emailSent, false);
    assert.equal(result.emailSkipReason, "scheduled");
    assert.equal(result.emailScheduledFor.toISOString(), "2026-10-07T06:00:00.000Z");
    assert.equal(mailerModule.calls.length, 0);
    assert.equal(result.vendorEmailedAt, null);
  } finally {
    restore();
  }
});

/* job cu DB fals (fără DB real, fără email real) */
function makeJobDb(features, emailLogs = []) {
  const rows = features.map((f) => ({ vendorEmailedAt: null, vendorEmailError: null, vendorId: "vendor-1", ...f }));
  return {
    rows,
    homepageFeature: {
      findMany: async ({ where }) =>
        rows.filter(
          (r) =>
            r.vendorEmailedAt === null &&
            r.vendorId &&
            r.startsAt > where.startsAt.gt &&
            r.startsAt <= where.startsAt.lte
        ),
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    },
    emailLog: {
      findFirst: async ({ where }) =>
        emailLogs.find((l) => l.template === where.template && l.status === where.status) || null,
      count: async ({ where }) =>
        emailLogs.filter((l) => l.template === where.template && l.status === where.status).length,
    },
  };
}

async function loadJob() {
  const mockMailer = mock.module("../lib/mailer.js", {
    namedExports: {
      homepageFeatureEmailTemplate: (id) => `homepage_feature:${id}`,
      sendHomepageFeatureSelectedEmail: async () => ({ ok: true }),
    },
  });
  const mockDb = mock.module("../db.js", { namedExports: { prisma: {} } });
  const mockNotify = mock.module("./notifications.js", {
    namedExports: { notifyVendorOnHomepageFeatureCreated: async () => null },
  });
  const mod = await import(`../jobs/homepageFeatureEmailJob.js?j=${Math.random()}`);
  return {
    runHomepageFeatureEmailJob: mod.runHomepageFeatureEmailJob,
    MAX_FAILED_ATTEMPTS: mod.MAX_FAILED_ATTEMPTS,
    restore: () => {
      mockMailer.restore();
      mockDb.restore();
      mockNotify.restore();
    },
  };
}

test("H4. job: trimite DOAR promovările scadente, o singură dată; a doua rulare nu duplică", async () => {
  const { runHomepageFeatureEmailJob, restore } = await loadJob();
  try {
    const pod = makeFeatureFixture({ ...POD_OCT_10 });
    const aow = makeFeatureFixture({ ...AOW_OCT_12, id: "aow-12", type: "ARTISAN_OF_WEEK", service: { profile: { slug: "atelier" } } });
    const db = makeJobDb([pod, aow]);
    const sent = [];
    const sendNow = async (feature) => {
      sent.push(feature.id);
      db.rows.find((r) => r.id === feature.id).vendorEmailedAt = new Date();
      return { emailSent: true };
    };

    // 7 oct 10:00 RO: Produsul zilei (10 oct) e scadent; Artizanul (12 oct) a fost scadent pe 5 oct
    const now = new Date("2026-10-07T07:00:00Z");
    const first = await runHomepageFeatureEmailJob({ now, prisma: db, sendNow });
    assert.deepEqual(sent.sort(), ["aow-12", "pod-10"]);
    assert.equal(first.sent, 2);

    const second = await runHomepageFeatureEmailJob({ now: new Date("2026-10-07T07:15:00Z"), prisma: db, sendNow });
    assert.equal(second.sent, 0);
    assert.equal(sent.length, 2, "nicio trimitere în plus");
  } finally {
    restore();
  }
});

test("H5. job: înainte de termen nu trimite; EmailLog SENT existent -> doar marchează, fără retrimitere; după 5 eșecuri -> stop", async () => {
  const { runHomepageFeatureEmailJob, MAX_FAILED_ATTEMPTS, restore } = await loadJob();
  try {
    const sent = [];
    const sendNow = async (feature) => {
      sent.push(feature.id);
      return { emailSent: false };
    };

    // înainte de 7 oct 09:00 -> nimic
    const early = makeJobDb([makeFeatureFixture({ ...POD_OCT_10 })]);
    const r1 = await runHomepageFeatureEmailJob({ now: new Date("2026-10-06T10:00:00Z"), prisma: early, sendNow });
    assert.equal(r1.notDue, 1);
    assert.equal(sent.length, 0);

    // emailul a plecat deja (EmailLog SENT), dar vendorEmailedAt n-a fost salvat
    const logged = makeJobDb(
      [makeFeatureFixture({ ...POD_OCT_10 })],
      [{ template: "homepage_feature:pod-10", status: "SENT", sentAt: new Date("2026-10-07T06:01:00Z") }]
    );
    const r2 = await runHomepageFeatureEmailJob({ now: new Date("2026-10-07T08:00:00Z"), prisma: logged, sendNow });
    assert.equal(r2.alreadyLogged, 1);
    assert.equal(sent.length, 0);
    assert.ok(logged.rows[0].vendorEmailedAt instanceof Date);

    // eșecuri repetate -> retry până la limită, apoi stop (doar manual din Admin)
    const failedLogs = Array.from({ length: MAX_FAILED_ATTEMPTS }, () => ({
      template: "homepage_feature:pod-10",
      status: "FAILED",
    }));
    const failing = makeJobDb([makeFeatureFixture({ ...POD_OCT_10 })], failedLogs);
    const r3 = await runHomepageFeatureEmailJob({ now: new Date("2026-10-07T08:00:00Z"), prisma: failing, sendNow });
    assert.equal(r3.gaveUp, 1);
    assert.equal(sent.length, 0);

    // sub limită -> se reîncearcă
    const retry = makeJobDb([makeFeatureFixture({ ...POD_OCT_10 })], failedLogs.slice(1));
    await runHomepageFeatureEmailJob({ now: new Date("2026-10-07T08:00:00Z"), prisma: retry, sendNow });
    assert.deepEqual(sent, ["pod-10"]);
  } finally {
    restore();
  }
});

test("H6. conținut: subiectele cerute, data în ora României, CTA spre produs / magazin", async () => {
  process.env.APP_URL = "https://www.artfest.ro";
  const { buildHomepageFeatureEmail } = await import(`../lib/mailer.js?h6=${Math.random()}`);

  const pod = buildHomepageFeatureEmail({
    firstName: "Ana",
    featureId: "pod-10",
    featureType: "PRODUCT_OF_DAY",
    productId: "p1",
    productTitle: "Lumânare de soia",
    ...POD_OCT_10,
  });
  assert.equal(pod.subject, "Produsul tău va fi Produsul zilei pe Artfest ✨");
  assert.match(pod.text, /^Bună, Ana,/);
  assert.match(pod.text, /„Lumânare de soia”/);
  assert.match(pod.text, /📅 Data promovării: 10 octombrie 2026/);
  assert.match(pod.text, /Vezi produsul: https:\/\/www\.artfest\.ro\/produs\/p1/);
  assert.match(pod.text, /Mulțumim că faci parte din comunitatea Artfest 🤍/);

  const aow = buildHomepageFeatureEmail({
    firstName: "Ana",
    featureId: "aow-12",
    featureType: "ARTISAN_OF_WEEK",
    storeName: "Atelier Ana",
    storeSlug: "atelier-ana",
    ...AOW_OCT_12,
  });
  assert.equal(aow.subject, "Săptămâna viitoare ești Artizanul săptămânii pe Artfest ✨");
  assert.match(aow.text, /📅 Perioada promovării: 12 octombrie 2026 – 18 octombrie 2026/);
  assert.match(aow.text, /Ai o săptămână la dispoziție pentru a pregăti magazinul\./);
  assert.match(aow.text, /Vezi magazinul meu: https:\/\/www\.artfest\.ro\/magazin\/atelier-ana/);
  assert.match(aow.text, /Ne bucurăm să te avem în comunitatea Artfest 🤍/);
  assert.doesNotMatch(pod.html + aow.html, /<script/);
});

/* =========================================================
   R. ROTAȚIE ECHILIBRATĂ (audit 2026-10-26): Produsul zilei
   vendor -> produs, Artizanul săptămânii pe magazin, cooldown
   adaptiv, fallback gradual, afișare doar dacă e eligibil, listă
   Admin pe grupe. Selecția e testată pe funcțiile PURE
   (selectProductOfDay / selectArtisanOfWeek), fără DB.
========================================================= */

async function loadSchedulerModule(db = {}) {
  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: db } }),
    mock.module("./notifications.js", {
      namedExports: { notifyVendorOnHomepageFeatureCreated: async () => null },
    }),
    mock.module("../lib/mailer.js", {
      namedExports: { sendHomepageFeatureSelectedEmail: async () => ({ ok: true }) },
    }),
  ];

  const mod = await import(`./homepageFeatureScheduler.js?r=${Date.now()}-${Math.random()}`);
  return { mod, restore: () => mocks.forEach((m) => m.restore()) };
}

// ziua N din octombrie 2026, 00:00 ora României (EEST până pe 25, apoi EET)
const roDay = (day) => getZonedDayRange(new Date(Date.UTC(2026, 9, day, 10))).startsAt;

const productsFor = (vendorId, count) =>
  Array.from({ length: count }, (_, i) => ({ id: `${vendorId}-p${i + 1}`, vendorId }));

// generează `days` zile la rând (ca generateHomepageSchedule) și întoarce selecțiile
function simulateDays(mod, { products, days, startDay = 1, history = [], artisanVendorId = null, seed = "t" }) {
  const random = mod.seededRandom(seed);
  const picks = [];

  for (let i = 0; i < days; i += 1) {
    const targetDate = roDay(startDay + i);
    const result = mod.selectProductOfDay({ products, history, targetDate, artisanVendorId, random });
    picks.push(result);
    history.push({ productId: result.product.id, vendorId: result.product.vendorId, startsAt: targetDate });
  }

  return picks;
}

const countBy = (items) => items.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());

test("R1. cooldown adaptiv: vendor min(14, n-1) zile, artizan min(26, n-1) săptămâni", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    assert.deepEqual([1, 2, 5, 15, 40].map(mod.computeVendorCooldownDays), [0, 1, 4, 14, 14]);
    assert.deepEqual([1, 2, 10, 27, 60].map(mod.computeArtisanCooldownWeeks), [0, 1, 9, 26, 26]);
  } finally {
    restore();
  }
});

test("R2. 2 vendori -> alternează zi de zi", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const picks = simulateDays(mod, { products: [...productsFor("A", 30), ...productsFor("B", 30)], days: 20 });
    const vendors = picks.map((p) => p.product.vendorId);

    for (let i = 1; i < vendors.length; i += 1) assert.notEqual(vendors[i], vendors[i - 1]);
    assert.deepEqual([...countBy(vendors).values()], [10, 10]);
    assert.ok(picks.every((p) => p.stage === "normal"));
  } finally {
    restore();
  }
});

test("R3. vendor cu 50 de produse vs vendori cu 2 -> NU domină (selecția e per vendor)", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const products = [...productsFor("BIG", 50), ...productsFor("S1", 2), ...productsFor("S2", 2)];
    const picks = simulateDays(mod, { products, days: 6 });
    const counts = Object.fromEntries(countBy(picks.map((p) => p.product.vendorId)));

    assert.deepEqual(counts, { BIG: 2, S1: 2, S2: 2 });
  } finally {
    restore();
  }
});

test("R4. același vendor nu revine în pauza de cooldown cât timp există alternativă (5 vendori, 40 de zile)", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const products = ["A", "B", "C", "D", "E"].flatMap((v, i) => productsFor(v, 10 + i * 7));
    const picks = simulateDays(mod, { products, days: 40 });
    const vendors = picks.map((p) => p.product.vendorId);

    // 5 vendori -> cooldown 4 zile: același vendor revine abia după 5 zile
    vendors.forEach((vendorId, i) => {
      assert.ok(!vendors.slice(Math.max(0, i - 4), i).includes(vendorId), `vendor ${vendorId} repetat devreme (ziua ${i})`);
    });
    assert.ok([...countBy(vendors).values()].every((n) => n === 8));
  } finally {
    restore();
  }
});

test("R5. cooldown produs 60 de zile + în interiorul vendorului: nepromovat > cel mai demult promovat", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const target = roDay(20);
    const daysBefore = (n) => new Date(target.getTime() - n * 86400000);

    // p1 promovat acum 59 de zile (în cooldown), p2 acum 61 -> p2
    let result = mod.selectProductOfDay({
      products: productsFor("A", 2),
      history: [
        { productId: "A-p1", vendorId: "A", startsAt: daysBefore(59) },
        { productId: "A-p2", vendorId: "A", startsAt: daysBefore(61) },
      ],
      targetDate: target,
    });
    assert.equal(result.product.id, "A-p2");
    assert.equal(result.stage, "normal");

    // nepromovat are prioritate față de un produs promovat acum 90 de zile
    result = mod.selectProductOfDay({
      products: productsFor("A", 3),
      history: [{ productId: "A-p2", vendorId: "A", startsAt: daysBefore(90) }],
      targetDate: target,
      random: () => 0.5,
    });
    assert.notEqual(result.product.id, "A-p2");

    // vendor cu 70 de produse, 60 de zile -> niciun produs repetat
    const picks = simulateDays(mod, { products: productsFor("A", 70), days: 60 });
    assert.equal(new Set(picks.map((p) => p.product.id)).size, 60);
  } finally {
    restore();
  }
});

test("R6. fallback gradual: un singur vendor / doar produse în cooldown -> tot există Produsul zilei", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    // un vendor, 2 produse: după epuizare se relaxează DOAR cooldown-ul produsului
    const picks = simulateDays(mod, { products: productsFor("SOLO", 2), days: 5 });
    assert.ok(picks.every((p) => p.product.vendorId === "SOLO"));
    assert.deepEqual(picks.map((p) => p.stage), [
      "normal",
      "normal",
      "relax_product_cooldown",
      "relax_product_cooldown",
      "relax_product_cooldown",
    ]);
    // la relaxare revine produsul cel mai demult promovat
    assert.equal(picks[2].product.id, picks[0].product.id);
    assert.equal(picks[3].product.id, picks[1].product.id);

    // 2 vendori, singurul produs al lui B e în cooldown -> A, deși a fost ieri (relax_vendor_cooldown)
    const result = mod.selectProductOfDay({
      products: [...productsFor("A", 3), ...productsFor("B", 1)],
      history: [
        { productId: "A-p1", vendorId: "A", startsAt: roDay(9) },
        { productId: "B-p1", vendorId: "B", startsAt: roDay(8) },
      ],
      targetDate: roDay(10),
    });
    assert.equal(result.product.vendorId, "A");
    assert.equal(result.stage, "relax_vendor_cooldown");
    assert.notEqual(result.product.id, "A-p1");

    assert.equal(mod.selectProductOfDay({ products: [], history: [], targetDate: roDay(10) }), null);
  } finally {
    restore();
  }
});

test("R7. programările VIITOARE intră în cooldown; vendorul Artizanului e evitat doar dacă există alternativă", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const products = [...productsFor("A", 5), ...productsFor("B", 5)];

    // A e deja programat MÂINE -> azi B
    let result = mod.selectProductOfDay({
      products,
      history: [{ productId: "A-p1", vendorId: "A", startsAt: roDay(11) }],
      targetDate: roDay(10),
    });
    assert.equal(result.product.vendorId, "B");

    // produs programat peste 30 de zile -> în cooldown și azi
    result = mod.selectProductOfDay({
      products: [...productsFor("A", 1), ...productsFor("B", 1)],
      history: [{ productId: "B-p1", vendorId: "B", startsAt: roDay(40) }],
      targetDate: roDay(10),
      random: () => 0.99,
    });
    assert.equal(result.product.id, "A-p1");

    result = mod.selectProductOfDay({ products, history: [], targetDate: roDay(10), artisanVendorId: "A" });
    assert.equal(result.product.vendorId, "B");

    result = mod.selectProductOfDay({ products: productsFor("A", 5), history: [], targetDate: roDay(10), artisanVendorId: "A" });
    assert.equal(result.product.vendorId, "A");
    assert.equal(result.stage, "allow_artisan_vendor");
  } finally {
    restore();
  }
});

test("R8. Artizanul săptămânii: 2 magazine alternează; 4 magazine -> pauză de 3 săptămâni; nepromovat primul", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    function simulateWeeks(services, weeks) {
      const history = [];
      const random = mod.seededRandom("w");
      const picks = [];

      for (let i = 0; i < weeks; i += 1) {
        const targetDate = getZonedWeekRange(new Date(Date.UTC(2026, 8, 7 + i * 7, 10))).startsAt;
        const { service } = mod.selectArtisanOfWeek({ services, history, targetDate, random });
        picks.push(service.id);
        history.push({ serviceId: service.id, startsAt: targetDate });
      }

      return picks;
    }

    const two = simulateWeeks([{ id: "S1" }, { id: "S2" }], 8);
    for (let i = 1; i < two.length; i += 1) assert.notEqual(two[i], two[i - 1]);

    const four = simulateWeeks([{ id: "S1" }, { id: "S2" }, { id: "S3" }, { id: "S4" }], 12);
    four.forEach((id, i) => assert.ok(!four.slice(Math.max(0, i - 3), i).includes(id)));

    const fresh = mod.selectArtisanOfWeek({
      services: [{ id: "OLD" }, { id: "NEW" }],
      history: [{ serviceId: "OLD", startsAt: roDay(1) }],
      targetDate: roDay(26),
    });
    assert.equal(fresh.service.id, "NEW");

    // un singur magazin -> tot e ales
    const solo = mod.selectArtisanOfWeek({
      services: [{ id: "S1" }],
      history: [{ serviceId: "S1", startsAt: roDay(19) }],
      targetDate: roDay(26),
    });
    assert.equal(solo.service.id, "S1");
  } finally {
    restore();
  }
});

test("R9. Europe/Bucharest + DST (25 oct 2026): ziua de 25 h, distanța în zile calendaristice rămâne corectă", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    const dstDay = getZonedDayRange(new Date("2026-10-25T10:00:00Z"));
    assert.equal(dstDay.startsAt.toISOString(), "2026-10-24T21:00:00.000Z"); // 00:00 EEST
    assert.equal(dstDay.endsAt.toISOString(), "2026-10-25T22:00:00.000Z"); // 00:00 EET (25 h)

    // A pe 25 oct (EEST), țintă 26 oct (EET): 25 h diferență, dar o singură zi -> 2 vendori alternează
    const result = mod.selectProductOfDay({
      products: [...productsFor("A", 3), ...productsFor("B", 3)],
      history: [{ productId: "A-p1", vendorId: "A", startsAt: dstDay.startsAt }],
      targetDate: dstDay.endsAt,
    });
    assert.equal(result.product.vendorId, "B");

    const picks = simulateDays(mod, { products: [...productsFor("A", 3), ...productsFor("B", 3)], days: 4, startDay: 23 });
    const vendors = picks.map((p) => p.product.vendorId);
    for (let i = 1; i < vendors.length; i += 1) assert.notEqual(vendors[i], vendors[i - 1]);
    assert.deepEqual(
      [24, 25, 26].map((d) => getZonedDayKey(roDay(d))),
      ["2026-10-24", "2026-10-25", "2026-10-26"]
    );
  } finally {
    restore();
  }
});

/* ---------- afișare pe homepage: doar dacă e încă eligibil ---------- */

const liveService = (vendorId) => ({
  id: `svc-${vendorId}`,
  vendorId,
  isActive: true,
  status: "ACTIVE",
  profile: { displayName: `Magazin ${vendorId}` },
  vendor: { id: vendorId, isActive: true },
});

const liveProduct = (id, vendorId, extra = {}) => ({
  id,
  serviceId: `svc-${vendorId}`,
  title: id,
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  availability: "READY",
  images: ["https://img/x.jpg"],
  service: liveService(vendorId),
  ...extra,
});

test("R10. isProductFeatureDisplayable: inactiv / ascuns / neaprobat / magazin sau vendor inactiv -> NU se afișează", async () => {
  const { mod, restore } = await loadSchedulerModule();
  try {
    assert.equal(mod.isProductFeatureDisplayable({ product: liveProduct("p", "A") }), true);

    for (const extra of [
      { isActive: false },
      { isHidden: true },
      { moderationStatus: "CHANGES_REQUESTED" },
      { moderationStatus: "REJECTED" },
      { availability: "SOLD_OUT" },
      { images: [] },
      { service: { ...liveService("A"), isActive: false } },
      { service: { ...liveService("A"), status: "INACTIVE" } },
      { service: { ...liveService("A"), vendor: { isActive: false } } },
    ]) {
      assert.equal(mod.isProductFeatureDisplayable({ product: liveProduct("p", "A", extra) }), false, JSON.stringify(extra));
    }

    assert.equal(mod.isProductFeatureDisplayable({ product: null }), false);
    assert.equal(mod.isArtisanFeatureDisplayable({ service: { ...liveService("A"), products: [{ id: "x" }] } }), true);
    assert.equal(mod.isArtisanFeatureDisplayable({ service: { ...liveService("A"), products: [] } }), false);
    assert.equal(
      mod.isArtisanFeatureDisplayable({ service: { ...liveService("A"), isActive: false, products: [{ id: "x" }] } }),
      false
    );
  } finally {
    restore();
  }
});

test("R11. produs dezactivat după programare -> homepage-ul afișează un înlocuitor eligibil, determinist; calendarul NU e modificat", async () => {
  const today = getZonedDayRange(new Date());
  const writes = [];
  const scheduled = {
    id: "feat-today",
    type: "PRODUCT_OF_DAY",
    dateKey: getZonedDayKey(today.startsAt),
    startsAt: today.startsAt,
    endsAt: today.endsAt,
    productId: "A-off",
    vendorId: "A",
    vendorDiscountStatus: "ACCEPTED",
    vendorDiscountPercent: 10,
    product: liveProduct("A-off", "A", { isActive: false }),
  };
  const catalog = [liveProduct("B-1", "B"), liveProduct("C-1", "C")];

  const db = {
    homepageFeature: {
      findUnique: async ({ where }) => (where.type_dateKey?.type === "PRODUCT_OF_DAY" ? scheduled : null),
      findMany: async () => [{ productId: "A-off", vendorId: "A", startsAt: today.startsAt }],
      create: async (args) => writes.push(["create", args]),
      update: async (args) => writes.push(["update", args]),
    },
    product: {
      findMany: async () =>
        catalog.map((p) => ({ id: p.id, serviceId: p.serviceId, service: { vendorId: p.service.vendorId } })),
      findUnique: async ({ where }) => catalog.find((p) => p.id === where.id) || null,
    },
  };

  const { mod, restore } = await loadSchedulerModule(db);
  try {
    const first = await mod.resolveDisplayProductFeature();
    const second = await mod.resolveDisplayProductFeature();

    assert.equal(first.replaced, true);
    assert.equal(first.originalFeatureId, "feat-today");
    assert.ok(["B-1", "C-1"].includes(first.feature.product.id));
    assert.equal(first.feature.source, "FALLBACK");
    assert.equal(first.feature.vendorDiscountStatus, "DECLINED", "fără reducerea promovării originale");
    assert.equal(second.feature.product.id, first.feature.product.id, "același înlocuitor toată ziua");
    assert.equal(writes.length, 0, "calendarul / istoricul nu se modifică");

    // produsul programat e eligibil -> se afișează el
    scheduled.product = liveProduct("A-off", "A");
    const normal = await mod.resolveDisplayProductFeature();
    assert.equal(normal.replaced, false);
    assert.equal(normal.feature.id, "feat-today");
  } finally {
    restore();
  }
});

/* ---------- Admin: active / upcoming / history corect peste 100 de rânduri ---------- */

test("R12. GET /api/admin/homepage-features: grupe separate pe tip, corecte peste 100 de rânduri", async () => {
  const DAY = 86400000;
  const rows = [];

  const add = (type, startsAt, length) =>
    rows.push({
      id: `${type}-${rows.length}`,
      type,
      startsAt: new Date(startsAt),
      endsAt: new Date(startsAt + length),
      createdAt: new Date(startsAt),
      product: type === "PRODUCT_OF_DAY" ? liveProduct(`p${rows.length}`, "A") : null,
      service: type === "ARTISAN_OF_WEEK" ? { ...liveService("A"), _count: { products: 3 } } : null,
    });

  const todayStart = getZonedDayRange(new Date()).startsAt.getTime();
  for (let i = 150; i >= 1; i -= 1) add("PRODUCT_OF_DAY", todayStart - i * DAY, DAY);
  add("PRODUCT_OF_DAY", todayStart, DAY);
  for (let i = 1; i <= 14; i += 1) add("PRODUCT_OF_DAY", todayStart + i * DAY, DAY);
  const weekStart = getZonedWeekRange(new Date()).startsAt.getTime();
  for (let i = 30; i >= 1; i -= 1) add("ARTISAN_OF_WEEK", weekStart - i * 7 * DAY, 7 * DAY);
  add("ARTISAN_OF_WEEK", weekStart, 7 * DAY);
  for (let i = 1; i <= 4; i += 1) add("ARTISAN_OF_WEEK", weekStart + i * 7 * DAY, 7 * DAY);
  // un Produs al zilei viitor, devenit neeligibil
  rows.find((r) => r.type === "PRODUCT_OF_DAY" && r.startsAt.getTime() === todayStart + 3 * DAY).product.isHidden = true;

  const cmp = (op, a, b) => (op === "lte" ? a <= b : op === "gt" ? a > b : op === "gte" ? a >= b : a < b);
  const matches = (row, where) =>
    row.type === where.type &&
    ["startsAt", "endsAt"].every((field) =>
      Object.entries(where[field] || {}).every(([op, value]) => cmp(op, row[field], value))
    );

  const db = {
    homepageFeature: {
      findMany: async ({ where, orderBy, take }) => {
        const dir = orderBy?.startsAt === "desc" ? -1 : 1;
        const list = rows.filter((r) => matches(r, where)).sort((a, b) => dir * (a.startsAt - b.startsAt));
        return take ? list.slice(0, take) : list;
      },
    },
  };

  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: db } }),
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (_req, _res, next) => next(),
        enforceTokenVersion: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
      },
    }),
    mock.module("../lib/openai.js", { namedExports: { openai: {} } }),
    mock.module("./r2Storage.js", { namedExports: { uploadToR2: async () => null } }),
    mock.module("./productOfDayTemplate.js", {
      namedExports: { composeProductOfDayImage: async () => null, buildProductOfDayBackgroundPrompt: () => "" },
    }),
    mock.module("./notifications.js", { namedExports: { notifyVendorOnHomepageFeatureCreated: async () => null } }),
    mock.module("../lib/mailer.js", { namedExports: { sendHomepageFeatureSelectedEmail: async () => ({ ok: true }) } }),
  ];

  let server;
  try {
    const router = (await import(`../routes/adminHomepageFeatureRoutes.js?a=${Math.random()}`)).default;
    const app = express();
    app.use(express.json());
    app.use("/api/admin/homepage-features", router);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));

    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/homepage-features?historyTake=30`);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));

    const pod = body.groups.PRODUCT_OF_DAY;
    const aow = body.groups.ARTISAN_OF_WEEK;
    const time = (f) => new Date(f.startsAt).getTime();

    assert.equal(rows.length, 200, "peste 100 de rânduri");
    assert.equal(pod.active.length, 1);
    assert.equal(time(pod.active[0]), todayStart);
    assert.equal(pod.upcoming.length, 14, "TOATE programările viitoare");
    assert.ok(pod.upcoming.every((f, i, all) => i === 0 || time(all[i - 1]) < time(f)), "crescător");
    assert.equal(pod.history.length, 30);
    assert.ok(pod.history.every((f, i, all) => i === 0 || time(all[i - 1]) > time(f)), "descrescător");
    assert.equal(time(pod.history[0]), todayStart - DAY, "cel mai recent trecut primul");
    assert.equal(pod.upcoming.find((f) => time(f) === todayStart + 3 * DAY).eligibleNow, false);
    assert.equal(pod.upcoming[0].eligibleNow, true);

    assert.equal(aow.active.length, 1);
    assert.equal(aow.upcoming.length, 4);
    assert.equal(aow.history.length, 30);
    assert.equal(body.features.length, 1 + 14 + 30 + 1 + 4 + 30);
  } finally {
    server?.close();
    mocks.forEach((m) => m.restore());
  }
});
