// Teste pentru POS-ul Târgului Artfest (MVP): scanare, garda de vânzare, coș,
// preview, vânzare atomică CASH / CARD, reduceri (VENDOR / ARTFEST - D8),
// idempotență, concurență pe ultima bucată, rollback complet.
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairPos.routes.test.js

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
  namedExports: {
    buildPublicUrl: (key) => `https://cdn.test/${key}`,
    async uploadToR2() {
      return { url: "https://cdn.test/x.jpg" };
    },
  },
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

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  pos = await import("../services/artfestFairPosService.js");
  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
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

// linie recepționată, cu etichetă validă (ca după fluxul real)
function receivedLine(line, qty) {
  const row = fake.tables.artfestFairInventoryItem.find((l) => l.id === line.id);
  Object.assign(row, {
    status: "RECEIVED",
    receivedQty: qty,
    availableQty: qty,
    receivedAt: new Date(),
    labelGeneratedAt: new Date(),
    labelPriceCents: row.priceSnapshotCents,
  });
  return row;
}

beforeEach(async () => {
  fake = createFakePrisma();
  const [admin, v1, v2] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
  ]);
  const [vendor1, vendor2] = fake.seed("vendor", [
    { userId: v1.id, displayName: "Atelier Ana" },
    { userId: v2.id, displayName: "Ceramica Ion" },
  ]);
  const [s1, s2] = fake.seed("vendorService", [
    { vendorId: vendor1.id, title: "S1" },
    { vendorId: vendor2.id, title: "S2" },
  ]);
  const [fair, otherFair] = fake.seed("artfestFair", [
    {
      key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000,
      inventoryDeadlineAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 9 * DAY),
    },
    { key: "ALT_TARG_2025", title: "Alt târg", registrationOpen: false },
  ]);
  const [r1, r2] = fake.seed("artfestFairRegistration", [
    { fairId: fair.id, vendorId: vendor1.id, submittedByUserId: v1.id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" },
    { fairId: fair.id, vendorId: vendor2.id, submittedByUserId: v2.id, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" },
  ]);
  const [pA, pB, pC] = fake.seed("product", [
    product(s1.id, { title: "Spiriduș", priceCents: 3900, readyQty: 10 }),
    product(s1.id, { title: "Glob", priceCents: 1999, readyQty: 10 }),
    product(s2.id, { title: "Cană", priceCents: 4550, readyQty: 10 }),
  ]);

  const a = await inventory.addInventoryItem({ vendorId: vendor1.id, userId: v1.id, body: { productId: pA.id, declaredQty: 3 } });
  const b = await inventory.addInventoryItem({ vendorId: vendor1.id, userId: v1.id, body: { productId: pB.id, declaredQty: 1 } });
  await inventory.submitInventory({ vendorId: vendor1.id, userId: v1.id });
  const c = await inventory.addInventoryItem({ vendorId: vendor2.id, userId: v2.id, body: { productId: pC.id, declaredQty: 2 } });
  await inventory.submitInventory({ vendorId: vendor2.id, userId: v2.id });

  ctx = { admin, v1, v2, vendor1, vendor2, fair, otherFair, r1, r2, pA, pB, pC };
  ctx.lA = receivedLine(a, 3);
  ctx.lB = receivedLine(b, 1);
  ctx.lC = receivedLine(c, 2);
});

