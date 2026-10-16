// Teste: decontul Târgului Artfest per vendor (vânzări + retururi + ajustări + sold reportat).
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairSettlement.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;

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
  namedExports: { async renderPdfWithSharedBrowser() { return Buffer.from("%PDF"); } },
});

const DAY = 24 * 60 * 60 * 1000;
let server;
let base;
let ctx;
let inventory;
let pos;
let returnsSvc;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  pos = await import("../services/artfestFairPosService.js");
  returnsSvc = await import("../services/artfestFairSaleReturnService.js");
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
    serviceId, title: "Produs", images: [], priceCents: 3900, currency: "RON", isActive: true, isHidden: false,
    moderationStatus: "APPROVED", orderMode: "DIRECT", availability: "READY", readyQty: 50, optionsSchema: [],
    limitedEditionOf: null, limitedEditionNumber: null, ...extra,
  };
}

function receive(line, qty) {
  const row = fake.tables.artfestFairInventoryItem.find((l) => l.id === line.id);
  Object.assign(row, { status: "RECEIVED", receivedQty: qty, availableQty: qty, receivedAt: new Date(), labelGeneratedAt: new Date(), labelPriceCents: row.priceSnapshotCents });
  return row;
}

beforeEach(async () => {
  fake = createFakePrisma();
  const [admin, u1, u2] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "a@t.ro", role: "VENDOR" },
    { email: "b@t.ro", role: "VENDOR" },
  ]);
  const [vA, vB] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelier A" },
    { userId: u2.id, displayName: "Atelier B" },
  ]);
  const [sA, sB] = fake.seed("vendorService", [
    { vendorId: vA.id, title: "SA" },
    { vendorId: vB.id, title: "SB" },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", salesOpen: true, commissionBps: 1000, inventoryDeadlineAt: new Date(Date.now() + 5 * DAY) },
  ]);
  fake.seed(
    "artfestFairRegistration",
    [vA, vB].map((v, i) => ({ fairId: fair.id, vendorId: v.id, submittedByUserId: [u1, u2][i].id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" }))
  );
  const [pA1, pA2, pB1] = fake.seed("product", [
    product(sA.id, { title: "Glob A", priceCents: 3900 }),
    product(sA.id, { title: "Lumânare A", priceCents: 1999 }),
    product(sB.id, { title: "Cană B", priceCents: 4550 }),
  ]);
  const add = async (v, u, p, qty) => {
    const l = await inventory.addInventoryItem({ vendorId: v.id, userId: u.id, body: { productId: p.id, declaredQty: qty } });
    await inventory.submitInventory({ vendorId: v.id, userId: u.id });
    return l;
  };
  const lA1 = receive(await add(vA, u1, pA1, 20), 20);
  const lA2 = receive(await add(vA, u1, pA2, 20), 20);
  const lB1 = receive(await add(vB, u2, pB1, 20), 20);
  ctx = { admin, u1, u2, vA, vB, fair, lA1, lA2, lB1 };
});

let seq = 0;
const key = (p) => `${p}-key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const D = "2026-12-20";
const D2 = "2026-12-22";
const at = (date, hhmm = "08:00") => new Date(`${date}T${hhmm}:00Z`);
const sell = async (lines, paymentMethod = "CASH", now = at(D)) =>
  (await pos.createSale({ body: { lines, paymentMethod }, idempotencyKey: key("sale"), adminId: ctx.admin.id, now })).sale;
const ret = async (saleId, lines, now = at(D, "10:00"), refundMethod = "CASH") =>
  (await returnsSvc.returnSale({ saleId, body: { reason: "Retur test", refundMethod, lines }, idempotencyKey: key("ret"), adminId: ctx.admin.id, now })).saleReturn;
const lineOf = (sale, itemId) => sale.lines.find((l) => l.inventoryItemId === itemId);
const BY_VENDOR = { refundResponsibility: "VENDOR", responsibilityReason: "Imputat vendorului (intern)" };
const BY_ARTFEST = { refundResponsibility: "ARTFEST", responsibilityReason: "Gest comercial (intern)" };
const discount = (extra) =>
  fake.seed("artfestFairDiscount", [
    { fairId: ctx.fair.id, name: "Promo", type: "PERCENT", percentBps: 1000, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA1.id, fundingSource: "VENDOR", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id, ...extra },
  ])[0];

async function call(method, path, { as = ctx.admin, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text, type: res.headers.get("content-type") };
}

const API = "/api/admin/artfest-fair/settlements";
const VAPI = "/api/vendor/artfest-fair/settlements";
const period = (vendor, from = D, to = D) => ({ vendorId: vendor.id, periodFrom: from, periodTo: to });
const draft = async (vendor, from = D, to = D) => {
  const r = await call("POST", API, { body: period(vendor, from, to) });
  assert.equal(r.status, 201, r.text);
  return r.body.item;
};
const finalize = (id) => call("POST", `${API}/${id}/finalize`);
const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
const linesOfVendor = (vendorId) => fake.tables.artfestFairSaleLine.filter((l) => l.vendorId === vendorId);

/* ============================== acces ============================== */

test("doar ADMIN pentru deconturi; vendorul primește 403 pe rutele Admin", async () => {
  assert.equal((await call("POST", `${API}/preview`, { as: null, body: period(ctx.vA) })).status, 401);
  assert.equal((await call("POST", `${API}/preview`, { as: ctx.u1, body: period(ctx.vA) })).status, 403);
  assert.equal((await call("POST", API, { as: ctx.u1, body: period(ctx.vA) })).status, 403);
});

/* ============================== calcul ============================== */

test("vendor cu doar vânzări: preview = draft = suma snapshot-urilor; finalizare; marcare plătit", async () => {
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }], "CASH");
  await sell([{ inventoryItemId: ctx.lA2.id, quantity: 1 }], "CARD");
  const lines = linesOfVendor(ctx.vA.id);
  const prev = (await call("POST", `${API}/preview`, { body: period(ctx.vA) })).body;
  assert.equal(prev.grossSalesCents, sum(lines, "lineGrossCents"));
  assert.equal(prev.commissionCents, sum(lines, "commissionCents"));
  assert.equal(prev.vendorNetCents, sum(lines, "vendorNetCents"));
  assert.equal(prev.finalDueCents, prev.vendorNetCents);
  assert.equal(prev.saleLines, 2);
  assert.equal(fake.tables.artfestFairSettlement.length, 0, "preview nu scrie");

  const d = await draft(ctx.vA);
  assert.equal(d.status, "DRAFT");
  assert.equal(d.sequence, 1);
  assert.equal(d.kind, "FINAL");
  assert.equal(d.finalDueCents, prev.finalDueCents);
  assert.equal(d.saleLines.length, 2);
  assert.equal(d.consistent, true);
  assert.equal(fake.tables.artfestFairSettlementEntry.length, 2);

  const f = await finalize(d.id);
  assert.equal(f.body.item.status, "FINALIZED");
  assert.ok(f.body.item.finalizedAt);

  assert.equal((await call("POST", `${API}/${d.id}/mark-paid`, { body: {} })).body.error, "payment_reference_required");
  const paid = await call("POST", `${API}/${d.id}/mark-paid`, { body: { paymentReference: "OP 123" } });
  assert.equal(paid.status, 200, paid.text);
  assert.equal(paid.body.item.status, "PAID");
  assert.equal(paid.body.item.paymentReference, "OP 123");
  assert.ok(paid.body.item.paidAt && paid.body.item.paidById === ctx.admin.id);
  assert.equal((await call("POST", `${API}/${d.id}/mark-paid`, { body: { paymentReference: "OP 124" } })).body.error, "already_paid");
});

test("retururi: RESTOCKED / VENDOR afectează vendorul; ARTFEST nu - intră doar în rambursări + Artfest borne", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 5 }]);
  const l = lineOf(s, ctx.lA1.id);
  const r1 = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]);
  const r2 = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", ...BY_VENDOR }]);
  const r3 = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", ...BY_ARTFEST }]);
  const r4 = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_VENDOR }]);
  const r5 = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_ARTFEST }]);
  const hits = [r1, r2, r4];
  const artfest = [r3, r5];
  const d = await draft(ctx.vA);
  assert.equal(d.returnLines.length, 5);
  assert.equal(d.returnsRefundCents, sum([...hits, ...artfest], "refundCents"), "toate rambursările");
  assert.equal(d.artfestBorneRefundCents, sum(artfest, "refundCents"));
  assert.equal(d.vendorBorneRefundCents, sum(hits, "refundCents"));
  assert.equal(d.commissionReversedCents, sum(hits, "commissionReversedCents"));
  assert.equal(d.vendorNetReversedCents, sum(hits, "vendorNetReversedCents"));
  assert.equal(d.finalDueCents, l.vendorNetCents - sum(hits, "vendorNetReversedCents"));
  // valorile originale rămân pe linia de retur (audit); intrarea ARTFEST aplică 0 vendorului
  const art = d.returnLines.filter((x) => !x.affectsVendorNet);
  assert.equal(art.length, 2);
  assert.ok(art.every((x) => x.vendorNetReversedCents > 0 && x.entry.vendorNetCents === 0 && x.entry.commissionCents === 0 && x.entry.grossCents === -x.refundCents));
  assert.ok(d.returnLines.filter((x) => x.affectsVendorNet).every((x) => x.entry.vendorNetCents === -x.vendorNetReversedCents));
  assert.equal(d.consistent, true);
});

test("reduceri VENDOR și ARTFEST: snapshot-urile liniilor, vendorul neutru la reducerea Artfest (D8)", async () => {
  discount({ inventoryItemId: ctx.lA1.id, percentBps: 2000, fundingSource: "VENDOR" });
  discount({ inventoryItemId: ctx.lA2.id, percentBps: 1000, fundingSource: "ARTFEST" });
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }, { inventoryItemId: ctx.lA2.id, quantity: 3 }]);
  const lv = lineOf(s, ctx.lA1.id);
  const la = lineOf(s, ctx.lA2.id);
  assert.equal(la.vendorNetCents, la.lineListCents - la.commissionOnListCents, "D8: net pe prețul de listă");
  const d = await draft(ctx.vA);
  assert.equal(d.listSalesCents, lv.lineListCents + la.lineListCents);
  assert.equal(d.discountsCents, lv.lineDiscountCents + la.lineDiscountCents);
  assert.equal(d.grossSalesCents, lv.lineGrossCents + la.lineGrossCents);
  assert.equal(d.commissionCents, lv.commissionCents + la.commissionCents);
  assert.equal(d.vendorNetCents, lv.vendorNetCents + la.vendorNetCents);
  // retur pe reducerea Artfest: compensația se inversează proporțional (snapshot pe bucată)
  const r = await ret(s.id, [{ saleLineId: la.id, quantity: 1, disposition: "RESTOCKED" }]);
  const rc = await call("POST", `${API}/${d.id}/recalculate`);
  assert.equal(rc.body.item.vendorNetReversedCents, r.vendorNetReversedCents);
  assert.ok(r.artfestFundedReversedCents > 0);
});

test("multi-vendor: fiecare decont conține doar liniile vendorului lui", async () => {
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }, { inventoryItemId: ctx.lB1.id, quantity: 2 }], "CARD");
  const a = await draft(ctx.vA);
  const b = await draft(ctx.vB);
  assert.deepEqual(a.saleLines.map((l) => l.title), ["Glob A"]);
  assert.deepEqual(b.saleLines.map((l) => l.title), ["Cană B"]);
  assert.equal(b.vendorNetCents, linesOfVendor(ctx.vB.id)[0].vendorNetCents);
});

test("o linie inclusă într-un decont nu se dublează; returul de după decont intră în următorul", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const d1 = await draft(ctx.vA);
  assert.equal((await finalize(d1.id)).body.item.status, "FINALIZED");
  // retur 2 zile mai târziu
  const r = await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_VENDOR }], at(D2));
  // al doilea decont pe o perioadă care acoperă și vânzarea: vânzarea NU se mai include
  const d2 = await draft(ctx.vA, D, D2);
  assert.equal(d2.sequence, 2);
  assert.equal(d2.label, "Decont #2 (corecție)");
  assert.equal(d2.saleLines.length, 0);
  assert.equal(d2.returnLines.length, 1);
  assert.equal(d2.vendorNetCents, 0);
  assert.equal(d2.finalDueCents, -r.vendorNetReversedCents);
  // decontul finalizat a rămas neschimbat
  const again = (await call("GET", `${API}/${d1.id}`)).body.item;
  assert.equal(again.returnLines.length, 0);
  assert.equal(again.finalDueCents, l.vendorNetCents);
  assert.equal(new Set(fake.tables.artfestFairSettlementEntry.map((e) => e.saleLineId || e.returnLineId)).size, fake.tables.artfestFairSettlementEntry.length);
});

/* ============================== ajustări ============================== */

test("ajustări: pozitivă / negativă, doar în DRAFT, motiv obligatoriu, sumă ≠ 0, adjustmentsCents calculat (nu din client)", async () => {
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  const d = await draft(ctx.vA);
  const add = (body) => call("POST", `${API}/${d.id}/adjustments`, { body });
  assert.equal((await add({ amountCents: 0, reason: "abc" })).body.error, "invalid_amount");
  assert.equal((await add({ amountCents: 12.5, reason: "abc" })).body.error, "invalid_amount");
  assert.equal((await add({ amountCents: 500, reason: " " })).body.error, "reason_required");
  const p = await add({ amountCents: 1500, reason: "Bonus transport (intern)", vendorNote: "Decontare transport", adjustmentsCents: 999999 });
  assert.equal(p.status, 201, p.text);
  assert.equal(p.body.item.adjustmentsCents, 1500);
  const n = await add({ amountCents: -400, reason: "Corecție etichetă (intern)" });
  assert.equal(n.body.item.adjustmentsCents, 1100);
  assert.equal(n.body.item.finalDueCents, d.finalDueCents + 1100);
  assert.equal(n.body.item.adjustments.length, 2);
  assert.equal(n.body.item.consistent, true);
  // recalcularea păstrează ajustările
  assert.equal((await call("POST", `${API}/${d.id}/recalculate`)).body.item.adjustmentsCents, 1100);
  await finalize(d.id);
  assert.equal((await add({ amountCents: 100, reason: "după finalizare" })).body.error, "settlement_not_draft");
  // nu există rute de editare / ștergere
  assert.equal((await call("DELETE", `${API}/${d.id}/adjustments/${fake.tables.artfestFairSettlementAdjustment[0].id}`)).status, 404);
});

/* ============================== sold negativ ============================== */

test("sold negativ => CARRIED_FORWARD; preluat o singură dată în decontul următor; anularea ciornei îl eliberează", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  const l = lineOf(s, ctx.lA1.id);
  const d1 = await draft(ctx.vA);
  await finalize(d1.id);
  await ret(s.id, [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_VENDOR }], at(D2));
  const d2 = await draft(ctx.vA, D2, D2);
  assert.ok(d2.finalDueCents < 0);
  const f2 = await finalize(d2.id);
  assert.equal(f2.body.item.status, "CARRIED_FORWARD");
  assert.equal((await call("POST", `${API}/${d2.id}/mark-paid`, { body: { paymentReference: "x" } })).body.error, "not_finalized");

  // decontul următor preia soldul
  await sell([{ inventoryItemId: ctx.lA2.id, quantity: 3 }], "CASH", at("2026-12-23"));
  const d3 = await draft(ctx.vA, "2026-12-23", "2026-12-23");
  assert.equal(d3.carriedInCents, d2.finalDueCents);
  assert.equal(d3.previousSettlementId, d2.id);
  assert.equal(d3.finalDueCents, d3.vendorNetCents + d2.finalDueCents);
  // anularea ciornei eliberează soldul; o ciornă nouă îl preia din nou
  const c = await call("POST", `${API}/${d3.id}/cancel`);
  assert.equal(c.body.item.status, "CANCELLED");
  assert.equal(c.body.item.previousSettlementId, null);
  assert.equal(fake.tables.artfestFairSettlementEntry.filter((e) => e.settlementId === d3.id).length, 0);
  const d4 = await draft(ctx.vA, "2026-12-23", "2026-12-23");
  assert.equal(d4.sequence, 4);
  assert.equal(d4.carriedInCents, d2.finalDueCents);
  await finalize(d4.id);
  // al cincilea decont NU mai preia nimic
  await sell([{ inventoryItemId: ctx.lA2.id, quantity: 1 }], "CASH", at("2026-12-24"));
  const d5 = await draft(ctx.vA, "2026-12-24", "2026-12-24");
  assert.equal(d5.carriedInCents, 0);
  assert.equal(d5.previousSettlementId, null);
  const d4full = (await call("GET", `${API}/${d4.id}`)).body.item;
  assert.equal(d4full.carriedFrom.id, d2.id);
  assert.equal((await call("GET", `${API}/${d2.id}`)).body.item.carriedInto.id, d4.id);
});

/* ============================== statusuri ============================== */

test("finalizarea îngheață: fără recalculare / ajustare / refinalizare; finalizare cu date vechi => 409", async () => {
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  const d = await draft(ctx.vA);
  // o vânzare nouă în perioadă după calcul => datele s-au schimbat
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }], "CASH", at(D, "12:00"));
  const stale = await finalize(d.id);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "settlement_stale");
  await call("POST", `${API}/${d.id}/recalculate`);
  assert.equal((await finalize(d.id)).body.item.status, "FINALIZED");
  assert.equal((await call("POST", `${API}/${d.id}/recalculate`)).body.error, "settlement_not_draft");
  assert.equal((await finalize(d.id)).body.error, "settlement_not_draft");
  assert.equal((await call("POST", `${API}/${d.id}/cancel`)).body.error, "settlement_not_draft");
});

test("un singur DRAFT pe vendor; vânzări zero => sumă 0 => FINALIZED, nu se poate marca plătit", async () => {
  const d = await draft(ctx.vA);
  assert.equal(d.saleLines.length, 0);
  assert.equal(d.finalDueCents, 0);
  const second = await call("POST", API, { body: period(ctx.vA) });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "draft_exists");
  const f = await finalize(d.id);
  assert.equal(f.body.item.status, "FINALIZED");
  assert.equal(f.body.item.actions.canMarkPaid, false);
  assert.equal((await call("POST", `${API}/${d.id}/mark-paid`, { body: { paymentReference: "x" } })).body.error, "nothing_to_pay");
});

test("perioadă invalidă / vendor inexistent", async () => {
  assert.equal((await call("POST", `${API}/preview`, { body: { vendorId: ctx.vA.id, periodFrom: D2, periodTo: D } })).body.error, "invalid_period");
  assert.equal((await call("POST", `${API}/preview`, { body: { vendorId: ctx.vA.id, periodFrom: "20.12.2026", periodTo: D } })).body.error, "invalid_date");
  assert.equal((await call("POST", `${API}/preview`, { body: { vendorId: "nu-exista", periodFrom: D, periodTo: D } })).status, 404);
});

/* ============================== vendor + CSV ============================== */

test("vendorul vede doar deconturile lui finalizate, fără motive interne; A nu vede B; CSV", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }]);
  await ret(s.id, [{ saleLineId: lineOf(s, ctx.lA1.id).id, quantity: 1, disposition: "NOT_RETURNED", ...BY_ARTFEST }]);
  const a = await draft(ctx.vA);
  await call("POST", `${API}/${a.id}/adjustments`, { body: { amountCents: 700, reason: "Motiv intern secret", vendorNote: "Bonus participare" } });
  await call("POST", `${API}/${a.id}/adjustments`, { body: { amountCents: -200, reason: "Alt motiv intern" } });
  const b = await draft(ctx.vB);

  // ciorna nu e vizibilă vendorului
  assert.equal((await call("GET", VAPI, { as: ctx.u1 })).body.items.length, 0);
  assert.equal((await call("GET", `${VAPI}/${a.id}`, { as: ctx.u1 })).status, 404);
  await finalize(a.id);
  await finalize(b.id);

  const listA = (await call("GET", VAPI, { as: ctx.u1 })).body.items;
  assert.deepEqual(listA.map((x) => x.id), [a.id]);
  assert.equal((await call("GET", `${VAPI}/${b.id}`, { as: ctx.u1 })).status, 404, "A nu vede decontul lui B");
  const det = await call("GET", `${VAPI}/${a.id}`, { as: ctx.u1 });
  assert.equal(det.status, 200);
  assert.equal(det.body.item.artfestBorneRefundCents > 0, true);
  assert.deepEqual(det.body.item.adjustments.map((x) => [x.amountCents, x.vendorNote]), [[700, "Bonus participare"], [-200, null]]);
  for (const secret of ["Motiv intern secret", "Alt motiv intern", "Gest comercial", "Retur test", "responsibilityReason", "finalizedById", "Cană B"]) {
    assert.equal(det.text.includes(secret), false, secret);
  }
  assert.equal(det.body.item.returnLines[0].affectsVendorNet, false);

  const csvV = await call("GET", `${VAPI}/${a.id}.csv`, { as: ctx.u1 });
  assert.equal(csvV.status, 200);
  assert.match(csvV.type, /text\/csv/);
  assert.ok(csvV.text.includes("Sumă finală (lei)") && csvV.text.includes("Glob A") && csvV.text.includes("Bonus participare"));
  assert.equal(csvV.text.includes("Motiv intern secret") || csvV.text.includes("Gest comercial") || csvV.text.includes("Cană B"), false);
  assert.equal((await call("GET", `${VAPI}/${b.id}.csv`, { as: ctx.u1 })).status, 404);

  const csvA = await call("GET", `${API}/${a.id}.csv`);
  assert.equal(csvA.status, 200);
  for (const t of ["Motiv intern secret", "Gest comercial", "Rambursări suportate de Artfest (lei)", "Sold reportat (lei)", "Atelier A"]) assert.ok(csvA.text.includes(t), t);

  // lista Admin: toți vendorii + deconturile
  const list = (await call("GET", API)).body;
  assert.equal(list.items.length, 2);
  assert.equal(list.vendors.length, 2);
});
