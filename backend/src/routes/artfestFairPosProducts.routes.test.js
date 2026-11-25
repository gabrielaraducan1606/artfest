// POS -> „Adaugă produs” (Admin): Artfest - stoc propriu SAU magazinul unui participant APPROVED.
// Stoc primit fizic cu confirmare (mișcare RECEIVED + cine), excepție Admin după termenul de
// inventar (vânzătorii rămân limitați), etichete AF, scanare, încasare: Artfest = integral
// Artfest, participant = 10% / 90%; retururi, rapoarte, decont. Fără produse online, fără vânzări
// la salvare. Rutele reale; mock-uri doar pe DB in-memory, auth pe header și PDF (HTML capturat).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairPosProducts.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";
process.env.APP_URL = "https://www.artfest.ro";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";

let fake;
const rendered = [];

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
    async renderPdfWithSharedBrowser(html, options) {
      rendered.push({ html, options });
      return Buffer.from("%PDF-test");
    },
  },
});

let server;
let base;
let ctx;
let inventory;
let reports;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
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

beforeEach(() => {
  fake = createFakePrisma();
  rendered.length = 0;
  const [admin, u1, u2, u3] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
    { email: "v3@t.ro", role: "VENDOR" },
  ]);
  const [v1, v2, v3] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Ana Popescu", isActive: true },
    { userId: u2.id, displayName: "Ion Ionescu", isActive: true },
    { userId: u3.id, displayName: "Retras", isActive: true },
  ]);
  const [products] = fake.seed("serviceType", [{ code: "products" }, { code: "services" }]);
  const store = (vendorId, title) => ({ vendorId, typeId: products.id, title, isActive: true, status: "ACTIVE" });
  const [sA1, sA2, sB] = fake.seed("vendorService", [store(v1.id, "Atelier Ana"), store(v1.id, "Ana Decor"), store(v2.id, "Ceramica Ion")]);
  fake.seed("serviceProfile", [
    { serviceId: sA1.id, slug: "atelier-ana", displayName: "Atelierul Anei" },
    { serviceId: sA2.id, slug: "ana-decor", displayName: "Ana Decor" },
    { serviceId: sB.id, slug: "ceramica-ion", displayName: "Ceramica Ion" },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000,
      inventoryDeadlineAt: new Date(Date.now() + 5 * 86400000), endsAt: new Date(Date.now() + 9 * 86400000) },
  ]);
  const reg = (vendorId, userId, status) => ({ fairId: fair.id, vendorId, submittedByUserId: userId, status, participationType: "PARTICIPARE_FIZICA" });
  const [r1, r2, r3] = fake.seed("artfestFairRegistration", [reg(v1.id, u1.id, "APPROVED"), reg(v2.id, u2.id, "APPROVED"), reg(v3.id, u3.id, "WITHDRAWN")]);
  ctx = { admin, u1, u2, v1, v2, sA1, sA2, sB, r1, r2, r3, fair };
});

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

const ADM = "/api/admin/artfest-fair";
const POS = `${ADM}/pos`;
const reqId = () => `req-${Math.random().toString(16).slice(2).padEnd(12, "0")}${Date.now().toString(16)}`.slice(0, 36);
const inv = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const cells = (html) => (html.match(/<div class="label">/g) || []).length;
const artfestBody = (extra = {}) => ({ owner: "ARTFEST", title: "Pungă de cadou", priceRon: "5", receivedQty: 20, confirmReceived: true, clientRequestId: reqId(), ...extra });
const anaBody = (extra = {}) => ({ owner: "PARTICIPANT", registrationId: ctx.r1.id, serviceId: ctx.sA2.id, title: "Felicitare", priceRon: "20", receivedQty: 4, confirmReceived: true, clientRequestId: reqId(), ...extra });
const sell = (lines, key, method = "CASH") => call("POST", `${POS}/sales`, { as: ctx.admin, key, body: { lines, paymentMethod: method } });

