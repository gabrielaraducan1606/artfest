// Teste pentru anularea participării la Târgul Artfest (APPROVED -> CANCELLED),
// returul produselor către vendor, confirmarea primirii (vendor / Admin în
// numele lui), restaurarea stocului online și istoricul deciziilor.
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairCancellation.routes.test.js

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

const R2 = "https://cdn.test";
mock.module("../services/r2Storage.js", {
  namedExports: {
    buildPublicUrl: (key) => `${R2}/${key}`,
    async uploadToR2({ folder, index }) {
      return { url: `${R2}/${folder}/admin/${index}.jpg` };
    },
  },
});

mock.module("../lib/pdfBrowser.js", {
  namedExports: { async renderPdfWithSharedBrowser() { return Buffer.from("%PDF"); } },
});

const DAY = 24 * 60 * 60 * 1000;
const INTERNAL_REASON = "Motiv intern strict confidențial 7Q";

let server;
let base;
let ctx;
let inventory;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorFairRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  const vendorInventoryRoutes = (await import("./vendorArtfestFairInventoryRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");

  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
  app.use("/api/vendor/artfest-fair", vendorFairRoutes);
  app.use("/api/vendor/fair/inventory", vendorInventoryRoutes);
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

beforeEach(async () => {
  fake = createFakePrisma();
  const [admin, v1, v2] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
  ]);
  const [vendor1, vendor2] = fake.seed("vendor", [
    { userId: v1.id, displayName: "Atelier Ana" },
    { userId: v2.id, displayName: "Vendor 2" },
  ]);
  const [s1, s2] = fake.seed("vendorService", [
    { vendorId: vendor1.id, title: "S1" },
    { vendorId: vendor2.id, title: "S2" },
  ]);
  const [fair] = fake.seed("artfestFair", [
    {
      key: "CHRISTMAS_FAIR_BUZAU_2026",
      title: "Târg",
      registrationOpen: true,
      // regulament publicat și legat (înscrierea îl cere)
      termsVersion: "1.1.0",
      termsUrl: "/targ-artfest/regulament/v1.1.0",
      inventoryDeadlineAt: new Date(Date.now() + 5 * DAY),
      endsAt: new Date(Date.now() + 9 * DAY),
    },
  ]);
  const [r1, r2] = fake.seed("artfestFairRegistration", [
    { fairId: fair.id, vendorId: vendor1.id, submittedByUserId: v1.id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" },
    { fairId: fair.id, vendorId: vendor2.id, submittedByUserId: v2.id, status: "SUBMITTED", participationType: "PARTICIPARE_FIZICA" },
  ]);
  const [pStock, pUnique, pMto, pDraft, pOther] = fake.seed("product", [
    product(s1.id, { title: "Spiriduș", readyQty: 10 }),
    product(s1.id, { title: "Vază unicat", priceCents: 12000, readyQty: null }),
    product(s1.id, { title: "Cană la comandă", availability: "MADE_TO_ORDER" }),
    product(s1.id, { title: "Felicitare", readyQty: 3 }),
    product(s2.id, { title: "Lumânare", readyQty: 4 }),
  ]);
  ctx = { admin, v1, v2, vendor1, vendor2, fair, r1, r2, pStock, pUnique, pMto, pDraft, pOther };

  const add = (body) => inventory.addInventoryItem({ vendorId: vendor1.id, userId: v1.id, body });
  ctx.lStock = await add({ productId: pStock.id, declaredQty: 5 });
  ctx.lUnique = await add({ productId: pUnique.id, declaredQty: 1, isUnique: true });
  ctx.lMto = await add({ productId: pMto.id, declaredQty: 3 });
  await inventory.submitInventory({ vendorId: vendor1.id, userId: v1.id });
  // o ciornă netrimisă
  ctx.lDraft = await add({ productId: pDraft.id, declaredQty: 2 });
});

let keySeq = 0;
const newKey = () => `test-key-${++keySeq}-${Math.random().toString(36).slice(2, 8)}`;

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

const ADM = "/api/admin/artfest-fair";
const VEN = "/api/vendor/artfest-fair";
const INV = "/api/vendor/fair/inventory";
const line = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const productRow = (id) => fake.tables.product.find((p) => p.id === id);
const registration = (id) => fake.tables.artfestFairRegistration.find((r) => r.id === id);
const lineEvents = (id, type) => fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === id && (!type || e.type === type));
const regEvents = (id, type) => fake.tables.artfestFairRegistrationEvent.filter((e) => e.registrationId === id && (!type || e.type === type));
const movements = (id, type) => fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === id && (!type || m.type === type));

const cancel = (body, key = newKey(), regId = ctx.r1.id) =>
  call("POST", `${ADM}/registrations/${regId}/cancel`, {
    as: ctx.admin,
    key,
    body: { cause: "ARTFEST_DECISION", reason: INTERNAL_REASON, goodsAlreadyShipped: false, ...body },
  });

const receive = (id, body) => call("POST", `${ADM}/inventory/${id}/receive`, { as: ctx.admin, body, key: newKey() });

const createReturn = (body) =>
  call("POST", `${ADM}/returns`, {
    as: ctx.admin,
    body: { registrationId: ctx.r1.id, reason: "PARTICIPATION_CANCELLED", method: "COURIER_BY_ARTFEST", ...body },
  });

const ship = (id, body = {}, key = newKey()) => call("POST", `${ADM}/returns/${id}/ship`, { as: ctx.admin, body, key });

// recepție (4 primite + 1 refuzată pentru stoc, unicatul primit) și anulare
async function receivedThenCancelled(cause = "ARTFEST_DECISION") {
  assert.equal((await receive(ctx.lStock.id, { receivedQty: 4, rejectedQty: 1, rejectedReason: "Ciobit" })).status, 200);
  assert.equal((await receive(ctx.lUnique.id, { receivedQty: 1 })).status, 200);
  const res = await cancel({ cause, goodsAlreadyShipped: true });
  assert.equal(res.status, 200, res.text);
}

/* ============================== acces ============================== */

