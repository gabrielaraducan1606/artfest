// Teste: vânzările văzute de vendor (izolare), rapoartele zilnice vendor / Admin
// (din liniile de vânzare, ziua locală), exporturile CSV și etichetele generate din Admin.
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header și PDF (HTML-ul se captează).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairReports.routes.test.js

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

const DAY = 24 * 60 * 60 * 1000;
let server;
let base;
let ctx;
let inventory;
let pos;
let labels;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  pos = await import("../services/artfestFairPosService.js");
  labels = await import("../lib/fairLabels.js");
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
  renderedHtml.length = 0;
  const [admin, u1, u2, u3] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "a@t.ro", role: "VENDOR" },
    { email: "b@t.ro", role: "VENDOR" },
    { email: "c@t.ro", role: "VENDOR" },
  ]);
  const [vA, vB, vC] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelier A" },
    { userId: u2.id, displayName: "Atelier B" },
    { userId: u3.id, displayName: "Atelier C" },
  ]);
  const [sA, sB, sC] = fake.seed("vendorService", [
    { vendorId: vA.id, title: "SA" },
    { vendorId: vB.id, title: "SB" },
    { vendorId: vC.id, title: "SC" },
  ]);
  fake.seed("serviceProfile", [{ serviceId: sA.id, displayName: "Magazin A" }]);
  const [fair, otherFair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", salesOpen: true, commissionBps: 1000, inventoryDeadlineAt: new Date(Date.now() + 5 * DAY) },
    { key: "ALT_TARG", title: "Alt târg" },
  ]);
  const regs = fake.seed(
    "artfestFairRegistration",
    [vA, vB, vC].map((v, i) => ({ fairId: fair.id, vendorId: v.id, submittedByUserId: [u1, u2, u3][i].id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" }))
  );
  const [pA1, pA2, pB1, pC1] = fake.seed("product", [
    product(sA.id, { title: "Glob A", priceCents: 3900 }),
    product(sA.id, { title: "Lumânare A", priceCents: 1999 }),
    product(sB.id, { title: "Cană B", priceCents: 4550 }),
    product(sC.id, { title: "Felicitare C", priceCents: 1000 }),
  ]);
  const add = async (v, u, p, qty) => {
    const l = await inventory.addInventoryItem({ vendorId: v.id, userId: u.id, body: { productId: p.id, declaredQty: qty } });
    await inventory.submitInventory({ vendorId: v.id, userId: u.id });
    return l;
  };
  const lA1 = receive(await add(vA, u1, pA1, 10), 10);
  const lA2 = receive(await add(vA, u1, pA2, 10), 10);
  const lB1 = receive(await add(vB, u2, pB1, 10), 10);
  const lC1 = receive(await add(vC, u3, pC1, 10), 10);
  ctx = { admin, u1, u2, u3, vA, vB, vC, fair, otherFair, regs, pA1, lA1, lA2, lB1, lC1 };
});

let seq = 0;
const sale = (lines, paymentMethod, now) =>
  pos.createSale({ body: { lines, paymentMethod }, idempotencyKey: `rep-key-${++seq}-abcdef`, adminId: ctx.admin.id, now });

async function call(method, path, { as } = {}) {
  const headers = {};
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text, type: res.headers.get("content-type") };
}

// ziua de test: 20 dec. 2026, ora României (UTC+2)
const D = "2026-12-20";
const at = (hhmmUtc) => new Date(`${D}T${hhmmUtc}:00Z`);

