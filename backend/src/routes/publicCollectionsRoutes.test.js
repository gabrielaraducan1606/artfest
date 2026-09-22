// src/routes/publicCollectionsRoutes.test.js
//
// GET /api/public/collections?placement=homepage|menu|all - fără DB real.
// prisma.collection.findMany / prisma.product.findMany sunt false și aplică
// EFECTIV clauzele `where` trimise de cod (nu întorc tot ce e seedat), ca
// testele să verifice regulile reale: isActive + showOnHomepage/showInMenu
// + "are cel puțin un produs public real".
//
// Rulare: node --experimental-test-module-mocks --test src/routes/publicCollectionsRoutes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5"; // niciodată contactat

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { matchWhere, project } from "../testing/matchWhere.js";

const matches = matchWhere;

function col(overrides = {}) {
  return {
    slug: "col-x",
    title: "Colecție X",
    subtitle: "Subtitlu",
    heroImage: "https://cdn.artfest.ro/x.jpg",
    isActive: true,
    showOnHomepage: false,
    showInMenu: false,
    // câmpuri care NU trebuie să iasă niciodată în răspunsul public
    rules: { categories: ["secret"] },
    items: [],
    promoPercent: 30,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function prod(overrides = {}) {
  return {
    id: "p1",
    category: "secret",
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    priceCents: 1000,
    service: {
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true },
      type: { code: "products" },
    },
    ...overrides,
  };
}

// implicit: un produs public care se potrivește regulii {categories:["secret"]}
async function fetchList(rows, query = "", products = [prod()]) {
  const calls = [];
  const productCalls = [];

  const db = {
    collection: {
      findMany: async (args) => {
        calls.push(args);
        const { where, select, take } = args;
        return rows
          .filter((r) => matches(r, where))
          .slice(0, take)
          .map((r) =>
            Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]))
          );
      },
    },
    product: {
      findMany: async (args) => {
        productCalls.push(args);
        return products
          .filter((p) => matches(p, args.where))
          .map((p) => project(p, args.select));
      },
    },
  };

  const restore = mock.module("../db.js", { namedExports: { prisma: db } });
  const mod = await import(
    `./publicCollectionsRoutes.js?t=${Date.now()}-${Math.random()}`
  );

  const app = express();
  app.use("/api/public", mod.default);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/public/collections${query}`
  );
  const body = await res.json();

  return {
    status: res.status,
    body,
    calls,
    productCalls,
    headers: res.headers,
    cleanup: async () => {
      await new Promise((resolve) => server.close(resolve));
      restore.restore();
    },
  };
}

/* ---------- reguli de includere (activ + flag) ---------- */

test("homepage: colecție activă cu showOnHomepage=true apare", async (t) => {
  const { body, cleanup } = await fetchList(
    [col({ slug: "nunta", title: "Nuntă", showOnHomepage: true })],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(
    body.items.map((c) => c.slug),
    ["nunta"]
  );
});

test("homepage: NU apare dacă showOnHomepage=false", async (t) => {
  const { body, cleanup } = await fetchList(
    [col({ slug: "doar-meniu", showOnHomepage: false, showInMenu: true })],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("homepage: NU apare dacă e inactivă, chiar cu showOnHomepage=true", async (t) => {
  const { body, cleanup } = await fetchList(
    [col({ slug: "inactiva", isActive: false, showOnHomepage: true })],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("menu: doar colecții active cu showInMenu=true", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({ slug: "in-meniu", showInMenu: true }),
      col({ slug: "meniu-inactiva", showInMenu: true, isActive: false }),
      col({ slug: "doar-home", showOnHomepage: true }),
    ],
    "?placement=menu"
  );
  t.after(cleanup);

  assert.deepEqual(
    body.items.map((c) => c.slug),
    ["in-meniu"]
  );
});

test("fără placement: active marcate pentru home SAU meniu, nu toate colecțiile active", async (t) => {
  const { body, cleanup } = await fetchList([
    col({ slug: "home", showOnHomepage: true }),
    col({ slug: "meniu", showInMenu: true }),
    col({ slug: "nicaieri" }), // activă, dar nemarcată nicăieri
    col({ slug: "inactiva", showInMenu: true, isActive: false }),
  ]);
  t.after(cleanup);

  assert.deepEqual(body.items.map((c) => c.slug).sort(), ["home", "meniu"]);
});

test("placement necunoscut e tratat ca lipsă (nu ca 'toate')", async (t) => {
  const { body, cleanup } = await fetchList(
    [col({ slug: "nicaieri" })],
    "?placement=altceva"
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("placement=all: toate colecțiile ACTIVE (pagina /colectii), fără cele inactive", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({ slug: "a" }),
      col({ slug: "b", showInMenu: true }),
      col({ slug: "inactiva", isActive: false }),
    ],
    "?placement=all"
  );
  t.after(cleanup);

  assert.deepEqual(body.items.map((c) => c.slug).sort(), ["a", "b"]);
});

/* ---------- colecții fără produse reale ---------- */

test("colecție activă cu showOnHomepage dar 0 produse care se potrivesc => NU apare", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({
        slug: "goala",
        showOnHomepage: true,
        rules: { categories: ["nicio-categorie"] },
      }),
    ],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("produsele nepublice nu contează: inactiv / ascuns / neaprobat / magazin inactiv => colecția e goală", async (t) => {
  const notPublic = [
    prod({ id: "a", isActive: false }),
    prod({ id: "b", isHidden: true }),
    prod({ id: "c", moderationStatus: "PENDING" }),
    prod({
      id: "d",
      service: {
        isActive: false,
        status: "ACTIVE",
        vendor: { isActive: true },
        type: { code: "products" },
      },
    }),
    prod({
      id: "e",
      service: {
        isActive: true,
        status: "ACTIVE",
        vendor: { isActive: false },
        type: { code: "products" },
      },
    }),
  ];

  const { body, cleanup } = await fetchList(
    [col({ slug: "doar-nepublice", showOnHomepage: true })],
    "?placement=homepage",
    notPublic
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("produs fixat (pinned) public numără chiar dacă regulile nu se potrivesc", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({
        slug: "cu-pinned",
        showOnHomepage: true,
        rules: { categories: ["nicio-categorie"] },
        items: [{ productId: "pin-1", pinned: true, excluded: false }],
      }),
    ],
    "?placement=homepage",
    [prod({ id: "pin-1", category: "alta" })]
  );
  t.after(cleanup);

  assert.deepEqual(
    body.items.map((c) => c.slug),
    ["cu-pinned"]
  );
});

test("produs fixat dar NEpublic nu ține colecția în listă", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({
        slug: "pinned-ascuns",
        showOnHomepage: true,
        rules: { categories: ["nicio-categorie"] },
        items: [{ productId: "pin-1", pinned: true, excluded: false }],
      }),
    ],
    "?placement=homepage",
    [prod({ id: "pin-1", category: "alta", isHidden: true })]
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("singurul produs care se potrivește e exclus manual => colecția e goală", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({
        slug: "exclus",
        showOnHomepage: true,
        items: [{ productId: "p1", pinned: false, excluded: true }],
      }),
    ],
    "?placement=homepage",
    [prod({ id: "p1" })]
  );
  t.after(cleanup);

  assert.deepEqual(body.items, []);
});

test("colecție fără reguli (rules={}) cu produse publice în catalog => are produse", async (t) => {
  const { body, cleanup } = await fetchList(
    [col({ slug: "toate", showOnHomepage: true, rules: {} })],
    "?placement=homepage",
    [prod({ id: "x", category: "orice" })]
  );
  t.after(cleanup);

  assert.deepEqual(
    body.items.map((c) => c.slug),
    ["toate"]
  );
});

/* ---------- forma răspunsului ---------- */

test("răspunsul public conține doar slug/title/subtitle/heroImage (fără rules/items)", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({
        slug: "nunta",
        showOnHomepage: true,
        items: [{ productId: "p1", pinned: true, excluded: false }],
      }),
    ],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(Object.keys(body.items[0]).sort(), [
    "heroImage",
    "slug",
    "subtitle",
    "title",
  ]);
  assert.ok(!JSON.stringify(body).includes("secret"));
  assert.ok(!JSON.stringify(body).includes("productId"));
});

test("limită de rânduri pe homepage (12)", async (t) => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    col({ slug: `c-${i}`, showOnHomepage: true })
  );
  const { body, cleanup } = await fetchList(rows, "?placement=homepage");
  t.after(cleanup);

  assert.equal(body.items.length, 12);
});

test("rânduri fără slug/title sunt omise; câmpurile goale devin șir gol", async (t) => {
  const { body, cleanup } = await fetchList(
    [
      col({ slug: "ok", showOnHomepage: true, subtitle: null, heroImage: null }),
      col({ slug: "", showOnHomepage: true }),
      col({ slug: "fara-titlu", title: "", showOnHomepage: true }),
    ],
    "?placement=homepage"
  );
  t.after(cleanup);

  assert.deepEqual(body.items, [
    { slug: "ok", title: "Colecție X", subtitle: "", heroImage: "" },
  ]);
});

/* ---------- fără N+1 ---------- */

test("număr CONSTANT de interogări pe produse, indiferent de câte colecții sunt în răspuns", async (t) => {
  const counts = [];

  for (const n of [1, 12, 60]) {
    const rows = Array.from({ length: n }, (_, i) =>
      col({
        slug: `c-${i}`,
        showOnHomepage: true,
        showInMenu: true,
        items: i % 2 ? [{ productId: "p1", pinned: true, excluded: false }] : [],
      })
    );
    const { productCalls, cleanup } = await fetchList(rows, "?placement=all");
    counts.push(productCalls.length);
    await cleanup();
  }

  assert.ok(counts.every((c) => c <= 2), `interogări pe produse: ${counts}`);
  assert.equal(counts[1], counts[2]);
  t.diagnostic(`interogări pe produse pentru 1/12/60 colecții: ${counts}`);
});
