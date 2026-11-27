// POS -> scanarea unui produs trimis de vânzător, dar NErecepționat: aceeași linie (fără produs nou /
// alt cod AF), fișa „Salvează, recepționează și adaugă în coș” = serviciile existente (accesorii,
// preț final, recepție cu posSale), recepție parțială în limita cantității declarate, dublu click /
// reluare fără dubluri, participanți neeligibili și produse blocate refuzate, stocul scade doar la
// încasare, vânzătorul vede aceeași linie actualizată. Cod negăsit => 404, fără creare automată.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairPosReceive.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
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

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  fake = createFakePrisma();
  const [admin, u1, u2] = fake.seed("user", [{ email: "adm@t.ro", role: "ADMIN" }, { email: "v1@t.ro", role: "VENDOR" }, { email: "v2@t.ro", role: "VENDOR" }]);
  const [v1, v2] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Atelierul Anei", isActive: true },
    { userId: u2.id, displayName: "Retras", isActive: true },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000, nextSaleNumber: 1, nextReturnNumber: 1 },
  ]);
  const reg = (vendorId, userId, status) => ({ fairId: fair.id, vendorId, submittedByUserId: userId, status, participationType: "PARTICIPARE_FIZICA" });
  const [r1, r2] = fake.seed("artfestFairRegistration", [reg(v1.id, u1.id, "APPROVED"), reg(v2.id, u2.id, "CANCELLED")]);
  const submitted = (o) => ({
    fairId: fair.id, currency: "RON", status: "SUBMITTED", productId: null, submittedAt: new Date(),
    receivedQty: 0, rejectedQty: 0, availableQty: 0, soldQty: 0, damagedQty: 0, lostQty: 0, returnedQty: 0,
    onlineReservationMode: "NONE", accessoriesUnitCents: 0, imageUrlSnapshot: "https://cdn.test/inger.jpg", ...o,
  });
  const [inger, blocat, retras] = fake.seed("artfestFairInventoryItem", [
    submitted({ registrationId: r1.id, vendorId: v1.id, variantKey: "manual:inger", titleSnapshot: "Înger din lut", storeNameSnapshot: "Atelierul Anei",
      priceSnapshotCents: 10000, labelGeneratedAt: new Date(), labelPriceCents: 10000, barcode: "AF23456789", declaredQty: 5 }),
    submitted({ registrationId: r1.id, vendorId: v1.id, variantKey: "manual:blocat", titleSnapshot: "Vas blocat", priceSnapshotCents: 5000,
      labelGeneratedAt: new Date(), labelPriceCents: 5000, barcode: "AF34567892", declaredQty: 2, saleBlockedAt: new Date(), saleBlockedReason: "verificare" }),
    submitted({ registrationId: r2.id, vendorId: v2.id, variantKey: "manual:retras", titleSnapshot: "Produs retras", priceSnapshotCents: 3000,
      labelGeneratedAt: new Date(), labelPriceCents: 3000, barcode: "AF45678923", declaredQty: 2 }),
  ]);
  ctx = { admin, u1, v1, fair, inger, blocat, retras };
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
const scan = async (code) => {
  const r = await call("GET", `${POS}/scan?barcode=${code}`, { as: ctx.admin });
  return { status: r.status, item: r.body?.item, body: r.body };
};
const inv = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const receive = (id, body, key) => call("POST", `${ADM}/inventory/${id}/receive`, { as: ctx.admin, key, body: { posSale: true, ...body } });