test("doar ADMIN pentru anulare și retur; vendorul primește 403", async () => {
  for (const [method, path] of [
    ["POST", `${ADM}/registrations/${ctx.r1.id}/cancel`],
    ["GET", `${ADM}/registrations/${ctx.r1.id}/events`],
    ["GET", `${ADM}/returns/candidates?registrationId=${ctx.r1.id}`],
    ["POST", `${ADM}/returns`],
  ]) {
    const res = await call(method, path, { as: ctx.v1, body: method === "POST" ? {} : undefined, key: newKey() });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal(registration(ctx.r1.id).status, "APPROVED");
});

/* ============================== reject / reapprove ============================== */

test("reject doar din SUBMITTED: o participare APPROVED nu mai poate fi respinsă", async () => {
  const res = await call("POST", `${ADM}/registrations/${ctx.r1.id}/reject`, { as: ctx.admin, body: { reason: "x" } });
  assert.equal(res.status, 409);
  assert.equal(res.body.currentStatus, "APPROVED");
  assert.match(res.body.message, /Anulează participarea/);
  assert.equal(registration(ctx.r1.id).status, "APPROVED");

  const ok = await call("POST", `${ADM}/registrations/${ctx.r2.id}/reject`, { as: ctx.admin, body: { reason: "Nu se potrivește" } });
  assert.equal(ok.status, 200);
  assert.equal(registration(ctx.r2.id).status, "REJECTED");
  assert.equal(regEvents(ctx.r2.id, "REJECTED").length, 1);
});

test("istoricul REAPPROVED nu se pierde: motivul respingerii rămâne în evenimente", async () => {
  await call("POST", `${ADM}/registrations/${ctx.r2.id}/reject`, { as: ctx.admin, body: { reason: "Prima respingere" } });
  const res = await call("POST", `${ADM}/registrations/${ctx.r2.id}/approve`, { as: ctx.admin });
  assert.equal(res.status, 200);
  assert.equal(registration(ctx.r2.id).rejectionReason, null);

  const events = await call("GET", `${ADM}/registrations/${ctx.r2.id}/events`, { as: ctx.admin });
  const types = events.body.items.map((e) => e.type);
  assert.deepEqual(types, ["REJECTED", "REAPPROVED"]);
  assert.equal(events.body.items[0].reason, "Prima respingere");
  assert.equal(events.body.items[1].before.rejectionReason, "Prima respingere");
  assert.equal(events.body.items[1].actorUserId, ctx.admin.id);
});

test("înscrierea, retragerea și reînscrierea scriu evenimente SUBMITTED / WITHDRAWN", async () => {
  // vendorul 2 nu are încă înscriere în tabelă cu evenimente: îl retragem și se reînscrie
  const w = await call("POST", `${VEN}/registration/withdraw`, { as: ctx.v2 });
  assert.equal(w.status, 200);
  const again = await call("POST", `${VEN}/registration`, {
    as: ctx.v2,
    body: {
      participationType: "PARTICIPARE_FIZICA",
      contactName: "Ion",
      contactPhone: "0722123456",
      contactEmail: "ion@t.ro",
      productTypes: ["ceramică"],
      estimatedProductCount: 5,
      termsAccepted: true,
      termsVersion: "1.1.0",
    },
  });
  assert.equal(again.status, 201);
  assert.deepEqual(regEvents(ctx.r2.id).map((e) => e.type), ["WITHDRAWN", "SUBMITTED"]);
  assert.equal(regEvents(ctx.r2.id, "SUBMITTED")[0].metadata.resubmission, true);
});

/* ============================== anulare ============================== */

test("cancel doar din APPROVED, cu validări (cauză, motiv, cheie, expediat)", async () => {
  assert.equal((await cancel({}, newKey(), ctx.r2.id)).status, 409);

  const noKey = await call("POST", `${ADM}/registrations/${ctx.r1.id}/cancel`, {
    as: ctx.admin,
    body: { cause: "ARTFEST_DECISION", reason: INTERNAL_REASON, goodsAlreadyShipped: false },
  });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.error, "idempotency_key_required");

  const bad = await cancel({ cause: "ALTCEVA", reason: "", goodsAlreadyShipped: undefined });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.cause && bad.body.fields.reason && bad.body.fields.goodsAlreadyShipped);
  assert.equal(registration(ctx.r1.id).status, "APPROVED");
});

test("ARTFEST_DECISION, neexpediat: DRAFT + SUBMITTED anulate, rezervările eliberate, regulă taxă/retur", async () => {
  // înainte: stocul transferat (10 - 5), unicatul indisponibil online
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");

  const res = await cancel({ messageForVendor: "Ne pare rău, standul a fost redus." });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.replayed, false);
  assert.deepEqual(
    { fee: res.body.rules.feeRefund, payer: res.body.rules.returnCostPayer },
    { fee: "FULL_IF_PAID", payer: "ARTFEST" }
  );
  assert.equal(res.body.summary.draftToCancel, 1);
  assert.equal(res.body.summary.submittedToCancel, 3);

  const reg = registration(ctx.r1.id);
  assert.equal(reg.status, "CANCELLED");
  assert.equal(reg.cancellationCause, "ARTFEST_DECISION");
  assert.equal(reg.cancellationReason, INTERNAL_REASON);
  assert.equal(reg.cancelledById, ctx.admin.id);
  assert.equal(reg.cancellationGoodsShipped, false);

  for (const l of [ctx.lStock, ctx.lUnique, ctx.lMto, ctx.lDraft]) {
    assert.equal(line(l.id).status, "CANCELLED", l.titleSnapshot);
    assert.equal(lineEvents(l.id, "REGISTRATION_CANCELLED").length, 1);
  }
  // TRANSFERRED: cantitatea revine în readyQty; FORCED_UNAVAILABLE: starea anterioară
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
  assert.equal(productRow(ctx.pStock.id).availability, "READY");
  assert.equal(productRow(ctx.pUnique.id).availability, "READY");
  assert.equal(productRow(ctx.pUnique.id).readyQty, null);
  assert.equal(productRow(ctx.pMto.id).availability, "MADE_TO_ORDER");
  assert.equal(lineEvents(ctx.lStock.id, "ONLINE_STOCK_RELEASED").length, 1);

  const ev = regEvents(ctx.r1.id, "CANCELLED");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reason, INTERNAL_REASON);
  assert.equal(ev[0].vendorMessage, "Ne pare rău, standul a fost redus.");
  assert.equal(ev[0].metadata.cause, "ARTFEST_DECISION");
});

