// Teste pentru recepția inventarului Târgului Artfest în Admin (etapa 2):
// scanare, recepție idempotentă, refuz / deteriorare cu fotografii, blocare de
// la vânzare, eligibilitate la moderare, vizibilitatea pentru vendor și
// anularea liniilor trimise (cu eliberarea rezervării online).
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header, R2 și PDF.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairReception.routes.test.js

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

const PHOTO = `${R2}/artfest-fair-reception/admin/1.jpg`;
const DAY = 24 * 60 * 60 * 1000;

let server;
let base;
let ctx;
let inventory;
let stock;
let locks;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairInventoryRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  stock = await import("../services/stockRestore.js");
  locks = await import("../services/fairProductLock.js");

  const app = express();
  app.use(express.json());
  app.use("/api/admin/artfest-fair", adminRoutes);
  app.use("/api/vendor/fair/inventory", vendorRoutes);
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
  const [fair, otherFair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, inventoryDeadlineAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 9 * DAY) },
    { key: "ALT_TARG_2025", title: "Alt târg", registrationOpen: false },
  ]);
  const [r1, r2] = fake.seed("artfestFairRegistration", [
    { fairId: fair.id, vendorId: vendor1.id, submittedByUserId: v1.id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" },
    { fairId: fair.id, vendorId: vendor2.id, submittedByUserId: v2.id, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" },
  ]);
  const [pStock, pUnique, pUniqueTracked, pMto, pOther] = fake.seed("product", [
    product(s1.id, { title: "Spiriduș", readyQty: 10 }),
    product(s1.id, { title: "Vază unicat", priceCents: 12000, readyQty: null }),
    product(s1.id, { title: "Tablou unicat", priceCents: 50000, readyQty: 1 }),
    product(s1.id, { title: "Cană la comandă", availability: "MADE_TO_ORDER" }),
    product(s2.id, { title: "Lumânare", readyQty: 4 }),
  ]);
  ctx = { admin, v1, v2, vendor1, vendor2, fair, otherFair, r1, r2, pStock, pUnique, pUniqueTracked, pMto, pOther };

  // inventarul vendorului 1: trimis prin fluxul real
  const add = (body) => inventory.addInventoryItem({ vendorId: vendor1.id, userId: v1.id, body });
  ctx.lStock = await add({ productId: pStock.id, declaredQty: 5, isFragile: true, handlingInstructions: "Ține vertical" });
  ctx.lUnique = await add({ productId: pUnique.id, declaredQty: 1, isUnique: true });
  ctx.lMto = await add({ productId: pMto.id, declaredQty: 3 });
  await inventory.submitInventory({ vendorId: vendor1.id, userId: v1.id });
});

