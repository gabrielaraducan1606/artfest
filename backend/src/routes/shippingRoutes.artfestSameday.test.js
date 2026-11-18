// /api/shipping/options și /ooh-locations cu „Sameday prin Artfest” (etapa 3):
//  - totul oprit -> răspunsul de până acum, identic, fără catalog Sameday;
//  - checkout-ul vechi pornit, Sameday prin Artfest oprit -> răspunsul de până acum;
//  - doar Sameday prin Artfest -> artfestSameday: true + metodele Sameday, fără nomenclator.
// Fără rețea (catalog simulat).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/shippingRoutes.artfestSameday.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

mock.module("../db.js", { namedExports: { prisma: {} } });
const { createShippingRouter } = await import("./shippingRoutes.js");

function catalog() {
  const calls = { getServices: 0, ooh: 0 };
  return {
    calls,
    getServices: async () => {
      calls.getServices += 1;
      return { courierAvailable: true, services: { HOME: { id: 7 }, LOCKER: { id: 15 }, PUDO: { id: 16 } } };
    },
    searchOoh: async () => {
      calls.ooh += 1;
      return { items: [], total: 0 };
    },
  };
}

async function get(router, path) {
  const app = express();
  app.use("/api/shipping", router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/shipping${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const OLD_OFF = { enabled: false, nomenclator: false, methods: [{ method: "HOME", label: "Livrare la adresă" }] };

test("totul oprit -> răspunsul vechi, identic; catalogul Sameday neatins", async () => {
  const cat = catalog();
  const res = await get(createShippingRouter({ catalog: cat, isActive: async () => false, artfestOffered: async () => false }), "/options");
  assert.deepEqual(res.body, OLD_OFF);
  assert.equal(cat.calls.getServices, 0);
  const ooh = await get(createShippingRouter({ catalog: cat, isActive: async () => false, artfestOffered: async () => false }), "/ooh-locations?type=LOCKER");
  assert.deepEqual(ooh.body, { items: [], total: 0 });
});

test("checkout vechi pornit, Sameday prin Artfest oprit -> răspunsul de până acum (fără câmp nou)", async () => {
  const res = await get(createShippingRouter({ catalog: catalog(), isActive: async () => true, artfestOffered: async () => false }), "/options");
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.nomenclator, true);
  assert.equal("artfestSameday" in res.body, false);
  assert.deepEqual(res.body.methods.map((m) => m.method), ["HOME", "LOCKER", "PUDO"]);
});

test("doar Sameday prin Artfest -> artfestSameday + metodele Sameday; checkout-ul vechi rămâne oprit", async () => {
  const res = await get(createShippingRouter({ catalog: catalog(), isActive: async () => false, artfestOffered: async () => true }), "/options");
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.nomenclator, false);
  assert.equal(res.body.artfestSameday, true);
  assert.deepEqual(res.body.methods.map((m) => m.method), ["HOME", "LOCKER", "PUDO"]);
});

test("verificarea Sameday prin Artfest eșuează -> tratat ca oprit (fail closed)", async () => {
  const res = await get(createShippingRouter({ catalog: catalog(), isActive: async () => false, artfestOffered: async () => { throw new Error("db"); } }), "/options");
  assert.deepEqual(res.body, OLD_OFF);
});
