// Teste pentru inventarul vendorului la Târgul Artfest (etapa 1): linii,
// variante, cod de bare, trimitere cu rezervarea stocului online, blocările
// pe produs, stockRestore pentru unicate, etichete PDF.
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header și conversia
// HTML -> PDF (fără puppeteer). bwip-js rulează real.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairInventory.routes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { createFakePrisma } from "../testkit/fakePrisma.js";
import { buildConfigurationKey } from "../lib/configurationKey.js";

let fake;
const pdfCalls = [];

mock.module("../db.js", {
  namedExports: {
    prisma: new Proxy({}, { get: (_target, key) => fake[key] }),
  },
});

mock.module("../api/auth.js", {
  namedExports: {
    authRequired(req, res, next) {
      const sub = req.headers["x-test-user"];
      if (!sub) return res.status(401).json({ error: "unauthorized" });
      req.user = { sub, role: "VENDOR" };
      next();
    },
  },
});

mock.module("../lib/pdfBrowser.js", {
  namedExports: {
    async renderPdfWithSharedBrowser(html, options) {
      pdfCalls.push({ html, options });
      return Buffer.from("%PDF-1.4 fake");
    },
  },
});

const FAIR_KEY = "CHRISTMAS_FAIR_BUZAU_2026";
const BARCODE_RE = /^AF[2-9ABCDEFGHJKMNPQRSTVWX]{8}$/;
const COLORS = [{ key: "culoare", label: "Culoare", required: true, type: "select", options: ["Roșu", "Verde"] }];

let server;
let base;
let ctx;
let inventory;
let locks;
let stock;