async function call(method, path, { as, body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const A = "/api/admin/artfest-fair/inventory";
const line = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const productRow = (id) => fake.tables.product.find((p) => p.id === id);
const movementsOf = (id, type) => fake.tables.artfestFairStockMovement.filter((m) => m.inventoryItemId === id && (!type || m.type === type));
const eventsOf = (id, type) => fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === id && e.type === type);
const receive = (id, body, key = `k-${Math.random().toString(36).slice(2, 12)}`) =>
  call("POST", `${A}/${id}/receive`, { as: ctx.admin, body, key });

/* ============================== acces ============================== */

test("doar ADMIN: fără sesiune 401, vendor 403", async () => {
  assert.equal((await call("GET", A)).status, 401);
  for (const [method, path] of [
    ["GET", A],
    ["GET", `${A}/by-barcode/${ctx.lStock.barcode}`],
    ["POST", `${A}/${ctx.lStock.id}/receive`],
    ["POST", `${A}/${ctx.lStock.id}/damage`],
    ["POST", `${A}/${ctx.lStock.id}/block`],
    ["POST", `${A}/${ctx.lStock.id}/cancel`],
  ]) {
    const res = await call(method, path, { as: ctx.v1, body: method === "POST" ? { receivedQty: 5 } : undefined, key: "kkkkkkkk1" });
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal(line(ctx.lStock.id).status, "SUBMITTED");
});

/* ============================== scanare ============================== */

test("scanare: cod valid (și cu litere mici / cratime), produs complet + avertismente", async () => {
  const raw = ctx.lStock.barcodeDisplay.toLowerCase(); // ex. af-xxxx-xxxx
  const res = await call("GET", `${A}/by-barcode/${encodeURIComponent(raw)}`, { as: ctx.admin });
  assert.equal(res.status, 200);
  const item = res.body.item;
  assert.equal(item.id, ctx.lStock.id);
  assert.equal(item.title, "Spiriduș");
  assert.equal(item.vendor.name, "Atelier Ana");
  assert.equal(item.declaredQty, 5);
  assert.equal(item.priceCents, 3900);
  assert.equal(item.status, "SUBMITTED");
  assert.equal(item.actions.canReceive, true);
  assert.ok(item.warnings.some((w) => /Fragil/.test(w)));
  assert.ok(item.warnings.some((w) => /Ține vertical/.test(w)));
});

test("scanare: cod inexistent / invalid => 404 clar; cod din alt târg => 409 cu produsul", async () => {
  for (const code of ["AF22222222", "nu-e-cod", "12345"]) {
    const res = await call("GET", `${A}/by-barcode/${code}`, { as: ctx.admin });
    assert.equal(res.status, 404, code);
    assert.equal(res.body.error, "barcode_not_found");
  }

  fake.seed("artfestFairInventoryItem", [{
    fairId: ctx.otherFair.id, registrationId: ctx.r1.id, vendorId: ctx.vendor1.id, productId: ctx.pMto.id,
    variantKey: "x", titleSnapshot: "Vechi", priceSnapshotCents: 100, barcode: "AF33333333", declaredQty: 1, status: "SUBMITTED",
  }]);
  const other = await call("GET", `${A}/by-barcode/AF33333333`, { as: ctx.admin });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "barcode_other_fair");
  assert.equal(other.body.item.belongsToActiveFair, false);
  assert.match(other.body.message, /nu aparține târgului activ/);
});

/* ============================== recepție ============================== */

test("recepție integrală: RECEIVED, stoc disponibil, mișcare + eveniment", async () => {
  const res = await receive(ctx.lStock.id, { receivedQty: 5, adminNotes: "cutie ok" });
  assert.equal(res.status, 200);
  assert.equal(res.body.replayed, false);

  const row = line(ctx.lStock.id);
  assert.equal(row.status, "RECEIVED");
  assert.equal(row.receivedQty, 5);
  assert.equal(row.availableQty, 5);
  assert.equal(row.receivedById, ctx.admin.id);
  assert.ok(row.receivedAt instanceof Date);
  assert.equal(row.adminNotes, "cutie ok");
  assert.equal(movementsOf(row.id, "RECEIVED").length, 1);
  assert.equal(movementsOf(row.id, "RECEIVED")[0].quantity, 5);
  assert.equal(eventsOf(row.id, "STATUS_CHANGED").length, 1);
  assert.equal(res.body.item.difference.text, null);
});

test("recepție parțială și în plus: diferența e afișată, nu respinsă", async () => {
  const partial = await receive(ctx.lStock.id, { receivedQty: 3 });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.item.difference.text, "Lipsesc 2 bucăți");

  const more = await receive(ctx.lMto.id, { receivedQty: 4 });
  assert.equal(more.status, 200);
  assert.equal(more.body.item.difference.text, "+1 bucată față de cantitatea declarată");
  assert.equal(line(ctx.lMto.id).availableQty, 4);

  const list = await call("GET", `${A}?filter=discrepancy`, { as: ctx.admin });
  assert.deepEqual(list.body.items.map((i) => i.id).sort(), [ctx.lStock.id, ctx.lMto.id].sort());
  assert.equal(list.body.counts.to_receive, 1);
  assert.equal(list.body.counts.received, 2);
});