let seq = 0;
const newKey = () => `pos-key-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function call(method, path, { as, body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text };
}

const POS = "/api/admin/artfest-fair/pos";
const line = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const scan = (barcode) => call("GET", `${POS}/scan?barcode=${encodeURIComponent(barcode)}`, { as: ctx.admin });
const sell = (lines, paymentMethod = "CASH", key = newKey()) =>
  call("POST", `${POS}/sales`, { as: ctx.admin, key, body: { lines, paymentMethod } });
const sales = () => fake.tables.artfestFairSale;

function discount(extra) {
  return fake.seed("artfestFairDiscount", [
    {
      fairId: ctx.fair.id, name: "Reducere", type: "PERCENT", percentBps: 2000, amountCents: null,
      scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA.id, vendorId: null, fundingSource: "VENDOR",
      status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id, ...extra,
    },
  ])[0];
}

/* ============================== acces + scanare ============================== */

test("doar ADMIN pentru POS", async () => {
  assert.equal((await call("GET", `${POS}/scan?barcode=${ctx.lA.barcode}`)).status, 401);
  assert.equal((await call("GET", `${POS}/scan?barcode=${ctx.lA.barcode}`, { as: ctx.v1 })).status, 403);
  assert.equal((await call("POST", `${POS}/sales`, { as: ctx.v1, key: newKey(), body: {} })).status, 403);
});

test("scanare validă: normalizează lowercase / spații / cratime și nu modifică nimic", async () => {
  const raw = `${ctx.lA.barcode.slice(0, 2)}-${ctx.lA.barcode.slice(2, 6)} ${ctx.lA.barcode.slice(6)}`.toLowerCase();
  const before = JSON.stringify(fake.tables.artfestFairInventoryItem);
  const res = await scan(raw);
  assert.equal(res.status, 200, res.text);
  const item = res.body.item;
  assert.equal(item.inventoryItemId, ctx.lA.id);
  assert.equal(item.priceCents, 3900);
  assert.equal(item.availableQty, 3);
  assert.equal(item.sellable, true);
  assert.equal(item.vendor.name, "Atelier Ana");
  assert.equal(JSON.stringify(fake.tables.artfestFairInventoryItem), before);
});

test("scanare: cod inexistent => 404; produs din alt târg => nevandabil", async () => {
  assert.equal((await scan("AF22222222")).status, 404);
  assert.equal((await scan("nu-e-cod")).status, 404);
  line(ctx.lA.id).fairId = ctx.otherFair.id;
  const res = await scan(ctx.lA.barcode);
  assert.equal(res.body.item.sellable, false);
  assert.ok(res.body.item.reasons.includes("other_fair"));
});

test("garda: fiecare motiv de blocare are mesaj clar", async () => {
  const cases = [
    ["registration_inactive", () => (fake.tables.artfestFairRegistration.find((r) => r.id === ctx.r1.id).status = "CANCELLED"), "Participarea vendorului nu mai este activă."],
    ["not_received", () => (line(ctx.lA.id).status = "SUBMITTED"), null],
    ["sale_blocked", () => (line(ctx.lA.id).saleBlockedAt = new Date()), "Produs blocat de la vânzare."],
    ["label_missing", () => (line(ctx.lA.id).labelGeneratedAt = null), "Eticheta lipsește."],
    ["label_outdated", () => (line(ctx.lA.id).labelPriceCents = 3500), "Prețul de pe etichetă nu mai corespunde."],
    ["insufficient_stock", () => (line(ctx.lA.id).availableQty = 0), "Stoc insuficient."],
    ["sales_closed", () => (fake.tables.artfestFair.find((f) => f.id === ctx.fair.id).salesOpen = false), "Vânzările la târg nu sunt deschise."],
  ];
  for (const [reason, mutate, message] of cases) {
    const snapshot = JSON.parse(JSON.stringify({ i: line(ctx.lA.id), r: fake.tables.artfestFairRegistration, f: fake.tables.artfestFair }));
    mutate();
    const res = await scan(ctx.lA.barcode);
    assert.equal(res.body.item.sellable, false, reason);
    assert.ok(res.body.item.reasons.includes(reason), `${reason}: ${res.body.item.reasons}`);
    if (message) assert.ok(res.body.item.messages.includes(message), reason);
    // vânzarea e refuzată la fel
    const sold = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
    assert.equal(sold.status, 409, reason);
    // refacere
    Object.assign(line(ctx.lA.id), snapshot.i, {
      receivedAt: new Date(snapshot.i.receivedAt),
      labelGeneratedAt: snapshot.i.labelGeneratedAt ? new Date(snapshot.i.labelGeneratedAt) : null,
      saleBlockedAt: null,
    });
    fake.tables.artfestFairRegistration.find((r) => r.id === ctx.r1.id).status = "APPROVED";
    fake.tables.artfestFair.find((f) => f.id === ctx.fair.id).salesOpen = true;
  }
  assert.equal(sales().length, 0);
});

test("stoc rezervat într-un retur către vendor în pregătire nu se mai poate vinde", async () => {
  const [ret] = fake.seed("artfestFairReturn", [
    { fairId: ctx.fair.id, registrationId: ctx.r1.id, vendorId: ctx.vendor1.id, number: 1, reason: "FAIR_ENDED_UNSOLD", costPayer: "VENDOR", method: "PICKUP", status: "PREPARING" },
  ]);
  fake.seed("artfestFairReturnLine", [{ returnId: ret.id, inventoryItemId: ctx.lA.id, qtyFromStock: 3 }]);
  const res = await scan(ctx.lA.barcode);
  assert.equal(res.body.item.availableQty, 0);
  assert.ok(res.body.item.reasons.includes("insufficient_stock"));
});

/* ============================== preview + calcule ============================== */

test("preview: calcul pe server, multi-vendor, comision 10% în bani întregi", async () => {
  const res = await call("POST", `${POS}/preview`, {
    as: ctx.admin,
    body: {
      lines: [
        { inventoryItemId: ctx.lA.id, quantity: 2, priceCents: 1 }, // prețul din client e ignorat
        { inventoryItemId: ctx.lB.id, quantity: 1 },
        { inventoryItemId: ctx.lC.id, quantity: 1 },
      ],
    },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.canConfirm, true);
  // 2 × 3900 + 1999 + 4550 = 14349
  assert.equal(res.body.totals.listCents, 14349);
  assert.equal(res.body.totals.totalPaidCents, 14349);
  // round_half_up: 780 + 199.9 -> 200 + 455
  assert.equal(res.body.totals.commissionCents, 780 + 200 + 455);
  assert.equal(res.body.totals.vendorNetCents, 14349 - 1435);
  assert.equal(res.body.vendors.length, 2);
  const ana = res.body.vendors.find((v) => v.vendorName === "Atelier Ana");
  assert.deepEqual({ g: ana.grossCents, c: ana.commissionCents, n: ana.vendorNetCents }, { g: 9799, c: 980, n: 8819 });
});

test("preview: linia nevandabilă e raportată, cu canConfirm false", async () => {
  line(ctx.lB.id).labelGeneratedAt = null;
  const res = await call("POST", `${POS}/preview`, { as: ctx.admin, body: { lines: [{ inventoryItemId: ctx.lA.id, quantity: 1 }, { inventoryItemId: ctx.lB.id, quantity: 1 }] } });
  assert.equal(res.body.canConfirm, false);
  assert.equal(res.body.problems[0].inventoryItemId, ctx.lB.id);
  assert.deepEqual(res.body.problems[0].messages, ["Eticheta lipsește."]);
});

test("formule: reducere VENDOR (artfestFunded 0) și ARTFEST (vendor neutru, D8)", () => {
  const vendorFunded = pos.computeLine({
    listUnitPriceCents: 3900, quantity: 2, commissionBps: 1000,
    discount: { type: "PERCENT", percentBps: 2000, fundingSource: "VENDOR" },
  });
  assert.deepEqual(
    { d: vendorFunded.lineDiscountCents, g: vendorFunded.lineGrossCents, c: vendorFunded.commissionCents, af: vendorFunded.artfestFundedDiscountCents, n: vendorFunded.vendorNetCents },
    { d: 1560, g: 6240, c: 624, af: 0, n: 5616 }
  );

  const artfestFunded = pos.computeLine({
    listUnitPriceCents: 3900, quantity: 2, commissionBps: 1000,
    discount: { type: "PERCENT", percentBps: 2000, fundingSource: "ARTFEST" },
  });
  // vendorul primește exact cât fără reducere: 7800 - 780
  assert.equal(artfestFunded.vendorNetCents, 7020);
  assert.equal(artfestFunded.artfestFundedDiscountCents, 7020 - 5616);
  assert.ok(artfestFunded.artfestFundedDiscountCents <= artfestFunded.lineDiscountCents);

  const fixed = pos.computeLine({
    listUnitPriceCents: 1999, quantity: 3, commissionBps: 1000,
    discount: { type: "FIXED_AMOUNT", amountCents: 500, fundingSource: "VENDOR" },
  });
  assert.deepEqual({ d: fixed.lineDiscountCents, g: fixed.lineGrossCents, eu: fixed.effectiveUnitPriceCents }, { d: 1500, g: 4497, eu: 1499 });
  // round_half_up în bani întregi
  assert.equal(pos.roundHalfUpDiv(19995, 10), 2000);
  assert.equal(pos.roundHalfUpDiv(19994, 10), 1999);
});

/* ============================== vânzarea ============================== */

test("vânzare CASH: o bucată, SOLD movement, stoc / soldQty, număr intern", async () => {
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "CASH");
  assert.equal(res.status, 201, res.text);
  const s = res.body.sale;
  assert.equal(s.saleNumber, 1);
  assert.match(s.receiptReference, /^TA\d{2}-000001$/);
  assert.equal(s.fiscal, false);
  assert.equal(s.paymentMethod, "CASH");
  assert.deepEqual({ t: s.totalPaidCents, c: s.commissionCents, n: s.vendorNetCents, cash: s.cashCents, card: s.cardCents }, { t: 3900, c: 390, n: 3510, cash: 3900, card: null });
  assert.deepEqual({ a: line(ctx.lA.id).availableQty, s: line(ctx.lA.id).soldQty }, { a: 2, s: 1 });
  const mv = fake.tables.artfestFairStockMovement.filter((m) => m.type === "SOLD");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].saleLineId, s.lines[0].id);
  assert.equal(s.lines[0].movements[0].type, "SOLD");
  assert.equal(fake.tables.artfestFair.find((f) => f.id === ctx.fair.id).nextSaleNumber, 2);
});

test("vânzare CARD multi-vendor cu două bucăți din același produs (scanat de două ori)", async () => {
  const res = await sell(
    [
      { inventoryItemId: ctx.lA.id, quantity: 1 },
      { inventoryItemId: ctx.lC.id, quantity: 1 },
      { inventoryItemId: ctx.lA.id, quantity: 1 },
    ],
    "CARD"
  );
  assert.equal(res.status, 201, res.text);
  const s = res.body.sale;
  assert.equal(s.lines.length, 2);
  assert.equal(s.lines.find((l) => l.inventoryItemId === ctx.lA.id).quantity, 2);
  assert.deepEqual({ card: s.cardCents, cash: s.cashCents }, { card: 12350, cash: null });
  assert.equal(s.vendors.length, 2);
  assert.equal(s.totalPaidCents, s.listCents - s.discountCents);
  assert.equal(s.vendorNetCents, s.lines.reduce((sum, l) => sum + l.vendorNetCents, 0));
  assert.deepEqual({ a: line(ctx.lA.id).availableQty, c: line(ctx.lC.id).availableQty }, { a: 1, c: 1 });
});

test("reducere VENDOR aplicată pe linie: alocare + snapshot, artfestFunded 0", async () => {
  const d = discount({ fundingSource: "VENDOR" });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2 }]);
  assert.equal(res.status, 201, res.text);
  const l = res.body.sale.lines[0];
  assert.deepEqual(
    { d: l.lineDiscountCents, g: l.lineGrossCents, c: l.commissionCents, af: l.artfestFundedDiscountCents, n: l.vendorNetCents },
    { d: 1560, g: 6240, c: 624, af: 0, n: 5616 }
  );
  const alloc = fake.tables.artfestFairSaleLineDiscount[0];
  assert.equal(alloc.discountId, d.id);
  assert.equal(alloc.amountCents, 1560);
  assert.equal(l.discount.fundingSource, "VENDOR");
});

test("reducere ARTFEST: vendorul rămâne neutru; reducerile inactive / expirate / pe alt produs se ignoră", async () => {
  discount({ fundingSource: "ARTFEST" });
  discount({ status: "DRAFT", percentBps: 9000 });
  discount({ endsAt: new Date(Date.now() - DAY), startsAt: new Date(Date.now() - 2 * DAY), percentBps: 9000 });
  discount({ inventoryItemId: ctx.lB.id, percentBps: 9000 });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2 }]);
  const l = res.body.sale.lines[0];
  assert.equal(l.lineDiscountCents, 1560);
  assert.equal(l.vendorNetCents, 7800 - 780);
  assert.equal(l.artfestFundedDiscountCents, 7020 - 5616);
  assert.equal(res.body.sale.totalPaidCents, 6240);
});

test("o singură reducere pe linie: cea pe produs are prioritate față de cea pe vendor", async () => {
  discount({ scope: "VENDOR", inventoryItemId: null, vendorId: ctx.vendor1.id, percentBps: 5000 });
  discount({ percentBps: 1000 });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(res.body.sale.lines[0].lineDiscountCents, 390);
  assert.equal(fake.tables.artfestFairSaleLineDiscount.length, 1);
});

test("idempotență: retry cu același conținut => aceeași vânzare; conținut diferit => 409", async () => {
  const key = newKey();
  const first = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "CASH", key);
  assert.equal(first.status, 201);
  const retry = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "CASH", key);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.sale.id, first.body.sale.id);
  assert.equal(sales().length, 1);
  assert.equal(line(ctx.lA.id).availableQty, 2);

  const conflict = await sell([{ inventoryItemId: ctx.lA.id, quantity: 2 }], "CASH", key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "idempotency_conflict");
  const otherMethod = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "CARD", key);
  assert.equal(otherMethod.status, 409);
  assert.equal(sales().length, 1);
});

test("dublu click simultan cu aceeași cheie => o singură vânzare", async () => {
  const key = newKey();
  const results = await Promise.all([1, 2, 3].map(() => sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "CASH", key)));
  assert.equal(new Set(results.map((r) => r.body.sale.id)).size, 1);
  assert.equal(sales().length, 1);
  assert.equal(line(ctx.lA.id).availableQty, 2);
});

test("două vânzări simultane pe ultima bucată => doar una reușește", async () => {
  const results = await Promise.all([
    sell([{ inventoryItemId: ctx.lB.id, quantity: 1 }], "CASH"),
    sell([{ inventoryItemId: ctx.lB.id, quantity: 1 }], "CARD"),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  const failed = results.find((r) => r.status === 409);
  assert.ok(failed.body.problems[0].reasons.includes("insufficient_stock"));
  assert.deepEqual({ a: line(ctx.lB.id).availableQty, s: line(ctx.lB.id).soldQty }, { a: 0, s: 1 });
  assert.equal(sales().length, 1);
});

test("rollback complet: o linie invalidă în coș => nicio vânzare, stocul și numerotarea neatinse", async () => {
  line(ctx.lC.id).saleBlockedAt = new Date();
  const res = await sell([
    { inventoryItemId: ctx.lA.id, quantity: 1 },
    { inventoryItemId: ctx.lC.id, quantity: 1 },
  ]);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "cart_not_sellable");
  assert.deepEqual(res.body.problems.map((p) => p.inventoryItemId), [ctx.lC.id]);
  assert.equal(sales().length, 0);
  assert.equal(fake.tables.artfestFairSaleLine.length, 0);
  assert.equal(fake.tables.artfestFairStockMovement.filter((m) => m.type === "SOLD").length, 0);
  assert.equal(line(ctx.lA.id).availableQty, 3);
  assert.equal(fake.tables.artfestFair.find((f) => f.id === ctx.fair.id).nextSaleNumber, 1);

  const tooMany = await sell([{ inventoryItemId: ctx.lA.id, quantity: 4 }]);
  assert.equal(tooMany.status, 409);
  assert.equal(line(ctx.lA.id).availableQty, 3);
});

test("validări: fără cheie, metodă invalidă (inclusiv MIXED), coș gol, cantitate invalidă", async () => {
  const noKey = await call("POST", `${POS}/sales`, { as: ctx.admin, body: { lines: [{ inventoryItemId: ctx.lA.id, quantity: 1 }], paymentMethod: "CASH" } });
  assert.equal(noKey.status, 400);
  assert.equal((await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }], "MIXED")).status, 400);
  assert.equal((await sell([], "CASH")).status, 400);
  assert.equal((await sell([{ inventoryItemId: ctx.lA.id, quantity: 0 }], "CASH")).status, 400);
  assert.equal(sales().length, 0);
});

test("istoric și detaliu vânzare: linii, reduceri, comision, net vendor, mișcări", async () => {
  discount({ fundingSource: "ARTFEST" });
  const sold = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }, { inventoryItemId: ctx.lC.id, quantity: 2 }], "CARD");
  const list = await call("GET", `${POS}/sales`, { as: ctx.admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.deepEqual(
    { n: list.body.items[0].saleNumber, u: list.body.items[0].units, m: list.body.items[0].paymentMethod, v: list.body.items[0].vendors.length },
    { n: 1, u: 3, m: "CARD", v: 2 }
  );
  const detail = await call("GET", `${POS}/sales/${sold.body.sale.id}`, { as: ctx.admin });
  const la = detail.body.item.lines.find((l) => l.inventoryItemId === ctx.lA.id);
  assert.equal(la.discount.fundingSource, "ARTFEST");
  assert.ok(la.movements[0].id);
  assert.equal(detail.body.item.vendors.length, 2);
});

test("deschiderea / închiderea vânzărilor", async () => {
  const closed = await call("POST", `${POS}/status`, { as: ctx.admin, body: { salesOpen: false } });
  assert.equal(closed.body.salesOpen, false);
  assert.equal((await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }])).status, 409);
  assert.equal((await call("POST", `${POS}/status`, { as: ctx.admin, body: { salesOpen: "da" } })).status, 400);
  const open = await call("POST", `${POS}/status`, { as: ctx.admin, body: { salesOpen: true } });
  assert.equal(open.body.salesOpen, true);
});

/* ============================== reduceri multiple ============================== */

const appliedDiscountId = () => fake.tables.artfestFairSaleLineDiscount.at(-1)?.discountId;

test("reduceri multiple, același scope: se aplică cea mai mare pentru client", async () => {
  discount({ scope: "VENDOR", inventoryItemId: null, vendorId: ctx.vendor1.id, percentBps: 1000 });
  const big = discount({ scope: "VENDOR", inventoryItemId: null, vendorId: ctx.vendor1.id, percentBps: 2500 });
  discount({ scope: "VENDOR", inventoryItemId: null, vendorId: ctx.vendor1.id, type: "FIXED_AMOUNT", percentBps: null, amountCents: 500 });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(res.status, 201, res.text);
  assert.equal(appliedDiscountId(), big.id);
  assert.equal(res.body.sale.lines[0].lineDiscountCents, 975);
  assert.equal(fake.tables.artfestFairSaleLineDiscount.length, 1);
});

test("reduceri multiple: INVENTORY_ITEM înaintea VENDOR, chiar dacă cea pe vendor e mai mare", async () => {
  discount({ scope: "VENDOR", inventoryItemId: null, vendorId: ctx.vendor1.id, percentBps: 9000 });
  const item = discount({ percentBps: 500 });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
  assert.equal(appliedDiscountId(), item.id);
  assert.equal(res.body.sale.lines[0].lineDiscountCents, 195);
});

test("reduceri multiple la egalitate: determinist după createdAt, apoi id (indiferent de ordinea din DB)", () => {
  const line = { id: "item", fairId: "f", vendorId: "v", priceSnapshotCents: 3900 };
  const base = { fairId: "f", status: "ACTIVE", scope: "INVENTORY_ITEM", inventoryItemId: "item", fundingSource: "VENDOR" };
  // 10% din 39 lei = 3,90 lei = reducere fixă de 3,90 lei / bucată => egalitate
  const older = { ...base, id: "zzz", type: "PERCENT", percentBps: 1000, createdAt: new Date("2026-10-01T10:00:00Z") };
  const newer = { ...base, id: "aaa", type: "FIXED_AMOUNT", amountCents: 390, createdAt: new Date("2026-10-02T10:00:00Z") };
  assert.equal(pos.pickDiscount([older, newer], line, 1).id, "zzz");
  assert.equal(pos.pickDiscount([newer, older], line, 1).id, "zzz");

  const sameTimeA = { ...older, id: "b-2" };
  const sameTimeB = { ...newer, id: "b-1", createdAt: older.createdAt };
  assert.equal(pos.pickDiscount([sameTimeA, sameTimeB], line, 1).id, "b-1");
  assert.equal(pos.pickDiscount([sameTimeB, sameTimeA], line, 1).id, "b-1");

  // același coș, de mai multe ori => același rezultat
  const runs = new Set(Array.from({ length: 5 }, () => pos.pickDiscount([newer, sameTimeA, older, sameTimeB], line, 1).id));
  assert.equal(runs.size, 1);
});

/* ============================== FIXED_AMOUNT per bucată ============================== */

test("FIXED_AMOUNT = reducere per bucată: min(amountCents × quantity, lineList), în bani întregi", async () => {
  const fixed = (amountCents, unit, quantity) =>
    pos.computeLine({ listUnitPriceCents: unit, quantity, commissionBps: 1000, discount: { type: "FIXED_AMOUNT", amountCents, fundingSource: "VENDOR" } });
  assert.equal(fixed(500, 1999, 3).lineDiscountCents, 1500);
  assert.equal(fixed(500, 1999, 3).lineGrossCents, 4497);
  // plafonată la valoarea liniei
  assert.equal(fixed(2500, 1999, 2).lineDiscountCents, 3998);
  assert.equal(fixed(2500, 1999, 2).lineGrossCents, 0);

  discount({ type: "FIXED_AMOUNT", percentBps: null, amountCents: 700 });
  const res = await sell([{ inventoryItemId: ctx.lA.id, quantity: 3 }]);
  assert.equal(res.status, 201, res.text);
  const l = res.body.sale.lines[0];
  assert.deepEqual({ list: l.lineListCents, d: l.lineDiscountCents, g: l.lineGrossCents }, { list: 11700, d: 2100, g: 9600 });
  assert.equal(fake.tables.artfestFairSaleLineDiscount[0].amountCents, 2100);
});

/* ============================== eligibilitatea produsului ============================== */

const productRow = (id) => fake.tables.product.find((p) => p.id === id);

test("produs dezaprobat / inactiv / ascuns / doar ofertă / șters => nevandabil, mesaj clar, fără override", async () => {
  const cases = [
    ["product_not_approved", () => (productRow(ctx.pA.id).moderationStatus = "REJECTED"), "Produsul nu mai este aprobat pe Artfest (moderare)."],
    ["product_inactive", () => (productRow(ctx.pA.id).isActive = false), "Produsul nu mai este activ pe Artfest."],
    ["product_hidden", () => (productRow(ctx.pA.id).isHidden = true), "Produsul este ascuns pe Artfest."],
    ["product_quote_only", () => (productRow(ctx.pA.id).orderMode = "QUOTE_ONLY"), "Produsul este doar la cerere de ofertă pe Artfest."],
    ["product_missing", () => (line(ctx.lA.id).productId = null), "Produsul nu mai există pe Artfest."],
  ];
  for (const [reason, mutate, message] of cases) {
    const snapshot = { p: { ...productRow(ctx.pA.id) }, productId: line(ctx.lA.id).productId };
    mutate();
    const scanned = await scan(ctx.lA.barcode);
    assert.equal(scanned.body.item.sellable, false, reason);
    assert.ok(scanned.body.item.reasons.includes(reason), reason);
    assert.ok(scanned.body.item.messages.includes(message), reason);
    const sold = await sell([{ inventoryItemId: ctx.lA.id, quantity: 1 }]);
    assert.equal(sold.status, 409, reason);
    assert.ok(sold.body.problems[0].reasons.includes(reason), reason);
    Object.assign(productRow(ctx.pA.id), snapshot.p);
    line(ctx.lA.id).productId = snapshot.productId;
  }
  assert.equal(sales().length, 0);
  assert.equal(line(ctx.lA.id).availableQty, 3);
});

test("unicat FORCED_UNAVAILABLE și stoc TRANSFERRED (SOLD_OUT online) rămân vandabile la stand", async () => {
  // unicat rezervat pentru târg: online devine SOLD_OUT prin fluxul târgului, NU prin moderare
  const [pU] = fake.seed("product", [product(fake.tables.vendorService[0].id, { title: "Vază unicat", priceCents: 12000, readyQty: null })]);
  const u = await inventory.addInventoryItem({ vendorId: ctx.vendor1.id, userId: ctx.v1.id, body: { productId: pU.id, declaredQty: 1, isUnique: true } });
  await inventory.submitInventory({ vendorId: ctx.vendor1.id, userId: ctx.v1.id });
  assert.equal(line(u.id).onlineReservationMode, "FORCED_UNAVAILABLE");
  assert.equal(productRow(pU.id).availability, "SOLD_OUT");
  const lU = receivedLine(u, 1);

  // stoc transferat integral la târg: readyQty 0, SOLD_OUT online
  productRow(ctx.pB.id).readyQty = 0;
  productRow(ctx.pB.id).availability = "SOLD_OUT";

  for (const id of [lU.id, ctx.lB.id]) {
    const res = await scan(line(id).barcode);
    assert.equal(res.body.item.sellable, true, `${line(id).titleSnapshot}: ${res.body.item.reasons}`);
  }
  const sold = await sell([{ inventoryItemId: lU.id, quantity: 1 }, { inventoryItemId: ctx.lB.id, quantity: 1 }], "CARD");
  assert.equal(sold.status, 201, sold.text);
  assert.equal(line(lU.id).soldQty, 1);

  // în schimb, un produs scos de moderare (nu de fluxul târgului) => blocat
  productRow(ctx.pA.id).moderationStatus = "PENDING";
  assert.equal((await scan(ctx.lA.barcode)).body.item.sellable, false);
});
