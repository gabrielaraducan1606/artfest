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