async function seedDay() {
  // reducere VENDOR pe A1 (20%) și ARTFEST pe B1 (10%)
  fake.seed("artfestFairDiscount", [
    { fairId: ctx.fair.id, name: "Promo A", type: "PERCENT", percentBps: 2000, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lA1.id, fundingSource: "VENDOR", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id },
    { fairId: ctx.fair.id, name: "Promo Artfest", type: "PERCENT", percentBps: 1000, scope: "INVENTORY_ITEM", inventoryItemId: ctx.lB1.id, fundingSource: "ARTFEST", status: "ACTIVE", approvedAt: new Date(), approvedById: ctx.admin.id },
  ]);
  // vânzare multi-vendor (A, B, C), CASH, 10:00 local
  const s1 = await sale([{ inventoryItemId: ctx.lA1.id, quantity: 2 }, { inventoryItemId: ctx.lB1.id, quantity: 1 }, { inventoryItemId: ctx.lC1.id, quantity: 3 }], "CASH", at("08:00"));
  // vânzare doar A, CARD, 23:59 local (ultimul minut al zilei)
  const s2 = await sale([{ inventoryItemId: ctx.lA2.id, quantity: 1 }], "CARD", at("21:59"));
  // 00:00 local a zilei următoare => NU intră în D
  const s3 = await sale([{ inventoryItemId: ctx.lA2.id, quantity: 1 }], "CASH", at("22:00"));
  // 23:59 local a zilei anterioare => NU intră în D
  const s0 = await sale([{ inventoryItemId: ctx.lB1.id, quantity: 1 }], "CARD", new Date("2026-12-19T21:59:00Z"));
  return { s0, s1, s2, s3 };
}

const linesOf = (vendorId) => fake.tables.artfestFairSaleLine.filter((l) => l.vendorId === vendorId);

/* ============================== vânzările vendorului ============================== */

test("vendorul vede DOAR liniile lui; vânzarea multi-vendor e separată corect", async () => {
  const { s1 } = await seedDay();
  const resA = await call("GET", "/api/vendor/artfest-fair/sales", { as: ctx.u1 });
  assert.equal(resA.status, 200);
  assert.ok(resA.body.items.every((i) => /A$/.test(i.titleSnapshot)), JSON.stringify(resA.body.items.map((i) => i.titleSnapshot)));
  assert.equal(resA.body.total, linesOf(ctx.vA.id).length);
  assert.equal(resA.text.includes("Cană B"), false);
  assert.equal(resA.text.includes("Felicitare C"), false);

  const resB = await call("GET", "/api/vendor/artfest-fair/sales", { as: ctx.u2 });
  const lineB = resB.body.items.find((i) => i.receiptReference === s1.sale.receiptReference);
  assert.equal(lineB.titleSnapshot, "Cană B");
  // fără totalul vânzării / netul altor vendori / alte linii
  assert.equal(resB.text.includes("Glob A"), false);
  assert.equal("totalPaidCents" in lineB, false);
  assert.equal(resB.text.includes(String(s1.sale.totalPaidCents)), false);
  assert.deepEqual(
    Object.keys(lineB).sort(),
    ["artfestFundedDiscountCents", "barcodeDisplay", "commissionCents", "discount", "effectiveUnitPriceCents", "lineDiscountCents", "lineGrossCents", "lineListCents", "listUnitPriceCents", "localDate", "localTime", "paymentMethod", "quantity", "receiptReference", "returned", "returnedQty", "returns", "saleLineId", "saleNumber", "soldAt", "status", "titleSnapshot", "variantLabel", "vendorNetCents"].sort()
  );
  assert.equal(lineB.discount.fundingSource, "ARTFEST");

  // filtrul pe zi (local)
  const dayA = await call("GET", `/api/vendor/artfest-fair/sales?date=${D}`, { as: ctx.u1 });
  assert.deepEqual(dayA.body.items.map((i) => i.localTime).sort(), ["10:00", "23:59"]);
  assert.equal((await call("GET", "/api/vendor/artfest-fair/sales?date=2026-13-40", { as: ctx.u1 })).status, 400);
});

test("doar vendorii au acces la vânzări / raport; Admin are rapoartele lui", async () => {
  assert.equal((await call("GET", "/api/vendor/artfest-fair/sales")).status, 401);
  assert.equal((await call("GET", "/api/admin/artfest-fair/pos/reports/daily", { as: ctx.u1 })).status, 403);
});

/* ============================== raport vendor ============================== */