before(async () => {
  const routes = (await import("./vendorArtfestFairInventoryRoutes.js")).default;
  const fairRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  locks = await import("../services/fairProductLock.js");
  stock = await import("../services/stockRestore.js");

  const app = express();
  app.use(express.json());
  app.use("/api/vendor/fair/inventory", routes);
  app.use("/api/vendor/artfest-fair", fairRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const DAY = 24 * 60 * 60 * 1000;

function product(serviceId, extra) {
  return {
    serviceId,
    title: "Produs",
    images: ["https://img/1.jpg", "https://img/2.jpg"],
    priceCents: 3900,
    currency: "RON",
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    orderMode: "DIRECT",
    availability: "READY",
    readyQty: null,
    optionsSchema: [],
    limitedEditionOf: null,
    limitedEditionNumber: null,
    ...extra,
  };
}

beforeEach(() => {
  pdfCalls.length = 0;
  fake = createFakePrisma();

  const [v1, v2, v3] = fake.seed("user", [
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
    { email: "v3@t.ro", role: "VENDOR" },
  ]);
  const [vendor1, vendor2, vendor3] = fake.seed("vendor", [
    { userId: v1.id, displayName: "Vendor 1" },
    { userId: v2.id, displayName: "Vendor 2" },
    { userId: v3.id, displayName: "Vendor 3" },
  ]);
  const [s1, s2] = fake.seed("vendorService", [
    { vendorId: vendor1.id, title: "Serviciu 1" },
    { vendorId: vendor2.id, title: "Serviciu 2" },
  ]);
  fake.seed("serviceProfile", [{ serviceId: s1.id, displayName: "Alexandrina Designs" }]);

  const [fair] = fake.seed("artfestFair", [
    {
      key: FAIR_KEY,
      title: "Târgul de Crăciun Artfest – Buzău",
      registrationOpen: true,
      inventoryDeadlineAt: new Date(Date.now() + 10 * DAY),
      endsAt: new Date(Date.now() + 20 * DAY),
      termsVersion: null,
    },
  ]);
  const [r1, r2, r3] = fake.seed("artfestFairRegistration", [
    { fairId: fair.id, vendorId: vendor1.id, submittedByUserId: v1.id, status: "APPROVED", participationType: "PARTICIPARE_LA_DISTANTA" },
    { fairId: fair.id, vendorId: vendor2.id, submittedByUserId: v2.id, status: "APPROVED", participationType: "PARTICIPARE_FIZICA" },
    { fairId: fair.id, vendorId: vendor3.id, submittedByUserId: v3.id, status: "SUBMITTED", participationType: "PARTICIPARE_FIZICA" },
  ]);

  const [pColors, pUnique, pMto, pQuote, pPending, pOther, pLow] = fake.seed("product", [
    product(s1.id, { title: "Spiridușul Ella", orderMode: "OPTIONS", readyQty: 5, optionsSchema: COLORS }),
    product(s1.id, { title: "Vază unicat", priceCents: 12000, readyQty: null }),
    product(s1.id, { title: "Cană la comandă", priceCents: 5000, availability: "MADE_TO_ORDER", readyQty: null }),
    product(s1.id, { title: "La ofertă", orderMode: "QUOTE_ONLY" }),
    product(s1.id, { title: "În moderare", moderationStatus: "PENDING" }),
    product(s2.id, { title: "Al vendorului 2", readyQty: 2 }),
    product(s1.id, { title: "Stoc mic", priceCents: 2000, readyQty: 1, limitedEditionOf: 50 }),
  ]);

  ctx = { v1, v2, v3, vendor1, vendor2, fair, r1, r2, r3, pColors, pUnique, pMto, pQuote, pPending, pOther, pLow };
});

async function call(method, path, { as, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: payload, type };
}

const INV = "/api/vendor/fair/inventory";
const add = (as, body) => call("POST", INV, { as, body });
const items = () => fake.tables.artfestFairInventoryItem;
const productRow = (id) => fake.tables.product.find((p) => p.id === id);
const eventsOf = (type) => fake.tables.artfestFairInventoryEvent.filter((e) => e.type === type);

/* ============================== acces ============================== */

test("acces: fără sesiune 401; înscriere neaprobată nu poate crea linii", async () => {
  assert.equal((await call("GET", INV)).status, 401);

  const view = await call("GET", INV, { as: ctx.v3 });
  assert.equal(view.status, 200);
  assert.equal(view.body.approved, false);
  assert.deepEqual(view.body.items, []);

  const res = await add(ctx.v3, { productId: ctx.pMto.id, declaredQty: 1 });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "registration_not_approved");
  assert.equal(items().length, 0);
});

test("produse eligibile: doar ale vendorului, active, aprobate, cu preț, fără QUOTE_ONLY", async () => {
  const res = await call("GET", `${INV}/products`, { as: ctx.v1 });
  const titles = res.body.items.map((p) => p.title).sort();
  assert.deepEqual(titles, ["Cană la comandă", "Spiridușul Ella", "Stoc mic", "Vază unicat"]);

  const ella = res.body.items.find((p) => p.title === "Spiridușul Ella");
  assert.deepEqual(ella.options[0].choices.map((c) => c.value), ["Roșu", "Verde"]);
  assert.equal(res.body.items.find((p) => p.title === "Stoc mic").isLimitedEdition, true);
});

/* ============================== creare ============================== */

test("creare: barcode generat, snapshot-uri, cheia de variantă ca online, câmpurile din client ignorate", async () => {
  const res = await add(ctx.v1, {
    productId: ctx.pColors.id,
    selectedOptions: { culoare: "Roșu" },
    declaredQty: 2,
    isFragile: true,
    handlingInstructions: "  Ține vertical  ",
    // nimic din acestea nu are voie să ajungă în DB
    barcode: "AFAAAAAAAA",
    priceSnapshotCents: 1,
    receivedQty: 9,
    soldQty: 9,
    status: "RECEIVED",
    onlineReservationMode: "TRANSFERRED",
    vendorId: ctx.vendor2.id,
  });
  assert.equal(res.status, 201);

  const row = items()[0];
  assert.match(row.barcode, BARCODE_RE);
  assert.notEqual(row.barcode, "AFAAAAAAAA");
  assert.equal(res.body.item.barcodeDisplay, `${row.barcode.slice(0, 2)}-${row.barcode.slice(2, 6)}-${row.barcode.slice(6)}`);
  assert.equal(row.vendorId, ctx.vendor1.id);
  assert.equal(row.registrationId, ctx.r1.id);
  assert.equal(row.status, "DRAFT");
  assert.equal(row.priceSnapshotCents, 3900);
  assert.equal(row.receivedQty, 0);
  assert.equal(row.soldQty, 0);
  assert.equal(row.onlineReservationMode, "NONE");
  assert.equal(row.titleSnapshot, "Spiridușul Ella");
  assert.equal(row.storeNameSnapshot, "Alexandrina Designs");
  assert.equal(row.imageUrlSnapshot, "https://img/1.jpg");
  assert.equal(row.variantKey, buildConfigurationKey({ culoare: "Roșu" }, {}, {}));
  assert.equal(row.variantLabel, "Culoare: Roșu");
  assert.deepEqual(row.variantSnapshot, { options: [{ key: "culoare", label: "Culoare", value: "Roșu", valueLabel: "Roșu" }] });
  assert.equal(row.isFragile, true);
  assert.equal(row.handlingInstructions, "Ține vertical");
  assert.equal(eventsOf("CREATED").length, 1);

  // produs fără opțiuni: aceeași funcție ca online, NU "default"
  const plain = await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 1 });
  assert.equal(plain.status, 201);
  assert.equal(items()[1].variantKey, buildConfigurationKey({}, {}, {}));
  assert.notEqual(items()[1].variantKey, "default");

  // serie limitată precompletată din produs
  const limited = await add(ctx.v1, { productId: ctx.pLow.id, declaredQty: 1 });
  assert.equal(limited.body.item.isLimitedEdition, true);
});

