// Târgul Artfest - regula financiară ACTUALĂ pentru vânzările viitoare ale produselor participanților.
// Preț propus = declarat + adaos 10% din declarat + accesorii (50 + 5 + 5 = 60 lei).
//   încasat ≥ propus (DECLARED_PLUS_MARKUP): vânzătorul primește prețul declarat, Artfest diferența;
//   încasat < propus (DISCOUNTED_COMMISSION): accesoriile întâi, apoi 10% / 90% din rest
//   (declarat 12, cutie 3, încasat 15: bază 12, comision 1,20, vânzător 10,80, Artfest 4,20).
// Încasarea sub accesorii e refuzată. Retururi din valorile salvate, coș mixt, istoricul (regula veche)
// păstrat, etichetele tipăresc totalul pentru client, prețurile finale vechi semnalate, nu modificate.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairDeclaredMarkup.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";
process.env.APP_URL = "https://www.artfest.ro";
delete process.env.ARTFEST_FAIR_LEGACY_COMMISSION_RULE;

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
    async renderPdfWithSharedBrowser(html) {
      rendered.push(html);
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

const yesterday = new Date(Date.now() - 86400000);

beforeEach(() => {
  fake = createFakePrisma();
  rendered.length = 0;
  const [admin, u1, u2] = fake.seed("user", [{ email: "adm@t.ro", role: "ADMIN" }, { email: "v1@t.ro", role: "VENDOR" }, { email: "v2@t.ro", role: "VENDOR" }]);
  const [v1, v2] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelierul Anei", isActive: true },
    { userId: u2.id, displayName: "Ceramica Ion", isActive: true },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000, nextSaleNumber: 2, nextReturnNumber: 1 },
  ]);
  const reg = (vendorId, userId) => ({ fairId: fair.id, vendorId, submittedByUserId: userId, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" });
  const [r1, r2] = fake.seed("artfestFairRegistration", [reg(v1.id, u1.id), reg(v2.id, u2.id)]);
  const line = (o) => ({
    fairId: fair.id, currency: "RON", status: "RECEIVED", receivedAt: new Date(), productId: null, storeNameSnapshot: "Magazin",
    receivedQty: o.qty, availableQty: o.qty, declaredQty: o.qty, soldQty: 0, damagedQty: 0, lostQty: 0, returnedQty: 0,
    onlineReservationMode: "NONE", accessoriesUnitCents: 0, ...o,
  });
  const [cutie, vas, felicitare, punga] = fake.seed("artfestFairInventoryItem", [
    // Ana: declarat 50 lei; etichetă încă negenerată
    line({ registrationId: r1.id, vendorId: v1.id, variantKey: "manual:inger", titleSnapshot: "Înger pictat", priceSnapshotCents: 5000, barcode: "AF23456789", qty: 20 }),
    // Ion: declarat 33,33 lei (rotunjiri); preț final VECHI salvat (40 lei) + etichetă tipărită cu el
    line({ registrationId: r2.id, vendorId: v2.id, variantKey: "manual:vas", titleSnapshot: "Vas lut", priceSnapshotCents: 3333,
      finalPriceCents: 4000, labelGeneratedAt: yesterday, labelPriceCents: 4000, barcode: "AF34567892", qty: 10 }),
    // Ana: declarat 12 lei + cutie 3 lei => propus 16,20 lei (eticheta tipărită cu el)
    line({ registrationId: r1.id, vendorId: v1.id, variantKey: "manual:felicitare", titleSnapshot: "Felicitare", priceSnapshotCents: 1200,
      accessories: [{ name: "Cutie", quantity: 1, unitPriceCents: 300, totalCents: 300 }], accessoriesUnitCents: 300,
      labelGeneratedAt: yesterday, labelPriceCents: 1620, barcode: "AF56789234", qty: 20 }),
    // Artfest - stoc propriu
    line({ registrationId: null, vendorId: null, variantKey: "manual:punga", titleSnapshot: "Pungă de cadou", storeNameSnapshot: null,
      priceSnapshotCents: 450, labelGeneratedAt: yesterday, labelPriceCents: 450, barcode: "AF45678923", qty: 30 }),
  ]);
  // vânzare ISTORICĂ (regula veche, comision 10% din prețul efectiv): trebuie să rămână neschimbată
  const [oldSale] = fake.seed("artfestFairSale", [{
    fairId: fair.id, saleNumber: 1, receiptReference: "TA26-000001", status: "COMPLETED", currency: "RON", listCents: 10000, discountCents: 0,
    totalPaidCents: 10000, commissionCents: 1000, vendorNetCents: 9000, accessoriesCents: 0, paymentMethod: "CASH", cashCents: 10000,
    idempotencyKey: "seed-old-sale-1", requestHash: "x", soldAt: new Date(), createdById: admin.id,
  }]);
  const [oldLine] = fake.seed("artfestFairSaleLine", [{
    saleId: oldSale.id, fairId: fair.id, inventoryItemId: cutie.id, vendorId: v1.id, titleSnapshot: "Înger pictat", barcodeSnapshot: "AF23456789",
    quantity: 1, listUnitPriceCents: 10000, lineListCents: 10000, lineDiscountCents: 0, lineGrossCents: 10000, effectiveUnitPriceCents: 10000,
    commissionBps: 1000, commissionCents: 1000, commissionOnListCents: 1000, vendorNetCents: 9000, artfestFundedDiscountCents: 0,
    accessoriesUnitCents: 0, accessoriesCents: 0, financeRule: "COMMISSION_PERCENT", pricingModel: "COMMISSION", returnedQty: 0, createdAt: new Date(),
  }]);
  ctx = { admin, u1, u2, v1, v2, fair, cutie, vas, felicitare, punga, oldSale, oldLine };
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
const inv = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const sell = (lines, key) => call("POST", `${POS}/sales`, { as: ctx.admin, key, body: { lines, paymentMethod: "CASH" } });
const day = (offset = 0) => reports.todayLocal(new Date(Date.now() + offset * 86400000));

async function setupCutie() {
  // cutie Artfest 5 lei / bucată + etichete generate acum (tipăresc totalul pentru client)
  assert.equal((await call("PUT", `${ADM}/inventory/${ctx.cutie.id}/accessories`, { as: ctx.admin, body: { items: [{ name: "Cutie", quantity: 1, unitPriceCents: 500 }] } })).status, 200);
  const res = await fetch(`${base}${ADM}/inventory/labels.pdf`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": ctx.admin.id },
    body: JSON.stringify({ ids: [ctx.cutie.id], copies: 2 }),
  });
  assert.equal(res.status, 200, await res.text());
}

// aceleași reguli ca CHECK-urile din DB (inclusiv 20261127180000_artfest_fair_declared_markup)
function assertDbChecks() {
  for (const l of fake.tables.artfestFairSaleLine) {
    const acc = l.accessoriesCents || 0;
    assert.equal(l.vendorNetCents, l.lineGrossCents - l.commissionCents - acc + (l.artfestFundedDiscountCents || 0), "AFSL_vendorNet_chk");
    assert.ok(l.commissionCents >= 0 && l.commissionCents <= l.lineGrossCents, "AFSL_commission_chk");
    assert.ok(l.commissionCents <= l.commissionOnListCents && l.commissionOnListCents <= l.lineListCents && l.commissionOnListCents >= 0, "AFSL_commissionOnList_chk");
    assert.ok(l.vendorNetCents <= l.lineListCents - l.commissionOnListCents, "AFSL_vendorNet_cap_chk");
    const rule = l.financeRule || "COMMISSION_PERCENT";
    if (rule === "DECLARED_PLUS_MARKUP" || rule === "DISCOUNTED_COMMISSION") {
      assert.ok(l.vendorId && l.declaredUnitPriceCents > 0 && l.markupUnitCents >= 0, "AFSL_finance_rule_chk");
      assert.equal(l.proposedUnitPriceCents, l.declaredUnitPriceCents + l.markupUnitCents + (l.accessoriesUnitCents || 0), "AFSL_finance_rule_chk (propus)");
      assert.equal(l.artfestFundedDiscountCents || 0, 0);
      if (rule === "DECLARED_PLUS_MARKUP") {
        assert.ok(l.lineGrossCents >= l.proposedUnitPriceCents * l.quantity, "AFSL_finance_rule_chk (≥ propus)");
        assert.equal(l.vendorNetCents, l.declaredUnitPriceCents * l.quantity, "AFSL_finance_rule_chk (declarat integral)");
      } else {
        assert.ok(l.lineGrossCents < l.proposedUnitPriceCents * l.quantity && l.lineGrossCents >= acc, "AFSL_finance_rule_chk (< propus, ≥ accesorii)");
        assert.equal(l.commissionCents, Math.floor((2 * (l.lineGrossCents - acc) * l.markupBps + 10000) / 20000), "AFSL_finance_rule_chk (10% din încasat − accesorii)");
      }
    } else {
      assert.ok(l.declaredUnitPriceCents == null && l.markupUnitCents == null && l.proposedUnitPriceCents == null, "AFSL_finance_rule_chk (fără valori noi)");
      if (rule === "ARTFEST_OWN") assert.equal(l.vendorId ?? null, null);
    }
  }
  for (const rl of fake.tables.artfestFairSaleReturnLine || []) {
    assert.equal(rl.vendorNetReversedCents, rl.refundCents - rl.commissionReversedCents - (rl.accessoriesReversedCents || 0) + (rl.artfestFundedReversedCents || 0), "AFSRL_vendorNet_chk");
    assert.ok(rl.commissionReversedCents >= 0 && rl.commissionReversedCents <= rl.refundCents, "AFSRL_amounts_chk");
  }
}

test("preț propus = declarat + 10% + accesorii (50 + 5 + 5 = 60); eticheta tipărește totalul; prețul final vechi semnalat, nu modificat", async () => {
  await setupCutie();
  const item = (await call("GET", `${ADM}/inventory/${ctx.cutie.id}`, { as: ctx.admin })).body.item;
  const p = item.pricing;
  assert.deepEqual(
    [p.vendorPriceCents, p.markupUnitCents, p.accessoriesUnitCents, p.proposedFinalPriceCents, p.salePriceCents, p.vendorNetCents, p.artfestCents, p.markupCents],
    [5000, 500, 500, 6000, 6000, 5000, 1000, 500]
  );
  assert.equal(p.financeRule, "DECLARED_PLUS_MARKUP");
  assert.equal(p.suggestedFinalPriceCents, 6000, "nu mai e declarat / 0,90 (55,56 lei)");
  // eticheta: totalul pentru client
  assert.equal(inv(ctx.cutie.id).labelPriceCents, 6000);
  assert.ok(rendered.at(-1).includes(">60 lei<"), "prețul tipărit pe etichetă = totalul pentru client, 60 lei");

  // Ion: prețul final vechi (40 lei) rămâne; diferența față de propusul nou (33,33 + 3,33 = 36,66) e semnalată
  const vas = (await call("GET", `${ADM}/inventory/${ctx.vas.id}`, { as: ctx.admin })).body.item;
  assert.equal(inv(ctx.vas.id).finalPriceCents, 4000);
  assert.deepEqual([vas.pricing.finalPriceCents, vas.pricing.proposedFinalPriceCents, vas.pricing.finalDiffersFromProposed, vas.label.state], [4000, 3666, true, "valid"]);
  assert.equal(inv(ctx.vas.id).labelPriceCents, 4000, "eticheta existentă neatinsă");

  // vânzătorul vede: declarat, adaos, accesorii, total client, suma lui
  const list = await inventory.listInventory({ vendorId: ctx.v1.id, db: fake });
  const mine = (list.items || list.lines || []).find((i) => i.id === ctx.cutie.id);
  assert.deepEqual([mine.pricing.vendorPriceCents, mine.pricing.markupUnitCents, mine.pricing.accessoriesUnitCents, mine.pricing.salePriceCents, mine.pricing.vendorNetCents], [5000, 500, 500, 6000, 5000]);
  assert.equal(inv(ctx.cutie.id).priceSnapshotCents, 5000, "prețul declarat neschimbat");
});

test("vânzare 60 lei: vânzătorul 50, Artfest 10 (adaos 5 + cutie 5); mai multe bucăți; regula și valorile salvate pe linie", async () => {
  await setupCutie();
  const scan = (await call("GET", `${POS}/scan?barcode=AF23456789`, { as: ctx.admin })).body.item;
  assert.deepEqual([scan.salePriceCents, scan.declaredUnitPriceCents, scan.markupUnitCents, scan.accessoriesUnitCents, scan.vendorUnitCents, scan.artfestUnitCents], [6000, 5000, 500, 500, 5000, 1000]);
  assert.equal(scan.sellable, true);

  const s1 = await sell([{ inventoryItemId: ctx.cutie.id, quantity: 1 }], "markup-sale-1");
  assert.equal(s1.status, 201, s1.text);
  const l1 = s1.body.sale.lines[0];
  assert.deepEqual([l1.lineGrossCents, l1.vendorNetCents, l1.commissionCents, l1.accessoriesCents], [6000, 5000, 500, 500]);
  assert.deepEqual([l1.financeRule, l1.declaredUnitPriceCents, l1.markupUnitCents, l1.proposedUnitPriceCents], ["DECLARED_PLUS_MARKUP", 5000, 500, 6000]);

  const s3 = await sell([{ inventoryItemId: ctx.cutie.id, quantity: 3 }], "markup-sale-3");
  const l3 = s3.body.sale.lines[0];
  assert.deepEqual([l3.lineGrossCents, l3.vendorNetCents, l3.commissionCents, l3.accessoriesCents], [18000, 15000, 1500, 1500]);
  assert.equal(inv(ctx.cutie.id).availableQty, 16);
  assertDbChecks();
});

const lineOf = (res) => res.body.sale.lines[0];
const amounts = (l) => [l.financeRule, l.lineGrossCents, l.accessoriesCents, l.commissionCents, l.vendorNetCents, l.lineGrossCents - l.vendorNetCents];

test("exemplul obligatoriu: declarat 12, cutie 3, încasat 15 => bază 12, comision 1,20, vânzător 10,80, Artfest 4,20; POS explică înainte de confirmare", async () => {
  const pv = (await call("POST", `${POS}/preview`, { as: ctx.admin, body: { lines: [{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 1500 }] } })).body;
  assert.equal(pv.canConfirm, true);
  const l = pv.lines[0];
  // calculul complet, înainte de confirmare
  assert.deepEqual([l.financeRule, l.vendorReduced, l.proposedUnitPriceCents, l.baseCents, l.commissionCents, l.vendorNetCents, l.declaredLineCents], ["DISCOUNTED_COMMISSION", true, 1620, 1200, 120, 1080, 1200]);
  const s = await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 1500 }], "rule2-example-1");
  assert.equal(s.status, 201, s.text);
  assert.deepEqual(amounts(lineOf(s)), ["DISCOUNTED_COMMISSION", 1500, 300, 120, 1080, 420]);
  assert.deepEqual([lineOf(s).declaredUnitPriceCents, lineOf(s).markupUnitCents, lineOf(s).proposedUnitPriceCents], [1200, 120, 1620]);
  assertDbChecks();
});