test("raport zilnic vendor = suma exactă a liniilor lui din ziua locală (snapshot-uri, CASH / CARD)", async () => {
  await seedDay();
  const rep = (await call("GET", `/api/vendor/artfest-fair/reports/daily?date=${D}`, { as: ctx.u1 })).body;
  const sales = new Map(fake.tables.artfestFairSale.map((s) => [s.id, s]));
  const own = linesOf(ctx.vA.id).filter((l) => {
    const t = new Date(sales.get(l.saleId).soldAt).getTime();
    return t >= Date.parse("2026-12-19T22:00:00Z") && t < Date.parse("2026-12-20T22:00:00Z");
  });
  const sum = (f) => own.reduce((s, l) => s + l[f], 0);
  assert.equal(rep.salesCount, 2);
  assert.equal(rep.units, sum("quantity"));
  assert.equal(rep.listCents, sum("lineListCents"));
  assert.equal(rep.discountCents, sum("lineDiscountCents"));
  assert.equal(rep.grossCents, sum("lineGrossCents"));
  assert.equal(rep.commissionCents, sum("commissionCents"));
  assert.equal(rep.vendorNetCents, sum("vendorNetCents"));
  // CASH = linia A1 din vânzarea multi-vendor; CARD = A2 la 23:59
  assert.equal(rep.cashCents, own.filter((l) => sales.get(l.saleId).paymentMethod === "CASH").reduce((s, l) => s + l.lineGrossCents, 0));
  assert.equal(rep.cardCents, 1999);
  assert.equal(rep.cashCents + rep.cardCents, rep.grossCents);
  assert.deepEqual(rep.products.map((p) => [p.title, p.quantity]), [["Glob A", 2], ["Lumânare A", 1]]);
  assert.equal(rep.discountCents, 1560);
});

test("comisionul și netul vin din snapshot-uri (nu se recalculează)", async () => {
  await seedDay();
  const lineC = linesOf(ctx.vC.id)[0];
  // snapshot „istoric” diferit de ce ar da formula azi (ex. alt comision la momentul vânzării)
  lineC.commissionCents = 123;
  lineC.vendorNetCents = lineC.lineGrossCents - 123;
  const rep = (await call("GET", `/api/vendor/artfest-fair/reports/daily?date=${D}`, { as: ctx.u3 })).body;
  assert.equal(rep.commissionCents, 123);
  assert.equal(rep.vendorNetCents, lineC.lineGrossCents - 123);
});

test("reducerile VENDOR și ARTFEST raportate corect (compensația Artfest din snapshot)", async () => {
  await seedDay();
  const repB = (await call("GET", `/api/vendor/artfest-fair/reports/daily?date=${D}`, { as: ctx.u2 })).body;
  const lineB = linesOf(ctx.vB.id).find((l) => l.lineDiscountCents > 0 && fake.tables.artfestFairSale.find((s) => s.id === l.saleId).paymentMethod === "CASH");
  assert.equal(repB.discountCents, lineB.lineDiscountCents);
  assert.equal(repB.artfestFundedDiscountCents, lineB.artfestFundedDiscountCents);
  assert.ok(repB.artfestFundedDiscountCents > 0);
  // vendorul B neutru: net = listă − comision la listă
  assert.equal(repB.vendorNetCents, lineB.lineListCents - lineB.commissionOnListCents);

  const admin = (await call("GET", `/api/admin/artfest-fair/pos/reports/daily?date=${D}`, { as: ctx.admin })).body;
  assert.equal(admin.artfestFundedDiscountCents, lineB.artfestFundedDiscountCents);
  assert.equal(admin.discountCents, 1560 + lineB.lineDiscountCents);
});

test("zi fără vânzări => zerouri, nu eroare (vendor și Admin)", async () => {
  const v = await call("GET", "/api/vendor/artfest-fair/reports/daily?date=2026-12-24", { as: ctx.u1 });
  assert.equal(v.status, 200);
  assert.deepEqual({ s: v.body.salesCount, u: v.body.units, g: v.body.grossCents, p: v.body.products.length }, { s: 0, u: 0, g: 0, p: 0 });
  const a = await call("GET", "/api/admin/artfest-fair/pos/reports/daily?date=2026-12-24", { as: ctx.admin });
  assert.equal(a.status, 200);
  assert.deepEqual({ s: a.body.salesCount, t: a.body.totalPaidCents, v: a.body.vendors.length }, { s: 0, t: 0, v: 0 });
});

