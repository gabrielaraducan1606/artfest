// Migrare de date VendorCampaign -> VendorCollection (FAZA 1).
// Rulare: node --test src/services/vendorCampaignMigration.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCampaignMigration,
  loadCampaignMigrationInput,
  planCampaignMigration,
} from "./vendorCampaignMigration.js";

const day = (n) => new Date(Date.UTC(2026, 8, n));

function campaign(id, extra = {}) {
  return {
    id,
    vendorId: "vendor-a",
    name: `Campania ${id}`,
    slug: `slug-${id}`,
    isActive: true,
    scope: "ALL_PRODUCTS",
    discountPercent: 10,
    platformFundingBps: 0,
    vendorFundingBps: 10000,
    fundingSource: "VENDOR",
    startsAt: day(1),
    endsAt: day(30),
    visits: 7,
    createdAt: day(1),
    products: [],
    _count: { creatives: 0 },
    ...extra,
  };
}

const owned = (productId, vendorId = "vendor-a", createdAt = day(2)) => ({
  productId,
  createdAt,
  product: { id: productId, service: { vendorId } },
});

/* ---------- fake DB: orice scriere pe tabelele de campanie e interzisă ---------- */

function makeDb({ campaigns = [], collections = [], items = [] } = {}) {
  const state = { campaigns, collections: [...collections], items: [...items], writesToCampaignTables: 0 };
  const forbidden = () => {
    state.writesToCampaignTables += 1;
    throw new Error("scriere interzisă pe tabelele de campanie");
  };

  const db = {
    state,
    vendorCampaign: {
      findMany: async () => state.campaigns.map((c) => ({ ...c })),
      create: forbidden,
      update: forbidden,
      updateMany: forbidden,
      delete: forbidden,
      deleteMany: forbidden,
    },
    vendorCampaignProduct: { deleteMany: forbidden, delete: forbidden },
    vendorCampaignCreative: { deleteMany: forbidden, delete: forbidden },
    shipment: { update: forbidden, updateMany: forbidden },
    vendorCollection: {
      findMany: async () => state.collections.map(({ id, slug, legacyCampaignId }) => ({ id, slug, legacyCampaignId: legacyCampaignId ?? null })),
      findUnique: async ({ where }) => state.collections.find((c) => c.legacyCampaignId === where.legacyCampaignId) || null,
      create: async ({ data }) => {
        if (state.collections.some((c) => c.slug === data.slug)) throw new Error(`unique slug ${data.slug}`);
        if (data.legacyCampaignId && state.collections.some((c) => c.legacyCampaignId === data.legacyCampaignId)) {
          throw new Error(`unique legacyCampaignId ${data.legacyCampaignId}`);
        }
        const row = { id: `col-${state.collections.length + 1}`, ...data };
        state.collections.push(row);
        return { id: row.id, slug: row.slug };
      },
    },
    vendorCollectionItem: {
      createMany: async ({ data, skipDuplicates }) => {
        for (const d of data) {
          const dup = state.items.some((i) => i.collectionId === d.collectionId && i.productId === d.productId);
          if (dup && !skipDuplicates) throw new Error("dup item");
          if (!dup) state.items.push(d);
        }
        return { count: data.length };
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  return db;
}

async function migrate(db) {
  const plan = planCampaignMigration(await loadCampaignMigrationInput(db));
  const applied = await applyCampaignMigration({ db, plan });
  return { plan, applied };
}

/* ---------- mapare ---------- */

test("ALL_PRODUCTS -> allOwnProducts=true, fără listă fixă; câmpurile mapate 1:1", async () => {
  const db = makeDb({ campaigns: [campaign("c1")] });
  const { plan, applied } = await migrate(db);

  assert.equal(plan.toCreate, 1);
  assert.equal(applied.created, 1);

  const [col] = db.state.collections;
  assert.deepEqual(
    {
      vendorId: col.vendorId, title: col.title, slug: col.slug, isActive: col.isActive, discountPercent: col.discountPercent,
      startsAt: col.startsAt, endsAt: col.endsAt, allOwnProducts: col.allOwnProducts, legacyCampaignId: col.legacyCampaignId,
      visits: col.visits, createdAt: col.createdAt, description: col.description, coverImage: col.coverImage,
    },
    {
      vendorId: "vendor-a", title: "Campania c1", slug: "slug-c1", isActive: true, discountPercent: 10,
      startsAt: day(1), endsAt: day(30), allOwnProducts: true, legacyCampaignId: "c1",
      visits: 7, createdAt: day(1), description: null, coverImage: null,
    }
  );
  assert.equal(db.state.items.length, 0, "ALL_PRODUCTS nu snapshotează produse");
});

test("SELECTED_PRODUCTS -> VendorCollectionItem în ordinea adăugării; allOwnProducts=false", async () => {
  const db = makeDb({
    campaigns: [campaign("c2", { scope: "SELECTED_PRODUCTS", products: [owned("p2", "vendor-a", day(5)), owned("p1", "vendor-a", day(3))] })],
  });
  await migrate(db);

  const [col] = db.state.collections;
  assert.equal(col.allOwnProducts, false);
  assert.deepEqual(db.state.items, [
    { collectionId: col.id, productId: "p1", position: 0 },
    { collectionId: col.id, productId: "p2", position: 1 },
  ]);
});

test("campanii inactive / expirate / fără date se migrează exact cum sunt", async () => {
  const db = makeDb({
    campaigns: [
      campaign("off", { isActive: false }),
      campaign("expired", { endsAt: day(2), startsAt: day(1) }),
      campaign("open", { startsAt: null, endsAt: null, discountPercent: 0 }),
    ],
  });
  await migrate(db);

  const by = Object.fromEntries(db.state.collections.map((c) => [c.legacyCampaignId, c]));
  assert.equal(by.off.isActive, false);
  assert.deepEqual([by.expired.startsAt, by.expired.endsAt], [day(1), day(2)]);
  assert.deepEqual([by.open.startsAt, by.open.endsAt, by.open.discountPercent], [null, null, 0]);
});

/* ---------- idempotență ---------- */

test("idempotent: a doua rulare nu creează nimic și nu dublează produse", async () => {
  const db = makeDb({
    campaigns: [campaign("c1"), campaign("c2", { scope: "SELECTED_PRODUCTS", products: [owned("p1")] })],
  });

  const first = await migrate(db);
  const second = await migrate(db);
  const third = await migrate(db);

  assert.equal(first.applied.created, 2);
  for (const run of [second, third]) {
    assert.equal(run.plan.toCreate, 0);
    assert.equal(run.plan.alreadyMigrated, 2);
    assert.equal(run.applied.created, 0);
  }
  assert.equal(db.state.collections.length, 2);
  assert.equal(db.state.items.length, 1);
});

test("idempotent: o colecție migrată și EDITATA ulterior nu e suprascrisă", async () => {
  const db = makeDb({ campaigns: [campaign("c1")] });
  await migrate(db);
  db.state.collections[0].title = "Titlu editat de vendor";
  db.state.collections[0].discountPercent = 0;

  await migrate(db);
  assert.equal(db.state.collections[0].title, "Titlu editat de vendor");
  assert.equal(db.state.collections[0].discountPercent, 0);
});

test("idempotent și la cursă: dacă între plan și aplicare colecția apare, tranzacția o sare", async () => {
  const db = makeDb({ campaigns: [campaign("c1")] });
  const plan = planCampaignMigration(await loadCampaignMigrationInput(db));
  db.state.collections.push({ id: "col-concurent", slug: "slug-c1", legacyCampaignId: "c1" });

  const applied = await applyCampaignMigration({ db, plan });
  assert.equal(applied.created, 0);
  assert.equal(applied.results[0].result, "SKIPPED");
  assert.equal(db.state.collections.length, 1);
});

/* ---------- coliziuni de slug ---------- */

test("coliziune de slug cu o colecție existentă -> „-colectie”, raportată", async () => {
  const db = makeDb({
    campaigns: [campaign("c1", { slug: "toamna" })],
    collections: [{ id: "x", slug: "toamna", legacyCampaignId: null }],
  });
  const { plan } = await migrate(db);

  assert.deepEqual(plan.slugCollisions, [{ campaignSlug: "toamna", collectionSlug: "toamna-colectie" }]);
  assert.ok(plan.warnings.some((w) => w.includes("SLUG_COLLISION")));
  assert.equal(db.state.collections.find((c) => c.legacyCampaignId === "c1").slug, "toamna-colectie");
});

test("coliziune dublă -> sufix cu id-ul campaniei; slug-uri unice garantate", async () => {
  const db = makeDb({
    campaigns: [campaign("abc123", { slug: "toamna" })],
    collections: [
      { id: "x", slug: "toamna", legacyCampaignId: null },
      { id: "y", slug: "toamna-colectie", legacyCampaignId: null },
    ],
  });
  await migrate(db);
  assert.equal(db.state.collections.find((c) => c.legacyCampaignId === "abc123").slug, "toamna-colectie-abc123");
});

/* ---------- validări / avertismente ---------- */

test("SELECTED: produs inexistent sau al altui vendor -> sărit, cu avertisment", async () => {
  const db = makeDb({
    campaigns: [
      campaign("c3", {
        scope: "SELECTED_PRODUCTS",
        products: [owned("p1"), owned("p-other", "vendor-b"), { productId: "p-gone", createdAt: day(4), product: null }],
      }),
    ],
  });
  const { plan } = await migrate(db);

  assert.deepEqual(db.state.items.map((i) => i.productId), ["p1"]);
  assert.ok(plan.warnings.some((w) => w.includes("PRODUCT_NOT_OWNED: p-other")));
  assert.ok(plan.warnings.some((w) => w.includes("PRODUCT_MISSING: p-gone")));
});

test("avertismente: finanțare SHARED, creative nemigrate, discount peste plafon, titlu lung", async () => {
  const db = makeDb({
    campaigns: [
      campaign("shared", { fundingSource: "SHARED", platformFundingBps: 5000 }),
      campaign("creat", { _count: { creatives: 3 } }),
      campaign("big", { discountPercent: 80 }),
      campaign("long", { name: "x".repeat(300) }),
    ],
  });
  const { plan } = await migrate(db);
  const by = Object.fromEntries(db.state.collections.map((c) => [c.legacyCampaignId, c]));

  assert.ok(plan.warnings.some((w) => w.startsWith("slug-shared: FUNDING_NOT_VENDOR")));
  assert.ok(plan.warnings.some((w) => w.startsWith("slug-creat: CREATIVES_NOT_MIGRATED: 3")));
  assert.ok(plan.warnings.some((w) => w.startsWith("slug-big: DISCOUNT_CLAMPED: 80% -> 50%")));
  assert.equal(by.big.discountPercent, 50);
  assert.equal(by.long.title.length, 160);
});

test("NU scrie nimic pe VendorCampaign / produse / creative / Shipment", async () => {
  const db = makeDb({
    campaigns: [campaign("c1"), campaign("c2", { scope: "SELECTED_PRODUCTS", products: [owned("p1")] })],
  });
  await migrate(db);
  await migrate(db);
  assert.equal(db.state.writesToCampaignTables, 0);
  assert.equal(db.state.campaigns.length, 2, "campaniile rămân");
});

test("dry-run (doar plan) nu scrie nimic", async () => {
  const db = makeDb({ campaigns: [campaign("c1")] });
  const plan = planCampaignMigration(await loadCampaignMigrationInput(db));
  assert.equal(plan.toCreate, 1);
  assert.equal(db.state.collections.length, 0);
});
