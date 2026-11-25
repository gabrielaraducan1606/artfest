// Etichete FĂRĂ PREȚ (Admin → Târg → Etichete): magazin participant + Artfest.
// Doar Admin; eligibilitate verificată pe server (înscriere APPROVED, magazin cu pagină
// publică); QR-ul codifică exact adresa aleasă; numărul exact de etichete; aceeași coală
// ca etichetele existente; nimic scris în DB. Etichetele cu preț / cod AF neschimbate.
// Rutele reale; mock-uri doar pe DB in-memory, auth pe header și PDF (HTML capturat).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/artfestFairPromoLabels.routes.test.js

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
let labels;
let promo;
let inventory;

before(async () => {
  const adminRoutes = (await import("./adminArtfestFairRoutes.js")).default;
  const vendorRoutes = (await import("./vendorArtfestFairRoutes.js")).default;
  inventory = await import("../services/artfestFairInventoryService.js");
  labels = await import("../lib/fairLabels.js");
  promo = await import("../lib/fairPromoLabels.js");
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
  const [admin, u1, u2, u3, u4, u5] = fake.seed("user", [
    { email: "adm@t.ro", role: "ADMIN" },
    { email: "v1@t.ro", role: "VENDOR" },
    { email: "v2@t.ro", role: "VENDOR" },
    { email: "v3@t.ro", role: "VENDOR" },
    { email: "v4@t.ro", role: "VENDOR" },
    { email: "v5@t.ro", role: "VENDOR" },
  ]);
  const [v1, v2, v3, v4, v5] = fake.seed("vendor", [
    { userId: u1.id, displayName: "Ana Popescu", isActive: true },
    { userId: u2.id, displayName: "Ion Ionescu", isActive: true },
    { userId: u3.id, displayName: "Retras", isActive: true },
    { userId: u4.id, displayName: "Anulat", isActive: true },
    { userId: u5.id, displayName: "Respins", isActive: true },
  ]);
  const [products, services] = fake.seed("serviceType", [{ code: "products" }, { code: "services" }]);
  const store = (vendorId, title, extra = {}) => ({ vendorId, typeId: products.id, title, isActive: true, status: "ACTIVE", ...extra });
  const [sA1, sA2, sAoff, sB, sBserv, s3, s4, s5] = fake.seed("vendorService", [
    store(v1.id, "Atelier Ana"),
    store(v1.id, "Ana Decor"),
    store(v1.id, "Ana Vechi", { isActive: false }),
    store(v2.id, "Ceramica Ion", { status: "DRAFT" }),
    { vendorId: v2.id, typeId: services.id, title: "Servicii Ion", isActive: true, status: "ACTIVE" },
    store(v3.id, "Magazin retras"),
    store(v4.id, "Magazin anulat"),
    store(v5.id, "Magazin respins"),
  ]);
  fake.seed("serviceProfile", [
    { serviceId: sA1.id, slug: "atelier-ana", displayName: "Atelierul Anei" },
    { serviceId: sA2.id, slug: "ana-decor", displayName: "Ana Decor" },
    { serviceId: sAoff.id, slug: "ana-vechi", displayName: "Ana Vechi" },
    { serviceId: sB.id, slug: "ceramica-ion", displayName: "Ceramica Ion" },
    { serviceId: s3.id, slug: "retras", displayName: "Retras" },
    { serviceId: s4.id, slug: "anulat", displayName: "Anulat" },
    { serviceId: s5.id, slug: "respins", displayName: "Respins" },
  ]);
  const [fair] = fake.seed("artfestFair", [
    { key: "CHRISTMAS_FAIR_BUZAU_2026", title: "Târg", registrationOpen: true, salesOpen: true, commissionBps: 1000,
      inventoryDeadlineAt: new Date(Date.now() + 5 * 86400000), endsAt: new Date(Date.now() + 9 * 86400000) },
  ]);
  const reg = (vendorId, userId, status) => ({ fairId: fair.id, vendorId, submittedByUserId: userId, status, participationType: "PARTICIPARE_FIZICA" });
  const [r1, r2, r3, r4, r5] = fake.seed("artfestFairRegistration", [
    reg(v1.id, u1.id, "APPROVED"),
    reg(v2.id, u2.id, "APPROVED"),
    reg(v3.id, u3.id, "WITHDRAWN"),
    reg(v4.id, u4.id, "CANCELLED"),
    reg(v5.id, u5.id, "REJECTED"),
  ]);
  ctx = { admin, u1, u2, v1, v2, sA1, sA2, sAoff, sB, sBserv, s3, s4, s5, r1, r2, r3, r4, r5, fair };
});

