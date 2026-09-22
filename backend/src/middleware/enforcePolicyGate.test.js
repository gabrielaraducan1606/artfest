// enforcePolicyGate: pregătit, dar NEMONTAT. Testele verifică modurile
// (off/report/enforce), termenul-limită, documentele multiple, rutele
// exceptate și faptul că nicio rută nu îl montează încă.
//
// Rulare: node --experimental-test-module-mocks --test src/middleware/enforcePolicyGate.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFakePrisma } from "../testkit/fakePrisma.js";
import { enforcePolicyGate, resolveEnforcementMode } from "./enforcePolicyGate.js";
import { publishLegalDocumentVersion } from "../services/legalPublishService.js";
import { requestReacceptance } from "../services/reacceptanceService.js";

let fake;
let ctx;
const savedEnv = process.env.LEGAL_ENFORCEMENT;

beforeEach(() => {
  delete process.env.LEGAL_ENFORCEMENT;
  fake = createFakePrisma();

  const [u1, v1, i1, admin] = fake.seed("user", [
    { email: "u1@t.ro", role: "USER" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "i1@t.ro", role: "INFLUENCER" },
    { email: "adm@t.ro", role: "ADMIN" },
  ]);

  const [vendor1] = fake.seed("vendor", [{ userId: v1.id, displayName: "A1" }]);

  ctx = { u1, v1, i1, admin, vendor1 };
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.LEGAL_ENFORCEMENT;
  else process.env.LEGAL_ENFORCEMENT = savedEnv;
});

const publish = (catalogId) =>
  publishLegalDocumentVersion({ catalogId, version: "1.0.0", actorId: ctx.admin.id, prisma: fake });

const request = (catalogId, audience, extra = {}) =>
  requestReacceptance({ catalogId, audience, version: "1.0.0", prisma: fake, ...extra });

async function run(user, options = {}, url = "/api/vendor/products") {
  const req = { user: user ? { sub: user.id, role: user.role } : undefined, originalUrl: url };
  const headers = {};
  let status = null;
  let body = null;
  let passed = false;

  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  await enforcePolicyGate({ prisma: fake, ...options })(req, res, () => {
    passed = true;
  });

  return { passed, status, body, headers, req };
}

test("mod implicit = report; valori invalide cad pe report", () => {
  assert.equal(resolveEnforcementMode(), "report");
  assert.equal(resolveEnforcementMode("ENFORCE"), "enforce");
  assert.equal(resolveEnforcementMode("off"), "off");
  assert.equal(resolveEnforcementMode("nonsense"), "report");

  process.env.LEGAL_ENFORCEMENT = "enforce";
  assert.equal(resolveEnforcementMode(), "enforce");
});

test("fără cereri deschise nu blochează nimic, în niciun mod (publicarea nu blochează)", async () => {
  await publish("TOS");
  await publish("VENDOR_TERMS");

  for (const mode of ["off", "report", "enforce"]) {
    assert.equal((await run(ctx.u1, { mode })).passed, true);
    assert.equal((await run(ctx.v1, { mode })).passed, true);
  }
});

test("report (implicit): NU blochează, dar marchează și loghează ce ar fi blocat", async () => {
  await publish("TOS");
  await request("TOS", "USER");

  const logged = [];
  const original = console.warn;
  console.warn = (...args) => logged.push(args.join(" "));

  try {
    const result = await run(ctx.u1);

    assert.equal(result.passed, true);
    assert.equal(result.status, null);
    assert.equal(result.headers["X-Policy-Gate"], "would-block");
    assert.equal(result.req.policyGate.missing[0].catalogId, "TOS");
  } finally {
    console.warn = original;
  }

  assert.equal(logged.length, 1);
  assert.match(logged[0], /policy-gate:report/);
  assert.match(logged[0], /TOS@1\.0\.0/);
});

test("off: nu face nimic, nici măcar interogări", async () => {
  await publish("TOS");
  await request("TOS", "USER");

  const result = await run(ctx.u1, { mode: "off" });

  assert.equal(result.passed, true);
  assert.equal(result.headers["X-Policy-Gate"], undefined);
  assert.equal(result.req.policyGate, undefined);
});