test("FORCED_UNAVAILABLE ține cont de onlineDeferredRestoreQty la eliberare", async () => {
  // unicat urmărit pe stoc (readyQty 1) + o comandă anulată în timpul târgului (amânată)
  const [pTracked] = fake.seed("product", [product(fake.tables.vendorService[0].id, { title: "Tablou", readyQty: 1 })]);
  const l = await inventory.addInventoryItem({ vendorId: ctx.vendor1.id, userId: ctx.v1.id, body: { productId: pTracked.id, declaredQty: 1, isUnique: true } });
  await inventory.submitInventory({ vendorId: ctx.vendor1.id, userId: ctx.v1.id });
  assert.equal(productRow(pTracked.id).readyQty, 0);
  line(l.id).onlineDeferredRestoreQty = 2;

  assert.equal((await cancel({})).status, 200);
  assert.equal(productRow(pTracked.id).readyQty, 3);
  assert.equal(productRow(pTracked.id).availability, "READY");
});

test("cancel idempotent: aceeași cheie => replayed, fără dublarea stocului; altă cheie => 409", async () => {
  const key = newKey();
  assert.equal((await cancel({}, key)).status, 200);
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);

  const again = await cancel({}, key);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
  assert.equal(regEvents(ctx.r1.id, "CANCELLED").length, 1);

  const other = await cancel({}, newKey());
  assert.equal(other.status, 409);
  assert.equal(other.body.currentStatus, "CANCELLED");
});

test("VENDOR_REQUEST și VENDOR_BREACH: taxa nu se restituie, returul e suportat de vendor", async () => {
  const preview = await call("GET", `${ADM}/registrations/${ctx.r1.id}/cancellation-preview`, { as: ctx.admin });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canCancel, true);
  for (const cause of ["VENDOR_REQUEST", "VENDOR_BREACH"]) {
    assert.equal(preview.body.rules[cause].feeRefund, "NONE");
    assert.equal(preview.body.rules[cause].returnCostPayer, "VENDOR");
  }
  assert.equal(preview.body.ifShipped.inTransit, 3);
  assert.equal(preview.body.ifNotShipped.linesToCancel, 4);

  const res = await cancel({ cause: "VENDOR_BREACH" });
  assert.equal(res.status, 200);
  assert.equal(res.body.rules.feeRefund, "NONE");
  assert.equal(res.body.item.cancellation.cause, "VENDOR_BREACH");
});

test("VENDOR_REQUEST: costul returului derivat = VENDOR", async () => {
  await receivedThenCancelled("VENDOR_REQUEST");
  const res = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 4 }] });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.item.costPayer, "VENDOR");
});

test("produs schimbat între timp: eliberarea NU suprascrie, scrie ONLINE_RESTORE_SKIPPED", async () => {
  // vendorul (sau Admin) a schimbat produsele după rezervare
  productRow(ctx.pUnique.id).availability = "MADE_TO_ORDER";
  productRow(ctx.pStock.id).availability = "MADE_TO_ORDER";

  assert.equal((await cancel({})).status, 200);
  assert.equal(productRow(ctx.pUnique.id).availability, "MADE_TO_ORDER");
  assert.equal(productRow(ctx.pStock.id).availability, "MADE_TO_ORDER");
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);
  assert.equal(lineEvents(ctx.lUnique.id, "ONLINE_RESTORE_SKIPPED")[0].note, "product_changed_since_reservation");
  assert.equal(lineEvents(ctx.lStock.id, "ONLINE_RESTORE_SKIPPED")[0].note, "product_no_longer_stock_tracked");
  assert.equal(line(ctx.lStock.id).status, "CANCELLED");
});

