// Târgul Artfest - „Ambalare și accesorii” (Admin) pe produsele participanților: valori PER BUCATĂ,
// reținute suplimentar din partea vânzătorului la vânzare și revenite integral Artfest.
// Comisionul rămâne 10% din prețul efectiv. Snapshot pe linia de vânzare (modificările ulterioare
// nu schimbă vânzările / deconturile existente), retururi din valorile salvate, sumă negativă
// refuzată, produsele Artfest neatinse. Rutele reale; mock-uri doar pe DB in-memory și auth pe header.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairAccessories.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
// regula financiară ISTORICĂ (comision 10% din prețul efectiv): testele de mai jos verifică mecanismele
// pe vânzări cu regula veche; regula actuală (declarat + adaos + accesorii): artfestFairDeclaredMarkup.routes.test.js
process.env.NODE_ENV = "test";
process.env.ARTFEST_FAIR_LEGACY_COMMISSION_RULE = "1";
process.env.JWT_SECRET = "test-secret";
process.env.APP_URL = "https://www.artfest.ro";

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
  namedExports: { async renderPdfWithSharedBrowser() { return Buffer.from("%PDF-test"); } },
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

const now = new Date();

beforeEach(() => {
  fake = createFakePrisma();
  const [admin, u1, u2] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN", firstName: "Maria", lastName: "Admin" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
  ]);
  const [v1, v2] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelierul Anei", isActive: true },
    { userId: u2.id, displayName: "Ceramica Ion", isActive: true },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000, nextSaleNumber: 1, nextReturnNumber: 1 },
  ]);
  const reg = (vendorId, userId) => ({ fairId: fair.id, vendorId, submittedByUserId: userId, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" });
  const [r1, r2] = fake.seed("artfestFairRegistration", [reg(v1.id, u1.id), reg(v2.id, u2.id)]);
  const line = (o) => ({
    fairId: fair.id, currency: "RON", status: "RECEIVED", labelGeneratedAt: now, receivedAt: now, productId: null,
    declaredQty: o.qty, receivedQty: o.qty, availableQty: o.qty, soldQty: 0, damagedQty: 0, lostQty: 0, returnedQty: 0,
    onlineReservationMode: "NONE", accessoriesUnitCents: 0, ...o,
  });
  const [cana, vas, punga] = fake.seed("artfestFairInventoryItem", [
    line({ registrationId: r1.id, vendorId: v1.id, variantKey: "manual:cana", titleSnapshot: "Cană pictată", priceSnapshotCents: 11000, labelPriceCents: 11000, barcode: "AF23456789", qty: 20 }),
    line({ registrationId: r2.id, vendorId: v2.id, variantKey: "manual:vas", titleSnapshot: "Vas lut", priceSnapshotCents: 5000, labelPriceCents: 5000, barcode: "AF34567892", qty: 10 }),
    line({ registrationId: null, vendorId: null, variantKey: "manual:punga", titleSnapshot: "Pungă de cadou", priceSnapshotCents: 450, labelPriceCents: 450, barcode: "AF45678923", qty: 30 }),
  ]);
  ctx = { admin, u1, u2, v1, v2, r1, r2, fair, cana, vas, punga };
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
const VND = "/api/vendor/artfest-fair";
const POS = `${ADM}/pos`;
const BOX_AND_BOW = [
  { name: "Cutie", quantity: 1, unitPriceCents: 600 },
  { name: "Fundă", quantity: 1, unitPriceCents: 200 },
];
const setAcc = (id, items, as = ctx.admin) => call("PUT", `${ADM}/inventory/${id}/accessories`, { as, body: { items } });
const sell = (lines, key, method = "CASH") => call("POST", `${POS}/sales`, { as: ctx.admin, key, body: { lines, paymentMethod: method } });
const inv = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const saleLines = () => fake.tables.artfestFairSaleLine || [];
const events = (type) => (fake.tables.artfestFairInventoryEvent || []).filter((e) => e.type === type);
const day = (offset = 0) => reports.todayLocal(new Date(Date.now() + offset * 86400000));

// aceleași reguli ca CHECK-urile din DB (migrația 20261127120000_artfest_fair_accessories)
function assertDbChecks() {
  for (const l of fake.tables.artfestFairInventoryItem) {
    assert.ok((l.accessoriesUnitCents || 0) >= 0, "AFII_accessories_chk");
    if (!l.vendorId) assert.ok(!l.accessoriesUnitCents && l.accessories == null, "AFII_accessories_chk (Artfest)");
  }
  for (const s of fake.tables.artfestFairSale || []) {
    assert.ok((s.accessoriesCents || 0) >= 0 && s.vendorNetCents >= 0, "AFS_accessories_chk / AFS_vendorNet_chk");
    const own = saleLines().filter((l) => l.saleId === s.id);
    assert.equal(s.accessoriesCents || 0, own.reduce((t, l) => t + (l.accessoriesCents || 0), 0), "antet = suma liniilor");
    assert.equal(s.vendorNetCents, own.reduce((t, l) => t + l.vendorNetCents, 0));
  }
  for (const l of saleLines()) {
    const acc = l.accessoriesCents || 0;
    assert.equal(l.vendorNetCents, l.lineGrossCents - l.commissionCents - acc + (l.artfestFundedDiscountCents || 0), "AFSL_vendorNet_chk");
    assert.equal(acc, (l.accessoriesUnitCents || 0) * l.quantity, "AFSL_accessories_chk (unit × cantitate)");
    assert.ok(l.vendorNetCents >= 0, "AFSL_accessories_chk (suma vânzătorului ≥ 0)");
    if (!l.vendorId) assert.ok(acc === 0 && l.commissionCents === l.lineGrossCents && l.vendorNetCents === 0, "AFSL_artfest_owned_chk");
  }
  for (const r of fake.tables.artfestFairSaleReturn || []) {
    assert.equal(r.vendorNetReversedCents, r.refundCents - r.commissionReversedCents - (r.accessoriesReversedCents || 0) + (r.artfestFundedReversedCents || 0), "AFSR_vendorNet_chk");
  }
  for (const rl of fake.tables.artfestFairSaleReturnLine || []) {
    assert.equal(rl.vendorNetReversedCents, rl.refundCents - rl.commissionReversedCents - (rl.accessoriesReversedCents || 0) + (rl.artfestFundedReversedCents || 0), "AFSRL_vendorNet_chk");
    assert.ok((rl.accessoriesReversedCents || 0) >= 0);
    if (!rl.vendorId) assert.ok(!rl.accessoriesReversedCents && !rl.vendorNetReversedCents, "AFSRL_artfest_owned_chk");
  }
  for (const s of fake.tables.artfestFairSettlement || []) {
    assert.equal(s.finalDueCents, s.vendorNetCents - s.vendorNetReversedCents + (s.adjustmentsCents || 0) + (s.carriedInCents || 0), "AFST_finalDue_chk");
    assert.ok((s.accessoriesCents || 0) >= 0 && (s.accessoriesReversedCents || 0) >= 0, "AFST_accessories_chk");
  }
  for (const e of fake.tables.artfestFairSettlementEntry || []) {
    if (e.saleLineId) assert.ok(e.grossCents >= 0 && e.vendorNetCents >= 0 && e.commissionCents >= 0 && (e.accessoriesCents || 0) >= 0, "AFSE_sign_chk");
    else assert.ok(e.grossCents <= 0 && e.vendorNetCents <= 0 && e.commissionCents <= 0 && (e.accessoriesCents || 0) <= 0, "AFSE_sign_chk");
  }
}

test("Admin: „Ambalare și accesorii” per bucată - validări, total automat, dublu click, istoric cu autor; Artfest refuzat; vânzătorul vede lista", async () => {
  // doar Admin
  assert.equal((await setAcc(ctx.cana.id, BOX_AND_BOW, ctx.u1)).status, 403);

  const bad = await setAcc(ctx.cana.id, [{ name: "", quantity: 0, unitPriceCents: -1 }]);
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields["items.0.name"] && bad.body.fields["items.0.quantity"] && bad.body.fields["items.0.unitPriceCents"]);
  assert.equal((await setAcc(ctx.cana.id, Array.from({ length: 21 }, () => ({ name: "x", quantity: 1, unitPriceCents: 1 })))).status, 400);
  assert.equal(inv(ctx.cana.id).accessoriesUnitCents, 0, "nimic salvat la erori");

  // dublu click: două cereri identice simultan => o singură modificare / un singur eveniment
  const [a, b] = await Promise.all([setAcc(ctx.cana.id, BOX_AND_BOW), setAcc(ctx.cana.id, BOX_AND_BOW)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual([a.body.changed, b.body.changed].sort(), [false, true]);
  assert.equal(events("ACCESSORIES_SET").length, 1);
  const line = inv(ctx.cana.id);
  assert.equal(line.accessoriesUnitCents, 800, "total pe bucată calculat pe server");
  assert.deepEqual(line.accessories, [
    { name: "Cutie", quantity: 1, unitPriceCents: 600, totalCents: 600 },
    { name: "Fundă", quantity: 1, unitPriceCents: 200, totalCents: 200 },
  ]);
  assert.equal(line.accessoriesUpdatedById, ctx.admin.id);
  // prețul final / eticheta nu se schimbă
  assert.equal(line.finalPriceCents ?? null, null);
  assert.equal(line.labelPriceCents, 11000);

  const got = await call("GET", `${ADM}/inventory/${ctx.cana.id}/accessories`, { as: ctx.admin });
  assert.equal(got.status, 200);
  assert.equal(got.body.unitCents, 800);
  assert.equal(got.body.updatedBy, "Maria Admin");
  assert.equal(got.body.history.length, 1);
  assert.equal(got.body.history[0].by, "Maria Admin");
  assert.equal(got.body.history[0].after.unitCents, 800);
  assert.equal(got.body.history[0].before.unitCents, 0);

  // Admin: linia arată suma vânzătorului la prețul etichetei, după comision și accesorii
  const adminLine = (await call("GET", `${ADM}/inventory/${ctx.cana.id}`, { as: ctx.admin })).body.item;
  assert.equal(adminLine.accessories.unitCents, 800);
  assert.equal(adminLine.accessories.editable, true);
  assert.equal(adminLine.pricing.commissionCents, 1100);
  assert.equal(adminLine.pricing.vendorNetCents, 9100);

  // produs Artfest (stoc propriu): fără accesorii
  const own = await setAcc(ctx.punga.id, BOX_AND_BOW);
  assert.equal(own.status, 409);
  assert.equal(own.body.error ?? own.body.code, "artfest_owned_no_accessories");

  // vânzătorul vede lista și valorile înainte de vânzare (inventarul lui)
  const list = await inventory.listInventory({ vendorId: ctx.v1.id, db: fake });
  const mine = (list.items || list.lines || []).find((i) => i.id === ctx.cana.id);
  assert.equal(mine.accessories.unitCents, 800);
  assert.deepEqual(mine.accessories.items.map((x) => x.name), ["Cutie", "Fundă"]);
  assert.equal(mine.pricing.vendorNetCents, 9100);
  assert.equal(mine.pricing.accessoriesUnitCents, 800);
  // alt vânzător nu vede linia
  const other = await inventory.listInventory({ vendorId: ctx.v2.id, db: fake });
  assert.equal((other.items || other.lines || []).some((i) => i.id === ctx.cana.id), false);

  // lista goală = fără accesorii
  assert.equal((await setAcc(ctx.cana.id, [])).body.accessories.unitCents, 0);
  assert.equal(events("ACCESSORIES_SET").length, 2);
});

test("vânzare: exemplul 110 lei (cutie + fundă) => comision 11, vânzător 91, Artfest 19; fără accesorii identic; mai multe bucăți; reducere la casă", async () => {
  await setAcc(ctx.cana.id, BOX_AND_BOW);

  // în POS, înainte de încasare: preț efectiv, comision, accesorii, suma vânzătorului
  const scanRes = await call("GET", `${POS}/scan?barcode=AF23456789`, { as: ctx.admin });
  const scan = { status: scanRes.status, body: scanRes.body?.item };
  assert.equal(scan.status, 200);
  assert.equal(scan.body.commissionUnitCents, 1100);
  assert.equal(scan.body.accessoriesUnitCents, 800);
  assert.equal(scan.body.vendorUnitCents, 9100);
  assert.equal(scan.body.artfestUnitCents, 1900);

  const preview = await call("POST", `${POS}/preview`, { as: ctx.admin, body: { lines: [{ inventoryItemId: ctx.cana.id, quantity: 1 }, { inventoryItemId: ctx.vas.id, quantity: 1 }] } });
  assert.equal(preview.status, 200);
  const pCana = preview.body.lines.find((l) => l.inventoryItemId === ctx.cana.id);
  assert.deepEqual(
    [pCana.lineGrossCents, pCana.commissionCents, pCana.accessoriesCents, pCana.vendorNetCents],
    [11000, 1100, 800, 9100]
  );
  assert.deepEqual(pCana.accessories.map((x) => [x.name, x.totalCents]), [["Cutie", 600], ["Fundă", 200]]);
  // produs fără accesorii: exact ca înainte (10% / 90%)
  const pVas = preview.body.lines.find((l) => l.inventoryItemId === ctx.vas.id);
  assert.deepEqual([pVas.lineGrossCents, pVas.commissionCents, pVas.accessoriesCents, pVas.vendorNetCents], [5000, 500, 0, 4500]);
  assert.equal(preview.body.totals.accessoriesCents, 800);
  assert.deepEqual(preview.body.totals.artfest, { commissionCents: 1600, accessoriesCents: 800, ownProductsCents: 0, totalCents: 2400 });

  const s1 = await sell([{ inventoryItemId: ctx.cana.id, quantity: 1 }, { inventoryItemId: ctx.vas.id, quantity: 1 }], "acc-sale-1");
  assert.equal(s1.status, 201);
  const l1 = saleLines().find((l) => l.inventoryItemId === ctx.cana.id);
  assert.deepEqual([l1.commissionCents, l1.accessoriesUnitCents, l1.accessoriesCents, l1.vendorNetCents], [1100, 800, 800, 9100]);
  assert.deepEqual(l1.accessoriesSnapshot.map((x) => [x.name, x.quantity, x.unitPriceCents, x.totalCents]), [["Cutie", 1, 600, 600], ["Fundă", 1, 200, 200]]);
  const lVas = saleLines().find((l) => l.inventoryItemId === ctx.vas.id);
  assert.equal(lVas.accessoriesCents ?? 0, 0);
  assert.equal(lVas.accessoriesSnapshot ?? null, null, "fără accesorii: nimic salvat în plus");
  assert.equal(lVas.vendorNetCents, 4500);
  // nu există linii de vânzare separate pentru accesorii (fără dublă încasare)
  assert.equal(saleLines().length, 2);
  assert.equal(s1.body.sale.totalPaidCents, 16000);
  assert.equal(s1.body.sale.accessoriesCents, 800);

  // mai multe bucăți: accesoriile × cantitatea
  const s2 = await sell([{ inventoryItemId: ctx.cana.id, quantity: 3 }], "acc-sale-3");
  const l3 = s2.body.sale.lines[0];
  assert.deepEqual([l3.lineGrossCents, l3.commissionCents, l3.accessoriesCents, l3.vendorNetCents], [33000, 3300, 2400, 27300]);

  // reducere la casă (90 lei/buc.): comisionul se recalculează din prețul efectiv, accesoriile rămân
  const s3 = await sell([{ inventoryItemId: ctx.cana.id, quantity: 2, effectiveUnitPriceCents: 9000 }], "acc-sale-disc");
  assert.equal(s3.status, 201);
  const ld = s3.body.sale.lines[0];
  assert.deepEqual([ld.lineGrossCents, ld.commissionCents, ld.accessoriesCents, ld.vendorNetCents], [18000, 1800, 1600, 14600]);
  // nimic online / preț final atins
  assert.equal(inv(ctx.cana.id).finalPriceCents ?? null, null);
  assert.equal(inv(ctx.cana.id).availableQty, 20 - 6);
  assertDbChecks();
});

test("sumă negativă pentru vânzător: vânzarea e refuzată și explicată; nimic nu se scrie", async () => {
  await setAcc(ctx.cana.id, BOX_AND_BOW);
  // 8 lei: comision 0,80, accesorii 8 lei => vânzătorul ar avea −0,80
  const res = await sell([{ inventoryItemId: ctx.cana.id, quantity: 1, effectiveUnitPriceCents: 800 }], "acc-negative-1");
  assert.equal(res.status, 409, res.text);
  const problem = res.body.problems[0];
  assert.ok(problem.reasons.includes("accessories_exceed_vendor_net"));
  assert.match(problem.messages.join(" "), /Accesoriile \(8,00 lei\) depășesc suma vânzătorului după comision \(7,20 lei\)/);
  assert.equal(saleLines().length, 0);
  assert.equal((fake.tables.artfestFairSale || []).length, 0);
  assert.equal(inv(ctx.cana.id).availableQty, 20);

  // accesorii prea mari chiar la prețul etichetei: avertizare de la scanare
  await setAcc(ctx.vas.id, [{ name: "Cutie mare", quantity: 1, unitPriceCents: 4600 }]);
  const scanRes = await call("GET", `${POS}/scan?barcode=AF34567892`, { as: ctx.admin });
  const scan = { status: scanRes.status, body: scanRes.body?.item };
  assert.ok(scan.body.reasons.includes("accessories_exceed_vendor_net"));
  assert.match(scan.body.messages.join(" "), /vânzătorul ar primi o sumă negativă/);
  const pr = await call("POST", `${POS}/preview`, { as: ctx.admin, body: { lines: [{ inventoryItemId: ctx.vas.id, quantity: 1 }] } });
  assert.equal(pr.body.canConfirm, false);
  // la limită (suma vânzătorului exact 0) vânzarea e permisă
  await setAcc(ctx.vas.id, [{ name: "Cutie mare", quantity: 1, unitPriceCents: 4500 }]);
  const zero = await sell([{ inventoryItemId: ctx.vas.id, quantity: 1 }], "acc-zero-net");
  assert.equal(zero.status, 201);
  assert.equal(zero.body.sale.lines[0].vendorNetCents, 0);
  assertDbChecks();
});

test("schimbarea accesoriilor după prima vânzare: vânzarea veche și decontul rămân; doar vânzările viitoare; dublu click la încasare", async () => {
  await setAcc(ctx.cana.id, BOX_AND_BOW);
  const s1 = await sell([{ inventoryItemId: ctx.cana.id, quantity: 1 }], "acc-before");
  assert.equal(s1.status, 201);
  const draft = await call("POST", `${ADM}/settlements`, { as: ctx.admin, body: { vendorId: ctx.v1.id, periodFrom: day(-1), periodTo: day(1) } });
  assert.equal(draft.status, 201, draft.text);
  assert.equal(draft.body.item.accessoriesCents, 800);
  const settlementId = draft.body.item.id;
  assert.equal((await call("POST", `${ADM}/settlements/${settlementId}/finalize`, { as: ctx.admin })).status, 200);

  // Artfest schimbă accesoriile (cutie mai scumpă, pungă în loc de fundă)
  const changed = await setAcc(ctx.cana.id, [{ name: "Cutie premium", quantity: 1, unitPriceCents: 900 }, { name: "Pungă", quantity: 1, unitPriceCents: 300 }]);
  assert.equal(changed.body.changed, true);
  const before = saleLines()[0];
  assert.deepEqual([before.accessoriesCents, before.vendorNetCents, before.accessoriesSnapshot[0].name], [800, 9100, "Cutie"], "vânzarea veche neschimbată");
  const sale1 = await call("GET", `${POS}/sales/${s1.body.sale.id}`, { as: ctx.admin });
  assert.equal(sale1.body.item.lines[0].accessoriesCents, 800);
  const st = { body: (await call("GET", `${ADM}/settlements/${settlementId}`, { as: ctx.admin })).body.item };
  assert.equal(st.body.accessoriesCents, 800);
  assert.equal(st.body.vendorNetCents, 9100);
  assert.equal(st.body.status, "FINALIZED");

  // dublu click la încasare: aceeași cheie => o singură vânzare, cu noile accesorii
  const [x, y] = await Promise.all([
    sell([{ inventoryItemId: ctx.cana.id, quantity: 1 }], "acc-after"),
    sell([{ inventoryItemId: ctx.cana.id, quantity: 1 }], "acc-after"),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]);
  assert.equal((fake.tables.artfestFairSale || []).length, 2);
  const after = saleLines().find((l) => l.saleId === x.body.sale.id);
  assert.deepEqual([after.accessoriesUnitCents, after.vendorNetCents], [1200, 11000 - 1100 - 1200]);
  assert.equal(inv(ctx.cana.id).availableQty, 18);

  // istoricul arată ambele modificări, cu autor
  const hist = (await call("GET", `${ADM}/inventory/${ctx.cana.id}/accessories`, { as: ctx.admin })).body.history;
  assert.equal(hist.length, 2);
  assert.deepEqual([hist[0].before.unitCents, hist[0].after.unitCents, hist[0].by], [800, 1200, "Maria Admin"]);
  assertDbChecks();
});

test("retur parțial și anulare: accesoriile se inversează din valorile salvate, proporțional, fără rețineri duble", async () => {
  await setAcc(ctx.cana.id, BOX_AND_BOW);
  const s = await sell([{ inventoryItemId: ctx.cana.id, quantity: 3 }], "acc-ret-sale");
  const lineId = s.body.sale.lines[0].id;
  // accesoriile se schimbă după vânzare: returul folosește TOT valorile salvate (8 lei / buc.)
  await setAcc(ctx.cana.id, [{ name: "Cutie premium", quantity: 1, unitPriceCents: 2000 }]);

  const r1 = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "acc-ret-1",
    body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(r1.status, 201, r1.text);
  const rl1 = r1.body.saleReturn.lines[0];
  assert.deepEqual([rl1.refundCents, rl1.commissionReversedCents, rl1.accessoriesReversedCents, rl1.vendorNetReversedCents], [11000, 1100, 800, 9100]);

  // rambursare suportată de Artfest: vânzătorul rămâne neafectat (accesoriile rămân reținute)
  const r2 = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "acc-ret-2",
    body: { reason: "deteriorat", refundMethod: "CASH", lines: [{ saleLineId: lineId, quantity: 1, disposition: "NOT_RESTOCKED", refundResponsibility: "ARTFEST", responsibilityReason: "spart la stand" }] },
  });
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.body.saleReturn.lines[0].vendorNetImpactCents, 0);

  // ultima bucată: totalul inversat pe linie = exact valorile liniei (fără rețineri duble)
  const r3 = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "acc-ret-3",
    body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(r3.status, 201);
  const rls = fake.tables.artfestFairSaleReturnLine.filter((x) => x.saleLineId === lineId);
  const sum = (k) => rls.reduce((t, x) => t + (x[k] || 0), 0);
  const sl = saleLines().find((l) => l.id === lineId);
  assert.equal(sum("accessoriesReversedCents"), sl.accessoriesCents);
  assert.equal(sum("refundCents"), sl.lineGrossCents);
  assert.equal(sum("vendorNetReversedCents"), sl.vendorNetCents);

  // anularea integrală inversează exact toate sumele (coș mixt cu produs Artfest)
  const v = await sell([{ inventoryItemId: ctx.cana.id, quantity: 2 }, { inventoryItemId: ctx.punga.id, quantity: 1 }], "acc-void-sale");
  const voided = await call("POST", `${POS}/sales/${v.body.sale.id}/void`, { as: ctx.admin, key: "acc-void", body: { reason: "greșeală la casă" } });
  assert.equal(voided.status, 201, voided.text);
  const vr = voided.body.saleReturn;
  const vLines = saleLines().filter((l) => l.saleId === v.body.sale.id);
  assert.equal(vr.refundCents, vLines.reduce((t, l) => t + l.lineGrossCents, 0));
  assert.equal(vr.accessoriesReversedCents, vLines.reduce((t, l) => t + (l.accessoriesCents || 0), 0));
  assert.equal(vr.accessoriesReversedCents, 4000, "accesoriile curente (20 lei) × 2 bucăți, salvate la vânzare");
  assert.equal(vr.vendorNetReversedCents, vLines.reduce((t, l) => t + l.vendorNetCents, 0));
  const ownRl = vr.lines.find((l) => l.vendorId == null);
  assert.deepEqual([ownRl.accessoriesReversedCents, ownRl.vendorNetReversedCents], [0, 0]);
  assertDbChecks();
});