test("scanare: produs trimis, nerecepționat => aceeași linie (produs, foto, magazin, vânzător), fără vânzare; cod necunoscut => 404, nimic creat", async () => {
  const s = await scan("AF23456789");
  assert.equal(s.status, 200);
  assert.equal(s.item.inventoryItemId, ctx.inger.id);
  assert.equal(s.item.notReceived, true);
  assert.equal(s.item.status, "SUBMITTED");
  assert.deepEqual([s.item.declaredQty, s.item.receivedQty], [5, 0]);
  assert.equal(s.item.imageUrl, "https://cdn.test/inger.jpg");
  assert.equal(s.item.storeName, "Atelierul Anei");
  assert.equal(s.item.vendor.name, "Atelierul Anei");
  assert.equal(s.item.registrationStatus, "APPROVED");
  assert.equal(s.item.sellable, false, "nu intră în coș înainte de recepție");
  assert.ok(s.item.reasons.includes("not_received"));
  assert.equal(inv(ctx.inger.id).status, "SUBMITTED", "scanarea nu recepționează nimic");

  const count = fake.tables.artfestFairInventoryItem.length;
  const nf = await scan("AF99999999");
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error ?? nf.body.code, "barcode_not_found");
  assert.equal(fake.tables.artfestFairInventoryItem.length, count, "fără creare automată");
});

test("fișa: accesorii + preț final + recepție parțială (3 din 5) cu reluare / dublu click; încasare cu prețul final, fără retipărire; vânzătorul vede linia", async () => {
  const id = ctx.inger.id;
  // 1. accesorii (formularul existent)
  const acc = await call("PUT", `${ADM}/inventory/${id}/accessories`, { as: ctx.admin, body: { items: [{ name: "Cutie", quantity: 1, unitPriceCents: 800 }] } });
  assert.equal(acc.status, 200);
  // 2. prețul final propus de Artfest (declaratul și online rămân)
  const fp = await call("POST", `${ADM}/inventory/${id}/final-price`, { as: ctx.admin, body: { finalPriceCents: 12000 } });
  assert.equal(fp.status, 200, fp.text);
  assert.equal(fp.body.labelReprintNeeded, true);
  assert.equal(inv(id).priceSnapshotCents, 10000, "prețul declarat neschimbat");
  // calculul arătat în fișă
  const line = (await call("GET", `${ADM}/inventory/${id}`, { as: ctx.admin })).body.item;
  assert.deepEqual([line.pricing.salePriceCents, line.pricing.commissionCents, line.pricing.accessoriesUnitCents, line.pricing.vendorNetCents], [12000, 1200, 800, 10000]);

  // 3. peste cantitatea declarată: refuzat (marfa în plus prin suplimentare)
  const over = await receive(id, { receivedQty: 6 }, "pos-recv-over-1");
  assert.equal(over.status, 409);
  assert.equal(over.body.error ?? over.body.code, "received_above_declared");
  assert.equal(inv(id).status, "SUBMITTED");

  // recepție parțială 3 din 5; dublu click / reîncercare cu aceeași cheie => o singură recepție
  const [a, b] = await Promise.all([receive(id, { receivedQty: 3 }, "pos-recv-inger-1"), receive(id, { receivedQty: 3 }, "pos-recv-inger-1")]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  const retry = await receive(id, { receivedQty: 3 }, "pos-recv-inger-1");
  assert.equal(retry.body.replayed, true);
  const after = inv(id);
  assert.deepEqual([after.status, after.receivedQty, after.availableQty, after.receivedById], ["RECEIVED", 3, 3, ctx.admin.id]);
  const moves = fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === id && m.type === "RECEIVED");
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0].quantity, moves[0].actorUserId], [3, ctx.admin.id]);
  const ev = fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === id && e.type === "STATUS_CHANGED");
  assert.equal(ev.length, 1);
  assert.ok(ev[0].createdAt, "când");

  // 4. scanarea normală continuă: vandabil; eticheta are prețul vechi => prețul final se introduce la casă
  const s = await scan("AF23456789");
  assert.equal(s.item.notReceived, false);
  assert.equal(s.item.sellable, true);
  assert.equal(s.item.requiresPrice, true);
  assert.equal(s.item.salePriceCents, 12000);
  assert.equal(inv(id).availableQty, 3, "stocul nu scade la adăugarea în coș");

  // 5. încasare: 120 lei = comision 12 + accesorii 8 + vânzător 100
  const sale = await call("POST", `${POS}/sales`, { as: ctx.admin, key: "pos-recv-sale-1", body: { lines: [{ inventoryItemId: id, quantity: 1, effectiveUnitPriceCents: 12000 }], paymentMethod: "CASH" } });
  assert.equal(sale.status, 201, sale.text);
  const l = sale.body.sale.lines[0];
  assert.deepEqual([l.lineGrossCents, l.commissionCents, l.accessoriesCents, l.vendorNetCents], [12000, 1200, 800, 10000]);
  assert.equal(inv(id).availableQty, 2, "stocul scade doar la încasare");

  // 6. vânzătorul: aceeași linie, recepționată, cu prețul final și accesoriile
  const list = await inventory.listInventory({ vendorId: ctx.v1.id, db: fake });
  const mine = (list.items || list.lines || []).find((i) => i.id === id);
  assert.equal(mine.status, "RECEIVED");
  assert.equal(mine.receivedQty, 3);
  assert.equal(mine.barcodeDisplay, "AF-2345-6789", "același cod AF");
  assert.equal(mine.pricing.finalPriceCents, 12000);
  assert.equal(mine.pricing.vendorPriceCents, 10000);
  assert.equal(mine.accessories.unitCents, 800);
  assert.equal(fake.tables.artfestFairInventoryItem.length, 3, "niciun produs nou");
});