test("SUBMITTED deja expediat: rezervarea rămâne, linia rămâne SUBMITTED (IN_TRANSIT pentru vendor)", async () => {
  const res = await cancel({ goodsAlreadyShipped: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.summary.inTransit, 3);

  for (const l of [ctx.lStock, ctx.lUnique, ctx.lMto]) {
    assert.equal(line(l.id).status, "SUBMITTED");
    assert.equal(lineEvents(l.id, "REGISTRATION_CANCELLED")[0].after.inTransit, true);
  }
  assert.equal(line(ctx.lDraft.id).status, "CANCELLED");
  // produsul nu redevine cumpărabil online
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");

  const inv = await call("GET", INV, { as: ctx.v1 });
  assert.equal(inv.status, 200);
  const stock = inv.body.items.find((i) => i.id === ctx.lStock.id);
  assert.equal(stock.situation, "IN_TRANSIT");
  assert.equal(stock.online.state, "reserved");
  assert.equal(stock.online.reservedQty, 5);
});

test("RECEIVED: blocat imediat de la vânzare (participation_cancelled); blocarea anterioară își păstrează motivul", async () => {
  assert.equal((await receive(ctx.lStock.id, { receivedQty: 5 })).status, 200);
  assert.equal((await receive(ctx.lUnique.id, { receivedQty: 1 })).status, 200);
  const blocked = await call("POST", `${ADM}/inventory/${ctx.lUnique.id}/block`, { as: ctx.admin, body: { reason: "Verificare etichetă" } });
  assert.equal(blocked.status, 200);

  assert.equal((await cancel({ goodsAlreadyShipped: true })).status, 200);

  const stock = line(ctx.lStock.id);
  assert.equal(stock.status, "RECEIVED");
  assert.equal(stock.saleBlockedReason, "participation_cancelled");
  assert.equal(stock.saleBlockedById, ctx.admin.id);
  assert.equal(lineEvents(ctx.lStock.id, "SALE_BLOCKED").length, 1);

  const unique = line(ctx.lUnique.id);
  assert.equal(unique.saleBlockedReason, "Verificare etichetă");
  const ev = lineEvents(ctx.lUnique.id, "REGISTRATION_CANCELLED")[0];
  assert.equal(ev.after.keptPreviousBlock, true);
  assert.equal(ev.before.saleBlockedReason, "Verificare etichetă");

  const admin = await call("GET", `${ADM}/inventory/${ctx.lStock.id}`, { as: ctx.admin });
  assert.equal(admin.body.item.returnOnly, true);
  assert.equal(admin.body.item.eligibility.sellable, false);
  assert.ok(admin.body.item.warnings.includes("Produs primit doar pentru retur – nu este disponibil pentru vânzare."));
});

test("recepție după CANCELLED: doar pentru retur (returnOnly, blocat automat); alt status => 409", async () => {
  assert.equal((await cancel({ goodsAlreadyShipped: true })).status, 200);

  const res = await receive(ctx.lStock.id, { receivedQty: 5 });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.returnOnly, true);
  assert.equal(res.body.item.returnOnly, true);
  assert.equal(res.body.item.eligibility.sellable, false);
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
  assert.equal(line(ctx.lStock.id).saleBlockedReason, "participation_cancelled");
  assert.equal(lineEvents(ctx.lStock.id, "RECEIVED_FOR_RETURN_ONLY").length, 1);

  // linie a unei înscrieri care nu e nici APPROVED, nici CANCELLED
  registration(ctx.r1.id).status = "WITHDRAWN";
  const refused = await receive(ctx.lUnique.id, { receivedQty: 1 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "registration_not_approved");
  assert.equal(line(ctx.lUnique.id).status, "SUBMITTED");
});

test("unblock refuzat pentru o linie a unei participări anulate", async () => {
  assert.equal((await receive(ctx.lStock.id, { receivedQty: 5 })).status, 200);
  assert.equal((await cancel({ goodsAlreadyShipped: true })).status, 200);
  const res = await call("POST", `${ADM}/inventory/${ctx.lStock.id}/unblock`, { as: ctx.admin });
  assert.equal(res.status, 409);
  assert.equal(res.body.currentStatus, "CANCELLED");
  assert.ok(line(ctx.lStock.id).saleBlockedAt);
});

test("CANCELLED e final: nu se mai aprobă, vendorul nu se reînscrie, nu mai trimite inventar", async () => {
  assert.equal((await cancel({})).status, 200);
  const approve = await call("POST", `${ADM}/registrations/${ctx.r1.id}/approve`, { as: ctx.admin });
  assert.equal(approve.status, 409);
  assert.equal(approve.body.currentStatus, "CANCELLED");

  const again = await call("POST", `${VEN}/registration`, {
    as: ctx.v1,
    body: { participationType: "PARTICIPARE_FIZICA", contactName: "Ana", contactPhone: "0722123456", contactEmail: "a@t.ro", productTypes: ["x"], estimatedProductCount: 2, termsAccepted: true, termsVersion: "1.1.0" },
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "registration_cancelled");

  assert.equal((await call("POST", `${INV}/submit`, { as: ctx.v1 })).status, 403);
  assert.equal((await call("POST", INV, { as: ctx.v1, body: { productId: ctx.pDraft.id, declaredQty: 1 } })).status, 403);
  assert.equal((await call("GET", `${INV}/labels.pdf`, { as: ctx.v1 })).status, 403);
});

test("trimiterea inventarului reverifică statusul sub lock (anulare concurentă)", async () => {
  registration(ctx.r1.id).status = "CANCELLED";
  // contextul (citit înainte) încă vede APPROVED: garda din tranzacție oprește trimiterea
  const res = await inventory
    .submitInventory({ vendorId: ctx.vendor1.id, userId: ctx.v1.id })
    .catch((e) => e);
  assert.equal(res.status, 403);
});

/* ============================== vendorul după anulare ============================== */

test("vendorul vede inventarul read-only, mesajul public, fără motivul intern", async () => {
  assert.equal((await receive(ctx.lStock.id, { receivedQty: 5 })).status, 200);
  assert.equal((await cancel({ goodsAlreadyShipped: true })).status, 200);

  const state = await call("GET", VEN, { as: ctx.v1 });
  assert.equal(state.body.registration.status, "CANCELLED");
  assert.match(state.body.registration.cancellationMessage, /Participarea ta la Târgul Artfest a fost anulată/);
  assert.equal(state.text.includes(INTERNAL_REASON), false);
  assert.equal(state.text.includes("ARTFEST_DECISION"), false);
  assert.equal(state.body.actions.canRegister, false);

  const inv = await call("GET", INV, { as: ctx.v1 });
  assert.equal(inv.body.readOnly, true);
  assert.equal(inv.body.canEdit, false);
  assert.equal(inv.text.includes(INTERNAL_REASON), false);
  const byId = Object.fromEntries(inv.body.items.map((i) => [i.id, i]));
  assert.equal(byId[ctx.lStock.id].situation, "AT_ARTFEST");
  assert.equal(byId[ctx.lUnique.id].situation, "IN_TRANSIT");
  assert.equal(byId[ctx.lDraft.id].situation, "CANCELLED");
  for (const item of inv.body.items) {
    assert.deepEqual(item.actions, { canEdit: false, canRemove: false, canCancel: false, canPrintLabel: false });
  }
});

/* ============================== retur: creare / editare / anulare ============================== */

test("candidați + creare retur (cost ARTFEST la ARTFEST_DECISION), cantități duplicate / prea mari respinse", async () => {
  await receivedThenCancelled();
  const cand = await call("GET", `${ADM}/returns/candidates?registrationId=${ctx.r1.id}`, { as: ctx.admin });
  assert.equal(cand.status, 200);
  const stock = cand.body.items.find((c) => c.inventoryItemId === ctx.lStock.id);
  assert.deepEqual({ s: stock.maxFromStock, r: stock.maxRejected }, { s: 4, r: 1 });
  assert.equal(cand.body.suggestedCostPayer, "ARTFEST");

  const dup = await createReturn({
    lines: [
      { inventoryItemId: ctx.lStock.id, qtyFromStock: 1 },
      { inventoryItemId: ctx.lStock.id, qtyFromStock: 1 },
    ],
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error, "duplicate_lines");

  const tooMuch = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 5 }] });
  assert.equal(tooMuch.status, 409);
  assert.equal(tooMuch.body.error, "quantity_exceeds_available");

  const ok = await createReturn({
    lines: [
      { inventoryItemId: ctx.lStock.id, qtyFromStock: 4, qtyRejected: 1 },
      { inventoryItemId: ctx.lUnique.id, qtyFromStock: 1 },
    ],
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.item.costPayer, "ARTFEST");
  assert.equal(ok.body.item.status, "PREPARING");
  assert.equal(ok.body.item.number, 1);

  // cantitățile din returul PREPARING nu pot fi folosite într-un alt retur
  const second = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }] });
  assert.equal(second.status, 409);
  // stocul nu se mișcă la creare
  assert.equal(line(ctx.lStock.id).availableQty, 4);
});

