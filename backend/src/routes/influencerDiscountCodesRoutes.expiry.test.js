// Matricea ACTIVE/EXPIRED/DISABLED pentru coduri de reducere:
//   - creare cod nou: blocată dacă colaborarea nu e activă;
//   - reactivare (toggle false -> true): blocată dacă nu e activă;
//   - dezactivare (toggle true -> false): mereu permisă (acțiune
//     protectivă, nu generează atribuiri noi) - NESCHIMBATĂ de acest task.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/influencerDiscountCodesRoutes.expiry.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

const USER_ID = "user-1";

let codes = [];
let profile = null;

const fakePrisma = {
  influencerProfile: {
    async findUnique() {
      return profile;
    },
  },
  discountCode: {
    async findUnique({ where }) {
      return codes.find((c) => c.code === where.code) || null;
    },
    async findFirst({ where }) {
      return (
        codes.find(
          (c) =>
            c.id === where.id &&
            c.influencerId === where.influencerId &&
            c.ownerType === "INFLUENCER"
        ) || null
      );
    },
    async update({ where, data }) {
      const code = codes.find((c) => c.id === where.id);
      Object.assign(code, data);
      return code;
    },
    async create({ data }) {
      const created = { id: `code-${codes.length + 1}`, usedCount: 0, ...data };
      codes.push(created);
      return created;
    },
  },
};

mock.module("../db.js", { namedExports: { prisma: fakePrisma } });

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, _res, next) {
      req.user = { sub: USER_ID };
      next();
    },
    enforceTokenVersion(_req, _res, next) {
      next();
    },
    // importat de vendorDiscountCodesRoutes.js (testul de effectiveStatus de mai jos)
    requireRole() {
      return (_req, _res, next) => next();
    },
  },
});

// legal-terms gate: nu e obiectul acestui test (testat separat)
mock.module("../middleware/enforceInfluencerTermsGate.js", {
  namedExports: {
    enforceInfluencerTermsGate(_req, _res, next) {
      next();
    },
  },
});

function profileFixture(overrides = {}) {
  return {
    id: "inf-1",
    userId: USER_ID,
    displayName: "Ana",
    referralCode: "ANA1",
    status: "ACTIVE",
    createdAt: new Date(),
    commissionBps: 2000,
    collaborationEndOverride: null,
    ...overrides,
  };
}

let server;
let base;

before(async () => {
  const router = (await import("./influencerDiscountCodesRoutes.js")).default;

  const app = express();
  app.use(express.json());
  app.use("/api/influencer/discount-codes", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  codes = [];
});

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  return { status: res.status, body: await res.json().catch(() => null) };
}

const createPayload = (code) => ({
  code,
  name: "Test",
  scope: "ALL_PRODUCTS",
  discountPercent: 5,
});

test("ACTIVE: poate crea un cod nou", async () => {
  profile = profileFixture();

  const { status } = await call("POST", "/api/influencer/discount-codes", createPayload("ACTIVE1"));

  assert.equal(status, 201);
  assert.equal(codes.length, 1);
});

test("EXPIRED: NU poate crea un cod nou", async () => {
  profile = profileFixture({ createdAt: new Date("2020-01-01T00:00:00.000Z") });

  const { status, body } = await call(
    "POST",
    "/api/influencer/discount-codes",
    createPayload("EXPIRED1")
  );

  assert.equal(status, 403);
  assert.equal(body.error, "collaboration_not_active");
  assert.equal(codes.length, 0);
});

test("prelungit -> ACTIVE: poate crea din nou un cod", async () => {
  profile = profileFixture({
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    collaborationEndOverride: new Date("2099-01-01T00:00:00.000Z"),
  });

  const { status } = await call(
    "POST",
    "/api/influencer/discount-codes",
    createPayload("EXTENDED1")
  );

  assert.equal(status, 201);
});