// aceleași reguli ca CHECK-urile din DB (migrațiile POS + 20261125120000_artfest_fair_own_stock)
function assertDbChecks() {
  for (const l of fake.tables.artfestFairInventoryItem) {
    assert.equal(l.registrationId == null, l.vendorId == null, "AFII_owner_chk");
    if (!l.vendorId) assert.ok(!l.productId && !l.serviceId && (l.onlineReservationMode ?? "NONE") === "NONE", "AFII_artfest_owned_chk");
    assert.equal(l.availableQty, l.receivedQty - (l.soldQty || 0) - (l.damagedQty || 0) - (l.lostQty || 0) - (l.returnedQty || 0), "AFII_availableQty_formula_chk");
  }
  for (const l of fake.tables.artfestFairSaleLine) {
    assert.equal(l.vendorNetCents, l.lineGrossCents - l.commissionCents + (l.artfestFundedDiscountCents || 0), "AFSL_vendorNet_chk");
    assert.ok(l.commissionCents <= l.commissionOnListCents, "AFSL_commissionOnList_chk");
    if (!l.vendorId) {
      assert.equal(l.commissionBps, 10000);
      assert.equal(l.commissionCents, l.lineGrossCents);
      assert.equal(l.vendorNetCents, 0);
      assert.equal(l.artfestFundedDiscountCents || 0, 0);
      assert.equal(l.pricingModel ?? "COMMISSION", "COMMISSION");
    }
  }
  for (const rl of fake.tables.artfestFairSaleReturnLine || []) {
    assert.equal(rl.vendorNetReversedCents, rl.refundCents - rl.commissionReversedCents + (rl.artfestFundedReversedCents || 0), "AFSRL_vendorNet_chk");
    if (!rl.vendorId) assert.equal(rl.vendorNetReversedCents, 0, "AFSRL_artfest_owned_chk");
  }
}

test("doar Admin: proprietarii posibili = Artfest (stoc propriu) + participanții APPROVED cu magazinele lor", async () => {
  assert.equal((await call("GET", `${POS}/products/owners`)).status, 401);
  assert.equal((await call("GET", `${POS}/products/owners`, { as: ctx.u1 })).status, 403);
  assert.equal((await call("POST", `${POS}/products`, { as: ctx.u1, body: artfestBody() })).status, 403);
  const r = await call("GET", `${POS}/products/owners`, { as: ctx.admin });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.artfest.name, "Artfest (stoc propriu)");
  const ana = r.body.participants.find((p) => p.registrationId === ctx.r1.id);
  assert.deepEqual(ana.stores.map((s) => s.name).sort(), ["Ana Decor", "Atelierul Anei"]);
  assert.ok(!r.body.participants.some((p) => p.registrationId === ctx.r3.id)); // retras
});