test("motivul returului e verificat; costul schimbat manual cere motiv și lasă audit", async () => {
  const notCancelled = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }] });
  assert.equal(notCancelled.status, 409);
  assert.equal(notCancelled.body.error, "registration_not_cancelled");

  await receivedThenCancelled("VENDOR_BREACH");
  const noReason = await createReturn({ costPayer: "ARTFEST", lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }] });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, "cost_payer_reason_required");

  const ok = await createReturn({
    costPayer: "ARTFEST",
    costPayerReason: "Gest comercial",
    lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.item.costPayer, "ARTFEST");
  assert.match(ok.body.item.adminNotes, /VENDOR → ARTFEST/);
  assert.equal(lineEvents(ctx.lStock.id, "ADMIN_NOTE").length, 1);

  const onlyRejected = await createReturn({ reason: "RECEPTION_REJECTED", lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }] });
  assert.equal(onlyRejected.status, 409);
});

test("PATCH și anulare retur doar în PREPARING; anularea nu atinge stocul", async () => {
  await receivedThenCancelled();
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 2 }] });
  const id = created.body.item.id;

  const patched = await call("PATCH", `${ADM}/returns/${id}`, {
    as: ctx.admin,
    body: { method: "PICKUP", lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 4, qtyRejected: 1 }], note: "Ridică marți" },
  });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.body.item.method, "PICKUP");
  assert.equal(patched.body.item.lines[0].sentQty, 5);

  const cancelled = await call("POST", `${ADM}/returns/${id}/cancel`, { as: ctx.admin, body: { reason: "Greșit" } });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.item.status, "CANCELLED");
  assert.equal(lineEvents(ctx.lStock.id, "RETURN_CANCELLED").length, 1);
  assert.equal(line(ctx.lStock.id).availableQty, 4);
  assert.equal(movements(ctx.lStock.id, "RETURNED_TO_VENDOR").length, 0);

  assert.equal((await call("PATCH", `${ADM}/returns/${id}`, { as: ctx.admin, body: { method: "PICKUP" } })).status, 409);
  assert.equal((await ship(id)).status, 409);
});

/* ============================== expediere ============================== */

async function shippedReturn() {
  await receivedThenCancelled();
  const created = await createReturn({
    lines: [
      { inventoryItemId: ctx.lStock.id, qtyFromStock: 4, qtyRejected: 1 },
      { inventoryItemId: ctx.lUnique.id, qtyFromStock: 1 },
    ],
  });
  const id = created.body.item.id;
  const res = await ship(id, { courierName: "Fan", trackingNumber: "AWB123" });
  assert.equal(res.status, 200, res.text);
  return id;
}

test("ship: mișcări de stoc legate de linia de retur, stocul online NU se restaurează; idempotent", async () => {
  await receivedThenCancelled();
  const created = await createReturn({
    lines: [
      { inventoryItemId: ctx.lStock.id, qtyFromStock: 4, qtyRejected: 1 },
      { inventoryItemId: ctx.lUnique.id, qtyFromStock: 1 },
    ],
  });
  const id = created.body.item.id;
  const key = newKey();

  const res = await ship(id, { courierName: "Fan", trackingNumber: "AWB123", shippingCostCents: 2500 }, key);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.replayed, false);
  assert.equal(res.body.item.status, "SHIPPED");
  assert.equal(res.body.item.trackingNumber, "AWB123");
  assert.equal(res.body.item.shippingCostCents, 2500);

  const stock = line(ctx.lStock.id);
  assert.deepEqual(
    { a: stock.availableQty, r: stock.returnedQty, rr: stock.rejectedReturnedQty },
    { a: 0, r: 4, rr: 1 }
  );
  const returnLineIds = new Set(fake.tables.artfestFairReturnLine.map((l) => l.id));
  const out = movements(ctx.lStock.id, "RETURNED_TO_VENDOR");
  const rej = movements(ctx.lStock.id, "REJECTED_RETURNED_TO_VENDOR");
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 4);
  assert.equal(rej[0].quantity, 1);
  assert.ok(returnLineIds.has(out[0].returnLineId) && returnLineIds.has(rej[0].returnLineId));
  assert.ok(out[0].idempotencyKey.length <= 100);

  // stocul online rămâne rezervat până la confirmarea primirii
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");

  const replay = await ship(id, {}, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(movements(ctx.lStock.id).filter((m) => m.type.endsWith("RETURNED_TO_VENDOR")).length, 2);
  assert.equal(line(ctx.lStock.id).returnedQty, 4);

  const other = await ship(id, {}, newKey());
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "return_not_editable");
});