test("prețul propus exact, peste el și cu un ban sub el (treptele), accesoriile neacoperite refuzate", async () => {
  // exact propus (16,20): vânzătorul primește prețul declarat
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1 }], "rule2-exact-1"))), ["DECLARED_PLUS_MARKUP", 1620, 300, 120, 1200, 420]);
  // peste propus (17 lei, confirmat): diferența revine Artfest
  const above = await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 1700, aboveLabelConfirmed: true }], "rule2-above-1");
  assert.deepEqual(amounts(lineOf(above)), ["DECLARED_PLUS_MARKUP", 1700, 300, 200, 1200, 500]);
  // un ban sub propus (16,19): accesorii, apoi 10% / 90% din 13,19 => comision 1,32, vânzător 11,87
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 1619 }], "rule2-minus1-1"))), ["DISCOUNTED_COMMISSION", 1619, 300, 132, 1187, 432]);
  // exact accesoriile (3 lei): bază 0 => vânzătorul 0, permis
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 300 }], "rule2-acc-1"))), ["DISCOUNTED_COMMISSION", 300, 300, 0, 0, 300]);
  // sub accesorii (2,99 lei): refuzat, explicat, nimic scris
  const before = fake.tables.artfestFairSaleLine.length;
  const blocked = await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 1, effectiveUnitPriceCents: 299 }], "rule2-below-1");
  assert.equal(blocked.status, 409);
  assert.ok(blocked.body.problems[0].reasons.includes("price_below_accessories"));
  assert.match(blocked.body.problems[0].messages.join(" "), /nu acoperă ambalajele \/ accesoriile Artfest \(3,00 lei\/buc\.\)/);
  assert.equal(fake.tables.artfestFairSaleLine.length, before);
  assertDbChecks();
});