test("Artfest - stoc propriu: confirmare obligatorie, intrare RECEIVED cu cine / când, fără vânzător, fără produs online, fără vânzare; dublu click => o linie", async () => {
  const productsBefore = fake.tables.product?.length || 0;
  const noConfirm = await call("POST", `${POS}/products`, { as: ctx.admin, body: artfestBody({ confirmReceived: false }) });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "receipt_confirmation_required");
  for (const bad of [{ receivedQty: 0 }, { receivedQty: 1001 }, { priceRon: "0" }, { title: " " }, { owner: "ALTCINEVA" }]) {
    assert.equal((await call("POST", `${POS}/products`, { as: ctx.admin, body: artfestBody(bad) })).status, 400, JSON.stringify(bad));
  }

  const body = artfestBody();
  const [a, b] = await Promise.all([call("POST", `${POS}/products`, { as: ctx.admin, body }), call("POST", `${POS}/products`, { as: ctx.admin, body })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201], a.text);
  const created = a.status === 201 ? a.body : b.body;
  assert.equal(fake.tables.artfestFairInventoryItem.filter((l) => l.titleSnapshot === "Pungă de cadou").length, 1);
  const line = inv(created.item.id);
  assert.equal(line.vendorId, null);
  assert.equal(line.registrationId, null);
  assert.equal(line.serviceId ?? null, null);
  assert.equal(line.status, "RECEIVED");
  assert.equal(line.receivedQty, 20);
  assert.equal(line.availableQty, 20);
  assert.equal(line.receivedById, ctx.admin.id);
  assert.ok(line.receivedAt);
  assert.match(created.item.barcodeDisplay, /^AF-/);
  assert.equal(created.item.vendor.name, "Artfest (stoc propriu)");
  assert.equal(created.item.artfestOwned, true);
  // la vânzare: integral Artfest
  assert.equal(created.item.pricing.commissionCents, 500);
  assert.equal(created.item.pricing.vendorNetCents, 0);
  const mv = fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === line.id);
  assert.deepEqual(mv.map((m) => [m.type, m.quantity, m.actorUserId, m.vendorId]), [["RECEIVED", 20, ctx.admin.id, null]]);
  const events = fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === line.id).map((e) => e.type);
  assert.deepEqual(events, ["CREATED", "STATUS_CHANGED"]);
  assert.equal(fake.tables.artfestFairSale.length, 0);
  assert.equal(fake.tables.product?.length || 0, productsBefore); // nimic online
  assertDbChecks();
});

test("excepție DOAR pentru Admin după termenul de inventar; vânzătorul rămâne limitat", async () => {
  Object.assign(fake.tables.artfestFair[0], { inventoryDeadlineAt: new Date(Date.now() - 3600000) });
  const art = await call("POST", `${POS}/products`, { as: ctx.admin, body: artfestBody() });
  assert.equal(art.status, 201, art.text);
  const ana = await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody() });
  assert.equal(ana.status, 201, ana.text);
  const stock = await call("POST", `${POS}/products/${ana.body.item.id}/stock`, { as: ctx.admin, key: "pos-stock-after-deadline-1", body: { receivedQty: 2, confirmReceived: true } });
  assert.equal(stock.status, 200, stock.text);
  // vânzătorul: aceeași regulă ca înainte
  await assert.rejects(
    inventory.addManualInventoryItem({ vendorId: ctx.v1.id, userId: ctx.u1.id, body: { title: "Ceva", priceRon: "10", declaredQty: 1, clientRequestId: reqId() } }),
    (e) => e.code === "inventory_locked"
  );
});

test("participant: magazinul ales (Ana are 2 magazine), vânzătorul corect, magazin obligatoriu / al altcuiva / participant retras refuzat", async () => {
  const r = await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody() });
  assert.equal(r.status, 201, r.text);
  const line = inv(r.body.item.id);
  assert.equal(line.vendorId, ctx.v1.id);
  assert.equal(line.registrationId, ctx.r1.id);
  assert.equal(line.serviceId, ctx.sA2.id);
  assert.equal(line.storeNameSnapshot, "Ana Decor");
  assert.equal(r.body.item.pricing.commissionCents, 200); // 10% din 20 lei
  assert.equal(r.body.item.pricing.vendorNetCents, 1800);

  assert.equal((await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody({ serviceId: undefined }) })).body.error, "store_required");
  assert.equal((await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody({ serviceId: ctx.sB.id }) })).body.error, "store_not_found");
  assert.equal((await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody({ registrationId: ctx.r3.id }) })).body.error, "participant_not_eligible");

  // eticheta „promo”: magazinul ales (nu ghicit dintre cele două)
  const sheet = await call("POST", `${ADM}/inventory/labels.pdf`, { as: ctx.admin, body: { ids: [line.id], copies: 1, layout: "promo" } });
  assert.equal(sheet.status, 200, sheet.text);
  const { storeQrSvg } = await import("../lib/fairLabels.js");
  assert.ok(rendered.at(-1).html.includes(storeQrSvg("https://www.artfest.ro/magazin/ana-decor")));
  assert.ok(!rendered.at(-1).html.includes(storeQrSvg("https://www.artfest.ro/magazin/atelier-ana")));
  assert.ok(!rendered.at(-1).html.includes("Atelierul Anei"));
  // apare în inventarul vânzătorului (doar citire, fără vânzare)
  const own = await inventory.listInventory({ vendorId: ctx.v1.id });
  assert.ok(own.items.some((i) => i.id === line.id && i.status === "RECEIVED"), JSON.stringify(own.items.map((i) => i.title)));
  assertDbChecks();
});