test("ship revalidează cantitățile curente (deteriorare între creare și expediere)", async () => {
  await receivedThenCancelled();
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 4 }] });
  const damage = await call("POST", `${ADM}/inventory/${ctx.lStock.id}/damage`, {
    as: ctx.admin,
    key: newKey(),
    body: { quantity: 1, reason: "Spart la manipulare" },
  });
  assert.equal(damage.status, 200);
  const res = await ship(created.body.item.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "quantity_exceeds_available");
  assert.equal(line(ctx.lStock.id).returnedQty, 0);
});

/* ============================== confirmare + restaurare ============================== */

const confirmAsVendor = (id, lines, key = newKey(), as = ctx.v1) =>
  call("POST", `${VEN}/returns/${id}/confirm`, { as, key, body: { lines, note: "Am primit coletul" } });

function linesOf(id) {
  return fake.tables.artfestFairReturnLine.filter((l) => l.returnId === id);
}

test("vendorul vede doar retururile proprii; confirmarea completă restaurează online și închide liniile", async () => {
  const id = await shippedReturn();

  const own = await call("GET", `${VEN}/returns`, { as: ctx.v1 });
  assert.equal(own.status, 200);
  assert.equal(own.body.items.length, 1);
  assert.equal(own.body.items[0].adminNotes, undefined);
  const stockLine = own.body.items[0].lines.find((l) => l.inventoryItemId === ctx.lStock.id);
  assert.equal(stockLine.restoreCap, 5);

  const foreign = await call("GET", `${VEN}/returns`, { as: ctx.v2 });
  assert.equal(foreign.body.items.length, 0);
  const ret = linesOf(id);
  const all = ret.map((l) => ({ returnLineId: l.id, receivedQty: l.qtyFromStock + l.qtyRejected }));
  assert.equal((await confirmAsVendor(id, all, newKey(), ctx.v2)).status, 404);

  const res = await confirmAsVendor(id, all);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.item.status, "CONFIRMED");

  // TRANSFERRED: 5 rezervate, 5 primite înapoi => readyQty 5 + 5; FORCED: starea anterioară
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
  assert.equal(productRow(ctx.pStock.id).availability, "READY");
  assert.equal(productRow(ctx.pUnique.id).availability, "READY");

  const stock = line(ctx.lStock.id);
  assert.equal(stock.vendorReturnReceivedQty, 5);
  assert.equal(stock.onlineRestoredQty, 5);
  assert.ok(stock.vendorReturnConfirmedAt);
  assert.equal(stock.status, "CLOSED");
  assert.equal(line(ctx.lUnique.id).status, "CLOSED");
  assert.equal(lineEvents(ctx.lStock.id, "VENDOR_RETURN_CONFIRMED").length, 1);
  assert.equal(lineEvents(ctx.lStock.id, "ONLINE_STOCK_RESTORED").length, 1);

  const inv = await call("GET", INV, { as: ctx.v1 });
  const s = inv.body.items.find((i) => i.id === ctx.lStock.id);
  assert.equal(s.situation, "RETURNED");
  assert.equal(s.online.state, "restored");
  assert.equal(s.online.restoredQty, 5);
});

test("confirmare idempotentă: aceeași cheie => replayed; altă cheie => 409", async () => {
  const id = await shippedReturn();
  const all = linesOf(id).map((l) => ({ returnLineId: l.id, receivedQty: l.qtyFromStock + l.qtyRejected }));
  const key = newKey();
  assert.equal((await confirmAsVendor(id, all, key)).status, 200);
  const replay = await confirmAsVendor(id, all, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
  const other = await confirmAsVendor(id, all, newKey());
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "already_confirmed");
});

test("restoreOnlineQty redus de vendor; 0 la unicat => rămâne indisponibil; peste plafon => 400", async () => {
  const id = await shippedReturn();
  const [stockLine, uniqueLine] = [ctx.lStock.id, ctx.lUnique.id].map((iid) => linesOf(id).find((l) => l.inventoryItemId === iid));

  const over = await confirmAsVendor(id, [
    { returnLineId: stockLine.id, receivedQty: 5, restoreOnlineQty: 6 },
    { returnLineId: uniqueLine.id, receivedQty: 1 },
  ]);
  assert.equal(over.status, 400);
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);

  const res = await confirmAsVendor(id, [
    { returnLineId: stockLine.id, receivedQty: 5, restoreOnlineQty: 2 },
    { returnLineId: uniqueLine.id, receivedQty: 1, restoreOnlineQty: 0 },
  ]);
  assert.equal(res.status, 200, res.text);
  assert.equal(productRow(ctx.pStock.id).readyQty, 7);
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
  assert.equal(lineEvents(ctx.lUnique.id, "ONLINE_RESTORE_SKIPPED").at(-1).note, "vendor_declined");
  assert.equal(line(ctx.lStock.id).onlineRestoredQty, 2);
  // rezervarea se încheie la închidere (produsul nu mai e blocat de târg)
  assert.ok(line(ctx.lUnique.id).onlineRestoredAt);
});

test("diferențe la confirmare => CONFIRMED_WITH_DIFFERENCES, de clarificat; implicit se restaurează doar ce s-a primit", async () => {
  const id = await shippedReturn();
  const [stockLine, uniqueLine] = [ctx.lStock.id, ctx.lUnique.id].map((iid) => linesOf(id).find((l) => l.inventoryItemId === iid));
  const res = await confirmAsVendor(id, [
    { returnLineId: stockLine.id, receivedQty: 3 },
    { returnLineId: uniqueLine.id, receivedQty: 1 },
  ]);
  assert.equal(res.status, 200);
  assert.equal(res.body.item.status, "CONFIRMED_WITH_DIFFERENCES");
  assert.equal(res.body.item.needsClarification, true);
  assert.equal(productRow(ctx.pStock.id).readyQty, 8);

  const adminView = await call("GET", `${ADM}/returns?registrationId=${ctx.r1.id}`, { as: ctx.admin });
  const r = adminView.body.items[0];
  assert.equal(r.needsClarification, true);
  assert.equal(r.lines.find((l) => l.id === stockLine.id).difference, -2);
});

