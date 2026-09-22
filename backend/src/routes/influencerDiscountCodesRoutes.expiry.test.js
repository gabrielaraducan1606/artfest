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