test("refuz: cu motiv și fotografie; fără motiv => 400; totul refuzat => REJECTED", async () => {
  const noReason = await receive(ctx.lStock.id, { receivedQty: 4, rejectedQty: 1 });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, "rejected_reason_required");
  assert.equal(line(ctx.lStock.id).status, "SUBMITTED");
  assert.equal(movementsOf(ctx.lStock.id).length, 0);

  const badPhoto = await receive(ctx.lStock.id, { receivedQty: 4, rejectedQty: 1, rejectedReason: "ambalaj deteriorat", photoUrls: ["https://evil/x.jpg"] });
  assert.equal(badPhoto.status, 400);
  assert.equal(badPhoto.body.error, "invalid_photos");

  const ok = await receive(ctx.lStock.id, { receivedQty: 4, rejectedQty: 1, rejectedReason: "ambalaj deteriorat", photoUrls: [PHOTO] });
  assert.equal(ok.status, 200);
  const row = line(ctx.lStock.id);
  assert.equal(row.status, "RECEIVED");
  assert.equal(row.rejectedQty, 1);
  assert.equal(row.availableQty, 4);
  const rejected = movementsOf(row.id, "REJECTED")[0];
  assert.equal(rejected.reason, "ambalaj deteriorat");
  assert.deepEqual(rejected.photoUrls, [PHOTO]);

  const all = await receive(ctx.lMto.id, { receivedQty: 0, rejectedQty: 3, rejectedReason: "nu corespunde descrierii" });
  assert.equal(all.status, 200);
  assert.equal(line(ctx.lMto.id).status, "REJECTED");
  assert.equal(line(ctx.lMto.id).availableQty, 0);
  assert.equal(movementsOf(ctx.lMto.id, "RECEIVED").length, 0);

  const filtered = await call("GET", `${A}?filter=rejected`, { as: ctx.admin });
  assert.deepEqual(filtered.body.items.map((i) => i.id).sort(), [ctx.lStock.id, ctx.lMto.id].sort());
});

test("linie deja recepționată: scanarea arată starea, o nouă recepție e refuzată", async () => {
  await receive(ctx.lStock.id, { receivedQty: 5 });
  const scan = await call("GET", `${A}/by-barcode/${ctx.lStock.barcode}`, { as: ctx.admin });
  assert.equal(scan.body.item.status, "RECEIVED");
  assert.equal(scan.body.item.actions.canReceive, false);
  assert.equal(scan.body.item.receivedQty, 5);

  const again = await receive(ctx.lStock.id, { receivedQty: 5 });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already_received");
  assert.equal(line(ctx.lStock.id).receivedQty, 5);
  assert.equal(movementsOf(ctx.lStock.id).length, 1);
});

test("idempotență: dublu click / retry cu aceeași cheie => o singură recepție", async () => {
  const body = { receivedQty: 4, rejectedQty: 1, rejectedReason: "spart" };
  const [a, b] = await Promise.all([receive(ctx.lStock.id, body, "same-key-123"), receive(ctx.lStock.id, body, "same-key-123")]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual([a.body.replayed, b.body.replayed].sort(), [false, true]);

  const retry = await receive(ctx.lStock.id, body, "same-key-123");
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);

  const row = line(ctx.lStock.id);
  assert.equal(row.receivedQty, 4);
  assert.equal(row.rejectedQty, 1);
  assert.equal(movementsOf(row.id).length, 2);

  // aceeași cheie pe alt produs => conflict, nu recepție
  const misuse = await receive(ctx.lMto.id, { receivedQty: 3 }, "same-key-123");
  assert.equal(misuse.status, 409);
  assert.equal(line(ctx.lMto.id).status, "SUBMITTED");

  const noKey = await call("POST", `${A}/${ctx.lMto.id}/receive`, { as: ctx.admin, body: { receivedQty: 3 } });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.error, "idempotency_key_required");
});

/* ============================== deteriorare ============================== */