test("suplimentare stoc: confirmare + Idempotency-Key, dublu click => o singură intrare; doar produse manuale", async () => {
  const created = (await call("POST", `${POS}/products`, { as: ctx.admin, body: artfestBody({ receivedQty: 5 }) })).body.item;
  assert.equal((await call("POST", `${POS}/products/${created.id}/stock`, { as: ctx.admin, key: "pos-stock-0001", body: { receivedQty: 3 } })).body.error, "receipt_confirmation_required");
  assert.equal((await call("POST", `${POS}/products/${created.id}/stock`, { as: ctx.admin, body: { receivedQty: 3, confirmReceived: true } })).status, 400); // fără cheie
  const body = { receivedQty: 3, confirmReceived: true };
  const [x, y] = await Promise.all([
    call("POST", `${POS}/products/${created.id}/stock`, { as: ctx.admin, key: "pos-stock-0002", body }),
    call("POST", `${POS}/products/${created.id}/stock`, { as: ctx.admin, key: "pos-stock-0002", body }),
  ]);
  assert.deepEqual([x.status, y.status], [200, 200], x.text + y.text);
  assert.equal(inv(created.id).receivedQty, 8);
  assert.equal(inv(created.id).availableQty, 8);
  const mv = fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === created.id);
  assert.deepEqual(mv.map((m) => m.quantity), [5, 3]);
  assert.ok(mv.every((m) => m.type === "RECEIVED" && m.actorUserId === ctx.admin.id));
  assert.equal(x.body.item.availableQty, 8);
  assertDbChecks();
});

