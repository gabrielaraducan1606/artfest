// Târgul Artfest - regulamentul 2.0.0 (FAIR_PRICE) cu O SINGURĂ regulă financiară: comision 10%
// din prețul efectiv, vendorul primește 90%. Cap-coadă: preț declarat -> sugestie (declarat / 0,90)
// -> preț final Admin -> etichetă -> scanare -> preț introdus la casă -> încasare -> stoc -> retur
// -> contul vendorului -> totaluri Admin -> decont. Plus: regula 1.x neatinsă, dublu click,
// acceptarea explicită (eligibilitate, o singură dată, doar vânzările ulterioare).
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairPricing.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const renderedHtml = [];

mock.module("../db.js", {
  namedExports: { prisma: new Proxy({}, { get: (_t, key) => fake[key] }) },
});

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, res, next) {
      const sub = req.headers["x-test-user"];
      if (!sub) return res.status(401).json({ error: "unauthorized" });
      req.user = { sub };
      next();
    },
  },
});

mock.module("../services/r2Storage.js", {
  namedExports: { buildPublicUrl: (key) => `https://cdn.test/${key}`, async uploadToR2() { return { url: "https://cdn.test/x.jpg" }; } },
});

mock.module("../lib/pdfBrowser.js", {
  namedExports: {
    async renderPdfWithSharedBrowser(html) {
      renderedHtml.push(html);
      return Buffer.from("%PDF-test");
    },
  },
});

// registrul documentelor publicate: funcțiile REALE, cu lista de versiuni controlată de test
// (versions.yml din repo nu se modifică; implicit = registrul real, fără versiunea nouă)
const realRules = await import("../lib/artfestFairRules.js?real");
let publishedOverride = null; // null = registrul real
const publishedList = () => publishedOverride ?? realRules.listPublishedFairRules();
mock.module("../lib/artfestFairRules.js", {
  namedExports: {
    ...realRules,
    listPublishedFairRules: publishedList,
    latestFairPriceRulesVersion: (list = publishedList()) => realRules.latestFairPriceRulesVersion(list),
    isFairRulesVersionPublished: (v) => publishedList().some((e) => e.version === realRules.normalizeFairRulesVersion(v)),
    loadPublishedFairRules: (v) =>
      publishedList().some((e) => e.version === v)
        ? { version: v, title: "Regulament test", html: `<h2>Regulament ${v}</h2>`, publishedAt: "2026-12-01", publicPath: realRules.fairRulesPublicPath(v) }
        : null,
  },
});
const PUBLISHED_WITH_FAIR_PRICE = [
  { version: "1.0.0", path: "artfest_fair_rules/v1.0.0.md", vars: 1, publishedAt: "2026-10-19", pricingModel: null },
  { version: "1.1.0", path: "artfest_fair_rules/v1.1.0.md", vars: 1, publishedAt: "2026-10-19", pricingModel: null },
  { version: "2.0.0", path: "artfest_fair_rules/v2.0.0.md", vars: 1, publishedAt: "2026-12-01", pricingModel: "FAIR_PRICE" },
];

const DAY = 24 * 60 * 60 * 1000;
let server;
let base;
let ctx;
let inventory;
let pricing;
let labels;
let reports;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  pricing = await import("../lib/artfestFairPricing.js");
  labels = await import("../lib/fairLabels.js");
  reports = await import("../services/artfestFairReportsService.js");
  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
  app.use("/api/vendor/artfest-fair", vendorRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function product(serviceId, extra) {
  return {
    serviceId, title: "Produs", images: ["https://img/1.jpg"], priceCents: 3900, currency: "RON",
    isActive: true, isHidden: false, moderationStatus: "APPROVED", orderMode: "DIRECT",
    availability: "READY", readyQty: null, optionsSchema: [], limitedEditionOf: null, limitedEditionNumber: null,
    ...extra,
  };
}

// linie recepționată (ca după recepția reală); eticheta doar dacă e cerută
function receivedLine(line, qty, { label = false } = {}) {
  const row = fake.tables.artfestFairInventoryItem.find((l) => l.id === line.id);
  Object.assign(row, { status: "RECEIVED", receivedQty: qty, availableQty: qty, receivedAt: new Date() });
  if (label) Object.assign(row, { labelGeneratedAt: new Date(), labelPriceCents: row.priceSnapshotCents });
  return row;
}

beforeEach(async () => {
  fake = createFakePrisma();
  renderedHtml.length = 0;
  const [admin, u1, u2] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
  ]);
  const [vendor1, vendor2] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelier Ana" },
    { userId: u2.id, displayName: "Ceramica Ion" },
  ]);
  const [s1, s2] = fake.seed("vendorService", [
    { vendorId: vendor1.id, title: "S1" },
    { vendorId: vendor2.id, title: "S2" },
  ]);
  const [fair] = fake.seed("artfestFair", [
    {
      key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000,
      inventoryDeadlineAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 9 * DAY),
    },
  ]);
  const [r1, r2] = fake.seed("artfestFairRegistration", [
    { fairId: fair.id, vendorId: vendor1.id, submittedByUserId: u1.id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" },
    { fairId: fair.id, vendorId: vendor2.id, submittedByUserId: u2.id, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" },
  ]);
  const [pA, pC] = fake.seed("product", [
    product(s1.id, { title: "Spiriduș", priceCents: 3900, readyQty: 10 }),
    product(s2.id, { title: "Cană", priceCents: 4550, readyQty: 10 }),
  ]);

  const a = await inventory.addInventoryItem({ vendorId: vendor1.id, userId: u1.id, body: { productId: pA.id, declaredQty: 3 } });
  await inventory.submitInventory({ vendorId: vendor1.id, userId: u1.id });
  const c = await inventory.addInventoryItem({ vendorId: vendor2.id, userId: u2.id, body: { productId: pC.id, declaredQty: 2 } });
  await inventory.submitInventory({ vendorId: vendor2.id, userId: u2.id });

  ctx = { admin, u1, u2, vendor1, vendor2, fair, r1, r2, pA, pC };
  ctx.lA = receivedLine(a, 3);
  // vendorul 2 rămâne pe regula veche (COMMISSION), cu etichetă validă
  ctx.lC = receivedLine(c, 2, { label: true });
});