test("deteriorare după intrarea în stoc: DAMAGED cu motiv + foto, separat de REJECTED", async () => {
  const early = await call("POST", `${A}/${ctx.lStock.id}/damage`, { as: ctx.admin, body: { quantity: 1, reason: "spart" }, key: "dmg-key-0" });
  assert.equal(early.status, 409); // încă nerecepționat => se refuză la recepție, nu „deteriorat”

  await receive(ctx.lStock.id, { receivedQty: 5 });

  const noReason = await call("POST", `${A}/${ctx.lStock.id}/damage`, { as: ctx.admin, body: { quantity: 1 }, key: "dmg-key-1" });
  assert.equal(noReason.status, 400);

  const ok = await call("POST", `${A}/${ctx.lStock.id}/damage`, {
    as: ctx.admin, body: { quantity: 2, reason: "căzut de pe raft", photoUrls: [PHOTO] }, key: "dmg-key-2",
  });
  assert.equal(ok.status, 200);
  const replay = await call("POST", `${A}/${ctx.lStock.id}/damage`, {
    as: ctx.admin, body: { quantity: 2, reason: "căzut de pe raft", photoUrls: [PHOTO] }, key: "dmg-key-2",
  });
  assert.equal(replay.body.replayed, true);

  const row = line(ctx.lStock.id);
  assert.equal(row.damagedQty, 2);
  assert.equal(row.availableQty, 3);
  assert.equal(row.rejectedQty, 0);
  const dmg = movementsOf(row.id, "DAMAGED");
  assert.equal(dmg.length, 1);
  assert.deepEqual(dmg[0].photoUrls, [PHOTO]);

  const tooMany = await call("POST", `${A}/${ctx.lStock.id}/damage`, { as: ctx.admin, body: { quantity: 9, reason: "x x x" }, key: "dmg-key-3" });
  assert.equal(tooMany.status, 409);
  assert.equal(line(ctx.lStock.id).availableQty, 3);
});

test("fotografii: upload în folderul recepției din R2", async () => {
  const form = new FormData();
  form.append("files", new Blob([Buffer.from("img")], { type: "image/jpeg" }), "a.jpg");
  form.append("files", new Blob([Buffer.from("img")], { type: "image/png" }), "b.png");
  const res = await fetch(`${base}${A}/photos`, { method: "POST", headers: { "x-test-user": ctx.admin.id }, body: form });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.urls.every((u) => u.startsWith(`${R2}/artfest-fair-reception/`)));
});

/* ============================== blocare ============================== */

test("blocare / deblocare de la vânzare, cu audit", async () => {
  const notYet = await call("POST", `${A}/${ctx.lStock.id}/block`, { as: ctx.admin, body: { reason: "verificare" } });
  assert.equal(notYet.status, 409);

  await receive(ctx.lStock.id, { receivedQty: 5 });
  const noReason = await call("POST", `${A}/${ctx.lStock.id}/block`, { as: ctx.admin, body: {} });
  assert.equal(noReason.status, 400);

  const blocked = await call("POST", `${A}/${ctx.lStock.id}/block`, { as: ctx.admin, body: { reason: "etichetă greșită" } });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.item.saleBlocked.reason, "etichetă greșită");
  assert.equal(blocked.body.item.eligibility.sellable, false);
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
  assert.equal((await call("POST", `${A}/${ctx.lStock.id}/block`, { as: ctx.admin, body: { reason: "iar" } })).status, 409);

  const filtered = await call("GET", `${A}?filter=blocked`, { as: ctx.admin });
  assert.deepEqual(filtered.body.items.map((i) => i.id), [ctx.lStock.id]);

  const unblocked = await call("POST", `${A}/${ctx.lStock.id}/unblock`, { as: ctx.admin });
  assert.equal(unblocked.status, 200);
  assert.equal(unblocked.body.item.saleBlocked, null);
  assert.equal(unblocked.body.item.eligibility.sellable, true);
  assert.equal(line(ctx.lStock.id).saleBlockedReason, null);
  assert.equal(eventsOf(ctx.lStock.id, "SALE_BLOCKED")[0].after.reason, "etichetă greșită");
  assert.equal(eventsOf(ctx.lStock.id, "SALE_UNBLOCKED")[0].before.reason, "etichetă greșită");
  assert.equal((await call("POST", `${A}/${ctx.lStock.id}/unblock`, { as: ctx.admin })).status, 409);
});