test("DISABLED: NU poate crea un cod nou (blocat mai devreme, de requireInfluencer)", async () => {
  profile = profileFixture({ status: "DISABLED" });

  const { status, body } = await call(
    "POST",
    "/api/influencer/discount-codes",
    createPayload("DISABLED1")
  );

  assert.equal(status, 403);
  assert.equal(body.error, "influencer_disabled");
});

test("EXPIRED: NU poate reactiva un cod dezactivat", async () => {
  profile = profileFixture({ createdAt: new Date("2020-01-01T00:00:00.000Z") });
  codes = [{ id: "code-1", influencerId: "inf-1", ownerType: "INFLUENCER", isActive: false, code: "OLD1" }];

  const { status, body } = await call(
    "PATCH",
    "/api/influencer/discount-codes/code-1/toggle"
  );

  assert.equal(status, 403);
  assert.equal(body.error, "collaboration_not_active");
  assert.equal(codes[0].isActive, false);
});

test("EXPIRED: POATE dezactiva un cod activ (acțiune protectivă, neschimbată)", async () => {
  profile = profileFixture({ createdAt: new Date("2020-01-01T00:00:00.000Z") });
  codes = [{ id: "code-1", influencerId: "inf-1", ownerType: "INFLUENCER", isActive: true, code: "ACTIVE1" }];

  const { status } = await call(
    "PATCH",
    "/api/influencer/discount-codes/code-1/toggle"
  );

  assert.equal(status, 200);
  assert.equal(codes[0].isActive, false);
});

test("ACTIVE: poate reactiva un cod dezactivat", async () => {
  profile = profileFixture();
  codes = [{ id: "code-1", influencerId: "inf-1", ownerType: "INFLUENCER", isActive: false, code: "OLD1" }];

  const { status } = await call(
    "PATCH",
    "/api/influencer/discount-codes/code-1/toggle"
  );

  assert.equal(status, 200);
  assert.equal(codes[0].isActive, true);
});

/* =========================================================
   effectiveStatus (sursă unică: deriveDiscountCodeStatus) în listări:
   - serializatoarele vendor / influencer;
   - ruta admin GET /api/admin/vendor-discount-codes și filtrul de status
     (= statusul EFECTIV, nu doar isActive). Mutat din testul de audit.
========================================================= */

const DAY = 86400000;
const NOW_MS = Date.now();
const ADMIN_CODES = [
  { id: "c-active", code: "ACTIV1", startsAt: new Date(NOW_MS - DAY), endsAt: new Date(NOW_MS + DAY) },
  { id: "c-noend", code: "FARAFINAL" },
  { id: "c-expired-1", code: "EU8", startsAt: new Date(NOW_MS - 20 * DAY), endsAt: new Date(NOW_MS - 9 * DAY) },
  { id: "c-expired-2", code: "EU0", startsAt: new Date(NOW_MS - 20 * DAY), endsAt: new Date(NOW_MS - 18 * DAY) },
  { id: "c-scheduled", code: "VIITOR", startsAt: new Date(NOW_MS + 2 * DAY) },
  { id: "c-exhausted", code: "EPUIZAT", usageLimit: 3, usedCount: 3 },
  { id: "c-disabled", code: "OPRIT", isActive: false },
].map((c, i) => ({
  ownerType: "VENDOR", vendorId: "vendor-a", scope: "VENDOR_ALL_PRODUCTS", status: "ACTIVE", isActive: true,
  startsAt: null, endsAt: null, usageLimit: null, usageLimitPerUser: null, usedCount: 0, discountPercent: 10,
  discountType: "PERCENT", fundingSource: "VENDOR", platformFundingBps: 0, vendorFundingBps: 10000, currency: "RON",
  createdAt: new Date(NOW_MS - i * 1000), vendor: { id: "vendor-a", displayName: "Atelier A", city: "Cluj", isActive: true },
  _count: { redemptions: 0 }, ...c,
}));

const matchesAdmin = (row, where = {}) =>
  Object.entries(where).every(([key, cond]) => (key === "id" && cond?.in ? cond.in.includes(row.id) : cond === undefined || typeof cond === "object" || row[key] === cond));