let seq = 0;
const newKey = () => `vp-key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function call(method, path, { as, body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

const ADMIN = "/api/admin/artfest-fair";
const POS = `${ADMIN}/pos`;
const item = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const saleLines = () => fake.tables.artfestFairSaleLine;
const asAdmin = (method, path, opts = {}) => call(method, path, { as: ctx.admin, ...opts });
const sell = (lines, key = newKey(), paymentMethod = "CASH") => asAdmin("POST", `${POS}/sales`, { key, body: { lines, paymentMethod } });
const preview = (lines) => asAdmin("POST", `${POS}/preview`, { body: { lines } });
const setFinal = (id, finalPriceCents) => asAdmin("POST", `${ADMIN}/inventory/${id}/final-price`, { body: { finalPriceCents } });
const printLabel = (id) => asAdmin("GET", `${ADMIN}/inventory/${id}/label.pdf`);

// vendorul 1 a acceptat regulamentul 2.0.0 (în producție: doar prin acceptarea explicită din modal)
function acceptFairPrice(registration = ctx.r1) {
  Object.assign(fake.tables.artfestFairRegistration.find((r) => r.id === registration.id), {
    pricingModel: "FAIR_PRICE",
    pricingModelAcceptedAt: new Date(),
    pricingModelTermsVersion: "2.0.0",
    pricingModelAcceptedById: ctx.u1.id, // CHECK AFR_pricing_model_acceptance_chk
  });
}

// prețul sugerat pentru 39,00 lei declarați = 43,33 lei (Artfest 4,33, vendorul 39,00)
async function readyFairPriceLine(finalPriceCents = 4333) {
  acceptFairPrice();
  assert.equal((await setFinal(ctx.lA.id, finalPriceCents)).status, 200);
  assert.equal((await printLabel(ctx.lA.id)).status, 200);
}

const tenPercent = (gross) => Math.floor((2 * gross * 1000 + 10000) / 20000); // round_half_up(gross × 10%)

/*
 * Constrângerile CHECK din baza de date (migrațiile POS + 20261123120000),
 * verificate pe fiecare linie scrisă: fake-ul nu le aplică singur.
 */
function assertDbChecks() {
  for (const l of saleLines()) {
    const msg = JSON.stringify(l);
    assert.ok(l.quantity >= 1 && l.listUnitPriceCents > 0, `AFSL_quantity ${msg}`);
    assert.equal(l.lineListCents, l.listUnitPriceCents * l.quantity, `AFSL_lineList ${msg}`);
    assert.ok(l.lineDiscountCents >= 0 && l.lineDiscountCents <= l.lineListCents, `AFSL_discount ${msg}`);
    assert.equal(l.lineGrossCents, l.lineListCents - l.lineDiscountCents, `AFSL_lineGross ${msg}`);
    assert.ok(l.effectiveUnitPriceCents >= 0 && l.effectiveUnitPriceCents <= l.listUnitPriceCents, `AFSL_effectiveUnit ${msg}`);
    assert.ok(l.commissionBps >= 0 && l.commissionBps <= 10000 && l.commissionCents >= 0 && l.commissionCents <= l.lineGrossCents, `AFSL_commission ${msg}`);
    assert.ok(l.commissionOnListCents >= 0 && l.commissionOnListCents <= l.lineListCents && l.commissionCents <= l.commissionOnListCents, `AFSL_commissionOnList ${msg}`);
    assert.ok(l.artfestFundedDiscountCents >= 0 && l.artfestFundedDiscountCents <= l.lineDiscountCents, `AFSL_artfestFunded ${msg}`);
    assert.equal(l.vendorNetCents, l.lineGrossCents - l.commissionCents + l.artfestFundedDiscountCents, `AFSL_vendorNet ${msg}`);
    assert.ok(l.vendorNetCents <= l.lineListCents - l.commissionOnListCents, `AFSL_vendorNet_cap ${msg}`);
    // regula unică: comisionul de 10% din prețul efectiv, pentru ambele modele
    assert.equal(l.commissionBps, 1000, `comision 10% ${msg}`);
    // la târg: niciodată finanțare Artfest; comisionul = exact 10% din prețul efectiv, vendorul restul
    assert.equal(l.artfestFundedDiscountCents, 0, `fără finanțare Artfest ${msg}`);
    assert.equal(l.commissionCents, tenPercent(l.lineGrossCents), `10% din efectiv ${msg}`);
    if (l.pricingModel === "FAIR_PRICE") {
      assert.ok(l.vendorBaseUnitPriceCents > 0, `AFSL_pricing_model ${msg}`);
    } else {
      assert.equal(l.pricingModel, "COMMISSION");
      assert.equal(l.vendorBaseUnitPriceCents, null);
      assert.equal(l.priceSetManually, false);
    }
  }
  for (const rl of fake.tables.artfestFairSaleReturnLine) {
    assert.ok(rl.commissionReversedCents >= 0 && rl.commissionReversedCents <= rl.refundCents, "AFSRL_amounts");
    assert.equal(rl.vendorNetReversedCents, rl.refundCents - rl.commissionReversedCents + (rl.artfestFundedReversedCents || 0), "AFSRL_vendorNet");
  }
}

/* ============================== calcul pur ============================== */

test("prețul sugerat = declarat / 0,90, în bani, consecvent cu comisionul din POS (minimul pentru care vendorul primește prețul declarat)", () => {
  assert.equal(pricing.suggestedFinalPriceCents(10000, 1000), 11111); // Artfest 11,11 / vendor 100,00
  assert.equal(pricing.suggestedFinalPriceCents(3900, 1000), 4333);
  for (const v of [1, 1999, 3900, 4550, 12345, 99999]) {
    const s = pricing.suggestedFinalPriceCents(v, 1000);
    assert.ok(pricing.splitGross(s, 1000).vendorNetCents >= v, `vendorul primește cel puțin ${v}`);
    assert.ok(pricing.splitGross(s - 1, 1000).vendorNetCents < v, `${s} e minimul`);
  }
  assert.deepEqual(pricing.splitGross(10000, 1000), { commissionCents: 1000, vendorNetCents: 9000 });
  assert.equal(pricing.suggestedFinalPriceCents(0, 1000), null);
});

/* ============================== regula 1.x neatinsă ============================== */

test("regula 1.x (COMMISSION): prețul nu se introduce la casă, comision 10% ca înainte", async () => {
  const edit = await preview([{ inventoryItemId: ctx.lC.id, quantity: 1, effectiveUnitPriceCents: 4000 }]);
  assert.equal(edit.body.canConfirm, false);
  assert.deepEqual(edit.body.problems[0].reasons, ["price_edit_not_allowed"]);

  const s = await sell([{ inventoryItemId: ctx.lC.id, quantity: 1 }]);
  assert.equal(s.status, 201, s.text);
  const l = s.body.sale.lines[0];
  assert.equal(l.pricingModel, "COMMISSION");
  assert.equal(l.lineGrossCents, 4550);
  assert.equal(l.commissionCents, 455);
  assert.equal(l.vendorNetCents, 4095);
  assert.equal(l.vendorBaseUnitPriceCents, null);
  assertDbChecks();
});

/* ============================== preț final + etichetă ============================== */

test("Admin: prețul declarat, sugestia declarat / 0,90, prețul final și împărțirea 10% / 90%; eticheta are prețul final și codul liniei", async () => {
  acceptFairPrice();
  const list = await asAdmin("GET", `${ADMIN}/inventory?filter=all`);
  const row = list.body.items.find((i) => i.id === ctx.lA.id);
  assert.equal(row.pricing.model, "FAIR_PRICE");
  assert.equal(row.pricing.vendorPriceCents, 3900);
  assert.equal(row.pricing.suggestedFinalPriceCents, 4333);
  assert.equal(row.pricing.finalPriceCents, null);
  assert.deepEqual(row.pricing.issues, ["final_price_missing"]);
  const old = list.body.items.find((i) => i.id === ctx.lC.id);
  assert.equal(old.pricing.model, "COMMISSION");
  assert.equal(old.pricing.ruleAccepted, false);

  const blocked = await printLabel(ctx.lA.id);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "final_price_missing");

  const ok = await setFinal(ctx.lA.id, 4333);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.item.pricing.finalPriceCents, 4333);
  assert.equal(ok.body.item.pricing.commissionCents, 433);
  assert.equal(ok.body.item.pricing.vendorNetCents, 3900);
  assert.equal(ok.body.labelReprintNeeded, false);
  // prețul online și prețul declarat rămân neatinse
  assert.equal(fake.tables.product.find((p) => p.id === ctx.pA.id).priceCents, 3900);
  assert.equal(item(ctx.lA.id).priceSnapshotCents, 3900);
  const event = fake.tables.artfestFairInventoryEvent.find((e) => e.type === "FINAL_PRICE_SET");
  assert.deepEqual(event.after, { finalPriceCents: 4333, vendorPriceCents: 3900 });

  assert.equal((await printLabel(ctx.lA.id)).status, 200);
  assert.equal(item(ctx.lA.id).labelPriceCents, 4333);
  const html = renderedHtml.at(-1);
  assert.ok(html.includes(labels.formatLabelPrice(4333)), "prețul final pe etichetă");
  assert.ok(html.includes(labels.formatLabelCode(item(ctx.lA.id).barcode)), "codul liniei pe etichetă");

  // un preț final sub cel sugerat e permis: vendorul primește 90% din el (Admin vede suma)
  const low = await setFinal(ctx.lA.id, 4000);
  assert.equal(low.status, 200);
  assert.equal(low.body.item.pricing.vendorNetCents, 3600);
});

/* ============================== scanare + vânzare ============================== */

test("scanarea: produs + vendor + preț declarat / sugerat / final + 10% / 90%; NU înregistrează vânzarea", async () => {
  await readyFairPriceLine();
  const res = await asAdmin("GET", `${POS}/scan?barcode=${item(ctx.lA.id).barcode}`);
  assert.equal(res.status, 200, res.text);
  const s = res.body.item;
  assert.equal(s.inventoryItemId, ctx.lA.id);
  assert.equal(s.vendor.id, ctx.vendor1.id);
  assert.equal(s.pricingModel, "FAIR_PRICE");
  assert.equal(s.vendorPriceCents, 3900);
  assert.equal(s.suggestedPriceCents, 4333);
  assert.equal(s.labelPriceCents, 4333);
  assert.equal(s.salePriceCents, 4333);
  assert.equal(s.artfestUnitCents, 433);
  assert.equal(s.vendorUnitCents, 3900);
  assert.equal(s.canEditPrice, true);
  assert.equal(s.sellable, true);
  assert.equal(fake.tables.artfestFairSale.length, 0);
  assert.equal(item(ctx.lA.id).availableQty, 3);
});

test("preț normal: o vânzare, comision 10% / vendor 90% salvate pe linie, stocul scade", async () => {
  await readyFairPriceLine();
  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(s.status, 201, s.text);
  const l = s.body.sale.lines[0];
  assert.equal(l.pricingModel, "FAIR_PRICE");
  assert.equal(l.listUnitPriceCents, 4333);
  assert.equal(l.lineGrossCents, 4333);
  assert.equal(l.commissionBps, 1000);
  assert.equal(l.commissionCents, 433);
  assert.equal(l.vendorNetCents, 3900);
  assert.equal(l.vendorBaseUnitPriceCents, 3900);
  assert.equal(l.priceSetManually, false);
  assert.equal(item(ctx.lA.id).availableQty, 2);
  assert.equal(item(ctx.lA.id).soldQty, 1);
  assertDbChecks();
});

test("dublu click (aceeași cheie, simultan) => o singură vânzare; vânzare repetată legitimă => a doua vânzare", async () => {
  await readyFairPriceLine();
  const key = newKey();
  const body = [{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4000 }];
  const [a, b] = await Promise.all([sell(body, key), sell(body, key)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.body.sale.id, b.body.sale.id);
  assert.equal(fake.tables.artfestFairSale.length, 1);
  assert.equal(item(ctx.lA.id).availableQty, 2);

  const retry = await sell(body, key);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  // aceeași cheie, alt preț => 409, nu o a doua vânzare
  const other = await sell([{ ...body[0], effectiveUnitPriceCents: 4100 }], key);
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "idempotency_conflict");

  const second = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(second.status, 201);
  assert.equal(fake.tables.artfestFairSale.length, 2);
  assert.equal(item(ctx.lA.id).availableQty, 1);
  assertDbChecks();
});

test("peste stoc: refuz, nimic scris", async () => {
  await readyFairPriceLine();
  const r = await sell([{ inventoryItemId: ctx.lA.id, quantity: 4 }]);
  assert.equal(r.status, 409);
  assert.ok(r.body.problems[0].reasons.includes("insufficient_stock"));
  assert.equal(fake.tables.artfestFairSale.length, 0);
  assert.equal(item(ctx.lA.id).availableQty, 3);
});

/* ============================== preț redus ============================== */

test("preț redus la casă: comisionul și suma vendorului scad (10% / 90% din efectiv); doar vânzarea curentă; limita = prețul final", async () => {
  await readyFairPriceLine();
  const p = await preview([{ inventoryItemId: ctx.lA.id, quantity: 2, effectiveUnitPriceCents: 4000 }]);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.canConfirm, true);
  const pl = p.body.lines[0];
  assert.equal(pl.lineListCents, 8666);
  assert.equal(pl.lineGrossCents, 8000);
  assert.equal(pl.lineDiscountCents, 666);
  assert.equal(pl.commissionCents, 800);
  assert.equal(pl.vendorNetCents, 7200);
  assert.equal(pl.vendorBaseUnitPriceCents, 3900);
  assert.equal(pl.suggestedUnitPriceCents, 4333);

  // peste prețul de pe etichetă: doar cu confirmare explicită; sub prețul declarat: permis (vendorul primește 90%)
  const high = await preview([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4500 }]);
  assert.deepEqual(high.body.problems[0].reasons, ["price_above_label_unconfirmed"]);
  assert.equal((await sell([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4500 }])).status, 409);
  const highOk = await preview([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4500, aboveLabelConfirmed: true }]);
  assert.equal(highOk.body.canConfirm, true);
  assert.equal(highOk.body.lines[0].priceAboveLabel, true);
  const deep = await preview([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 3000 }]);
  assert.equal(deep.body.canConfirm, true);
  assert.equal(deep.body.lines[0].commissionCents, 300);
  assert.equal(deep.body.lines[0].vendorNetCents, 2700);

  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2, effectiveUnitPriceCents: 4000 }]);
  assert.equal(s.status, 201, s.text);
  const l = s.body.sale.lines[0];
  assert.equal(l.priceSetManually, true);
  assert.equal(l.commissionCents, 800);
  assert.equal(l.vendorNetCents, 7200);
  assert.equal(l.discount, null); // prețul introdus nu e o regulă de reducere salvată
  assert.equal(s.body.sale.totalPaidCents, 8000);
  // inventarul, eticheta și prețul online rămân neatinse
  assert.equal(item(ctx.lA.id).finalPriceCents, 4333);
  assert.equal(item(ctx.lA.id).labelPriceCents, 4333);
  assert.equal(fake.tables.product.find((x) => x.id === ctx.pA.id).priceCents, 3900);
  assertDbChecks();
});

test("preț peste etichetă, confirmat: se vinde la prețul introdus (10% / 90%), fără retipărire; dublu click => o vânzare", async () => {
  await readyFairPriceLine();
  const key = newKey();
  const body = [{ inventoryItemId: ctx.lA.id, quantity: 2, effectiveUnitPriceCents: 4500, aboveLabelConfirmed: true }];
  const [a, b] = await Promise.all([sell(body, key), sell(body, key)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(fake.tables.artfestFairSale.length, 1);
  const l = saleLines()[0];
  assert.equal(l.listUnitPriceCents, 4500);
  assert.equal(l.lineDiscountCents, 0);
  assert.equal(l.lineGrossCents, 9000);
  assert.equal(l.commissionCents, 900);
  assert.equal(l.vendorNetCents, 8100);
  assert.equal(l.priceSetManually, true);
  // aceeași cheie fără confirmare = alt conținut => 409
  assert.equal((await sell([{ ...body[0], aboveLabelConfirmed: false }], key)).status, 409);
  // eticheta, prețul final și prețul online neatinse
  assert.equal(item(ctx.lA.id).labelPriceCents, 4333);
  assert.equal(item(ctx.lA.id).finalPriceCents, 4333);
  assert.equal(fake.tables.product.find((x) => x.id === ctx.pA.id).priceCents, 3900);
  // retur pe vânzarea peste etichetă: se inversează exact valorile salvate
  const ret = await asAdmin("POST", `${POS}/sales/${a.body.sale.id}/returns`, {
    key: newKey(),
    body: { reason: "Retur", refundMethod: "CASH", lines: [{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(ret.status, 201, ret.text);
  const rl = fake.tables.artfestFairSaleReturnLine[0];
  assert.equal(rl.refundCents, 4500);
  assert.equal(rl.commissionReversedCents, 450);
  assert.equal(rl.vendorNetReversedCents, 4050);
  assertDbChecks();
});

test("reducere „finanțată de Artfest” nu se aplică la târg: 10% / 90% din prețul efectiv rămâne regula", async () => {
  await readyFairPriceLine();
  fake.seed("artfestFairDiscount", [
    { fairId: ctx.fair.id, name: "Promo Artfest", type: "PERCENT", percentBps: 2000, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA.id, fundingSource: "ARTFEST", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id },
  ]);
  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(s.status, 201, s.text);
  const l = s.body.sale.lines[0];
  assert.equal(l.lineDiscountCents, 0);
  assert.equal(l.artfestFundedDiscountCents, 0);
  assert.equal(l.commissionCents, 433);
  assert.equal(l.vendorNetCents, 3900);
  assertDbChecks();
});

test("reducere automată aprobată (implicit pe vendor): scade prețul efectiv, comisionul și suma vendorului", async () => {
  await readyFairPriceLine();
  fake.seed("artfestFairDiscount", [
    { fairId: ctx.fair.id, name: "Promo", type: "PERCENT", percentBps: 500, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA.id, fundingSource: "VENDOR", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id },
  ]);
  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(s.status, 201, s.text);
  const l = s.body.sale.lines[0];
  assert.equal(l.lineDiscountCents, 217); // 5% din 43,33 = 2,1665 -> 2,17
  assert.equal(l.lineGrossCents, 4116);
  assert.equal(l.commissionCents, 412); // 10% din 41,16 = 4,116 -> 4,12
  assert.equal(l.vendorNetCents, 3704);
  assert.equal(l.discount.name, "Promo");

  // prețul introdus la casă înlocuiește reducerea automată
  const manual = await preview([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4200 }]);
  assert.equal(manual.body.lines[0].lineGrossCents, 4200);
  assert.equal(manual.body.lines[0].discount, null);
  assertDbChecks();
});

/* ============================== schimbare de preț după prima vânzare ============================== */

test("prețul final schimbat după prima vânzare: vânzarea veche neschimbată; cele noi la prețul nou (10% / 90%)", async () => {
  await readyFairPriceLine();
  const first = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  const firstLine = { ...saleLines().find((x) => x.id === first.body.sale.lines[0].id) };

  const change = await setFinal(ctx.lA.id, 4500);
  assert.equal(change.status, 200);
  assert.equal(change.body.labelReprintNeeded, true);

  // eticheta veche, fără preț introdus: blocat; cu reimprimare: preț nou
  assert.ok((await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }])).body.problems[0].reasons.includes("label_outdated"));
  assert.equal((await printLabel(ctx.lA.id)).status, 200);
  const second = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.sale.lines[0].lineGrossCents, 4500);
  assert.equal(second.body.sale.lines[0].commissionCents, 450);
  assert.equal(second.body.sale.lines[0].vendorNetCents, 4050);
  assert.deepEqual(saleLines().find((x) => x.id === firstLine.id), firstLine);
  assertDbChecks();
});

test("POS: prețul introdus după scanare nu cere retipărirea etichetei; fără preț, eticheta veche blochează", async () => {
  await readyFairPriceLine(); // eticheta tipărită la 43,33
  assert.equal((await setFinal(ctx.lA.id, 4500)).body.labelReprintNeeded, true);
  const labelBefore = { labelPriceCents: item(ctx.lA.id).labelPriceCents, labelGeneratedAt: item(ctx.lA.id).labelGeneratedAt };

  const scanned = (await asAdmin("GET", `${POS}/scan?barcode=${item(ctx.lA.id).barcode}`)).body.item;
  assert.equal(scanned.sellable, true);
  assert.equal(scanned.requiresPrice, true);
  assert.equal(scanned.labelPriceCents, 4333);
  assert.equal(scanned.salePriceCents, 4500);

  assert.equal((await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }])).status, 409);
  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4333 }]);
  assert.equal(s.status, 201, s.text);
  assert.equal(s.body.sale.lines[0].commissionCents, 433);
  assert.equal(s.body.sale.lines[0].vendorNetCents, 3900);
  assert.equal(item(ctx.lA.id).labelPriceCents, labelBefore.labelPriceCents);
  assert.equal(item(ctx.lA.id).labelGeneratedAt, labelBefore.labelGeneratedAt);
  assert.equal(item(ctx.lA.id).finalPriceCents, 4500);
  assertDbChecks();
});

/* ============================== retur + anulare ============================== */

test("retur pe o vânzare cu preț redus: se inversează exact sumele salvate (10% / 90%); stocul revine; anularea la fel", async () => {
  await readyFairPriceLine();
  const s = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2, effectiveUnitPriceCents: 4001 }]);
  const line = saleLines().find((x) => x.id === s.body.sale.lines[0].id);
  assert.equal(line.commissionCents, 800); // 10% din 80,02 = 8,002 -> 8,00
  assert.equal(line.vendorNetCents, 7202);
  const ret = await asAdmin("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    key: newKey(),
    body: { reason: "Clientul a returnat", refundMethod: "CASH", lines: [{ saleLineId: line.id, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(ret.status, 201, ret.text);
  const rl = fake.tables.artfestFairSaleReturnLine[0];
  assert.equal(rl.refundCents, 4001);
  assert.equal(rl.commissionReversedCents, 400);
  assert.equal(rl.vendorNetReversedCents, 3601);
  assert.equal(item(ctx.lA.id).availableQty, 2);
  // valorile vânzării rămân cele salvate
  assert.equal(saleLines().find((x) => x.id === line.id).vendorNetCents, 7202);

  const s2 = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  const v = await asAdmin("POST", `${POS}/sales/${s2.body.sale.id}/void`, { key: newKey(), body: { reason: "Greșeală la casă" } });
  assert.equal(v.status, 201, v.text);
  assert.equal(item(ctx.lA.id).availableQty, 2);
  assertDbChecks();
});

/* ============================== contul vendorului + totaluri ============================== */

test("vendor: azi + total + cuvenit + decontat + rest; Admin: pe vendor + total; anulări / retururi separat", async () => {
  await readyFairPriceLine();
  const s1 = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2 }]);
  await sell([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4000 }]);
  await asAdmin("POST", `${POS}/sales/${s1.body.sale.id}/returns`, {
    key: newKey(),
    body: { reason: "Retur", refundMethod: "CASH", lines: [{ saleLineId: s1.body.sale.lines[0].id, quantity: 1, disposition: "RESTOCKED" }] },
  });
  const s3 = await sell([{ inventoryItemId: ctx.lC.id, quantity: 1 }]);
  await asAdmin("POST", `${POS}/sales/${s3.body.sale.id}/void`, { key: newKey(), body: { reason: "Anulare" } });

  // așteptat: din valorile salvate (nimic recalculat)
  const v1Lines = saleLines().filter((l) => l.vendorId === ctx.vendor1.id);
  const v1Returns = fake.tables.artfestFairSaleReturnLine.filter((r) => r.vendorId === ctx.vendor1.id);
  const due = v1Lines.reduce((t, l) => t + l.vendorNetCents, 0) - v1Returns.reduce((t, r) => t + r.vendorNetReversedCents, 0);
  const collected = v1Lines.reduce((t, l) => t + l.lineGrossCents, 0) - v1Returns.reduce((t, r) => t + r.refundCents, 0);

  const v1 = await call("GET", "/api/vendor/artfest-fair/summary", { as: ctx.u1 });
  assert.equal(v1.status, 200, v1.text);
  assert.equal(v1.body.date, reports.todayLocal(new Date()));
  assert.equal(v1.body.today.sales.units, 3);
  assert.equal(v1.body.today.sales.grossCents, 2 * 4333 + 4000);
  assert.equal(v1.body.today.returns.units, 1);
  assert.equal(v1.body.today.net.collectedCents, collected);
  assert.equal(v1.body.today.net.vendorDueCents, due);
  assert.deepEqual(v1.body.todayProducts[0].unitPricesCents.sort(), [4000, 4333]);
  assert.equal(v1.body.settlement.remainingCents, due);
  assert.equal(JSON.stringify(v1.body).includes("Cană"), false);

  const today = reports.todayLocal(new Date());
  const d = await asAdmin("POST", `${ADMIN}/settlements`, { body: { vendorId: ctx.vendor1.id, periodFrom: today, periodTo: today } });
  assert.equal(d.status, 201, d.text);
  assert.equal(d.body.item.finalDueCents, due);
  assert.equal((await asAdmin("POST", `${ADMIN}/settlements/${d.body.item.id}/finalize`)).status, 200);
  assert.equal((await asAdmin("POST", `${ADMIN}/settlements/${d.body.item.id}/mark-paid`, { body: { paymentReference: "OP 1" } })).status, 200);
  const after = await call("GET", "/api/vendor/artfest-fair/summary", { as: ctx.u1 });
  assert.equal(after.body.settlement.paidCents, due);
  assert.equal(after.body.settlement.remainingCents, 0);

  const adm = await asAdmin("GET", `${POS}/reports/summary`);
  assert.equal(adm.status, 200, adm.text);
  assert.equal(adm.body.participationFeeIncluded, false);
  const row1 = adm.body.rows.find((r) => r.vendorId === ctx.vendor1.id);
  const row2 = adm.body.rows.find((r) => r.vendorId === ctx.vendor2.id);
  assert.equal(row1.total.net.collectedCents, collected);
  assert.equal(row1.total.net.vendorDueCents, due);
  assert.equal(row1.total.net.artfestCents, collected - due);
  assert.equal(row2.total.voids.refundCents, 4550);
  assert.equal(row2.total.net.vendorDueCents, 0);
  const t = adm.body.totals.total;
  assert.equal(t.voids.count, 1);
  assert.equal(t.returns.count, 1);
  assert.equal(t.net.vendorDueCents + t.net.artfestCents, t.net.collectedCents);
  assertDbChecks();
});

/* ============================== acceptarea explicită ============================== */

const PM = "/api/vendor/artfest-fair/pricing-model";
const regRow = (r) => fake.tables.artfestFairRegistration.find((x) => x.id === r.id);
beforeEach(() => {
  publishedOverride = null; // implicit: registrul real (versions.yml)
});

test("registrul REAL (versions.yml): nicio versiune cu regula nouă publicată => nimeni nu poate accepta", async () => {
  const s = await call("GET", PM, { as: ctx.u1 });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.model, "COMMISSION");
  assert.equal(s.body.offer.available, false);
  assert.equal(s.body.canAccept, false);
  const r = await call("POST", `${PM}/accept`, { as: ctx.u1, body: { accepted: true, termsVersion: "2.0.0" } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "pricing_terms_not_available");
  assert.equal((await call("GET", `${PM}/document`, { as: ctx.u1 })).status, 404);
  assert.equal(regRow(ctx.r1).pricingModel, "COMMISSION");
});

test("eligibilitate: doar înscrierile SUBMITTED / APPROVED văd solicitarea; REJECTED / WITHDRAWN / CANCELLED nu", async () => {
  publishedOverride = PUBLISHED_WITH_FAIR_PRICE;
  for (const [status, expected] of [["SUBMITTED", true], ["APPROVED", true], ["REJECTED", false], ["WITHDRAWN", false], ["CANCELLED", false]]) {
    Object.assign(regRow(ctx.r1), { status });
    const s = await call("GET", PM, { as: ctx.u1 });
    assert.equal(s.body.canAccept, expected, status);
    if (!expected) {
      const r = await call("POST", `${PM}/accept`, { as: ctx.u1, body: { accepted: true, termsVersion: "2.0.0" } });
      assert.equal(r.status, 409, status);
      assert.equal(r.body.error, "registration_not_active");
      assert.equal(regRow(ctx.r1).pricingModel, "COMMISSION");
    }
  }
});

test("acceptare o singură dată: exemplul 10% / 90% cu reducere, dovada salvată; vânzările vechi neschimbate; regula doar pentru vânzările ulterioare", async () => {
  Object.assign(item(ctx.lA.id), { labelGeneratedAt: new Date(), labelPriceCents: 3900 });
  const before = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(before.status, 201, before.text);
  const oldLine = { ...saleLines()[0] };
  assert.equal(oldLine.pricingModel, "COMMISSION");
  Object.assign(regRow(ctx.r1), { termsVersion: "1.1.0", termsAcceptedAt: new Date("2026-10-20T10:00:00Z") });
  const registrationTerms = { termsVersion: regRow(ctx.r1).termsVersion, termsAcceptedAt: regRow(ctx.r1).termsAcceptedAt };

  publishedOverride = PUBLISHED_WITH_FAIR_PRICE;
  const s = await call("GET", PM, { as: ctx.u1 });
  assert.equal(s.body.canAccept, true);
  assert.equal(s.body.offer.version, "2.0.0");
  assert.deepEqual(s.body.example, {
    commissionBps: 1000,
    vendorPriceCents: 10000,
    salePriceCents: 11111,
    artfestCents: 1111,
    vendorCents: 10000,
    discountedSaleCents: 10000,
    discountedArtfestCents: 1000,
    discountedVendorCents: 9000,
  });
  // exemplul e consecvent cu calculul real
  assert.equal(pricing.suggestedFinalPriceCents(10000, 1000), s.body.example.salePriceCents);
  assert.deepEqual(pricing.splitGross(11111, 1000), { commissionCents: 1111, vendorNetCents: 10000 });
  // rezumatul nu mai promite „prețul integral, fără comision”
  const summary = s.body.summary.join(" ");
  assert.match(summary, /10% din prețul efectiv/);
  assert.match(summary, /90%/);
  assert.doesNotMatch(summary, /fără comision|Nu se mai aplică comisionul/i);

  const doc = await call("GET", `${PM}/document`, { as: ctx.u1 });
  assert.equal(doc.status, 200, doc.text);
  assert.equal(doc.body.version, "2.0.0");

  assert.equal((await call("POST", `${PM}/accept`, { as: ctx.u1, body: { termsVersion: "2.0.0" } })).body.error, "acceptance_required");
  assert.equal((await call("POST", `${PM}/accept`, { as: ctx.u1, body: { accepted: true, termsVersion: "1.1.0" } })).body.error, "terms_version_changed");

  const ok = await call("POST", `${PM}/accept`, { as: ctx.u1, body: { accepted: true, termsVersion: "2.0.0" } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.changed, true);
  const row = regRow(ctx.r1);
  assert.equal(row.pricingModel, "FAIR_PRICE");
  assert.equal(row.pricingModelTermsVersion, "2.0.0");
  assert.equal(row.pricingModelAcceptedById, ctx.u1.id);
  assert.ok(row.pricingModelAcceptIp);
  const proof = { at: row.pricingModelAcceptedAt, ip: row.pricingModelAcceptIp, ua: row.pricingModelAcceptUa };

  const again = await call("POST", `${PM}/accept`, { as: ctx.u1, body: { accepted: true, termsVersion: "2.0.0" } });
  assert.equal(again.body.changed, false);
  assert.deepEqual({ at: regRow(ctx.r1).pricingModelAcceptedAt, ip: regRow(ctx.r1).pricingModelAcceptIp, ua: regRow(ctx.r1).pricingModelAcceptUa }, proof);
  assert.deepEqual({ termsVersion: regRow(ctx.r1).termsVersion, termsAcceptedAt: regRow(ctx.r1).termsAcceptedAt }, registrationTerms);
  assert.equal(regRow(ctx.r2).pricingModel, "COMMISSION");

  // regula nouă (preț final + preț la casă) doar pentru vânzările ulterioare
  assert.deepEqual(saleLines().find((l) => l.id === oldLine.id), oldLine);
  assert.ok((await preview([{ inventoryItemId: ctx.lA.id, quantity: 1 }])).body.problems[0].reasons.includes("final_price_missing"));
  assert.equal((await setFinal(ctx.lA.id, 4333)).status, 200);
  assert.equal((await printLabel(ctx.lA.id)).status, 200);
  const after = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1, effectiveUnitPriceCents: 4000 }]);
  assert.equal(after.status, 201, after.text);
  assert.equal(after.body.sale.lines[0].pricingModel, "FAIR_PRICE");
  assert.equal(after.body.sale.lines[0].commissionCents, 400);
  assert.equal(after.body.sale.lines[0].vendorNetCents, 3600);
  assert.deepEqual(saleLines().find((l) => l.id === oldLine.id), oldLine);
  assertDbChecks();
});

test("regula 1.x: etichetă și vânzare fără preț final, ca înainte; eticheta veche blochează (fără preț la casă)", async () => {
  Object.assign(item(ctx.lC.id), { labelGeneratedAt: null, labelPriceCents: null });
  assert.equal((await printLabel(ctx.lC.id)).status, 200);
  assert.equal(item(ctx.lC.id).labelPriceCents, 4550);
  assert.equal(item(ctx.lC.id).finalPriceCents, null);
  const res = await asAdmin("GET", `${POS}/scan?barcode=${item(ctx.lC.id).barcode}`);
  assert.equal(res.body.item.sellable, true);
  assert.equal(res.body.item.canEditPrice, false);
  const s = await sell([{ inventoryItemId: ctx.lC.id, quantity: 2 }]);
  assert.equal(s.status, 201, s.text);
  assert.equal(s.body.sale.lines[0].commissionCents, 910);
  Object.assign(item(ctx.lC.id), { availableQty: 1, priceSnapshotCents: 4600 });
  assert.ok((await preview([{ inventoryItemId: ctx.lC.id, quantity: 1 }])).body.problems[0].reasons.includes("label_outdated"));
});

test("pregătire etichete ÎNAINTE de acceptare: prețul final se salvează și se tipărește; regula rămâne veche și nu se vinde la prețul nou", async () => {
  // vendorul 2: înscriere APPROVED, regula 1.x (neacceptat 2.0.0)
  const before = await sell([{ inventoryItemId: ctx.lC.id, quantity: 1 }]); // vânzare existentă, la prețul declarat
  assert.equal(before.status, 201, before.text);
  const oldLine = { ...saleLines()[0] };

  const r = await setFinal(ctx.lC.id, 5056);
  assert.equal(r.status, 200, r.text);
  assert.equal(item(ctx.lC.id).finalPriceCents, 5056);
  assert.equal(r.body.labelReprintNeeded, true);
  // eticheta se generează cu prețul final
  assert.equal((await printLabel(ctx.lC.id)).status, 200);
  assert.equal(item(ctx.lC.id).labelPriceCents, 5056);
  assert.ok(renderedHtml.at(-1).includes(labels.formatLabelPrice(5056)));
  // regulamentul NU e marcat acceptat; prețul online și vânzarea existentă neatinse
  const reg = fake.tables.artfestFairRegistration.find((x) => x.id === ctx.r2.id);
  assert.equal(reg.pricingModel, "COMMISSION");
  assert.equal(reg.pricingModelAcceptedAt ?? null, null);
  assert.equal(fake.tables.product.find((x) => x.id === ctx.pC.id).priceCents, 4550);
  assert.deepEqual(saleLines().find((l) => l.id === oldLine.id), oldLine);

  // POS: nu se vinde la prețul nou înainte de acceptare (eticheta nu corespunde regulii 1.x)
  const scan = (await asAdmin("GET", `${POS}/scan?barcode=${item(ctx.lC.id).barcode}`)).body.item;
  assert.equal(scan.sellable, false);
  assert.equal(scan.salePriceCents, 4550);
  assert.ok(scan.reasons.includes("label_outdated"));
  assert.equal((await sell([{ inventoryItemId: ctx.lC.id, quantity: 1 }])).status, 409);
  assert.equal((await sell([{ inventoryItemId: ctx.lC.id, quantity: 1, effectiveUnitPriceCents: 5056 }])).status, 409);
  assert.equal(saleLines().length, 1);
});