test("produs respins la moderare după recepție: semnalat, nevandabil, statusul rămâne RECEIVED", async () => {
  await receive(ctx.lStock.id, { receivedQty: 5 });
  productRow(ctx.pStock.id).moderationStatus = "REJECTED";

  const res = await call("GET", `${A}/${ctx.lStock.id}`, { as: ctx.admin });
  assert.equal(res.body.item.status, "RECEIVED");
  assert.equal(res.body.item.eligibility.eligible, false);
  assert.equal(res.body.item.eligibility.sellable, false);
  assert.ok(res.body.item.warnings.some((w) => /moderare/.test(w)));
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");
});

/* ============================== vendor ============================== */

test("vendorul vede rezultatul recepției și nu îl poate modifica", async () => {
  await receive(ctx.lStock.id, {
    receivedQty: 3, rejectedQty: 1, rejectedReason: "ambalaj deteriorat", photoUrls: [PHOTO], adminNotes: "notă internă",
  });

  const view = await call("GET", "/api/vendor/fair/inventory", { as: ctx.v1 });
  const item = view.body.items.find((i) => i.id === ctx.lStock.id);
  assert.equal(item.status, "RECEIVED");
  assert.equal(item.reception.receivedQty, 3);
  assert.equal(item.reception.rejectedQty, 1);
  assert.equal(item.reception.difference, -1);
  assert.ok(item.reception.messages.includes("Ai declarat 5 bucăți. Artfest a recepționat 3."));
  assert.ok(item.reception.messages.includes("1 produs a fost refuzat: ambalaj deteriorat."));
  assert.deepEqual(item.reception.rejections[0].photoUrls, [PHOTO]);
  assert.equal(JSON.stringify(view.body).includes("notă internă"), false);
  assert.equal(item.actions.canCancel, false);
  assert.equal(item.actions.canEdit, false);

  const patch = await call("PATCH", `/api/vendor/fair/inventory/${ctx.lStock.id}`, { as: ctx.v1, body: { declaredQty: 9, receivedQty: 9 } });
  assert.equal(patch.status, 409);
  const cancel = await call("POST", `/api/vendor/fair/inventory/${ctx.lStock.id}/cancel`, { as: ctx.v1 });
  assert.equal(cancel.status, 409);
  assert.equal(cancel.body.error, "not_cancellable");
  assert.equal(line(ctx.lStock.id).receivedQty, 3);
  assert.equal(line(ctx.lStock.id).status, "RECEIVED");

  // alt vendor nu poate anula linia
  const foreign = await call("POST", `/api/vendor/fair/inventory/${ctx.lMto.id}/cancel`, { as: ctx.v2 });
  assert.equal(foreign.status, 404);
});

/* ============================== anulare SUBMITTED ============================== */

test("anulare TRANSFERRED: stocul online revine, linia CANCELLED, reactivare curată", async () => {
  assert.equal(productRow(ctx.pStock.id).readyQty, 5); // 10 - 5 rezervate

  const res = await call("POST", `/api/vendor/fair/inventory/${ctx.lStock.id}/cancel`, { as: ctx.v1 });
  assert.equal(res.status, 200);
  assert.equal(productRow(ctx.pStock.id).readyQty, 10);
  assert.equal(productRow(ctx.pStock.id).availability, "READY");
  const row = line(ctx.lStock.id);
  assert.equal(row.status, "CANCELLED");
  assert.equal(row.onlineReleasedQty, 5);
  assert.ok(row.onlineReleasedAt instanceof Date);
  assert.equal(eventsOf(row.id, "ONLINE_STOCK_RELEASED").length, 1);

  // produsul nu mai e blocat de târg
  await locks.assertProductNotLockedByFair(ctx.pStock.id, { availability: "MADE_TO_ORDER" });

  // re-adăugarea aceleiași variante reactivează linia cu rezervarea resetată
  const again = await inventory.addInventoryItem({ vendorId: ctx.vendor1.id, userId: ctx.v1.id, body: { productId: ctx.pStock.id, declaredQty: 2 } });
  assert.equal(again.id, ctx.lStock.id);
  assert.equal(line(row.id).onlineReservationMode, "NONE");
  assert.equal(line(row.id).onlineReleasedQty, 0);
  await inventory.submitInventory({ vendorId: ctx.vendor1.id, userId: ctx.v1.id });
  assert.equal(productRow(ctx.pStock.id).readyQty, 8);
  assert.equal(line(row.id).onlineReservedQty, 2);
});

