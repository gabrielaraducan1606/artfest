// Teste: retururi / rambursări către clienți (VOID / RETURN), sumele inversate pe
// bucăți, stocul, idempotența, rapoartele în ziua returului și notificarea zilnică
// agregată a vendorului. Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairSaleReturns.routes.test.js

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
  const lA1 = receive(await add(vA, u1, pA1, 10), 10);
  const lA2 = receive(await add(vA, u1, pA2, 10), 10);
  const lB1 = receive(await add(vB, u2, pB1, 10), 10);
  ctx = { admin, u1, u2, vA, vB, fair, lA1, lA2, lB1 };
});

let seq = 0;
const newKey = (p = "ret") => `${p}-key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const sell = async (lines, paymentMethod = "CASH", now = new Date()) =>
  (await pos.createSale({ body: { lines, paymentMethod }, idempotencyKey: newKey("sale"), adminId: ctx.admin.id, now })).sale;

async function call(method, path, { as = ctx.admin, body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

const POS = "/api/admin/artfest-fair/pos";
const item = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const saleRow = (id) => fake.tables.artfestFairSale.find((s) => s.id === id);
const lineOf = (sale, itemId) => sale.lines.find((l) => l.inventoryItemId === itemId);
const doReturn = (saleId, body, key = newKey()) => call("POST", `${POS}/sales/${saleId}/returns`, { body, key });
const doVoid = (saleId, body = { reason: "Client răzgândit" }, key = newKey()) => call("POST", `${POS}/sales/${saleId}/void`, { body, key });
const retBody = (lines, refundMethod = "CASH", reason = "Clientul a returnat") => ({ reason, refundMethod, lines });
// responsabilul ales explicit de Admin (NOT_RESTOCKED / NOT_RETURNED)
const BY_VENDOR = { refundResponsibility: "VENDOR", responsibilityReason: "Imputat vendorului (test)" };
const BY_ARTFEST = { refundResponsibility: "ARTFEST", responsibilityReason: "Gest comercial Artfest (test)" };
const movementsOf = (itemId) => fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === itemId);
const discount = (extra) =>
  fake.seed("artfestFairDiscount", [
    { fairId: ctx.fair.id, name: "Promo", type: "PERCENT", percentBps: 1000, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA2.id, fundingSource: "ARTFEST", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id, ...extra },
  ])[0];

/* ============================== acces ============================== */

test("doar ADMIN poate anula / returna; vendorul nu poate iniția", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  assert.equal((await call("POST", `${POS}/sales/${s.id}/void`, { as: null, body: { reason: "x y z" }, key: newKey() })).status, 401);
  assert.equal((await call("POST", `${POS}/sales/${s.id}/void`, { as: ctx.u1, body: { reason: "x y z" }, key: newKey() })).status, 403);
  assert.equal((await call("POST", `${POS}/sales/${s.id}/returns`, { as: ctx.u1, body: retBody([]), key: newKey() })).status, 403);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 0);
});

/* ============================== VOID ============================== */

test("VOID integral: toate liniile inversate exact, stocul revine, vânzarea VOIDED", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }], "CARD");
  const res = await doVoid(s.id);
  assert.equal(res.status, 201, res.text);
  const r = res.body.saleReturn;
  assert.equal(r.type, "VOID");
  assert.equal(r.refundMethod, "CARD");
  assert.equal(r.refundCents, s.totalPaidCents);
  assert.equal(r.commissionReversedCents, s.commissionCents);
  assert.equal(r.vendorNetReversedCents, s.vendorNetCents);
  assert.match(r.reference, /^RT\d{2}-000001$/);
  const row = saleRow(s.id);
  assert.equal(row.status, "VOIDED");
  assert.ok(row.voidedAt && row.voidedById === ctx.admin.id);
  assert.equal(item(ctx.lA1.id).availableQty, 10);
  assert.equal(item(ctx.lA1.id).soldQty, 0);
  assert.equal(item(ctx.lB1.id).availableQty, 10);
  const reversed = fake.tables.artfestFairStockMovement.filter((m) => m.type === "SALE_REVERSED");
  assert.equal(reversed.length, 2);
  assert.ok(reversed.every((m) => m.saleReturnLineId && m.reason));
  assert.ok(fake.tables.artfestFairSaleLine.every((l) => l.returnedQty === l.quantity));
  assert.equal(res.body.sale.actions.canVoid, false);
  assert.equal(res.body.sale.actions.canReturn, false);
});

test("VOID dublu: aceeași cheie => replay; altă cheie => 409; VOID după un retur parțial => 409", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const key = newKey();
  const first = await doVoid(s.id, { reason: "Greșeală la casă" }, key);
  const again = await doVoid(s.id, { reason: "Greșeală la casă" }, key);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.saleReturn.id, first.body.saleReturn.id);
  const other = await doVoid(s.id);
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "sale_voided");
  assert.equal(fake.tables.artfestFairSaleReturn.length, 1);
  assert.equal(item(ctx.lA1.id).availableQty, 10);

  const s2 = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s2, ctx.lA1.id);
  assert.equal((await doReturn(s2.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]))).status, 201);
  const v = await doVoid(s2.id);
  assert.equal(v.status, 409);
  assert.equal(v.body.error, "void_not_allowed");
});

test("VOID: motiv obligatoriu, cheie obligatorie", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  assert.equal((await doVoid(s.id, { reason: " " })).body.error, "reason_required");
  assert.equal((await call("POST", `${POS}/sales/${s.id}/void`, { body: { reason: "Greșeală" } })).body.error, "idempotency_key_required");
  assert.equal(saleRow(s.id).status, "COMPLETED");
});

/* ============================== RETURN ============================== */

test("RETURN parțial RESTOCKED: SALE_REVERSED, availableQty crește, PARTIALLY_RETURNED", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 3 }]);
  const l = lineOf(s, ctx.lA1.id);
  const res = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]));
  assert.equal(res.status, 201, res.text);
  assert.equal(saleRow(s.id).status, "PARTIALLY_RETURNED");
  assert.equal(fake.tables.artfestFairSaleLine[0].returnedQty, 1);
  assert.equal(item(ctx.lA1.id).availableQty, 8);
  assert.equal(item(ctx.lA1.id).soldQty, 2);
  const mv = movementsOf(ctx.lA1.id).filter((m) => m.type === "SALE_REVERSED");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].quantity, 1);
  assert.equal(res.body.saleReturn.refundCents, 3900);
  assert.equal(res.body.saleReturn.commissionReversedCents, 390);
  assert.equal(res.body.saleReturn.vendorNetReversedCents, 3510);
});

test("retururi succesive până la integral: sumele închid EXACT linia (reducere ARTFEST, resturi de împărțire)", async () => {
  discount({ percentBps: 1000, fundingSource: "ARTFEST" });
  const s = await sell([{ inventoryItemId: ctx.lA2.id, quantity: 7 }], "CARD");
  const l = lineOf(s, ctx.lA2.id);
  // 7 × 19,99 = 139,93; -10% => 125,94; comision 12,59; compensație Artfest 12,59 - nimic nu se împarte exact la 7
  assert.equal(l.lineGrossCents % 7 !== 0 || l.commissionCents % 7 !== 0, true);
  assert.ok(l.artfestFundedDiscountCents > 0);
  for (const [qty, disposition, resp] of [[2, "RESTOCKED", {}], [3, "NOT_RESTOCKED", BY_VENDOR], [2, "NOT_RETURNED", BY_ARTFEST]]) {
    const r = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: qty, disposition, conditionNote: "Notă despre stare", ...resp }], "CARD"));
    assert.equal(r.status, 201, r.text);
  }
  const rls = fake.tables.artfestFairSaleReturnLine;
  const sum = (k) => rls.reduce((t, r) => t + r[k], 0);
  assert.equal(sum("refundCents"), l.lineGrossCents);
  assert.equal(sum("commissionReversedCents"), l.commissionCents);
  assert.equal(sum("artfestFundedReversedCents"), l.artfestFundedDiscountCents);
  assert.equal(sum("vendorNetReversedCents"), l.vendorNetCents);
  assert.ok(rls.every((r) => r.vendorNetReversedCents === r.refundCents - r.commissionReversedCents + r.artfestFundedReversedCents));
  const headers = fake.tables.artfestFairSaleReturn;
  assert.equal(headers.reduce((t, r) => t + r.refundCents, 0), s.totalPaidCents);
  assert.equal(saleRow(s.id).status, "RETURNED");
  // nimic în plus de returnat
  const extra = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]));
  assert.equal(extra.status, 409);
  assert.equal(extra.body.error, "sale_fully_returned");
});

test("alocarea pe bucăți: oricum împarți returul, totalul e același", () => {
  const line = { lineGrossCents: 12594, commissionCents: 1259, artfestFundedDiscountCents: 1259, quantity: 7 };
  for (const split of [[7], [1, 1, 1, 1, 1, 1, 1], [3, 4], [2, 3, 2], [6, 1]]) {
    let from = 0;
    const acc = { refundCents: 0, commissionReversedCents: 0, artfestFundedReversedCents: 0, vendorNetReversedCents: 0 };
    for (const q of split) {
      const a = returnsSvc.reversedAmounts(line, from, q);
      for (const k of Object.keys(acc)) acc[k] += a[k];
      assert.ok(a.commissionReversedCents <= a.refundCents);
      from += q;
    }
    assert.deepEqual(acc, { refundCents: 12594, commissionReversedCents: 1259, artfestFundedReversedCents: 1259, vendorNetReversedCents: 12594 });
  }
});

test("cantitate peste disponibil => 409, nimic scris", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const res = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 3, disposition: "RESTOCKED" }]));
  assert.equal(res.status, 409);
  assert.match(res.body.problems[0].messages[0], /cel mult 2/);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 0);
  assert.equal(item(ctx.lA1.id).availableQty, 8);
  // aceeași linie de două ori (dispoziții diferite) peste cantitate => tot 409
  const both = await doReturn(s.id, retBody([
    { saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" },
    { saleLineId: l.id, quantity: 2, disposition: "NOT_RETURNED", conditionNote: "Clientul a pierdut produsul", ...BY_VENDOR },
  ]));
  assert.equal(both.status, 409);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 0);
});

test("două retururi simultane pe ultima bucată => doar unul reușește", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  const l = lineOf(s, ctx.lA1.id);
  const body = retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]);
  const [a, b] = await Promise.all([doReturn(s.id, body), doReturn(s.id, body)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 1);
  assert.equal(item(ctx.lA1.id).availableQty, 10);
  assert.equal(fake.tables.artfestFairSaleLine[0].returnedQty, 1);
});

test("NOT_RESTOCKED: SALE_REVERSED + DAMAGED, availableQty NU crește; responsabil + motiv obligatorii", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const missing = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED" }]));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "responsibility_required");
  const noReason = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", refundResponsibility: "VENDOR", responsibilityReason: " a " }]));
  assert.equal(noReason.body.error, "responsibility_reason_required");
  const res = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", conditionNote: "Spart la colț", ...BY_VENDOR }]));
  assert.equal(res.status, 201, res.text);
  const it = item(ctx.lA1.id);
  assert.equal(it.availableQty, 8);
  assert.equal(it.soldQty, 1);
  assert.equal(it.damagedQty, 1);
  assert.equal(it.availableQty, it.receivedQty - it.soldQty - it.damagedQty - it.lostQty - it.returnedQty);
  const types = movementsOf(ctx.lA1.id).filter((m) => m.saleReturnLineId).map((m) => m.type).sort();
  assert.deepEqual(types, ["DAMAGED", "SALE_REVERSED"]);
  assert.match(movementsOf(ctx.lA1.id).find((m) => m.type === "DAMAGED").reason, /Spart la colț/);
});

test("NOT_RETURNED: fără mișcare de stoc, availableQty neschimbat; responsabil + motiv obligatorii", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  assert.equal((await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED" }]))).body.error, "responsibility_required");
  assert.equal((await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", refundResponsibility: "CLIENT", responsibilityReason: "abc" }]))).body.error, "invalid_responsibility");
  const movesBefore = fake.tables.artfestFairStockMovement.length;
  const res = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", conditionNote: "Produs defect, clientul nu l-a adus", ...BY_VENDOR }]));
  assert.equal(res.status, 201, res.text);
  assert.equal(fake.tables.artfestFairStockMovement.length, movesBefore);
  assert.equal(item(ctx.lA1.id).availableQty, 8);
  assert.equal(item(ctx.lA1.id).soldQty, 2);
  assert.equal(res.body.saleReturn.refundCents, 3900);
  assert.equal(fake.tables.artfestFairSaleLine[0].returnedQty, 1);
});

test("reducere VENDOR: artfestFundedReversed 0; reducere ARTFEST: compensația se inversează", async () => {
  discount({ inventoryItemId: ctx.lA1.id, percentBps: 2000, fundingSource: "VENDOR" });
  discount({ inventoryItemId: ctx.lB1.id, percentBps: 1000, fundingSource: "ARTFEST" });
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }]);
  const la = lineOf(s, ctx.lA1.id);
  const lb = lineOf(s, ctx.lB1.id);
  const res = await doReturn(s.id, retBody([
    { saleLineId: la.id, quantity: 1, disposition: "RESTOCKED" },
    { saleLineId: lb.id, quantity: 1, disposition: "RESTOCKED" },
  ]));
  assert.equal(res.status, 201, res.text);
  const byLine = (id) => res.body.saleReturn.lines.find((x) => x.saleLineId === id);
  assert.equal(byLine(la.id).artfestFundedReversedCents, 0);
  assert.equal(byLine(la.id).vendorNetReversedCents, la.vendorNetCents);
  assert.equal(byLine(lb.id).artfestFundedReversedCents, lb.artfestFundedDiscountCents);
  assert.ok(lb.artfestFundedDiscountCents > 0);
  assert.equal(byLine(lb.id).vendorNetReversedCents, lb.vendorNetCents);
  assert.equal(saleRow(s.id).status, "RETURNED");
});

test("rambursare CASH / CARD salvată; MIXED / lipsă => 400", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }], "CARD");
  const l = lineOf(s, ctx.lA1.id);
  const line1 = [{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }];
  assert.equal((await doReturn(s.id, retBody(line1, "MIXED"))).body.error, "invalid_refund_method");
  assert.equal((await doReturn(s.id, retBody(line1, ""))).body.error, "invalid_refund_method");
  assert.equal((await doReturn(s.id, retBody(line1, "CASH"))).body.saleReturn.refundMethod, "CASH");
  assert.equal((await doReturn(s.id, retBody(line1, "CARD"))).body.saleReturn.refundMethod, "CARD");
});

test("vânzare multi-vendor: retur doar pe linia vendorului ales", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }, { inventoryItemId: ctx.lB1.id, quantity: 2 }]);
  const lb = lineOf(s, ctx.lB1.id);
  const res = await doReturn(s.id, retBody([{ saleLineId: lb.id, quantity: 2, disposition: "RESTOCKED" }]));
  assert.equal(res.status, 201);
  assert.ok(res.body.saleReturn.lines.every((x) => x.vendorId === ctx.vB.id));
  assert.equal(fake.tables.artfestFairSaleLine.find((x) => x.inventoryItemId === ctx.lA1.id).returnedQty, 0);
  assert.equal(item(ctx.lA1.id).availableQty, 9);
  assert.equal(item(ctx.lB1.id).availableQty, 10);
  assert.equal(saleRow(s.id).status, "PARTIALLY_RETURNED");
});

test("rollback complet: o linie invalidă => niciun retur, stocul și numerotarea neatinse", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const other = await sell([{ inventoryItemId: ctx.lB1.id, quantity: 1 }]);
  const l = lineOf(s, ctx.lA1.id);
  const foreign = lineOf(other, ctx.lB1.id);
  const snapshot = JSON.stringify({ items: fake.tables.artfestFairInventoryItem, lines: fake.tables.artfestFairSaleLine, mv: fake.tables.artfestFairStockMovement.length });
  const res = await doReturn(s.id, retBody([
    { saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" },
    { saleLineId: foreign.id, quantity: 1, disposition: "RESTOCKED" },
  ]));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "return_not_allowed");
  assert.equal(fake.tables.artfestFairSaleReturn.length, 0);
  assert.equal(fake.tables.artfestFairSaleReturnLine.length, 0);
  assert.equal(JSON.stringify({ items: fake.tables.artfestFairInventoryItem, lines: fake.tables.artfestFairSaleLine, mv: fake.tables.artfestFairStockMovement.length }), snapshot);
  assert.equal(fake.tables.artfestFair[0].nextReturnNumber, 1);
  assert.equal(saleRow(s.id).status, "COMPLETED");
});

test("RESTOCKED pe un produs care nu mai e în stocul activ => refuz cu explicație", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }]);
  item(ctx.lA1.id).status = "CLOSED";
  const l = lineOf(s, ctx.lA1.id);
  const res = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]));
  assert.equal(res.status, 409);
  assert.match(res.body.problems[0].messages.join(" "), /nevandabil/);
});

test("idempotență retur: același conținut => replay; alt conținut pe aceeași cheie => 409", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 3 }]);
  const l = lineOf(s, ctx.lA1.id);
  const key = newKey();
  const body = retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]);
  const a = await doReturn(s.id, body, key);
  const b = await doReturn(s.id, body, key);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.saleReturn.id, a.body.saleReturn.id);
  const c = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 2, disposition: "RESTOCKED" }]), key);
  assert.equal(c.status, 409);
  assert.equal(c.body.error, "idempotency_conflict");
  const d = await doReturn(s.id, { ...body, refundMethod: "CARD" }, key);
  assert.equal(d.status, 409);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 1);
  assert.equal(item(ctx.lA1.id).availableQty, 8);
  // dublu click simultan cu aceeași cheie => un singur retur
  const key2 = newKey();
  const [x, y] = await Promise.all([doReturn(s.id, body, key2), doReturn(s.id, body, key2)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]);
  assert.equal(fake.tables.artfestFairSaleReturn.length, 2);
});

test("preview: sumele inversate și efectul pe stoc, fără scriere", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const res = await call("POST", `${POS}/sales/${s.id}/returns/preview`, {
    body: { type: "RETURN", refundMethod: "CASH", lines: [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", conditionNote: "x" }] },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.responsibilityOk, false, "preview arată sumele și înainte de alegerea responsabilului");
  const art = await call("POST", `${POS}/sales/${s.id}/returns/preview`, {
    body: { type: "RETURN", refundMethod: "CASH", lines: [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", ...BY_ARTFEST }] },
  });
  assert.equal(art.body.responsibilityOk, true);
  assert.equal(art.body.lines[0].vendorAffected, false);
  assert.equal(art.body.lines[0].vendorNetImpactCents, 0);
  assert.equal(art.body.lines[0].artfestBorneRefundCents, 3900);
  assert.equal(art.body.totals.artfestBorneRefundCents, 3900);
  const ven = await call("POST", `${POS}/sales/${s.id}/returns/preview`, {
    body: { type: "RETURN", refundMethod: "CASH", lines: [{ saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", ...BY_VENDOR }] },
  });
  assert.equal(ven.body.lines[0].vendorAffected, true);
  assert.equal(ven.body.lines[0].vendorNetImpactCents, 3510);
  assert.equal(ven.body.totals.artfestBorneRefundCents, 0);
  assert.equal(res.body.totals.refundCents, 3900);
  assert.equal(res.body.lines[0].stock.availableDelta, 0);
  assert.deepEqual(res.body.lines[0].stock.movements, ["SALE_REVERSED", "DAMAGED"]);
  assert.equal(res.body.nextStatus, "PARTIALLY_RETURNED");
  const v = await call("POST", `${POS}/sales/${s.id}/returns/preview`, { body: { type: "VOID" } });
  assert.equal(v.body.totals.refundCents, s.totalPaidCents);
  assert.equal(v.body.nextStatus, "VOIDED");
  assert.equal(fake.tables.artfestFairSaleReturn.length, 0);
});

/* ============================== cine suportă rambursarea ============================== */

// invariantul din CHECK-urile AFSRL_responsibility_chk / AFSRL_responsibility_reason_chk
function assertResponsibilityInvariant() {
  for (const l of fake.tables.artfestFairSaleReturnLine) {
    const needs = ["NOT_RETURNED", "NOT_RESTOCKED"].includes(l.disposition);
    assert.equal(l.refundResponsibility != null, needs, `${l.disposition} / ${l.refundResponsibility}`);
    if (l.refundResponsibility) assert.ok(String(l.responsibilityReason || "").trim().length >= 3);
    else assert.equal(l.responsibilityReason ?? null, null);
  }
}

test("RESTOCKED: fără responsabil (alegerea e refuzată); VOID: liniile fără responsabil", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const bad = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED", ...BY_ARTFEST }]));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "responsibility_not_allowed");
  const ok = await doReturn(s.id, retBody([{ saleLineId: l.id, quantity: 1, disposition: "RESTOCKED" }]));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.saleReturn.lines[0].refundResponsibility, null);
  assert.equal(ok.body.saleReturn.lines[0].vendorAffected, true);
  const s2 = await sell([{ inventoryItemId: ctx.lB1.id, quantity: 1 }]);
  const v = await doVoid(s2.id);
  assert.ok(v.body.saleReturn.lines.every((x) => x.refundResponsibility === null && x.responsibilityReason === null));
  assertResponsibilityInvariant();
});

test("ARTFEST: vendorul neafectat, valorile originale păstrate pentru audit; VENDOR: netul vendorului scade", async () => {
  discount({ inventoryItemId: ctx.lA2.id, percentBps: 1000, fundingSource: "ARTFEST" });
  const s = await sell([{ inventoryItemId: ctx.lA2.id, quantity: 4 }], "CARD");
  const l = lineOf(s, ctx.lA2.id);
  const res = await doReturn(s.id, retBody([
    { saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_ARTFEST },
    { saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_VENDOR },
    { saleLineId: l.id, quantity: 1, disposition: "NOT_RESTOCKED", conditionNote: "Zgâriat", ...BY_ARTFEST },
  ], "CARD"));
  assert.equal(res.status, 201, res.text);
  const lines = res.body.saleReturn.lines;
  assert.equal(lines.length, 3);
  const art = lines.filter((x) => x.refundResponsibility === "ARTFEST");
  const ven = lines.find((x) => x.refundResponsibility === "VENDOR");
  // valorile inversate rămân integrale pe fiecare linie, indiferent de responsabil
  for (const x of lines) {
    assert.ok(x.refundCents > 0 && x.vendorNetReversedCents > 0 && x.artfestFundedReversedCents >= 0);
    assert.equal(x.vendorNetReversedCents, x.refundCents - x.commissionReversedCents + x.artfestFundedReversedCents);
  }
  assert.ok(art.every((x) => x.vendorAffected === false && x.vendorNetImpactCents === 0 && x.artfestBorneRefundCents === x.refundCents));
  assert.equal(ven.vendorAffected, true);
  assert.equal(ven.vendorNetImpactCents, ven.vendorNetReversedCents);
  assert.equal(ven.artfestBorneRefundCents, 0);
  // artfestBorneRefundCents = refundCents al liniilor ARTFEST (NU vendorNetReversedCents)
  assert.equal(res.body.saleReturn.artfestBorneRefundCents, art.reduce((t, x) => t + x.refundCents, 0));
  assert.equal(res.body.saleReturn.vendorNetImpactCents, ven.vendorNetReversedCents);
  // antetul păstrează totalurile integrale (audit)
  assert.equal(res.body.saleReturn.refundCents, lines.reduce((t, x) => t + x.refundCents, 0));
  // linia de vânzare nu se modifică retroactiv (doar returnedQty)
  const row = fake.tables.artfestFairSaleLine.find((x) => x.id === l.id);
  assert.equal(row.vendorNetCents, l.vendorNetCents);
  assert.equal(row.lineGrossCents, l.lineGrossCents);
  assert.equal(row.returnedQty, 3);
  // motivul intern se salvează pe linie
  assert.equal(fake.tables.artfestFairSaleReturnLine.find((x) => x.refundResponsibility === "VENDOR").responsibilityReason, "Imputat vendorului (test)");
  assertResponsibilityInvariant();

  // rapoartele zilei: vendorul scade DOAR ce îi e imputat; Admin separă vendor / Artfest
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const artRefund = art.reduce((t, x) => t + x.refundCents, 0);
  const vr = (await call("GET", `/api/vendor/artfest-fair/reports/daily?date=${today}`, { as: ctx.u1 })).body;
  assert.equal(vr.returns.refundCents, artRefund + ven.refundCents);
  assert.equal(vr.returns.vendorBorne.refundCents, ven.refundCents);
  assert.equal(vr.returns.artfestBorne.refundCents, artRefund);
  assert.equal(vr.dayVendorNetCents, vr.vendorNetCents - ven.vendorNetReversedCents);
  assert.deepEqual(vr.returnLines.map((x) => x.affectsVendorNet).sort(), [false, false, true]);
  assert.equal(JSON.stringify(vr).includes("Imputat vendorului") || JSON.stringify(vr).includes("Gest comercial"), false);
  const sl = (await call("GET", `/api/vendor/artfest-fair/sales?date=${today}`, { as: ctx.u1 })).body.items[0];
  assert.equal(sl.returned.vendorNetImpactCents, ven.vendorNetReversedCents);
  assert.equal(sl.returned.refundCents, artRefund + ven.refundCents);
  const adm = (await call("GET", `${POS}/reports/daily?date=${today}`)).body;
  assert.equal(adm.returns.vendorBorne.refundCents, ven.refundCents);
  assert.equal(adm.returns.artfestBorne.refundCents, artRefund);
  assert.equal(adm.returns.vendorBorne.refundCents + adm.returns.artfestBorne.refundCents, adm.returns.refundCents);
  assert.equal(adm.dayVendorNetCents, adm.vendorNetCents - ven.vendorNetReversedCents);
  assert.equal(adm.consistent, true);
  const csv = await call("GET", `${POS}/reports/daily.csv?date=${today}`);
  assert.ok(csv.text.includes("Rambursări suportate de vendor (lei)") && csv.text.includes("Rambursări suportate de Artfest (lei)"));
});

test("idempotență: alt responsabil sau alt motiv pe aceeași cheie => 409", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }]);
  const l = lineOf(s, ctx.lA1.id);
  const key = newKey();
  const body = retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_VENDOR }]);
  assert.equal((await doReturn(s.id, body, key)).status, 201);
  assert.equal((await doReturn(s.id, body, key)).status, 200);
  const other = retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", ...BY_ARTFEST }]);
  assert.equal((await doReturn(s.id, other, key)).body.error, "idempotency_conflict");
  const otherReason = retBody([{ saleLineId: l.id, quantity: 1, disposition: "NOT_RETURNED", refundResponsibility: "VENDOR", responsibilityReason: "Alt motiv" }]);
  assert.equal((await doReturn(s.id, otherReason, key)).body.error, "idempotency_conflict");
  assert.equal(fake.tables.artfestFairSaleReturn.length, 1);
});

/* ============================== rapoarte ============================== */

const D = "2026-12-20";
const at = (date, hhmmUtc) => new Date(`${date}T${hhmmUtc}:00Z`);
const report = (as, date) => call("GET", as === ctx.admin ? `${POS}/reports/daily?date=${date}` : `/api/vendor/artfest-fair/reports/daily?date=${date}`, { as });

test("returul apare în ziua returului; ziua vânzării nu se rescrie; izolare vendor; Admin vede tot; CSV", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }], "CASH", at(D, "08:00"));
  const before = (await report(ctx.admin, D)).body;
  const la = lineOf(s, ctx.lA1.id);
  const lb = lineOf(s, ctx.lB1.id);
  const NEXT = "2026-12-21";
  await returnsSvc.returnSale({ saleId: s.id, idempotencyKey: newKey(), adminId: ctx.admin.id, now: at(NEXT, "09:00"),
    body: retBody([{ saleLineId: la.id, quantity: 1, disposition: "RESTOCKED" }], "CASH") });
  await returnsSvc.returnSale({ saleId: s.id, idempotencyKey: newKey(), adminId: ctx.admin.id, now: at(NEXT, "10:00"),
    body: retBody([{ saleLineId: lb.id, quantity: 1, disposition: "NOT_RETURNED", conditionNote: "Fără produs", ...BY_ARTFEST }], "CARD") });

  // ziua vânzării: identică
  const after = (await report(ctx.admin, D)).body;
  assert.equal(after.totalPaidCents, before.totalPaidCents);
  assert.equal(after.returns.count, 0);

  // ziua returului: Admin vede tot
  const adm = (await report(ctx.admin, NEXT)).body;
  assert.equal(adm.salesCount, 0);
  assert.equal(adm.returns.count, 2);
  assert.equal(adm.returns.refundCents, 3900 + 4550);
  assert.equal(adm.returns.cashRefundCents, 3900);
  assert.equal(adm.returns.cardRefundCents, 4550);
  assert.equal(adm.returns.vendorBorne.vendorNetReversedCents, 3510);
  assert.equal(adm.returns.vendorBorne.refundCents, 3900);
  assert.equal(adm.returns.artfestBorne.refundCents, 4550);
  assert.equal(adm.netCollectedCents, -(3900 + 4550));
  assert.equal(adm.dayVendorNetCents, -3510);
  assert.equal(adm.consistent, true);
  assert.equal(adm.vendors.length, 2);

  // vendor A: doar returul lui
  const a = (await report(ctx.u1, NEXT)).body;
  assert.equal(a.returns.count, 1);
  assert.equal(a.returns.refundCents, 3900);
  assert.equal(a.returns.artfestBorne.refundCents, 0);
  assert.equal(a.dayVendorNetCents, -3510);
  assert.equal(a.returnLines.length, 1);
  assert.equal(a.returnLines[0].titleSnapshot, "Glob A");
  assert.equal(JSON.stringify(a).includes("Cană B"), false);
  assert.equal(JSON.stringify(a).includes("Clientul a returnat"), false, "motivul nu ajunge la vendor");

  // vendor B: rambursare suportată de Artfest => vede rambursarea, netul nu e afectat
  const b = (await report(ctx.u2, NEXT)).body;
  assert.equal(b.returns.refundCents, 4550);
  assert.equal(b.returns.artfestBorne.refundCents, 4550);
  assert.equal(b.returns.vendorBorne.vendorNetReversedCents, 0);
  assert.equal(b.dayVendorNetCents, 0);
  assert.equal(b.returnLines[0].affectsVendorNet, false);
  assert.equal(b.returnLines[0].vendorNetImpactCents, 0);
  assert.equal(JSON.stringify(b).includes("Gest comercial"), false, "motivul intern nu ajunge la vendor");

  // zi fără retururi / vânzări => 0
  const empty = (await report(ctx.u1, "2026-12-22")).body;
  assert.equal(empty.returns.count, 0);
  assert.equal(empty.returns.refundCents, 0);
  assert.equal(empty.dayVendorNetCents, 0);

  // CSV-urile includ retururile
  const csvA = await call("GET", `/api/vendor/artfest-fair/reports/daily.csv?date=${NEXT}`, { as: ctx.u1 });
  assert.ok(csvA.text.includes("Rambursat total (lei)") && csvA.text.includes("Glob A") && csvA.text.includes("Returnat, revandabil"));
  assert.equal(csvA.text.includes("Cană B"), false);
  const csvAdm = await call("GET", `${POS}/reports/daily.csv?date=${NEXT}`);
  assert.ok(csvAdm.text.includes("Încasat net al zilei") && csvAdm.text.includes("Fără produs") === false && csvAdm.text.includes("Clientul a returnat"));
});

test("vânzările vendorului: status pe linie, cantitate și sume returnate, fără motiv / date client", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }], "CASH", at(D, "08:00"));
  const lb = lineOf(s, ctx.lB1.id);
  await doReturn(s.id, retBody([{ saleLineId: lb.id, quantity: 1, disposition: "RESTOCKED" }], "CASH", "Client nemulțumit, tel 0722"));
  const a = (await call("GET", `/api/vendor/artfest-fair/sales?date=${D}`, { as: ctx.u1 })).body;
  assert.equal(a.items[0].status, "COMPLETED", "linia vendorului A nu e afectată de returul lui B");
  assert.equal(a.items[0].returnedQty, 0);
  const b = (await call("GET", `/api/vendor/artfest-fair/sales?date=${D}`, { as: ctx.u2 }));
  assert.equal(b.body.items[0].status, "RETURNED");
  assert.equal(b.body.items[0].returned.quantity, 1);
  assert.equal(b.body.items[0].returned.refundCents, lb.lineGrossCents);
  assert.equal(b.body.items[0].returned.vendorNetReversedCents, lb.vendorNetCents);
  assert.equal(b.text.includes("0722"), false);
});

/* ============================== notificarea zilnică ============================== */

const dailyNotifs = () => fake.tables.notification.filter((n) => n.meta?.kind === "artfest_fair_daily_sales");

test("notificare zilnică: prima vânzare creează, următoarele o actualizează; câte una pe vendor", async () => {
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }], "CASH", at(D, "08:00"));
  assert.equal(dailyNotifs().length, 1);
  const first = dailyNotifs()[0];
  assert.equal(first.vendorId, ctx.vA.id);
  assert.equal(first.userId, ctx.u1.id);
  assert.equal(first.dedupeKey, `artfest_fair_daily_sales:${ctx.fair.id}:${ctx.vA.id}:${D}`);
  assert.match(first.body, /Astăzi ai vândut 1 produs la Târgul Artfest\. Net estimat: 35,10 lei\./);
  assert.equal(first.link, `/vendor/targ-artfest?date=${D}#vanzari`);
  first.readAt = new Date();

  await sell([{ inventoryItemId: ctx.lA2.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }], "CARD", at(D, "12:00"));
  const all = dailyNotifs();
  assert.equal(all.length, 2, "una pentru A (actualizată) + una pentru B");
  const a = all.find((n) => n.vendorId === ctx.vA.id);
  assert.equal(a.id, first.id);
  assert.equal(a.meta.units, 3);
  assert.equal(a.readAt, null, "actualizarea o face din nou necitită");
  assert.match(a.body, /3 produse/);
  const b = all.find((n) => n.vendorId === ctx.vB.id);
  assert.equal(b.userId, ctx.u2.id);
  assert.equal(b.meta.units, 1);
  assert.equal(JSON.stringify(b).includes("Glob A"), false);
});