test("refuzate din POS: participant neeligibil (participare anulată), produs blocat; recepția nu se face", async () => {
  const s = await scan("AF45678923");
  assert.equal(s.item.registrationStatus, "CANCELLED");
  const r = await receive(ctx.retras.id, { receivedQty: 1 }, "pos-recv-retras-1");
  assert.equal(r.status, 409);
  assert.equal(r.body.error ?? r.body.code, "registration_not_approved");
  assert.equal(inv(ctx.retras.id).status, "SUBMITTED");

  assert.equal((await scan("AF34567892")).item.saleBlocked, true);
  const b = await receive(ctx.blocat.id, { receivedQty: 1 }, "pos-recv-blocat-1");
  assert.equal(b.status, 409);
  assert.equal(b.body.error ?? b.body.code, "sale_blocked");
  assert.equal(inv(ctx.blocat.id).status, "SUBMITTED");
});

test("reluare după eroare parțială: pașii deja salvați nu se dublează (accesorii / preț identice = fără schimbare)", async () => {
  const id = ctx.inger.id;
  const items = [{ name: "Fundă", quantity: 2, unitPriceCents: 150 }];
  assert.equal((await call("PUT", `${ADM}/inventory/${id}/accessories`, { as: ctx.admin, body: { items } })).body.changed, true);
  assert.equal((await call("POST", `${ADM}/inventory/${id}/final-price`, { as: ctx.admin, body: { finalPriceCents: 11000 } })).body.changed, true);
  // recepția a eșuat (ex. cantitate greșită); reluarea retrimite toți pașii
  assert.equal((await receive(id, { receivedQty: 9 }, "pos-recv-retry-1")).status, 409);
  assert.equal((await call("PUT", `${ADM}/inventory/${id}/accessories`, { as: ctx.admin, body: { items } })).body.changed, false);
  assert.equal((await call("POST", `${ADM}/inventory/${id}/final-price`, { as: ctx.admin, body: { finalPriceCents: 11000 } })).body.changed, false);
  assert.equal((await receive(id, { receivedQty: 5 }, "pos-recv-retry-2")).status, 200);
  const evs = fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === id);
  assert.equal(evs.filter((e) => e.type === "ACCESSORIES_SET").length, 1);
  assert.equal(evs.filter((e) => e.type === "FINAL_PRICE_SET").length, 1);
  assert.equal(evs.filter((e) => e.type === "STATUS_CHANGED").length, 1);
  assert.equal(inv(id).receivedQty, 5);
});