test("contul vânzătorului, rapoarte, totaluri Admin și decont/CSV: comisionul și fiecare reținere separat; coș mixt cu produse Artfest", async () => {
  await setAcc(ctx.cana.id, BOX_AND_BOW);
  // coș mixt: Ana (cu accesorii) × 2, Ion (fără) × 1, Artfest × 2
  const s = await sell(
    [{ inventoryItemId: ctx.cana.id, quantity: 2 }, { inventoryItemId: ctx.vas.id, quantity: 1 }, { inventoryItemId: ctx.punga.id, quantity: 2 }],
    "acc-mixed"
  );
  assert.equal(s.status, 201, s.text);
  assert.equal(s.body.sale.totalPaidCents, 22000 + 5000 + 900);
  const own = s.body.sale.lines.find((l) => l.inventoryItemId === ctx.punga.id);
  assert.deepEqual([own.commissionCents, own.accessoriesCents, own.vendorNetCents], [900, 0, 0], "Artfest: integral Artfest, fără reținere suplimentară");
  // retur 1 bucată cană (afectează vânzătorul)
  const lineId = s.body.sale.lines.find((l) => l.inventoryItemId === ctx.cana.id).id;
  await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "acc-mixed-ret", body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCKED" }] },
  });

  // vânzătorul: vânzările lui, cu comisionul și reținerea pentru accesorii (+ motivul)
  const sales = await call("GET", `${VND}/sales`, { as: ctx.u1 });
  assert.equal(sales.status, 200);
  assert.equal(sales.body.items.length, 1, "doar linia lui");
  const vl = sales.body.items[0];
  assert.deepEqual([vl.lineGrossCents, vl.commissionCents, vl.accessoriesCents, vl.vendorNetCents], [22000, 2200, 1600, 18200]);
  assert.deepEqual(vl.accessories.map((x) => x.name), ["Cutie", "Fundă"]);
  assert.equal(vl.returned.accessoriesReversedCents, 800);
  const daily = await call("GET", `${VND}/reports/daily`, { as: ctx.u1 });
  assert.equal(daily.body.accessoriesCents, 1600);
  assert.equal(daily.body.accessoryLines.length, 1);
  assert.equal(daily.body.dayAccessoriesCents, 800);
  assert.equal(daily.body.dayVendorNetCents, 18200 - 9100);
  const csv = await call("GET", `${VND}/reports/daily.csv`, { as: ctx.u1 });
  assert.match(csv.text, /Ambalare și accesorii reținute \(lei\);16,00/);
  assert.ok(csv.text.includes("Cutie 1 × 6,00 lei + Fundă 1 × 2,00 lei"));
  assert.doesNotMatch(csv.text, /Vas lut|Pungă de cadou/, "fără liniile altora");
  const summary = await call("GET", `${VND}/summary`, { as: ctx.u1 });
  assert.equal(summary.body.total.sales.accessoriesCents, 1600);
  assert.equal(summary.body.total.net.vendorDueCents, 18200 - 9100);
  assert.equal(summary.body.artfest, undefined, "vânzătorul nu vede totalurile Artfest");
  // vânzătorul fără accesorii: neschimbat
  const ion = (await call("GET", `${VND}/sales`, { as: ctx.u2 })).body.items[0];
  assert.deepEqual([ion.commissionCents, ion.accessoriesCents, ion.vendorNetCents], [500, 0, 4500]);

  // Admin: comision, recuperare accesorii, produse proprii - separat; totalul Artfest fără dublare
  const rep = await call("GET", `${POS}/reports/daily`, { as: ctx.admin });
  assert.equal(rep.body.consistent, true);
  assert.deepEqual(rep.body.artfest.sales, { commissionCents: 2700, accessoriesCents: 1600, ownProductsCents: 900, artfestFundedCents: 0, artfestBorneRefundCents: 0, totalCents: 5200 });
  assert.deepEqual(rep.body.artfest.day, { commissionCents: 1600, accessoriesCents: 800, ownProductsCents: 900, artfestFundedCents: 0, artfestBorneRefundCents: 0, totalCents: 3300 });
  // totalul Artfest = încasat net − suma netă a vânzătorilor
  assert.equal(rep.body.artfest.day.totalCents, rep.body.netCollectedCents - rep.body.dayVendorNetCents);
  const acsv = await call("GET", `${POS}/reports/daily.csv`, { as: ctx.admin });
  assert.match(acsv.text, /Artfest - recuperare ambalare și accesorii, nu este profit net \(lei\);16,00/);
  assert.match(acsv.text, /Artfest - vânzări produse proprii \(lei\);9,00/);
  const asum = await call("GET", `${POS}/reports/summary`, { as: ctx.admin });
  assert.equal(asum.body.artfest.total.totalCents, asum.body.totals.total.net.artfestCents);
  assert.equal(asum.body.artfest.total.accessoriesCents, 800);
  const anaRow = asum.body.rows.find((r) => r.vendorId === ctx.v1.id);
  assert.equal(anaRow.total.net.accessoriesCents, 800);

  // decont + CSV: comisionul și fiecare reținere, separat; suma finală = net − net inversat
  const st = await call("POST", `${ADM}/settlements`, { as: ctx.admin, body: { vendorId: ctx.v1.id, periodFrom: day(-1), periodTo: day(1) } });
  assert.equal(st.status, 201, st.text);
  const d = st.body.item;
  assert.deepEqual([d.grossSalesCents, d.commissionCents, d.accessoriesCents, d.vendorNetCents, d.accessoriesReversedCents, d.vendorNetReversedCents, d.finalDueCents],
    [22000, 2200, 1600, 18200, 800, 9100, 9100]);
  assert.equal(d.saleLines[0].accessories.length, 2);
  assert.equal(d.consistent, true);
  const finalize = await call("POST", `${ADM}/settlements/${d.id}/finalize`, { as: ctx.admin });
  assert.equal(finalize.status, 200);
  const vcsv = await call("GET", `${VND}/settlements/${d.id}.csv`, { as: ctx.u1 });
  assert.equal(vcsv.status, 200);
  assert.match(vcsv.text, /Ambalare și accesorii reținute \(lei\);16,00/);
  assert.match(vcsv.text, /Accesorii restituite la retururi \(lei\);8,00/);
  assert.ok(vcsv.text.includes(";Cutie 1 × 6,00 lei + Fundă 1 × 2,00 lei;182,00"));
  assert.match(vcsv.text, /Sumă finală \(lei\);91,00/);
  // produsele Artfest nu intră în niciun decont
  assert.equal((fake.tables.artfestFairSettlementEntry || []).some((e) => e.saleLineId === own.id), false);
  assertDbChecks();
});