test("cantități multiple: pragul se aplică pe linie (propus × cantitate); reducerea afectează vânzătorul doar sub prag", async () => {
  // 3 × 16,20 = 48,60: treapta 1
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 3 }], "rule2-q3-exact"))), ["DECLARED_PLUS_MARKUP", 4860, 900, 360, 3600, 1260]);
  // 3 × 15: bază 45 − 9 = 36, comision 3,60, vânzător 32,40
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 3, effectiveUnitPriceCents: 1500 }], "rule2-q3-disc"))), ["DISCOUNTED_COMMISSION", 4500, 900, 360, 3240, 1260]);
  // reducere de 1 ban pe bucată × 2: 32,38 < 32,40 => treapta 2
  assert.deepEqual(amounts(lineOf(await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 2, effectiveUnitPriceCents: 1619 }], "rule2-q2-minus1"))), ["DISCOUNTED_COMMISSION", 3238, 600, 264, 2374, 864]);
  assertDbChecks();
});

test("retururi sub prețul propus: din valorile salvate, proporțional; totalul închide exact linia; anularea inversează tot", async () => {
  const s = await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 3, effectiveUnitPriceCents: 1500 }], "rule2-ret-sale");
  const line = lineOf(s);
  const r1 = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "rule2-ret-1", body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: line.id, quantity: 1, disposition: "RESTOCKED" }] },
  });
  assert.equal(r1.status, 201, r1.text);
  const rl = r1.body.saleReturn.lines[0];
  assert.deepEqual([rl.refundCents, rl.accessoriesReversedCents, rl.commissionReversedCents, rl.vendorNetReversedCents], [1500, 300, 120, 1080]);
  const r2 = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
    as: ctx.admin, key: "rule2-ret-2", body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: line.id, quantity: 2, disposition: "RESTOCKED" }] },
  });
  assert.equal(r2.status, 201, r2.text);
  const rls = fake.tables.artfestFairSaleReturnLine.filter((x) => x.saleLineId === line.id);
  const sum = (k) => rls.reduce((t, x) => t + (x[k] || 0), 0);
  assert.deepEqual([sum("refundCents"), sum("accessoriesReversedCents"), sum("commissionReversedCents"), sum("vendorNetReversedCents")], [4500, 900, 360, 3240]);
  // „un ban sub”: o linie cu rest la împărțire
  const odd = await sell([{ inventoryItemId: ctx.felicitare.id, quantity: 2, effectiveUnitPriceCents: 1619 }], "rule2-odd-sale");
  const voided = await call("POST", `${POS}/sales/${odd.body.sale.id}/void`, { as: ctx.admin, key: "rule2-odd-void", body: { reason: "greșeală" } });
  assert.equal(voided.status, 201, voided.text);
  assert.deepEqual(
    [voided.body.saleReturn.refundCents, voided.body.saleReturn.accessoriesReversedCents, voided.body.saleReturn.commissionReversedCents, voided.body.saleReturn.vendorNetReversedCents],
    [3238, 600, 264, 2374]
  );
  assertDbChecks();
});