test("confirmare Admin în numele vendorului: înainte de 7 zile 409; după, doar cu motiv", async () => {
  const id = await shippedReturn();
  const all = linesOf(id).map((l) => ({ returnLineId: l.id, receivedQty: l.qtyFromStock + l.qtyRejected }));
  const onBehalf = (body, key = newKey()) => call("POST", `${ADM}/returns/${id}/confirm-on-behalf`, { as: ctx.admin, key, body });

  const early = await onBehalf({ lines: all, reason: "Vendorul nu răspunde" });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "confirm_too_early");

  fake.tables.artfestFairReturn.find((r) => r.id === id).shippedAt = new Date(Date.now() - 8 * DAY);
  const noReason = await onBehalf({ lines: all });
  assert.equal(noReason.status, 400);

  const ok = await onBehalf({ lines: all, reason: "Vendorul nu răspunde de 8 zile" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.item.confirmedByAdmin, true);
  assert.equal(ok.body.item.confirmationNote, "Vendorul nu răspunde de 8 zile");
  const row = fake.tables.artfestFairReturn.find((r) => r.id === id);
  assert.equal(row.confirmedById, ctx.admin.id);
  const ev = lineEvents(ctx.lStock.id, "VENDOR_RETURN_CONFIRMED")[0];
  assert.equal(ev.actorUserId, ctx.admin.id);
  assert.equal(ev.after.byAdmin, true);
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
});

test("confirmarea cere toate liniile și nu acceptă mai mult decât s-a trimis", async () => {
  const id = await shippedReturn();
  const [stockLine] = linesOf(id);
  const partial = await confirmAsVendor(id, [{ returnLineId: stockLine.id, receivedQty: 1 }]);
  assert.equal(partial.status, 400);
  assert.equal(partial.body.error, "lines_incomplete");
  const tooMany = await confirmAsVendor(
    id,
    linesOf(id).map((l) => ({ returnLineId: l.id, receivedQty: l.qtyFromStock + l.qtyRejected + 1 }))
  );
  assert.equal(tooMany.status, 400);
  assert.equal(fake.tables.artfestFairReturn.find((r) => r.id === id).status, "SHIPPED");
});

test("returul nu se poate confirma înainte de expediere", async () => {
  await receivedThenCancelled();
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 1 }] });
  const id = created.body.item.id;
  const res = await confirmAsVendor(id, linesOf(id).map((l) => ({ returnLineId: l.id, receivedQty: 1 })));
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "return_not_shipped");
});

/* ============================== deteriorate (DAMAGED) ============================== */

const damage = (id, quantity) =>
  call("POST", `${ADM}/inventory/${id}/damage`, { as: ctx.admin, key: newKey(), body: { quantity, reason: "Spart la manipulare" } });

// stoc: 5 rezervate online (10 -> 5); recepție (5 - rejected) + rejected refuzate; `damaged` deteriorate; anulare (în tranzit)
async function withDamaged({ damaged = 2, rejected = 1 } = {}) {
  const body = rejected
    ? { receivedQty: 5 - rejected, rejectedQty: rejected, rejectedReason: "Ciobit" }
    : { receivedQty: 5 };
  assert.equal((await receive(ctx.lStock.id, body)).status, 200);
  if (damaged) assert.equal((await damage(ctx.lStock.id, damaged)).status, 200);
  assert.equal((await cancel({ goodsAlreadyShipped: true })).status, 200);
}

test("DAMAGED: candidații arată separat vandabil / refuzat / deteriorat", async () => {
  await withDamaged();
  const cand = await call("GET", `${ADM}/returns/candidates?registrationId=${ctx.r1.id}`, { as: ctx.admin });
  const c = cand.body.items.find((i) => i.inventoryItemId === ctx.lStock.id);
  assert.deepEqual(
    { s: c.maxFromStock, r: c.maxRejected, d: c.maxDamaged, dp: c.damagedPendingQty },
    { s: 2, r: 1, d: 2, dp: 2 }
  );
});

test("DAMAGED: retur doar cu deteriorate - DAMAGED_RETURNED_TO_VENDOR, availableQty neschimbat, nimic online", async () => {
  await withDamaged();
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyDamaged: 2 }] });
  assert.equal(created.status, 201, created.text);
  const id = created.body.item.id;
  assert.equal(created.body.item.lines[0].qtyDamaged, 2);
  assert.equal(created.body.item.lines[0].sentQty, 0);

  assert.equal((await ship(id)).status, 200);
  const l = line(ctx.lStock.id);
  assert.deepEqual({ a: l.availableQty, d: l.damagedQty, dr: l.damagedReturnedQty, r: l.returnedQty }, { a: 2, d: 2, dr: 2, r: 0 });
  const mv = movements(ctx.lStock.id, "DAMAGED_RETURNED_TO_VENDOR");
  assert.equal(mv.length, 1);
  assert.equal(mv[0].quantity, 2);
  assert.ok(mv[0].returnLineId);
  assert.match(mv[0].reason, /returnat deteriorat/);

  // vendorul vede plafonul 0 pentru linia doar cu deteriorate
  const own = await call("GET", `${VEN}/returns`, { as: ctx.v1 });
  assert.equal(own.body.items[0].lines[0].restoreCap, 0);

  const rl = linesOf(id)[0];
  const bad = await confirmAsVendor(id, [{ returnLineId: rl.id, receivedDamagedQty: 2, restoreOnlineQty: 1 }]);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_restore_qty");
  assert.match(bad.body.fields[rl.id], /deteriorate nu pot fi readăugate/);

  const missing = await confirmAsVendor(id, [{ returnLineId: rl.id }]);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "received_damaged_qty_required");

  const ok = await confirmAsVendor(id, [{ returnLineId: rl.id, receivedDamagedQty: 2 }]);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.item.status, "CONFIRMED");
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);
  const row = fake.tables.artfestFairReturnLine.find((x) => x.id === rl.id);
  assert.deepEqual({ r: row.vendorReceivedQty, rd: row.vendorReceivedDamagedQty, ro: row.restoreOnlineQty }, { r: 0, rd: 2, ro: 0 });
  const ev = lineEvents(ctx.lStock.id, "VENDOR_RETURN_CONFIRMED").at(-1);
  assert.equal(ev.after.returnedDamagedQty, 2);
  assert.equal(ev.after.receivedDamagedQty, 2);
  assert.match(ev.note, /Returnat deteriorat: 2/);
  // încă 2 vandabile + 1 refuzat la Artfest => linia rămâne deschisă
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
});