async function call(method, path, { as, body, key } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers["x-test-user"] = as.id;
  if (key) headers["Idempotency-Key"] = key;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text, type };
}

const API = "/api/admin/artfest-fair/labels/promo";
const pdf = (body, as = ctx.admin) => call("POST", `${API}.pdf`, { as, body });
const cells = (html) => (html.match(/<div class="label">/g) || []).length;
const sheets = (html) => (html.match(/<div class="sheet">/g) || []).length;
const dbSnapshot = () => JSON.stringify({
  sales: fake.tables.artfestFairSale.length,
  movements: fake.tables.artfestFairStockMovement.length,
  events: fake.tables.artfestFairInventoryEvent.length,
  regs: fake.tables.artfestFairRegistration,
  services: fake.tables.vendorService,
});

test("doar Admin: fără sesiune 401, vânzătorul 403 (lista și PDF-ul)", async () => {
  assert.equal((await call("GET", `${API}/participants`)).status, 401);
  assert.equal((await call("GET", `${API}/participants`, { as: ctx.u1 })).status, 403);
  assert.equal((await pdf({ kind: "artfest", copies: 1 }, ctx.u1)).status, 403);
  assert.equal(rendered.length, 0);
});

test("lista: doar participanții APPROVED, cu magazinele de produse și disponibilitatea paginii publice", async () => {
  const r = await call("GET", `${API}/participants`, { as: ctx.admin });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items.map((i) => i.vendorName).sort(), ["Ana Popescu", "Ion Ionescu"]);
  const ana = r.body.items.find((i) => i.vendorName === "Ana Popescu");
  assert.deepEqual(
    ana.stores.map((s) => [s.name, s.available, s.url]).sort(),
    [
      ["Ana Decor", true, "https://www.artfest.ro/magazin/ana-decor"],
      ["Ana Vechi", false, null],
      ["Atelierul Anei", true, "https://www.artfest.ro/magazin/atelier-ana"],
    ].sort()
  );
  const ion = r.body.items.find((i) => i.vendorName === "Ion Ionescu");
  assert.deepEqual(ion.stores.map((s) => s.name), ["Ceramica Ion"]); // magazinul de servicii nu apare
  assert.equal(ion.stores[0].available, false);
  assert.ok(ion.stores[0].reason);
  assert.equal(r.body.maxCopies, promo.PROMO_LABEL_MAX_COPIES);
});

test("Artfest: QR către https://www.artfest.ro, textul și adresa; fără preț / produs / cod AF; număr exact pe A4", async () => {
  const before = dbSnapshot();
  const r = await pdf({ kind: "artfest", copies: 30 });
  assert.equal(r.status, 200, r.text);
  assert.match(r.type, /application\/pdf/);
  const { html, options } = rendered.at(-1);
  assert.equal(options.format, "A4");
  assert.equal(cells(html), 30);
  assert.equal(sheets(html), 2); // 24 + 6, restul pozițiilor goale
  assert.ok(html.includes("Artfest") && html.includes("Descoperă creația românească") && html.includes("artfest.ro"));
  // QR-ul: exact SVG-ul generat pentru adresa Artfest (decodarea reală e verificată în browser)
  assert.ok(html.includes(labels.storeQrSvg("https://www.artfest.ro")));
  // fără preț tipărit: doar locul alb „Preț: ______ lei”; fără produs / cod AF / cod de bare
  assert.ok(html.includes(`Preț: <span class="blankLine"></span> lei`));
  assert.doesNotMatch(html, /d+(,d+)? lei|AF-[0-9A-Z]{4}-|class="price"|class="barcode"/);
  assert.equal(dbSnapshot(), before); // nimic scris în DB
});