test("retururi și anulare: vânzătorului i se inversează exact prețul declarat pe bucată (și la rotunjiri); fără dubluri", async () => {
  await setupCutie();
  // Ion: declarat 33,33, fără accesorii, vândut la 37 lei × 3 => adaos 11,01 (resturi de împărțire)
  const s = await sell([{ inventoryItemId: ctx.vas.id, quantity: 3, effectiveUnitPriceCents: 3700 }], "markup-ret-sale");
  assert.equal(s.status, 201, s.text);
  const line = s.body.sale.lines[0];
  assert.deepEqual([line.lineGrossCents, line.vendorNetCents, line.commissionCents], [11100, 9999, 1101]);
  for (const [i, key] of ["markup-ret-1", "markup-ret-2", "markup-ret-3"].entries()) {
    const r = await call("POST", `${POS}/sales/${s.body.sale.id}/returns`, {
      as: ctx.admin, key, body: { reason: "client", refundMethod: "CASH", lines: [{ saleLineId: line.id, quantity: 1, disposition: "RESTOCKED" }] },
    });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.saleReturn.lines[0].vendorNetReversedCents, 3333, `bucata ${i + 1}: exact prețul declarat`);
  }
  const rls = fake.tables.artfestFairSaleReturnLine.filter((x) => x.saleLineId === line.id);
  assert.equal(rls.reduce((t, x) => t + x.refundCents, 0), 11100);
  assert.equal(rls.reduce((t, x) => t + x.commissionReversedCents, 0), 1101);

  // anulare integrală, cu accesorii: exact toate sumele
  const v = await sell([{ inventoryItemId: ctx.cutie.id, quantity: 2 }], "markup-void-sale");
  const voided = await call("POST", `${POS}/sales/${v.body.sale.id}/void`, { as: ctx.admin, key: "markup-void-1", body: { reason: "greșeală" } });
  assert.equal(voided.status, 201, voided.text);
  assert.deepEqual(
    [voided.body.saleReturn.refundCents, voided.body.saleReturn.commissionReversedCents, voided.body.saleReturn.accessoriesReversedCents, voided.body.saleReturn.vendorNetReversedCents],
    [12000, 1000, 1000, 10000]
  );
  assert.equal(inv(ctx.cutie.id).availableQty, 20);
  assertDbChecks();
});