test("enforce: 428 cu documentele lipsă (multiple), doar pentru audience-ul contului", async () => {
  await publish("TOS");
  await publish("PRIVACY");
  await publish("RETURNS_POLICY_ACK@USER");
  await request("TOS", "USER");
  await request("PRIVACY", "USER");
  await request("RETURNS_POLICY_ACK@USER", "USER");

  const blocked = await run(ctx.u1, { mode: "enforce" });

  assert.equal(blocked.passed, false);
  assert.equal(blocked.status, 428);
  assert.equal(blocked.body.error, "policy_acceptance_required");
  assert.deepEqual(blocked.body.missing.map((m) => m.key).sort(), ["PRIVACY", "RETURNS_POLICY_ACK", "TOS"]);

  // vendorul și influencerul nu sunt vizați de cererile pe audience USER
  assert.equal((await run(ctx.v1, { mode: "enforce" })).passed, true);
  assert.equal((await run(ctx.i1, { mode: "enforce" })).passed, true);
  assert.equal((await run(ctx.admin, { mode: "enforce" })).passed, true);

  // după acceptare trece
  fake.seed("userConsent", [
    { userId: ctx.u1.id, document: "TOS", version: "1.0.0" },
    { userId: ctx.u1.id, document: "PRIVACY_ACK", version: "1.0.0" },
    { userId: ctx.u1.id, document: "RETURNS_POLICY_ACK", version: "1.0.0" },
  ]);

  assert.equal((await run(ctx.u1, { mode: "enforce" })).passed, true);
});

test("enforce pe scope VENDORS: doar documentele per vendor; Returns@VENDOR separat de USER", async () => {
  await publish("TOS");
  await publish("VENDOR_TERMS");
  await publish("RETURNS_POLICY_ACK@VENDOR");
  await request("TOS", "VENDOR");
  await request("VENDOR_TERMS", "VENDOR");
  await request("RETURNS_POLICY_ACK@VENDOR", "VENDOR");

  const vendorsScope = await run(ctx.v1, { mode: "enforce", scope: "VENDORS" });
  assert.equal(vendorsScope.status, 428);
  assert.deepEqual(vendorsScope.body.missing.map((m) => m.catalogId).sort(), [
    "RETURNS_POLICY_ACK@VENDOR",
    "VENDOR_TERMS",
  ]);

  const usersScope = await run(ctx.v1, { mode: "enforce", scope: "USERS" });
  assert.deepEqual(usersScope.body.missing.map((m) => m.catalogId), ["TOS"]);

  const all = await run(ctx.v1, { mode: "enforce", scope: "ALL" });
  assert.equal(all.body.missing.length, 3);

  // string compatibil cu apelul vechi enforcePolicyGate("VENDORS")
  const legacyStyle = await run(ctx.v1, { mode: "enforce", scope: undefined });
  assert.equal(legacyStyle.status, 428);
});

test("termenul-limită: înainte de deadline nu blochează, după da", async () => {
  await publish("TOS");
  await request("TOS", "USER", { deadlineAt: "2099-01-01T00:00:00.000Z" });

  assert.equal((await run(ctx.u1, { mode: "enforce" })).passed, true);

  const late = await run(ctx.u1, { mode: "enforce", now: () => new Date("2100-01-01T00:00:00Z") });
  assert.equal(late.status, 428);
  assert.equal(late.body.missing[0].deadlineAt !== null, true);
});

test("INFLUENCER_TERMS nu e tratat de acest middleware (îl ține modalul dedicat)", async () => {
  await publish("INFLUENCER_TERMS");
  await request("INFLUENCER_TERMS", "INFLUENCER");

  assert.equal((await run(ctx.i1, { mode: "enforce" })).passed, true);

  // dar TOS pe audience INFLUENCER îl blochează pe influencer
  await publish("TOS");
  await request("TOS", "INFLUENCER");

  const blocked = await run(ctx.i1, { mode: "enforce" });
  assert.equal(blocked.status, 428);
  assert.deepEqual(blocked.body.missing.map((m) => m.key), ["TOS"]);
});

test("rute exceptate + neautentificat + erori", async () => {
  await publish("TOS");
  await request("TOS", "USER");

  for (const url of [
    "/api/policy-gate?scope=USERS",
    "/api/policy-gate/accept",
    "/api/legal/vendor-accept",
    "/legal/tos.html",
    "/api/auth/login",
    "/api/influencer/terms/accept",
  ]) {
    assert.equal((await run(ctx.u1, { mode: "enforce" }, url)).passed, true, url);
  }

  assert.equal((await run(null, { mode: "enforce" })).status, 401);

  const broken = { getPendingDocuments: async () => { throw new Error("db down"); } };
  const original = console.error;
  console.error = () => {};

  try {
    // în report nu stricăm cererea; în enforce e eroare 500
    assert.equal((await run(ctx.u1, { mode: "report", ...broken })).passed, true);
    assert.equal((await run(ctx.u1, { mode: "enforce", ...broken })).status, 500);
  } finally {
    console.error = original;
  }
});

test("NEMONTAT: nicio rută/serverul nu apelează enforcePolicyGate(...) activ", () => {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) files.push(full);
    }
  })(path.join(backendRoot, "src"));

  files.push(path.join(backendRoot, "server.js"));

  const offenders = [];

  for (const file of files) {
    if (file.endsWith(path.join("middleware", "enforcePolicyGate.js"))) continue;

    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const code = line.trim();

        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (/enforcePolicyGate\s*\(/.test(code)) offenders.push(`${file}:${index + 1}`);
      });
  }

  assert.deepEqual(offenders, []);
});