// metode folosite DOAR de ruta admin (aditive pe același fake)
fakePrisma.discountCode.findMany = async ({ where, skip = 0, take } = {}) => {
  const rows = ADMIN_CODES.filter((r) => matchesAdmin(r, where));
  return take ? rows.slice(skip, skip + take) : rows;
};
fakePrisma.discountCode.count = async ({ where } = {}) => ADMIN_CODES.filter((r) => matchesAdmin(r, where)).length;
fakePrisma.user = { findUnique: async () => ({ id: USER_ID, role: "ADMIN" }) };
fakePrisma.shipmentItem = { findMany: async () => [] };

let adminServer;
let adminBase;

before(async () => {
  const router = (await import("./adminVendorDiscountCodesRoutes.js")).default;
  const app = express();
  app.use("/api/admin/vendor-discount-codes", router);
  adminServer = http.createServer(app);
  await new Promise((resolve) => adminServer.listen(0, "127.0.0.1", resolve));
  adminBase = `http://127.0.0.1:${adminServer.address().port}/api/admin/vendor-discount-codes`;
});

after(() => new Promise((resolve) => adminServer.close(resolve)));

async function adminList(query = "") {
  const res = await fetch(`${adminBase}${query}`);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body;
}

test("admin: effectiveStatus pe fiecare cod; isActive / status rămân în răspuns", async () => {
  const body = await adminList();
  assert.deepEqual(Object.fromEntries(body.items.map((i) => [i.code, i.effectiveStatus])), {
    ACTIV1: "ACTIVE", FARAFINAL: "ACTIVE", EU8: "EXPIRED", EU0: "EXPIRED", VIITOR: "SCHEDULED", EPUIZAT: "EXHAUSTED", OPRIT: "DISABLED",
  });
  const expired = body.items.find((i) => i.code === "EU8");
  assert.equal(expired.isActive, true);
  assert.equal(expired.status, "ACTIVE");
});

test("admin: filtrul „activ” = effectiveStatus ACTIVE; filtre programat / expirat / epuizat / inactiv; paginare pe rezultat", async () => {
  const active = await adminList("?status=active");
  assert.deepEqual(active.items.map((i) => i.code).sort(), ["ACTIV1", "FARAFINAL"]);
  assert.equal(active.total, 2);
  assert.deepEqual((await adminList("?status=expired")).items.map((i) => i.code).sort(), ["EU0", "EU8"]);
  assert.deepEqual((await adminList("?status=scheduled")).items.map((i) => i.code), ["VIITOR"]);
  assert.deepEqual((await adminList("?status=exhausted")).items.map((i) => i.code), ["EPUIZAT"]);
  assert.deepEqual((await adminList("?status=inactive")).items.map((i) => i.code), ["OPRIT"]);

  const page1 = await adminList("?status=expired&pageSize=1&page=1");
  const page2 = await adminList("?status=expired&pageSize=1&page=2");
  assert.equal(page1.total, 2);
  assert.notEqual(page1.items[0].code, page2.items[0].code);
});

test("vendor + influencer: serializatoarele întorc același effectiveStatus, fără să elimine câmpuri", async () => {
  const { serializeVendorDiscountCode } = await import("./vendorDiscountCodesRoutes.js");
  const { serializeDiscountCode } = await import("./influencerDiscountCodesRoutes.js");
  for (const row of ADMIN_CODES) {
    const vendor = serializeVendorDiscountCode(row);
    const influencer = serializeDiscountCode({ ...row, ownerType: "INFLUENCER", vendorId: null, influencerId: "inf-1" });
    assert.equal(vendor.effectiveStatus, influencer.effectiveStatus, row.code);
    assert.equal(vendor.isActive, row.isActive);
    assert.equal(influencer.isActive, row.isActive);
  }
  assert.equal(serializeVendorDiscountCode(ADMIN_CODES.find((c) => c.code === "EU8")).effectiveStatus, "EXPIRED");
});