test("variante invalide și produse neeligibile sunt respinse", async () => {
  const wrong = await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Albastru" }, declaredQty: 1 });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "invalid_variant");
  assert.ok(wrong.body.fields.culoare);

  const missing = await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: {}, declaredQty: 1 });
  assert.equal(missing.status, 400);

  const unknown = await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu", text: "x" }, declaredQty: 1 });
  assert.equal(unknown.status, 400);

  for (const p of [ctx.pQuote, ctx.pPending]) {
    const res = await add(ctx.v1, { productId: p.id, declaredQty: 1 });
    assert.equal(res.status, 400, p.title);
    assert.equal(res.body.error, "product_not_eligible");
  }

  // produsul altui vendor
  const foreign = await add(ctx.v1, { productId: ctx.pOther.id, declaredQty: 1 });
  assert.equal(foreign.status, 404);

  const badQty = await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 0 });
  assert.equal(badQty.status, 400);
  assert.equal(items().length, 0);
});

test("variantă dublată => 409; altă culoare => linie separată cu alt barcode", async () => {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 1 });
  const dup = await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 3 });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, "duplicate_variant");

  const green = await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Verde" }, declaredQty: 1 });
  assert.equal(green.status, 201);
  assert.equal(items().length, 2);
  assert.notEqual(items()[0].barcode, items()[1].barcode);
  assert.notEqual(items()[0].variantKey, items()[1].variantKey);
});

test("barcode: la coliziune se generează alt cod", async () => {
  // primul cod generat există deja în DB
  fake.seed("artfestFairInventoryItem", [
    {
      fairId: ctx.fair.id, registrationId: ctx.r2.id, vendorId: ctx.vendor2.id, productId: ctx.pOther.id,
      variantKey: buildConfigurationKey({}, {}, {}), titleSnapshot: "x", priceSnapshotCents: 100,
      barcode: "AF22222222", declaredQty: 1,
    },
  ]);
  const sequence = [...Array(8).fill(0), ...Array(8).fill(1)]; // AF22222222, apoi AF33333333
  let i = 0;
  const randomInt = () => sequence[i++ % sequence.length];

  const item = await inventory.addInventoryItem({
    vendorId: ctx.vendor1.id,
    userId: ctx.v1.id,
    body: { productId: ctx.pMto.id, declaredQty: 1 },
    randomInt,
  });
  assert.equal(item.barcode, "AF33333333");
  assert.equal(new Set(items().map((r) => r.barcode)).size, items().length);
});

test("editare / eliminare în DRAFT; reguli de unicat; reactivarea aceleiași variante", async () => {
  const created = await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1 });
  const id = created.body.item.id;

  const edited = await call("PATCH", `${INV}/${id}`, { as: ctx.v1, body: { declaredQty: 3, vendorNotes: "cutie" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.item.declaredQty, 3);

  const badUnique = await call("PATCH", `${INV}/${id}`, { as: ctx.v1, body: { isUnique: true } });
  assert.equal(badUnique.status, 400); // unicat => cantitate 1

  const remade = await call("PATCH", `${INV}/${id}`, { as: ctx.v1, body: { isUnique: true, declaredQty: 1, canBeRemade: true } });
  assert.equal(remade.status, 400);

  const removed = await call("DELETE", `${INV}/${id}`, { as: ctx.v1 });
  assert.equal(removed.status, 200);
  assert.equal(items()[0].status, "CANCELLED");
  const listed = await call("GET", INV, { as: ctx.v1 });
  assert.equal(listed.body.items.length, 0);

  const again = await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1, isUnique: true });
  assert.equal(again.status, 201);
  assert.equal(items().length, 1);
  assert.equal(again.body.item.id, id);
  assert.equal(items()[0].status, "DRAFT");
  assert.equal(items()[0].isUnique, true);
});