/* ============================== raport Admin ============================== */

test("raport zilnic Admin = suma tuturor liniilor din ziua locală; breakdown pe vendor și produse", async () => {
  const { s1, s2, s0, s3 } = await seedDay();
  const rep = (await call("GET", `/api/admin/artfest-fair/pos/reports/daily?date=${D}`, { as: ctx.admin })).body;
  assert.equal(rep.salesCount, 2);
  assert.equal(rep.totalPaidCents, s1.sale.totalPaidCents + s2.sale.totalPaidCents);
  assert.equal(rep.cashCents, s1.sale.totalPaidCents);
  assert.equal(rep.cardCents, s2.sale.totalPaidCents);
  assert.equal(rep.commissionCents, s1.sale.commissionCents + s2.sale.commissionCents);
  assert.equal(rep.vendorNetCents, s1.sale.vendorNetCents + s2.sale.vendorNetCents);
  assert.equal(rep.consistent, true);
  assert.equal(rep.vendors.length, 3);
  assert.equal(rep.vendors.reduce((s, v) => s + v.grossCents, 0), rep.totalPaidCents);
  const a = rep.vendors.find((v) => v.vendorId === ctx.vA.id);
  assert.equal(a.storeName, "Magazin A");
  assert.equal(a.salesCount, 2);
  assert.equal(rep.products[0].title, "Felicitare C"); // cel mai vândut (3 bucăți)
  // vânzările din afara zilei locale (s0: 23:59 ziua anterioară, s3: 00:00 ziua următoare) nu intră
  assert.equal(rep.units, 2 + 1 + 3 + 1);
  const next = (await call("GET", "/api/admin/artfest-fair/pos/reports/daily?date=2026-12-21", { as: ctx.admin })).body;
  assert.equal(next.totalPaidCents, s3.sale.totalPaidCents);
  const prev = (await call("GET", "/api/admin/artfest-fair/pos/reports/daily?date=2026-12-19", { as: ctx.admin })).body;
  assert.equal(prev.totalPaidCents, s0.sale.totalPaidCents);
});

test("statusul ulterior al vânzării nu rescrie ziua vânzării (retururile apar în ziua returului)", async () => {
  const { s2 } = await seedDay();
  const before = (await call("GET", `/api/admin/artfest-fair/pos/reports/daily?date=${D}`, { as: ctx.admin })).body;
  fake.tables.artfestFairSale.find((s) => s.id === s2.sale.id).status = "PARTIALLY_RETURNED";
  const rep = (await call("GET", `/api/admin/artfest-fair/pos/reports/daily?date=${D}`, { as: ctx.admin })).body;
  assert.equal(rep.salesCount, before.salesCount);
  assert.equal(rep.totalPaidCents, before.totalPaidCents);
  assert.equal(rep.returns.count, 0);
  assert.equal(rep.netCollectedCents, rep.totalPaidCents);
});

/* ============================== CSV ============================== */

test("CSV vendor: doar datele vendorului; CSV Admin: total + vendori + produse", async () => {
  await seedDay();
  const v = await call("GET", `/api/vendor/artfest-fair/reports/daily.csv?date=${D}`, { as: ctx.u1 });
  assert.equal(v.status, 200);
  assert.match(v.type, /text\/csv/);
  assert.ok(v.text.includes("Glob A") && v.text.includes("Lumânare A"));
  assert.equal(v.text.includes("Cană B") || v.text.includes("Felicitare C") || v.text.includes("Atelier B"), false);
  assert.ok(v.text.includes("Net vendor din vânzări (lei)") && v.text.includes("Net al zilei"));

  const a = await call("GET", `/api/admin/artfest-fair/pos/reports/daily.csv?date=${D}`, { as: ctx.admin });
  assert.equal(a.status, 200);
  for (const t of ["Total încasat (lei)", "Magazin A", "Atelier B", "Atelier C", "Felicitare C", "Cană B"]) assert.ok(a.text.includes(t), t);
});