test("Artfest: etichete AF -> scanare -> încasare integral Artfest; participant 10% / 90%; coș mixt, stoc, rapoarte, decont, retur", async () => {
  const art = (await call("POST", `${POS}/products`, { as: ctx.admin, body: artfestBody({ receivedQty: 10, priceRon: "4,50" }) })).body.item;
  const ana = (await call("POST", `${POS}/products`, { as: ctx.admin, body: anaBody({ receivedQty: 4 }) })).body.item;

  // etichete: formatul existent, numărul ales, cod AF; fără vânzare
  const sheet = await call("POST", `${ADM}/inventory/labels.pdf`, { as: ctx.admin, body: { ids: [art.id, ana.id], copies: 2 } });
  assert.equal(sheet.status, 200, sheet.text);
  assert.equal(cells(rendered.at(-1).html), 4);
  assert.ok(rendered.at(-1).html.includes("Pungă de cadou") && rendered.at(-1).html.includes("Felicitare"));
  assert.equal(fake.tables.artfestFairSale.length, 0);

  const scan = await call("GET", `${POS}/scan?barcode=${inv(art.id).barcode}`, { as: ctx.admin });
  assert.equal(scan.status, 200, scan.text);
  assert.equal(scan.body.item.sellable, true);
  assert.equal(scan.body.item.artfestOwned, true);
  assert.equal(scan.body.item.vendor.name, "Artfest (stoc propriu)");
  assert.equal(scan.body.item.artfestUnitCents, 450);
  assert.equal(scan.body.item.vendorUnitCents, 0);

  // coș mixt: 2 pungi (Artfest) + 1 felicitare (Ana)
  const sale = await sell([{ inventoryItemId: art.id, quantity: 2 }, { inventoryItemId: ana.id, quantity: 1 }], "pos-own-sale-0001");
  assert.equal(sale.status, 201, sale.text);
  const lArt = fake.tables.artfestFairSaleLine.find((l) => l.inventoryItemId === art.id);
  const lAna = fake.tables.artfestFairSaleLine.find((l) => l.inventoryItemId === ana.id);
  assert.deepEqual([lArt.vendorId, lArt.lineGrossCents, lArt.commissionCents, lArt.vendorNetCents, lArt.commissionBps], [null, 900, 900, 0, 10000]);
  assert.deepEqual([lAna.vendorId, lAna.lineGrossCents, lAna.commissionCents, lAna.vendorNetCents], [ctx.v1.id, 2000, 200, 1800]);
  const s = fake.tables.artfestFairSale[0];
  assert.deepEqual([s.totalPaidCents, s.commissionCents, s.vendorNetCents], [2900, 1100, 1800]);
  assert.equal(inv(art.id).availableQty, 8);
  assert.equal(inv(ana.id).availableQty, 3);
  assert.equal(fake.tables.artfestFairStockMovement.find((m) => m.saleLineId === lArt.id).vendorId, null);
  const detail = sale.body.sale.vendors.find((v) => v.vendorId === null);
  assert.equal(detail.vendorName, "Artfest (stoc propriu)");
  assertDbChecks();

  // raport zilnic Admin: rând „Artfest (stoc propriu)” separat; total încasat = ambele
  const D = reports.todayLocal(new Date());
  const daily = await call("GET", `${POS}/reports/daily?date=${D}`, { as: ctx.admin });
  assert.equal(daily.status, 200, daily.text);
  assert.ok(JSON.stringify(daily.body).includes("Artfest (stoc propriu)"));
  const summary = await call("GET", `${POS}/reports/summary`, { as: ctx.admin });
  assert.equal(summary.status, 200, summary.text);
  // vânzătorul vede DOAR linia lui (90%)
  const vs = await call("GET", "/api/vendor/artfest-fair/summary", { as: ctx.u1 });
  assert.equal(vs.status, 200, vs.text);
  assert.equal(vs.body.today.sales.grossCents, 2000);
  assert.equal(vs.body.today.net.vendorDueCents, 1800);
  // decontul vânzătorului nu include produsele Artfest
  const pv = await call("POST", `${ADM}/settlements/preview`, { as: ctx.admin, body: { vendorId: ctx.v1.id, periodFrom: D, periodTo: D } });
  assert.equal(pv.status, 200, pv.text);
  assert.equal(pv.body.grossSalesCents, 2000);
  assert.equal(pv.body.vendorNetCents, 1800);

  // retur: produsul Artfest nu poate fi pus în sarcina unui vânzător; rambursarea = integral Artfest
  const saleId = s.id;
  const badRet = await call("POST", `${POS}/sales/${saleId}/returns/preview`, {
    as: ctx.admin,
    body: { reason: "Client", refundMethod: "CASH", lines: [{ saleLineId: lArt.id, quantity: 1, disposition: "NOT_RESTOCKED", refundResponsibility: "VENDOR", responsibilityReason: "test test" }] },
  });
  assert.equal(badRet.body.canConfirm, false, badRet.text);
  const ret = await call("POST", `${POS}/sales/${saleId}/returns`, {
    as: ctx.admin,
    key: "pos-own-return-0001",
    body: { reason: "Clientul a returnat", refundMethod: "CASH", lines: [{ saleLineId: lArt.id, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(ret.status, 201, ret.text);
  const rl = fake.tables.artfestFairSaleReturnLine.find((x) => x.saleLineId === lArt.id);
  assert.deepEqual([rl.vendorId, rl.refundCents, rl.commissionReversedCents, rl.vendorNetReversedCents], [null, 450, 450, 0]);
  assert.equal(inv(art.id).availableQty, 9);
  assertDbChecks();
});