test("cross-vendor: liniile altui vendor => 404 la editare, ștergere, preț", async () => {
  const created = await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 2 });
  const id = created.body.item.id;

  for (const [method, path] of [
    ["PATCH", `${INV}/${id}`],
    ["DELETE", `${INV}/${id}`],
    ["POST", `${INV}/${id}/sync-price`],
  ]) {
    const res = await call(method, path, { as: ctx.v2, body: method === "PATCH" ? { declaredQty: 9 } : undefined });
    assert.equal(res.status, 404, `${method} ${path}`);
  }

  const theirs = await call("GET", INV, { as: ctx.v2 });
  assert.deepEqual(theirs.body.items, []);
  assert.equal(items()[0].declaredQty, 2);
  assert.equal(items()[0].status, "DRAFT");
  assert.equal(pdfCalls.length, 0);
});

/* ============================== trimitere ============================== */

async function draftMix() {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 2 });
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Verde" }, declaredQty: 1 });
  await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1, isUnique: true });
  await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 4 });
}

test("submit: transfer din readyQty, unicat SOLD_OUT, la comandă fără rezervare", async () => {
  await draftMix();
  const res = await call("POST", `${INV}/submit`, { as: ctx.v1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.submitted, 4);

  // A. stoc urmărit: 5 - (2 + 1) = 2
  assert.equal(productRow(ctx.pColors.id).readyQty, 2);
  assert.equal(productRow(ctx.pColors.id).availability, "READY");
  const colorLines = items().filter((l) => l.productId === ctx.pColors.id);
  assert.deepEqual(colorLines.map((l) => [l.onlineReservationMode, l.onlineReservedQty]), [["TRANSFERRED", 2], ["TRANSFERRED", 1]]);

  // B. unicat (stoc neurmărit): SOLD_OUT, starea anterioară salvată
  const unique = items().find((l) => l.productId === ctx.pUnique.id);
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
  assert.equal(productRow(ctx.pUnique.id).readyQty, null);
  assert.equal(unique.onlineReservationMode, "FORCED_UNAVAILABLE");
  assert.equal(unique.onlinePrevAvailability, "READY");
  assert.equal(unique.onlinePrevReadyQty, null);
  assert.equal(unique.onlineReservedQty, 0);

  // C. la comandă: nimic schimbat
  const mto = items().find((l) => l.productId === ctx.pMto.id);
  assert.equal(mto.onlineReservationMode, "NONE");
  assert.equal(productRow(ctx.pMto.id).availability, "MADE_TO_ORDER");

  assert.ok(items().every((l) => l.status === "SUBMITTED" && l.submittedAt));
  assert.equal(eventsOf("SUBMITTED").length, 4);
  assert.equal(eventsOf("ONLINE_STOCK_RESERVED").length, 3);

  // mesajele pentru UI
  const view = res.body.items;
  assert.equal(view.find((i) => i.variantLabel === "Culoare: Roșu").online.reservedQty, 2);
  assert.equal(view.find((i) => i.variantLabel === "Culoare: Roșu").online.onlineAvailableQty, 2);
  assert.equal(view.find((i) => i.title === "Vază unicat").online.forcedUnavailable, true);

  // liniile trimise nu se mai editează
  const edit = await call("PATCH", `${INV}/${unique.id}`, { as: ctx.v1, body: { declaredQty: 1 } });
  assert.equal(edit.status, 409);
});

test("submit: stocul ajunge la 0 => SOLD_OUT (ca la checkout)", async () => {
  await add(ctx.v1, { productId: ctx.pLow.id, declaredQty: 1 });
  const res = await call("POST", `${INV}/submit`, { as: ctx.v1 });
  assert.equal(res.status, 200);
  assert.equal(productRow(ctx.pLow.id).readyQty, 0);
  assert.equal(productRow(ctx.pLow.id).availability, "SOLD_OUT");
});

test("submit cu stoc insuficient => rollback complet", async () => {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 2 });
  await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1, isUnique: true });
  await add(ctx.v1, { productId: ctx.pLow.id, declaredQty: 3 }); // readyQty = 1

  const res = await call("POST", `${INV}/submit`, { as: ctx.v1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "insufficient_online_stock");
  assert.match(res.body.message, /Stoc mic/);

  assert.equal(productRow(ctx.pColors.id).readyQty, 5);
  assert.equal(productRow(ctx.pUnique.id).availability, "READY");
  assert.equal(productRow(ctx.pLow.id).readyQty, 1);
  assert.ok(items().every((l) => l.status === "DRAFT" && l.onlineReservationMode === "NONE"));
  assert.equal(eventsOf("ONLINE_STOCK_RESERVED").length, 0);
  assert.equal(eventsOf("SUBMITTED").length, 0);
});