/* ============================== etichete din Admin ============================== */

test("Admin: etichetă individuală, etichetele unui vendor, toate etichetele târgului - același generator 1D + QR", async () => {
  const one = await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA1.id}/label.pdf`, { as: ctx.admin });
  assert.equal(one.status, 200);
  assert.match(one.type, /application\/pdf/);
  const htmlOne = renderedHtml.at(-1);
  assert.ok(htmlOne.includes(labels.qrSvg(ctx.lA1.barcode)) && htmlOne.includes(labels.barcodeSvg(ctx.lA1.barcode)));
  assert.equal((htmlOne.match(/class="label"/g) || []).length, 1);

  const vendor = await call("GET", `/api/admin/artfest-fair/inventory/labels.pdf?vendorId=${ctx.vA.id}`, { as: ctx.admin });
  assert.equal(vendor.status, 200);
  // A1 (10 buc.) + A2 (10 buc.) => 20 etichete, doar ale vendorului A
  assert.equal((renderedHtml.at(-1).match(/class="label"/g) || []).length, 20);
  assert.equal(renderedHtml.at(-1).includes("Cană B"), false);

  const all = await call("GET", "/api/admin/artfest-fair/inventory/labels.pdf", { as: ctx.admin });
  assert.equal(all.status, 200);
  assert.equal((renderedHtml.at(-1).match(/class="label"/g) || []).length, 40);
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/labels.pdf`, { as: ctx.u1 })).status, 403);
});

test("Admin: preț schimbat => avertizare + regenerare actualizează labelGeneratedAt / labelPriceCents", async () => {
  const row = fake.tables.artfestFairInventoryItem.find((l) => l.id === ctx.lA1.id);
  row.priceSnapshotCents = 4200; // preț sincronizat; eticheta veche (3900) e invalidă
  fake.tables.product.find((p) => p.id === ctx.pA1.id).priceCents = 4200;
  const before = row.labelGeneratedAt;
  const detail = await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA1.id}`, { as: ctx.admin });
  assert.equal(detail.body.item.label.state, "outdated");
  assert.ok(detail.body.item.warnings.includes("Eticheta are un preț vechi."));

  const res = await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA1.id}/label.pdf`, { as: ctx.admin });
  assert.equal(res.status, 200);
  assert.equal(row.labelPriceCents, 4200);
  assert.ok(row.labelGeneratedAt >= before);
  assert.ok(fake.tables.artfestFairInventoryEvent.some((e) => e.inventoryItemId === row.id && e.type === "LABEL_GENERATED" && e.actorUserId === ctx.admin.id));
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA1.id}`, { as: ctx.admin })).body.item.label.state, "valid");

  // preț nesincronizat înainte de termen => aceeași regulă ca la vendor
  fake.tables.product.find((p) => p.id === ctx.pA1.id).priceCents = 5000;
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA1.id}/label.pdf`, { as: ctx.admin })).status, 409);
});

test("Admin: linie din alt târg / DRAFT / participare anulată => fără etichetă", async () => {
  const row = fake.tables.artfestFairInventoryItem.find((l) => l.id === ctx.lA2.id);
  row.fairId = ctx.otherFair.id;
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA2.id}/label.pdf`, { as: ctx.admin })).status, 404);
  row.fairId = ctx.fair.id;
  row.status = "DRAFT";
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lA2.id}/label.pdf`, { as: ctx.admin })).status, 404);
  assert.equal((await call("GET", "/api/admin/artfest-fair/inventory/nu-exista/label.pdf", { as: ctx.admin })).status, 404);

  fake.tables.artfestFairRegistration.find((r) => r.vendorId === ctx.vB.id).status = "CANCELLED";
  assert.equal((await call("GET", `/api/admin/artfest-fair/inventory/${ctx.lB1.id}/label.pdf`, { as: ctx.admin })).status, 409);
  // în etichetele târgului nu intră liniile participării anulate
  await call("GET", "/api/admin/artfest-fair/inventory/labels.pdf", { as: ctx.admin });
  assert.equal(renderedHtml.at(-1).includes("Cană B"), false);
});