test("coș mixt (Ana + Ion cu preț final vechi + Artfest) și istoricul: regula veche păstrată; rapoarte, cont vânzător, decont/CSV", async () => {
  await setupCutie();
  const s = await sell(
    [{ inventoryItemId: ctx.cutie.id, quantity: 1 }, { inventoryItemId: ctx.vas.id, quantity: 2 }, { inventoryItemId: ctx.punga.id, quantity: 2 }],
    "markup-mixed-1"
  );
  assert.equal(s.status, 201, s.text);
  const by = (id) => s.body.sale.lines.find((l) => l.inventoryItemId === id);
  assert.deepEqual([by(ctx.cutie.id).vendorNetCents, by(ctx.cutie.id).commissionCents, by(ctx.cutie.id).accessoriesCents], [5000, 500, 500]);
  // Ion: prețul final vechi 40 lei: vânzătorul 33,33, adaosul efectiv 6,67 (peste 3,33 propus)
  assert.deepEqual([by(ctx.vas.id).lineGrossCents, by(ctx.vas.id).vendorNetCents, by(ctx.vas.id).commissionCents], [8000, 6666, 1334]);
  assert.deepEqual([by(ctx.punga.id).financeRule, by(ctx.punga.id).commissionCents, by(ctx.punga.id).vendorNetCents], ["ARTFEST_OWN", 900, 0]);
  assert.equal(s.body.sale.totalPaidCents, 6000 + 8000 + 900);

  // istoricul: vânzarea veche neschimbată (regula veche)
  const old = fake.tables.artfestFairSaleLine.find((l) => l.id === ctx.oldLine.id);
  assert.deepEqual([old.financeRule, old.commissionCents, old.vendorNetCents, old.declaredUnitPriceCents ?? null], ["COMMISSION_PERCENT", 1000, 9000, null]);

  // vânzătorul: ambele vânzări, fiecare cu regula ei
  const sales = (await call("GET", `${VND}/sales`, { as: ctx.u1 })).body.items;
  const rules = Object.fromEntries(sales.map((x) => [x.financeRule, x]));
  assert.deepEqual([rules.COMMISSION_PERCENT.vendorNetCents, rules.DECLARED_PLUS_MARKUP.vendorNetCents, rules.DECLARED_PLUS_MARKUP.declaredUnitPriceCents, rules.DECLARED_PLUS_MARKUP.markupUnitCents], [9000, 5000, 5000, 500]);

  // Admin: raport consistent; partea Artfest = încasat net − cuvenit vânzătorilor
  const rep = (await call("GET", `${POS}/reports/daily`, { as: ctx.admin })).body;
  assert.equal(rep.consistent, true);
  assert.equal(rep.artfest.day.totalCents, rep.netCollectedCents - rep.dayVendorNetCents);
  assert.equal(rep.artfest.sales.accessoriesCents, 500);
  assert.equal(rep.artfest.sales.ownProductsCents, 900);

  // decont Ana: vânzarea veche (9000) + cea nouă (5000); CSV cu regula fiecărei linii și prețul declarat
  const st = await call("POST", `${ADM}/settlements`, { as: ctx.admin, body: { vendorId: ctx.v1.id, periodFrom: day(-1), periodTo: day(1) } });
  assert.equal(st.status, 201, st.text);
  assert.deepEqual([st.body.item.vendorNetCents, st.body.item.finalDueCents, st.body.item.accessoriesCents], [14000, 14000, 500]);
  assert.equal((await call("POST", `${ADM}/settlements/${st.body.item.id}/finalize`, { as: ctx.admin })).status, 200);
  const csv = await call("GET", `${VND}/settlements/${st.body.item.id}.csv`, { as: ctx.u1 });
  assert.ok(csv.text.includes("Preț declarat / buc. (lei)") && csv.text.includes("Total client (lei)") && csv.text.includes("Suma vânzătorului (lei)"));
  assert.ok(csv.text.includes(";comision 10% (istoric);"), "linia veche cu regula ei");
  assert.ok(csv.text.includes(";declarat + adaos 10% + accesorii;50,00;60,00;0,00;60,00;5,00;5,00;Cutie 1 × 5,00 lei;50,00"), csv.text);
  assertDbChecks();
});