test("notificare zilnică: zi nouă => notificare nouă; retry => fără duplicat; anularea nu o rescrie", async () => {
  const s = await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }], "CASH", at(D, "08:00"));
  // retry al aceleiași vânzări (aceeași cheie)
  const key = newKey("sale");
  await pos.createSale({ body: { lines: [{ inventoryItemId: ctx.lA1.id, quantity: 1 }], paymentMethod: "CASH" }, idempotencyKey: key, adminId: ctx.admin.id, now: at(D, "09:00") });
  await pos.createSale({ body: { lines: [{ inventoryItemId: ctx.lA1.id, quantity: 1 }], paymentMethod: "CASH" }, idempotencyKey: key, adminId: ctx.admin.id, now: at(D, "09:00") });
  assert.equal(dailyNotifs().length, 1);
  assert.equal(dailyNotifs()[0].meta.units, 2);

  // anularea nu rescrie notificarea zilei
  await doVoid(s.id);
  assert.equal(dailyNotifs()[0].meta.units, 2);

  // 00:30 local a zilei următoare => notificare nouă
  await sell([{ inventoryItemId: ctx.lA1.id, quantity: 1 }], "CASH", at(D, "22:30"));
  const notifs = dailyNotifs();
  assert.equal(notifs.length, 2);
  assert.deepEqual(notifs.map((n) => n.meta.localDate).sort(), [D, "2026-12-21"]);
});