test("dublu submit (secvențial și simultan) => o singură rezervare", async () => {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 2 });

  const [a, b] = await Promise.all([
    call("POST", `${INV}/submit`, { as: ctx.v1 }),
    call("POST", `${INV}/submit`, { as: ctx.v1 }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(productRow(ctx.pColors.id).readyQty, 3);

  const third = await call("POST", `${INV}/submit`, { as: ctx.v1 });
  assert.equal(third.status, 409);
  assert.equal(third.body.error, "nothing_to_submit");
  assert.equal(productRow(ctx.pColors.id).readyQty, 3);
  assert.equal(eventsOf("ONLINE_STOCK_RESERVED").length, 1);
});

test("concurență pe același produs: editarea nu poate redeschide un unicat rezervat", async () => {
  await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1, isUnique: true });

  const edit = locks
    .guardedProductUpdate(ctx.pUnique.id, { availability: "READY", readyQty: 3 }, (db) =>
      db.product.update({ where: { id: ctx.pUnique.id }, data: { availability: "READY", readyQty: 3 } })
    )
    .then(() => "edited", (e) => e.code);
  const submit = call("POST", `${INV}/submit`, { as: ctx.v1 });

  const [editResult, submitRes] = await Promise.all([edit, submit]);
  assert.equal(submitRes.status, 200);

  // oricare ar fi ordinea: produsul rămâne indisponibil online cât e la târg
  const line = items()[0];
  assert.equal(line.onlineReservationMode, "FORCED_UNAVAILABLE");
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
  assert.ok(["edited", "product_reserved_for_fair"].includes(editResult));

  // după rezervare, orice încercare e blocată
  await assert.rejects(
    locks.guardedProductUpdate(ctx.pUnique.id, { availability: "READY" }, (db) =>
      db.product.update({ where: { id: ctx.pUnique.id }, data: { availability: "READY" } })
    ),
    (e) => e.code === "product_reserved_for_fair"
  );
  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
});

test("retragerea înscrierii e blocată după trimiterea inventarului", async () => {
  await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 1 });
  const beforeSubmit = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(beforeSubmit.body.actions.canWithdraw, true);

  await call("POST", `${INV}/submit`, { as: ctx.v1 });

  // UI-ul nu mai oferă retragerea
  const state = await call("GET", "/api/vendor/artfest-fair", { as: ctx.v1 });
  assert.equal(state.body.actions.canWithdraw, false);

  const res = await call("POST", "/api/vendor/artfest-fair/registration/withdraw", { as: ctx.v1 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "inventory_submitted");
  assert.equal(fake.tables.artfestFairRegistration.find((r) => r.id === ctx.r1.id).status, "APPROVED");
});

/* ============================== stockRestore ============================== */

test("stockRestore: unicatul de la târg nu redevine cumpărabil; cantitatea se amână", async () => {
  await add(ctx.v1, { productId: ctx.pUnique.id, declaredQty: 1, isUnique: true });
  await call("POST", `${INV}/submit`, { as: ctx.v1 });

  // o comandă online veche pentru unicat + una pentru un produs fără rezervare
  productRow(ctx.pOther.id).readyQty = 0;
  productRow(ctx.pOther.id).availability = "SOLD_OUT";
  await stock.restoreProductStock(fake, new Map([[ctx.pUnique.id, 1], [ctx.pOther.id, 2]]));

  assert.equal(productRow(ctx.pUnique.id).availability, "SOLD_OUT");
  assert.equal(items()[0].onlineDeferredRestoreQty, 1);
  assert.equal(eventsOf("ONLINE_RESTORE_DEFERRED").length, 1);

  // comportament neschimbat fără rezervare de târg
  assert.equal(productRow(ctx.pOther.id).readyQty, 2);
  assert.equal(productRow(ctx.pOther.id).availability, "READY");
});

/* ============================== preț ============================== */