test("Etichete „Cu fotografie produs”: aceeași rută; miniatura doar când fotografia e disponibilă; altfel eticheta normală; prețul total și codul AF neschimbate", async () => {
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 120, b: 60 } } }).jpeg().toBuffer();
  const { clearLabelPhotoCache } = await import("../lib/fairLabelPhotos.js");
  clearLabelPhotoCache();
  process.env.LABEL_PHOTO_HOSTS = "media.test";
  inv(ctx.cutie.id).imageUrlSnapshot = "https://media.test/inger.jpg";
  inv(ctx.vas.id).imageUrlSnapshot = "https://media.test/lipsa.jpg";
  const realFetch = globalThis.fetch;
  const photoCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith("https://media.test/")) {
      photoCalls.push(String(url));
      return String(url).endsWith("inger.jpg") ? new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } }) : new Response("", { status: 404 });
    }
    return realFetch(url, opts);
  };
  const pdf = (body) =>
    realFetch(`${base}${ADM}/inventory/labels.pdf`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": ctx.admin.id }, body: JSON.stringify(body) });
  try {
    const plain = await pdf({ ids: [ctx.cutie.id, ctx.vas.id], copies: 1 });
    assert.equal(plain.status, 200);
    const htmlPlain = rendered.at(-1);
    assert.equal((htmlPlain.match(/class="thumb /g) || []).length, 0, "fără opțiune: fără fotografie");
    assert.equal(photoCalls.length, 0, "fără opțiune nu se descarcă nimic");

    const withPhoto = await pdf({ ids: [ctx.cutie.id, ctx.vas.id], copies: 1, photo: true });
    assert.equal(withPhoto.status, 200);
    const html = rendered.at(-1);
    assert.equal((html.match(/class="thumb ph1"/g) || []).length, 1, "doar produsul cu fotografie disponibilă");
    assert.ok(html.includes("AF-2345-6789") && html.includes("AF-3456-7892"), "ambele etichete, cu codul AF");
    assert.ok(html.includes(">40 lei<"), "eticheta fără fotografie (404) e generată normal, cu prețul ei");

    // eticheta individuală, cu fotografia din cache (fără a doua descărcare)
    const one = await realFetch(`${base}${ADM}/inventory/${ctx.cutie.id}/label.pdf?photo=1`, { headers: { "x-test-user": ctx.admin.id } });
    assert.equal(one.status, 200);
    assert.ok(rendered.at(-1).includes('class="thumb ph1"'));
    assert.equal(photoCalls.filter((u) => u.endsWith("inger.jpg")).length, 1);
    // drepturi: vânzătorul nu are acces
    const denied = await realFetch(`${base}${ADM}/inventory/labels.pdf`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": ctx.u1.id }, body: JSON.stringify({ ids: [ctx.cutie.id], photo: true }) });
    assert.equal(denied.status, 403);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LABEL_PHOTO_HOSTS;
  }
  // prețurile și calculul neschimbate de opțiune
  assert.equal(inv(ctx.cutie.id).priceSnapshotCents, 5000);
});