test("DAMAGED: retur mixt vandabil + refuzat + deteriorat; online revin doar nedeterioratele; linia se închide", async () => {
  await withDamaged({ damaged: 1 });
  // 4 primite - 1 deteriorată = 3 vandabile, 1 refuzată, 1 deteriorată
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 3, qtyRejected: 1, qtyDamaged: 1 }] });
  assert.equal(created.status, 201, created.text);
  const id = created.body.item.id;
  assert.equal((await ship(id)).status, 200);

  const l = line(ctx.lStock.id);
  assert.deepEqual(
    { a: l.availableQty, r: l.returnedQty, rr: l.rejectedReturnedQty, dr: l.damagedReturnedQty },
    { a: 0, r: 3, rr: 1, dr: 1 }
  );
  assert.deepEqual(
    movements(ctx.lStock.id).filter((m) => m.returnLineId).map((m) => m.type).sort(),
    ["DAMAGED_RETURNED_TO_VENDOR", "REJECTED_RETURNED_TO_VENDOR", "RETURNED_TO_VENDOR"]
  );

  const rl = linesOf(id)[0];
  const tooMuch = await confirmAsVendor(id, [{ returnLineId: rl.id, receivedQty: 4, receivedDamagedQty: 1, restoreOnlineQty: 5 }]);
  assert.equal(tooMuch.status, 400);
  assert.equal(productRow(ctx.pStock.id).readyQty, 5);

  const ok = await confirmAsVendor(id, [{ returnLineId: rl.id, receivedQty: 4, receivedDamagedQty: 1 }]);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.item.status, "CONFIRMED");
  // 5 rezervate; revin doar cele 4 nedeteriorate
  assert.equal(productRow(ctx.pStock.id).readyQty, 9);
  const after = line(ctx.lStock.id);
  assert.equal(after.onlineRestoredQty, 4);
  assert.equal(after.vendorReturnReceivedQty, 5);
  assert.equal(after.status, "CLOSED");
});

test("DAMAGED: cantitate prea mare, dublată în alt retur PREPARING sau duplicat => respinse", async () => {
  await withDamaged();
  const tooMuch = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyDamaged: 3 }] });
  assert.equal(tooMuch.status, 409);
  assert.equal(tooMuch.body.problems[0].reason, "damaged_exceeded");

  const dup = await createReturn({
    lines: [
      { inventoryItemId: ctx.lStock.id, qtyDamaged: 1 },
      { inventoryItemId: ctx.lStock.id, qtyDamaged: 1 },
    ],
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error, "duplicate_lines");

  assert.equal((await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyDamaged: 2 }] })).status, 201);
  const again = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyDamaged: 1 }] });
  assert.equal(again.status, 409);

  // returul RECEPTION_REJECTED nu poate conține deteriorate
  const onlyRejected = await createReturn({
    reason: "RECEPTION_REJECTED",
    lines: [{ inventoryItemId: ctx.lStock.id, qtyRejected: 1, qtyDamaged: 1 }],
  });
  assert.equal(onlyRejected.status, 409);
});

test("DAMAGED: linia se închide doar după returnarea și confirmarea tuturor deterioratelor", async () => {
  await withDamaged({ damaged: 2, rejected: 0 });
  // 5 primite, 2 deteriorate => 3 vandabile
  const first = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 3, qtyDamaged: 1 }] });
  const id1 = first.body.item.id;
  assert.equal((await ship(id1)).status, 200);
  const rl1 = linesOf(id1)[0];
  assert.equal((await confirmAsVendor(id1, [{ returnLineId: rl1.id, receivedQty: 3, receivedDamagedQty: 1 }])).status, 200);
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
  const inv = await call("GET", INV, { as: ctx.v1 });
  const s = inv.body.items.find((i) => i.id === ctx.lStock.id);
  assert.equal(s.situation, "AT_ARTFEST");
  assert.equal(s.physical.damagedPendingReturnQty, 1);

  const second = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyDamaged: 1 }] });
  const id2 = second.body.item.id;
  assert.equal((await ship(id2)).status, 200);
  // expediat, dar neconfirmat => încă deschisă
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
  const rl2 = linesOf(id2)[0];
  assert.equal((await confirmAsVendor(id2, [{ returnLineId: rl2.id, receivedDamagedQty: 1 }])).status, 200);
  assert.equal(line(ctx.lStock.id).status, "CLOSED");
  assert.equal(line(ctx.lStock.id).damagedReturnedQty, 2);
  assert.equal(productRow(ctx.pStock.id).readyQty, 8);
});

test("DAMAGED: confirmare Admin după 7 zile, cu deteriorate confirmate separat (și diferențe)", async () => {
  await withDamaged();
  const created = await createReturn({ lines: [{ inventoryItemId: ctx.lStock.id, qtyFromStock: 2, qtyDamaged: 2 }] });
  const id = created.body.item.id;
  assert.equal((await ship(id)).status, 200);
  fake.tables.artfestFairReturn.find((r) => r.id === id).shippedAt = new Date(Date.now() - 8 * DAY);
  const rl = linesOf(id)[0];
  const res = await call("POST", `${ADM}/returns/${id}/confirm-on-behalf`, {
    as: ctx.admin,
    key: newKey(),
    body: { reason: "Vendorul nu a răspuns", lines: [{ returnLineId: rl.id, receivedQty: 2, receivedDamagedQty: 1 }] },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.item.confirmedByAdmin, true);
  assert.equal(res.body.item.status, "CONFIRMED_WITH_DIFFERENCES");
  assert.equal(res.body.item.lines[0].difference, -1);
  assert.equal(productRow(ctx.pStock.id).readyQty, 7);
});