test("magazin participant: destinația este magazinul SELECTAT (participant cu mai multe magazine)", async () => {
  const r = await pdf({ kind: "store", registrationId: ctx.r1.id, serviceId: ctx.sA2.id, copies: 1 });
  assert.equal(r.status, 200, r.text);
  const { html } = rendered.at(-1);
  assert.equal(cells(html), 1);
  assert.ok(html.includes("Ana Decor"));
  assert.ok(html.includes("Scanează și descoperă magazinul"));
  assert.ok(html.includes(labels.storeQrSvg("https://www.artfest.ro/magazin/ana-decor")));
  assert.ok(!html.includes(labels.storeQrSvg("https://www.artfest.ro/magazin/atelier-ana")));

  const r2 = await pdf({ kind: "store", registrationId: ctx.r1.id, serviceId: ctx.sA1.id, copies: 2 });
  assert.equal(r2.status, 200);
  assert.ok(rendered.at(-1).html.includes(labels.storeQrSvg("https://www.artfest.ro/magazin/atelier-ana")));
  assert.ok(rendered.at(-1).html.includes("Atelierul Anei"));
});

test("refuzuri pe server: participant retras / anulat / respins, magazin fără pagină publică, magazin al altcuiva", async () => {
  for (const [r, s] of [[ctx.r3, ctx.s3], [ctx.r4, ctx.s4], [ctx.r5, ctx.s5]]) {
    const res = await pdf({ kind: "store", registrationId: r.id, serviceId: s.id, copies: 1 });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error, "participant_not_eligible");
  }
  const draft = await pdf({ kind: "store", registrationId: ctx.r2.id, serviceId: ctx.sB.id, copies: 1 });
  assert.equal(draft.status, 409);
  assert.equal(draft.body.error, "store_not_public");
  const inactive = await pdf({ kind: "store", registrationId: ctx.r1.id, serviceId: ctx.sAoff.id, copies: 1 });
  assert.equal(inactive.body.error, "store_not_public");
  const other = await pdf({ kind: "store", registrationId: ctx.r2.id, serviceId: ctx.sA1.id, copies: 1 });
  assert.equal(other.status, 404);
  const services = await pdf({ kind: "store", registrationId: ctx.r2.id, serviceId: ctx.sBserv.id, copies: 1 });
  assert.equal(services.status, 404);
  assert.equal((await pdf({ kind: "store", copies: 1 })).body.error, "participant_not_eligible");
  assert.equal(rendered.length, 0);
});

test("număr de exemplare verificat pe server: întreg 1..maxim", async () => {
  for (const copies of [0, -1, 1.5, "abc", null, promo.PROMO_LABEL_MAX_COPIES + 1]) {
    const r = await pdf({ kind: "artfest", copies });
    assert.equal(r.status, 400, String(copies));
    assert.equal(r.body.error, "invalid_copies");
  }
  assert.equal((await pdf({ kind: "nimic", copies: 1 })).body.error, "invalid_kind");
  const max = await pdf({ kind: "artfest", copies: promo.PROMO_LABEL_MAX_COPIES });
  assert.equal(max.status, 200);
  assert.equal(cells(rendered.at(-1).html), promo.PROMO_LABEL_MAX_COPIES);
  assert.equal(sheets(rendered.at(-1).html), promo.PROMO_LABEL_MAX_COPIES / promo.PROMO_LABELS_PER_SHEET);
});