test("anulare FORCED_UNAVAILABLE: starea anterioară a unicatului e refăcută", async () => {
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
  const res = await call("POST", `${A}/${ctx.lUnique.id}/cancel`, { as: ctx.admin, body: { reason: "vendorul a retras piesa" } });
  assert.equal(res.status, 200);
  assert.equal(productRow(ctx.pUnique.id).availability, "READY");
  assert.equal(productRow(ctx.pUnique.id).readyQty, null);
  assert.equal(line(ctx.lUnique.id).status, "CANCELLED");
  assert.equal(eventsOf(ctx.lUnique.id, "ONLINE_STOCK_RELEASED").length, 1);
});

test("anulare unicat cu restaurare amânată: comenzile online anulate între timp se adaugă", async () => {
  const l = await inventory.addInventoryItem({ vendorId: ctx.vendor1.id, userId: ctx.v1.id, body: { productId: ctx.pUniqueTracked.id, declaredQty: 1, isUnique: true } });
  await inventory.submitInventory({ vendorId: ctx.vendor1.id, userId: ctx.v1.id });
  assert.equal(productRow(ctx.pUniqueTracked.id).readyQty, 0);
  assert.equal(line(l.id).onlinePrevReadyQty, 1);

  await stock.restoreProductStock(fake, new Map([[ctx.pUniqueTracked.id, 2]]));
  assert.equal(line(l.id).onlineDeferredRestoreQty, 2);
  assert.equal(productRow(ctx.pUniqueTracked.id).availability, "SOLD_OUT");

  const res = await call("POST", `/api/vendor/fair/inventory/${l.id}/cancel`, { as: ctx.v1 });
  assert.equal(res.status, 200);
  assert.equal(productRow(ctx.pUniqueTracked.id).readyQty, 3); // 1 anterior + 2 amânate
  assert.equal(productRow(ctx.pUniqueTracked.id).availability, "READY");
});

test("anulare unicat când produsul a fost schimbat între timp: nu suprascrie, auditează", async () => {
  productRow(ctx.pUnique.id).availability = "MADE_TO_ORDER"; // modificat în afara fluxului
  const res = await call("POST", `${A}/${ctx.lUnique.id}/cancel`, { as: ctx.admin });
  assert.equal(res.status, 200);
  assert.equal(productRow(ctx.pUnique.id).availability, "MADE_TO_ORDER");
  assert.equal(eventsOf(ctx.lUnique.id, "ONLINE_RESTORE_SKIPPED").length, 1);
  assert.equal(line(ctx.lUnique.id).status, "CANCELLED");
});

test("anulare: după recepție blocată; după termen doar Admin; MADE_TO_ORDER fără schimbare de stoc", async () => {
  await receive(ctx.lStock.id, { receivedQty: 5 });
  const afterReception = await call("POST", `${A}/${ctx.lStock.id}/cancel`, { as: ctx.admin });
  assert.equal(afterReception.status, 409);
  assert.equal(afterReception.body.error, "not_cancellable");

  fake.tables.artfestFair[0].inventoryDeadlineAt = new Date(Date.now() - 1000);
  const vendorLate = await call("POST", `/api/vendor/fair/inventory/${ctx.lMto.id}/cancel`, { as: ctx.v1 });
  assert.equal(vendorLate.status, 409);
  assert.equal(vendorLate.body.error, "inventory_locked");

  const adminLate = await call("POST", `${A}/${ctx.lMto.id}/cancel`, { as: ctx.admin });
  assert.equal(adminLate.status, 200);
  assert.equal(line(ctx.lMto.id).status, "CANCELLED");
  assert.equal(productRow(ctx.pMto.id).availability, "MADE_TO_ORDER");
  assert.equal(eventsOf(ctx.lMto.id, "ONLINE_STOCK_RELEASED").length, 0);
});