test("Cod negăsit -> „Adaugă produs într-un magazin”: participant APPROVED + magazin, recepție confirmată, cod AF nou prin mecanismul existent, preț final + accesorii opționale", async () => {
  const [s1] = fake.seed("serviceType", [{ code: "products" }]);
  const [store] = fake.seed("vendorService", [{ vendorId: ctx.v1.id, typeId: s1.id, title: "Atelier", isActive: true, status: "ACTIVE" }]);
  fake.seed("serviceProfile", [{ serviceId: store.id, slug: "atelier-ana", displayName: "Atelierul Anei" }]);
  const owners = await call("GET", `${POS}/products/owners`, { as: ctx.admin });
  const ana = owners.body.participants.find((p) => p.vendorId === ctx.v1.id);
  assert.ok(ana.lines.some((l) => l.title === "Înger din lut"), "produsele existente ale participantului, pentru căutarea de dubluri");
  assert.equal(owners.body.participants.some((p) => p.vendorId !== ctx.v1.id), false, "doar participanții APPROVED");

  const body = { owner: "PARTICIPANT", registrationId: ana.registrationId, serviceId: store.id, title: "Glob pictat", priceRon: "50", receivedQty: 4, confirmReceived: true, clientRequestId: "req-glob-0000000001" };
  const [c1, c2] = await Promise.all([
    call("POST", `${POS}/products`, { as: ctx.admin, body }),
    call("POST", `${POS}/products`, { as: ctx.admin, body }),
  ]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 201]);
  const created = fake.tables.artfestFairInventoryItem.filter((l) => l.titleSnapshot === "Glob pictat");
  assert.equal(created.length, 1, "dublu click: un singur produs");
  const g = created[0];
  assert.match(g.barcode, /^AF[2-9A-HJKMNP-TV-X]{8}$/);
  assert.notEqual(g.barcode, "AF99999999", "codul scanat necunoscut nu devine cod AF");
  assert.deepEqual([g.status, g.receivedQty, g.receivedById, g.productId ?? null], ["RECEIVED", 4, ctx.admin.id, null]);
  assert.equal((fake.tables.product || []).length, 0, "nimic publicat online");
  // opționale, prin serviciile existente
  assert.equal((await call("POST", `${ADM}/inventory/${g.id}/final-price`, { as: ctx.admin, body: { finalPriceCents: 5500 } })).status, 200);
  assert.equal((await call("PUT", `${ADM}/inventory/${g.id}/accessories`, { as: ctx.admin, body: { items: [{ name: "Pungă", quantity: 1, unitPriceCents: 300 }] } })).status, 200);
  const view = (await call("GET", `${ADM}/inventory/${g.id}`, { as: ctx.admin })).body.item;
  // regula actuală: prețul final 55 < propus 50 + 5 + 3 = 58 => accesoriile întâi (3), apoi 10% / 90%
  // din 52: comision 5,20, vânzătorul 46,80
  assert.deepEqual([view.pricing.salePriceCents, view.pricing.markupCents, view.pricing.accessoriesUnitCents, view.pricing.vendorNetCents], [5500, 520, 300, 4680]);
  assert.equal(view.pricing.financeRule, "DISCOUNTED_COMMISSION");
  assert.equal(view.pricing.proposedFinalPriceCents, 5800);
  assert.equal(view.pricing.finalDiffersFromProposed, true);
  assert.equal(view.pricing.markupReduced, true);
  // fără etichetă nu se vinde (regula existentă)
  assert.ok((await scan(g.barcode)).item.reasons.includes("label_missing"));
  const list = await inventory.listInventory({ vendorId: ctx.v1.id, db: fake });
  assert.ok((list.items || list.lines || []).some((i) => i.id === g.id), "apare în contul vânzătorului");
});