test("aceeași coală A4 ca etichetele existente; etichetele cu preț și cod AF neschimbate", () => {
  const product = labels.buildLabelsHtml(
    [{ title: "Spiriduș", variantLabel: null, storeName: "Atelier", priceCents: 3900, barcode: "AF2345678Z" }],
    { mode: "sheet" }
  );
  // același CSS de coală (dimensiuni, coloane, margine de sus)
  assert.ok(product.replace(/\s+/g, " ").includes(promo.promoSheetCss().replace(/\s+/g, " ")));
  // eticheta produsului: preț, cod AF și codul de bare, ca înainte
  assert.ok(product.includes("39 lei"));
  assert.ok(product.includes("AF-2345-678Z"));
  assert.ok(product.includes('class="barcode"'));
});

/* ============================== produs în inventar + etichetă fără preț cu cod AF ============================== */

const ADD = `${API}/inventory-item`;
const reqId = () => `req-${Math.random().toString(16).slice(2).padEnd(12, "0")}${Date.now().toString(16)}`.slice(0, 36);
const inv = (id) => fake.tables.artfestFairInventoryItem.find((l) => l.id === id);
const POS = "/api/admin/artfest-fair/pos";

function acceptNewRule(registration) {
  Object.assign(fake.tables.artfestFairRegistration.find((r) => r.id === registration.id), {
    pricingModel: "FAIR_PRICE",
    pricingModelAcceptedAt: new Date(),
    pricingModelTermsVersion: "2.0.0",
    pricingModelAcceptedById: ctx.u1.id,
  });
}

test("„Adaugă și în inventar”: fluxul manual existent (cod AF unic, SUBMITTED), fără duplicare; ciornele vendorului neatinse", async () => {
  // o ciornă proprie a vendorului, care NU trebuie trimisă de Admin
  const own = await inventory.addManualInventoryItem({ vendorId: ctx.v1.id, userId: ctx.u1.id, body: { title: "Ciorna Anei", priceRon: "10", declaredQty: 1, clientRequestId: reqId() } });
  const clientRequestId = reqId();
  const body = { registrationId: ctx.r1.id, title: "Brad din lemn", priceRon: "45,50", declaredQty: 3, clientRequestId };
  const r = await call("POST", ADD, { as: ctx.admin, body });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.item.status, "SUBMITTED"); // urmează recepția, ca orice linie
  assert.equal(r.body.item.isManual, true);
  assert.match(r.body.item.barcodeDisplay, /^AF-/);
  const line = inv(r.body.item.id);
  assert.equal(line.vendorId, ctx.v1.id);
  assert.equal(line.priceSnapshotCents, 4550);
  assert.equal(line.declaredQty, 3);
  assert.equal(inv(own.item.id).status, "DRAFT");

  // retrimiterea (dublu click / reîncercare) => aceeași linie
  const again = await call("POST", ADD, { as: ctx.admin, body });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.item.id, r.body.item.id);
  assert.equal(fake.tables.artfestFairInventoryItem.filter((l) => l.titleSnapshot === "Brad din lemn").length, 1);

  // apare în lista participantului, pentru selectare fără re-adăugare
  const list = await call("GET", `${API}/participants`, { as: ctx.admin });
  const ana = list.body.items.find((i) => i.registrationId === ctx.r1.id);
  assert.ok(ana.lines.some((l) => l.id === r.body.item.id));
  assert.ok(!ana.lines.some((l) => l.id === own.item.id)); // ciornele nu sunt încă inventar trimis

  // doar Admin; participant neaprobat refuzat; termenul pentru inventar respectat
  assert.equal((await call("POST", ADD, { as: ctx.u1, body: { ...body, clientRequestId: reqId() } })).status, 403);
  assert.equal((await call("POST", ADD, { as: ctx.admin, body: { ...body, registrationId: ctx.r3.id, clientRequestId: reqId() } })).body.error, "participant_not_eligible");
  Object.assign(fake.tables.artfestFair[0], { inventoryDeadlineAt: new Date(Date.now() - 86400000) });
  const late = await call("POST", ADD, { as: ctx.admin, body: { ...body, clientRequestId: reqId() } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "inventory_locked");
});

