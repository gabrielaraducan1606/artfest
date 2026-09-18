// backend/src/routes/assistant/assistantQuotesRoutes.acceptCard.test.js
//
// Teste deterministe pentru POST /api/assistant/quotes/:id/offers/:offerId/accept
// cu paymentMethod=CARD - FĂRĂ Stripe real, FĂRĂ DB real. Mocăm
// STRICT "../../../db.js" (Prisma) și "../../../api/auth.js" (doar
// ca să treacă middleware-ul) - restul e codul REAL al rutei
// (assistantQuotesRoutes.js, neatins).
//
// Acoperă scenariul H din audit: acceptarea unei oferte cu CARD
// pentru un vendor fără Stripe activ trebuie blocată ÎNAINTE de a
// crea comanda (nu doar la inițierea plății).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/assistantRoutes/assistant/assistantQuotesRoutes.acceptCard.test.js

process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5";
process.env.OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "test-key-never-called";
process.env.STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY || "sk_test_never_called";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

let quotes;
let vendors;
let server;
let baseUrl;

function makeFakeDb() {
  return {
    quoteRequest: {
      findFirst: async ({ where, include }) => {
        const quote = quotes.get(where.id);
        if (!quote || quote.userId !== where.userId) return null;

        const offerId = include?.offers?.where?.id;

        return {
          ...quote,
          offers: (quote.offers || []).filter((o) => o.id === offerId),
        };
      },
    },
    vendor: {
      findUnique: async ({ where: { id } }) => vendors.get(id) || null,
    },
  };
}

async function freshApp() {
  quotes = new Map();
  vendors = new Map();

  const moduleMockDb = mock.module("../../../db.js", {
    namedExports: { prisma: makeFakeDb() },
  });

  const moduleMockAuth = mock.module("../../../api/auth.js", {
    namedExports: {
      authRequired: (req, _res, next) => {
        req.user = { sub: "user-1" };
        next();
      },
      enforceTokenVersion: (_req, _res, next) => next(),
      optionalAuth: (_req, _res, next) => next(),
      requireRole:
        () =>
        (_req, _res, next) =>
          next(),
      signToken: () => "test-token",
    },
  });

  const mod = await import(
    `./assistantQuotesRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  return {
    router: mod.default,
    restore: () => {
      moduleMockDb.restore();
      moduleMockAuth.restore();
    },
  };
}

let restoreCurrent = null;

before(async () => {
  const { router, restore } = await freshApp();
  restoreCurrent = restore;

  const app = express();
  app.use(express.json());
  app.use("/api/assistant/quotes", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreCurrent) restoreCurrent();
});

const VALID_PF_BODY = {
  shippingAddress: {
    recipientName: "Ion Popescu",
    phone: "0712345678",
    addressLine1: "Str. Exemplu 1",
    city: "Cluj-Napoca",
    county: "CJ",
    postalCode: "400000",
  },
  customerType: "PF",
};

function seedQuote({ vendorId, offerStatus = "SENT" }) {
  quotes.set("quote-1", {
    id: "quote-1",
    userId: "user-1",
    vendorId,
    orderId: null,
    status: "PENDING",
    offers: [
      {
        id: "offer-1",
        status: offerStatus,
        validUntil: null,
        items: [],
      },
    ],
  });
}

test("H. accept ofertă CARD, vendor fără Stripe -> 400 vendor_stripe_not_active, ÎNAINTE de creare comandă", async () => {
  seedQuote({ vendorId: "vendor-a" });
  vendors.set("vendor-a", {
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
    stripeConnectStatus: "not_started",
  });

  const res = await fetch(
    `${baseUrl}/api/assistant/quotes/quote-1/offers/offer-1/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PF_BODY, paymentMethod: "CARD" }),
    }
  );
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error, "vendor_stripe_not_active");
});

test("accept ofertă CARD, vendor Stripe-ready -> NU e blocată de verificarea Stripe (trece de check-ul CARD)", async () => {
  seedQuote({ vendorId: "vendor-b" });
  vendors.set("vendor-b", {
    stripeAccountId: "acct_b",
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: "enabled",
  });

  const res = await fetch(
    `${baseUrl}/api/assistant/quotes/quote-1/offers/offer-1/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PF_BODY, paymentMethod: "CARD" }),
    }
  );
  const body = await res.json();

  // Nu se mai oprește la "vendor_stripe_not_active" - trece mai
  // departe în handler (spre crearea comenzii, care are propriile
  // dependințe neacoperite aici - nu ne interesează în acest test,
  // interesează STRICT că verificarea Stripe nu blochează fals).
  assert.notEqual(body.error, "vendor_stripe_not_active");
});

test("accept ofertă COD -> NU declanșează verificarea Stripe (vendor fără Stripe, dar COD e mereu disponibil)", async () => {
  seedQuote({ vendorId: "vendor-a" });
  vendors.set("vendor-a", {
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
    stripeConnectStatus: "not_started",
  });

  const res = await fetch(
    `${baseUrl}/api/assistant/quotes/quote-1/offers/offer-1/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PF_BODY, paymentMethod: "COD" }),
    }
  );
  const body = await res.json();

  assert.notEqual(body.error, "vendor_stripe_not_active");
});
