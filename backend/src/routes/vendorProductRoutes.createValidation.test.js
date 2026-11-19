// src/routes/vendorProductRoutes.createValidation.test.js
//
// Ruta REALĂ POST /api/vendors/store/:slug/products, cu Prisma simulat (fără DB,
// fără rețea). Validările rulează până la tranzacție; tranzacția doar numără
// produsele „care ar fi fost create”.
//
//  1. Orice 400 de validare are `message` (și `field` când e un câmp): Smart Listing
//     afișa „Unele date nu sunt valide. Verifică formularul.” fără câmp la codurile
//     fără mesaj (invalid_additional_category, invalid_lead_time, ...).
//  2. Contract Smart Listing: payload-ul construit de formular (buildDraftForm +
//     buildCreatePayload) pentru o ciornă „gata de publicare” trece validarea
//     serverului - inclusiv ciorne vechi cu o categorie suplimentară inexistentă.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorProductRoutes.createValidation.test.js

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5/x";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { CATEGORIES_DETAILED } from "../constants/categories.js";
import { CURRENT_GPSR_NOTICE_VERSION } from "../lib/gpsrNoticeVersions.js";

const KEYS = CATEGORIES_DETAILED.map((c) => c.key);

let server;
let baseUrl;
let created = 0;
const restores = [];

const model = (overrides = {}) => new Proxy(overrides, { get: (t, k) => (k in t ? t[k] : async () => null) });
const prisma = new Proxy(
  {
    serviceProfile: model({
      findUnique: async () => ({
        slug: "magazin-test",
        service: { id: "svc-1", vendorId: "v-1", type: { code: "products" }, vendor: { id: "v-1", userId: "u-1" }, profile: {} },
      }),
    }),
    product: model({ count: async () => 0, findMany: async () => [] }),
    $transaction: async () => {
      created += 1;
      throw new Error("TEST_STOP_BEFORE_WRITE");
    },
  },
  { get: (t, k) => (k in t ? t[k] : model()) }
);

const IMG = "https://pub.example.r2.dev/products/u-1/a.jpg";

before(async () => {
  restores.push(mock.module("../db.js", { namedExports: { prisma } }));
  restores.push(
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, _res, next) => {
          req.user = { sub: "u-1", role: "VENDOR" };
          next();
        },
        optionalAuth: (_req, _res, next) => next(),
        enforceTokenVersion: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
        signToken: () => "token",
      },
    })
  );
  restores.push(mock.module("../middleware/vendorAccessRequired.js", { namedExports: { vendorAccessRequired: (_q, _s, next) => next() } }));
  restores.push(mock.module("../lib/openai.js", { namedExports: { openai: {} } }));
  const images = await import("../lib/productImageUrls.js?real");
  restores.push(mock.module("../lib/productImageUrls.js", { namedExports: { ...images, enforceVendorProductImageUrls: async () => true } }));
  const mode = await import("../services/shipping/checkoutMode.js?real");
  restores.push(mock.module("../services/shipping/checkoutMode.js", { namedExports: { ...mode, isSamedayCheckoutActive: async () => false } }));

  const { default: router } = await import("./vendorProductRoutes.js");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restores.forEach((r) => r.restore());
});