test("etichetă fără preț cu cod AF (fără acceptare 2.0.0); eticheta de produs cu „Preț: ______ lei”, codul AF și QR de promovare", async () => {
  const added = await call("POST", ADD, { as: ctx.admin, body: { registrationId: ctx.r1.id, title: "Glob pictat", priceRon: "30", declaredQty: 2, clientRequestId: reqId() } });
  const id = added.body.item.id;
  const line = inv(id);

  // participantul e pe COMMISSION (fără acceptare 2.0.0): eticheta fără preț e permisă
  assert.equal(fake.tables.artfestFairRegistration.find((r) => r.id === ctx.r1.id).pricingModel ?? "COMMISSION", "COMMISSION");
  // QR Artfest: participantul rămâne obligatoriu (proprietarul produsului)
  assert.equal((await pdf({ kind: "artfest", inventoryItemId: id, copies: 1 })).body.error, "participant_not_eligible");
  // produsul altui participant: refuzat
  assert.equal((await pdf({ kind: "artfest", registrationId: ctx.r2.id, inventoryItemId: id, copies: 1 })).body.error, "inventory_item_not_found");

  const r = await pdf({ kind: "store", registrationId: ctx.r1.id, serviceId: ctx.sA2.id, inventoryItemId: id, copies: 3 });
  assert.equal(r.status, 200, r.text);
  const { html } = rendered.at(-1);
  assert.equal(cells(html), 3); // aceeași linie, același cod AF pe toate exemplarele
  assert.equal((html.match(new RegExp(labels.formatLabelCode(line.barcode), "g")) || []).length, 3);
  assert.ok(html.includes('class="barcode"'));
  assert.ok(html.includes("Glob pictat"));
  assert.ok(html.includes(`Preț: <span class="blankLine"></span> lei`));
  assert.doesNotMatch(html, /\d+(,\d+)? lei/); // niciun preț tipărit
  assert.ok(html.includes(labels.storeQrSvg("https://www.artfest.ro/magazin/ana-decor"))); // QR de promovare
  // aceeași etichetă de produs (format + așezare) ca etichetele cu preț
  assert.ok(html.replace(/\s+/g, " ").includes(promo.promoSheetCss().replace(/\s+/g, " ")));
  // eticheta e marcată: există, fără preț
  assert.ok(inv(id).labelGeneratedAt);
  assert.equal(inv(id).labelPriceCents, null);
  const ev = fake.tables.artfestFairInventoryEvent.filter((e) => e.inventoryItemId === id && e.type === "LABEL_GENERATED").at(-1);
  assert.deepEqual(ev.after, { labelPriceCents: null, blankPrice: true, copies: 3 });
});