test("preț: înainte de termen se sincronizează; după termen e blocat pe produs și în inventar", async () => {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 1 });
  const id = items()[0].id;
  // eticheta e generată de Artfest (Admin) - aici o simulăm direct pe linie
  Object.assign(items()[0], { labelPriceCents: 3900, labelGeneratedAt: new Date() });

  // vendorul schimbă prețul înainte de termen: permis
  await locks.guardedProductUpdate(ctx.pColors.id, { priceCents: 4500 }, (db) =>
    db.product.update({ where: { id: ctx.pColors.id }, data: { priceCents: 4500 } })
  );
  const view = await call("GET", INV, { as: ctx.v1 });
  assert.equal(view.body.items[0].priceOutOfSync, true);
  assert.equal(view.body.items[0].canSyncPrice, true);

  const synced = await call("POST", `${INV}/${id}/sync-price`, { as: ctx.v1 });
  assert.equal(synced.status, 200);
  assert.equal(items()[0].priceSnapshotCents, 4500);
  assert.equal(synced.body.item.label.state, "outdated"); // eticheta veche are 39 lei
  assert.equal(eventsOf("PRICE_SYNCED").length, 1);

  await call("POST", `${INV}/submit`, { as: ctx.v1 });

  // termenul trece
  fake.tables.artfestFair[0].inventoryDeadlineAt = new Date(Date.now() - 1000);

  await assert.rejects(
    locks.assertProductNotLockedByFair(ctx.pColors.id, { priceCents: 5000 }),
    (e) => e.code === "product_price_locked_by_fair" && /blocat/.test(e.message)
  );
  // același preț retrimis de formular nu e o modificare
  await locks.assertProductNotLockedByFair(ctx.pColors.id, { priceCents: 4500 });
  // ștergerea e blocată
  await assert.rejects(
    locks.assertProductsNotLockedByFair({ productIds: [ctx.pColors.id], action: "delete" }),
    (e) => e.code === "product_locked_by_fair"
  );
  // în bulk, un singur produs blocat oprește operația
  await assert.rejects(
    locks.assertProductsNotLockedByFair({ productIds: [ctx.pMto.id, ctx.pColors.id], patch: { priceCents: 100 } }),
    (e) => e.productIds.includes(ctx.pColors.id) && !e.productIds.includes(ctx.pMto.id)
  );

  const sync = await call("POST", `${INV}/${id}/sync-price`, { as: ctx.v1 });
  assert.equal(sync.status, 409);
  assert.equal(sync.body.error, "price_locked");

  const late = await add(ctx.v1, { productId: ctx.pMto.id, declaredQty: 1 });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "inventory_locked");
});

test("fără blocări: produsele care nu sunt la târg se modifică normal", async () => {
  await locks.assertProductNotLockedByFair(ctx.pMto.id, { priceCents: 1, availability: "READY", readyQty: 4 });
  const out = await locks.guardedProductUpdate(ctx.pMto.id, { title: "x" }, (db) =>
    db.product.update({ where: { id: ctx.pMto.id }, data: { title: "Nou" } })
  );
  assert.equal(out.title, "Nou");
});

/* ============================== etichete ============================== */

test("etichete: vendorul nu le mai poate genera (403), nimic nu se modifică", async () => {
  await add(ctx.v1, { productId: ctx.pColors.id, selectedOptions: { culoare: "Roșu" }, declaredQty: 5 });
  await call("POST", `${INV}/submit`, { as: ctx.v1 });
  const line = items()[0];
  const barcode = line.barcode;

  for (const path of [`${INV}/${line.id}/label.pdf`, `${INV}/labels.pdf`, `${INV}/nu-exista/label.pdf`]) {
    const res = await call("GET", path, { as: ctx.v1 });
    assert.equal(res.status, 403, path);
    assert.equal(res.body.error, "labels_managed_by_artfest");
  }
  // alt vendor => tot 403 (nu află dacă linia există)
  assert.equal((await call("GET", `${INV}/${line.id}/label.pdf`, { as: ctx.v2 })).status, 403);

  assert.equal(pdfCalls.length, 0);
  assert.equal(line.labelGeneratedAt ?? null, null);
  assert.equal(line.labelPriceCents ?? null, null);
  assert.equal(line.barcode, barcode);
  assert.equal(eventsOf("LABEL_GENERATED").length, 0);

  // inventarul rămâne vizibil (cu codul liniei) pentru vendor
  const listed = await call("GET", INV, { as: ctx.v1 });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].barcode, barcode);
});