async function post(payload) {
  const before = created;
  const silence = mock.method(console, "error", () => {});
  const info = mock.method(console, "info", () => {});
  try {
    const res = await fetch(`${baseUrl}/api/vendors/store/magazin-test/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null), accepted: created > before };
  } finally {
    silence.mock.restore();
    info.mock.restore();
  }
}

const valid = (patch = {}) => ({
  title: "Cană pictată manual",
  description: "Cană din ceramică pictată manual.",
  price: 45,
  images: [IMG],
  category: KEYS[0],
  orderMode: "READY_TO_BUY",
  availability: "READY",
  readyQty: 3,
  isOwnManufacturer: true,
  safetyWarnings: "",
  isForChildren: false,
  gpsrConfirmation: { accepted: true, noticeVersion: CURRENT_GPSR_NOTICE_VERSION, source: "smart_listing" },
  ...patch,
});

test("payload valid -> validarea trece (ajunge la tranzacție)", async () => {
  const r = await post(valid());
  assert.equal(r.accepted, true, JSON.stringify(r.body));
});

const INVALID = [
  ["invalid_title", { title: "   " }, "title"],
  ["invalid_category", { category: "categorie_inexistenta" }, "category"],
  ["invalid_additional_category", { additionalCategories: ["categorie_veche"] }, "additionalCategories"],
  ["too_many_additional_categories", { additionalCategories: KEYS.slice(1, 5) }, "additionalCategories"],
  ["invalid_additional_categories", { additionalCategories: KEYS[1] }, "additionalCategories"],
  ["invalid_availability", { availability: "ALTCEVA" }, "availability"],
  ["invalid_lead_time", { availability: "MADE_TO_ORDER", leadTimeDays: 0, orderMode: "OPTIONS" }, "leadTimeDays"],
  ["invalid_ready_qty", { readyQty: -2 }, "readyQty"],
  ["invalid_next_ship_date", { availability: "PREORDER", nextShipDate: "nu-e-data" }, "nextShipDate"],
  ["invalid_order_mode", { orderMode: "ALTUL" }, "orderMode"],
];

for (const [code, patch, field] of INVALID) {
  test(`400 ${code}: are message și field`, async () => {
    const r = await post(valid(patch));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, code);
    assert.equal(typeof r.body.message, "string");
    assert.ok(r.body.message.length > 5, r.body.message);
    assert.equal(r.body.field, field);
    assert.equal(r.accepted, false);
  });
}

test("codul și detaliul existente rămân neschimbate (compatibilitate)", async () => {
  const r = await post(valid({ additionalCategories: ["categorie_veche"] }));
  assert.deepEqual(
    { error: r.body.error, detail: r.body.detail },
    { error: "invalid_additional_category", detail: "categorie_veche" }
  );
});

/* ---------------- contract Smart Listing (formularul real -> serverul real) ---------------- */

const FRONT = "../../../frontend/src/";

async function smartListing() {
  const { buildDraftForm, evaluatePublishGate } = await import(`${FRONT}features/smartListing/smartListingConfig.js`);
  const { buildCreatePayload } = await import(`${FRONT}features/smartListing/smartListingSave.js`);
  const { checkProductForPublish } = await import(`${FRONT}utils/productPublishCheck.js`);
  const known = KEYS;
  const vendorGpsr = { gpsrManufacturerName: "Atelier Test", gpsrManufacturerAddress: "Str. Lungă 1, Cluj-Napoca", gpsrManufacturerEmail: "atelier@exemplu.ro" };
  return (state) => {
    const draft = buildDraftForm(state);
    const check = checkProductForPublish(draft.form, { knownCategories: known, vendorGpsr, isNewProduct: true, samedayShipping: false });
    const gate = evaluatePublishGate({ check, draftErrors: draft.errors });
    return { gate, payload: buildCreatePayload({ ...draft.form, gpsrConfirmed: true, gpsrConfirmationSource: "smart_listing" }) };
  };
}

const slState = (patch = {}) => ({
  details: { title: "Lumânare parfumată", description: "Lumânare din ceară de soia, turnată manual.", category: KEYS[0] },
  images: [IMG],
  commerce: { saleType: "IN_STOCK", price: "45", stock: "3" },
  variants: [],
  customFields: [],
  safety: { isOwnManufacturer: true, safetyWarnings: "", isForChildren: false },
  ...patch,
});

const CONTRACT = {
  "fără variante": slState(),
  "cu variante": slState({
    commerce: { saleType: "WITH_OPTIONS", price: "45", leadTimeDays: "5" },
    variants: [{ label: "Parfum", values: [{ label: "Lavandă" }, { label: "Vanilie", deltaLei: "5" }] }],
  }),
  "cu personalizare": slState({
    commerce: { saleType: "WITH_OPTIONS", price: "45", leadTimeDays: "5" },
    customFields: [{ label: "Nume pe etichetă", type: "text", required: true }],
  }),
  "cerere de ofertă": slState({ commerce: { saleType: "QUOTE", price: "100", leadTimeDays: "10" } }),
  "ciornă veche: categorie suplimentară inexistentă": slState({
    details: {
      title: "Lumânare parfumată",
      description: "Lumânare din ceară de soia, turnată manual.",
      category: KEYS[0],
      additionalCategories: ["categorie_veche", KEYS[0]],
    },
  }),
};

for (const [name, state] of Object.entries(CONTRACT)) {
  test(`Smart Listing „${name}”: gata de publicare => serverul acceptă payload-ul`, async () => {
    const build = await smartListing();
    const { gate, payload } = build(state);
    assert.equal(gate.ready, true, JSON.stringify(gate.blockers));
    const r = await post(payload);
    assert.equal(r.accepted, true, `${r.status} ${JSON.stringify(r.body)}`);
  });
}