test("POS cu eticheta fără preț: scanarea AF nu vinde; prețul introdus => o vânzare 10% / 90%, stocul scade, suma apare la vânzător", async () => {
  acceptNewRule(ctx.r1);
  const added = await call("POST", ADD, { as: ctx.admin, body: { registrationId: ctx.r1.id, title: "Felicitare", priceRon: "20", declaredQty: 4, clientRequestId: reqId() } });
  const id = added.body.item.id;
  assert.equal((await pdf({ kind: "artfest", registrationId: ctx.r1.id, inventoryItemId: id, copies: 4 })).status, 200);
  // recepția (regula existentă): până atunci nu se vinde
  let preview = await call("POST", `${POS}/preview`, { as: ctx.admin, body: { lines: [{ inventoryItemId: id, quantity: 1, effectiveUnitPriceCents: 2500 }] } });
  assert.ok(preview.body.problems[0].reasons.includes("not_received"));
  Object.assign(inv(id), { status: "RECEIVED", receivedQty: 4, availableQty: 4, receivedAt: new Date() });

  const scan = await call("GET", `${POS}/scan?barcode=${inv(id).barcode}`, { as: ctx.admin });
  assert.equal(scan.status, 200, scan.text);
  assert.equal(scan.body.item.vendor.id, ctx.v1.id);
  assert.equal(scan.body.item.blankPriceLabel, true);
  assert.equal(scan.body.item.requiresPrice, true);
  assert.equal(scan.body.item.sellable, true);
  assert.equal(fake.tables.artfestFairSale.length, 0); // scanarea singură nu vinde

  const key = "promo-pos-key-0001";
  const noPrice = await call("POST", `${POS}/sales`, { as: ctx.admin, key, body: { lines: [{ inventoryItemId: id, quantity: 1 }], paymentMethod: "CASH" } });
  assert.equal(noPrice.status, 409);
  assert.ok(noPrice.body.problems[0].reasons.includes("label_blank_price"));

  // prețul scris pe etichetă, introdus la casă (poate fi și peste prețul declarat; eticheta nu are preț de confirmat)
  const body = { lines: [{ inventoryItemId: id, quantity: 2, effectiveUnitPriceCents: 2500 }], paymentMethod: "CASH" };
  const headers = { as: ctx.admin, body };
  const k2 = "promo-pos-key-0002";
  const [a, b] = await Promise.all([callKey("POST", `${POS}/sales`, k2, headers), callKey("POST", `${POS}/sales`, k2, headers)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(fake.tables.artfestFairSale.length, 1);
  const l = fake.tables.artfestFairSaleLine[0];
  assert.equal(l.lineGrossCents, 5000);
  assert.equal(l.commissionCents, 500);
  assert.equal(l.vendorNetCents, 4500);
  assert.equal(l.pricingModel, "FAIR_PRICE");
  assert.equal(inv(id).availableQty, 2);
  assert.equal(inv(id).soldQty, 2);

  // contul vendorului: suma cuvenită 90%
  const summary = await call("GET", "/api/vendor/artfest-fair/summary", { as: ctx.u1 });
  assert.equal(summary.status, 200, summary.text);
  assert.equal(summary.body.today.sales.grossCents, 5000);
  assert.equal(summary.body.today.net.vendorDueCents, 4500);
});

test("COMMISSION fără acceptare 2.0.0: eticheta fără preț -> scanare, preț obligatoriu, încasare 10% / 90%, stoc; regula neschimbată", async () => {
  const reg = fake.tables.artfestFairRegistration.find((r) => r.id === ctx.r1.id);
  Object.assign(reg, { pricingModel: "COMMISSION", pricingModelAcceptedAt: null, pricingModelTermsVersion: null, pricingModelAcceptedById: null });
  const added = await call("POST", ADD, { as: ctx.admin, body: { registrationId: ctx.r1.id, title: "Ornament", priceRon: "15", declaredQty: 2, clientRequestId: reqId() } });
  const id = added.body.item.id;
  assert.equal((await pdf({ kind: "artfest", registrationId: ctx.r1.id, inventoryItemId: id, copies: 2 })).status, 200);
  Object.assign(inv(id), { status: "RECEIVED", receivedQty: 2, availableQty: 2, receivedAt: new Date() });
  const sales = fake.tables.artfestFairSale.length;
  const scan = await call("GET", `${POS}/scan?barcode=${inv(id).barcode}`, { as: ctx.admin });
  assert.equal(scan.body.item.pricingModel, "COMMISSION");
  assert.equal(scan.body.item.canEditPrice, true);
  assert.equal(scan.body.item.requiresPrice, true);
  assert.equal(scan.body.item.blankPriceLabel, true);
  assert.equal(fake.tables.artfestFairSale.length, sales); // scanarea singură nu vinde
  const noPrice = await call("POST", `${POS}/sales`, { as: ctx.admin, key: "promo-pos-key-0003", body: { lines: [{ inventoryItemId: id, quantity: 1 }], paymentMethod: "CASH" } });
  assert.equal(noPrice.status, 409);
  assert.ok(noPrice.body.problems[0].reasons.includes("label_blank_price"));
  const r = await call("POST", `${POS}/sales`, { as: ctx.admin, key: "promo-pos-key-0004", body: { lines: [{ inventoryItemId: id, quantity: 1, effectiveUnitPriceCents: 1800 }], paymentMethod: "CASH" } });
  assert.equal(r.status, 201, r.text);
  const line = fake.tables.artfestFairSaleLine.find((l) => l.inventoryItemId === id);
  assert.equal(line.pricingModel ?? "COMMISSION", "COMMISSION");
  assert.equal(line.lineGrossCents, 1800);
  assert.equal(line.commissionCents, 180);
  assert.equal(line.vendorNetCents, 1620);
  assert.equal(line.vendorBaseUnitPriceCents ?? null, null); // CHECK-ul existent pentru COMMISSION
  assert.equal(inv(id).availableQty, 1);
  assert.equal(reg.pricingModel, "COMMISSION");
  assert.equal(reg.pricingModelAcceptedAt, null);
});

async function callKey(method, path, key, { as, body }) {
  const headers = { "content-type": "application/json", "Idempotency-Key": key };
  if (as) headers["x-test-user"] = as.id;
  const res = await fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

/* ============================== POS: „Adaugă produs” + „Produse / Etichete” ============================== */

test("POS „Adaugă produs” (pungă de cadou, participant): creare -> listă/căutare -> N etichete cu preț + AF -> recepție -> scanare -> încasare 10% / 90%, stoc", async () => {
  const LABELS = "/api/admin/artfest-fair/inventory/labels.pdf";
  const body = { registrationId: ctx.r1.id, title: "Pungă de cadou mică", priceRon: "4,50", declaredQty: 10, clientRequestId: reqId() };
  // dublu click: două cereri simultane cu același clientRequestId => o singură linie
  const [c1, c2] = await Promise.all([call("POST", ADD, { as: ctx.admin, body }), call("POST", ADD, { as: ctx.admin, body })]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 201]);
  assert.equal(fake.tables.artfestFairInventoryItem.filter((l) => l.titleSnapshot === "Pungă de cadou mică").length, 1);
  const id = c1.body.item.id;
  assert.equal(inv(id).vendorId, ctx.v1.id); // proprietarul ales, fără vendor fictiv
  assert.equal(inv(id).status, "SUBMITTED");
  assert.equal(fake.tables.artfestFairSale.length, 0); // salvarea nu vinde

  // „Produse / Etichete”: căutare după denumire (fără majuscule) și după codul AF afișat
  const byName = await call("GET", "/api/admin/artfest-fair/inventory?filter=all&q=pung", { as: ctx.admin });
  assert.equal(byName.status, 200, byName.text);
  const found = byName.body.items.find((i) => i.id === id);
  assert.ok(found);
  assert.equal(found.priceCents, 450);
  assert.equal(found.actions.canReceive, true);
  assert.equal(found.actions.canPrintLabel, true);
  const byCode = await call("GET", `/api/admin/artfest-fair/inventory?filter=all&q=${encodeURIComponent(found.barcodeDisplay)}`, { as: ctx.admin });
  assert.deepEqual(byCode.body.items.map((i) => i.id), [id]);

  // etichete: număr ales (3), formatul existent: denumire, preț, cod AF (cod de bare + QR); fără vânzare
  const sheet = await call("POST", LABELS, { as: ctx.admin, body: { ids: [id], copies: 3 } });
  assert.equal(sheet.status, 200, sheet.text);
  const html = rendered.at(-1).html;
  assert.equal(cells(html), 3);
  assert.ok(html.includes("Pungă de cadou mică") && html.includes(labels.formatLabelPrice(450)));
  assert.ok(html.includes(labels.barcodeSvg(inv(id).barcode)) && html.includes(labels.formatLabelCode(inv(id).barcode)));
  assert.equal(inv(id).labelPriceCents, 450);
  // retipărire din listă: aceleași coduri, alt număr
  assert.equal((await call("POST", LABELS, { as: ctx.admin, body: { ids: [id], copies: 1 } })).status, 200);
  assert.equal(cells(rendered.at(-1).html), 1);
  for (const bad of [0, 241, "abc", 2.5]) {
    assert.equal((await call("POST", LABELS, { as: ctx.admin, body: { ids: [id], copies: bad } })).status, 400, String(bad));
  }
  assert.equal(fake.tables.artfestFairSale.length, 0); // tipărirea nu vinde

  // înainte de recepție: scanarea explică starea și nu se poate vinde
  let scan = await call("GET", `${POS}/scan?barcode=${inv(id).barcode}`, { as: ctx.admin });
  assert.equal(scan.body.item.sellable, false);
  assert.ok(scan.body.item.reasons.includes("not_received"));

  // recepția existentă (Idempotency-Key): stocul = bucățile recepționate
  const rec = await call("POST", `/api/admin/artfest-fair/inventory/${id}/receive`, { as: ctx.admin, key: "pos-receive-test-0001", body: { receivedQty: 10 } });
  assert.equal(rec.status, 200, rec.text);
  assert.equal(inv(id).availableQty, 10);
  scan = await call("GET", `${POS}/scan?barcode=${inv(id).barcode}`, { as: ctx.admin });
  assert.equal(scan.body.item.sellable, true);
  assert.equal(scan.body.item.requiresPrice, false); // eticheta are prețul curent
  assert.equal(scan.body.item.vendor.id, ctx.v1.id);
  assert.equal(fake.tables.artfestFairSale.length, 0);

  // încasarea: 3 bucăți la prețul de pe etichetă => 13,50 lei; 10% Artfest / 90% participant
  const sale = await call("POST", `${POS}/sales`, { as: ctx.admin, key: "pos-prod-sale-0001", body: { lines: [{ inventoryItemId: id, quantity: 3 }], paymentMethod: "CARD" } });
  assert.equal(sale.status, 201, sale.text);
  const line = fake.tables.artfestFairSaleLine.find((l) => l.inventoryItemId === id);
  assert.equal(line.vendorId, ctx.v1.id);
  assert.equal(line.lineGrossCents, 1350);
  assert.equal(line.commissionCents, 135);
  assert.equal(line.vendorNetCents, 1215);
  assert.equal(inv(id).availableQty, 7);
  assert.equal(inv(id).soldQty, 3);
});

test("POS „Adaugă produs”: termenul pentru inventar e respectat și semnalat în starea POS (fără ocolire)", async () => {
  let status = await call("GET", `${POS}/status`, { as: ctx.admin });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.body.inventoryOpen, true);
  assert.ok(status.body.inventoryDeadlineAt);
  Object.assign(fake.tables.artfestFair[0], { inventoryDeadlineAt: new Date(Date.now() - 3600000) });
  status = await call("GET", `${POS}/status`, { as: ctx.admin });
  assert.equal(status.body.inventoryOpen, false);
  const late = await call("POST", ADD, { as: ctx.admin, body: { registrationId: ctx.r1.id, title: "Ambalaj", priceRon: "3", declaredQty: 5, clientRequestId: reqId() } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "inventory_locked");
  assert.equal(fake.tables.artfestFairInventoryItem.filter((l) => l.titleSnapshot === "Ambalaj").length, 0);
});
