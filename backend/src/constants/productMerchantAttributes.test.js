// src/constants/productMerchantAttributes.test.js
//
// Teste pure (fără DB/mock) pentru helperul comun feed + JSON-LD și pentru
// mapping-ul central Google Product Category.
//
// Rulare: node --test src/constants/productMerchantAttributes.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVAILABILITY_NEEDS_DATE,
  availabilityToGoogle,
  availabilityToSchemaOrg,
  buildMerchantPrice,
  buildProductMerchantAttributes,
  collectProductImageUrls,
  getCategoryLabel,
  getColorLabel,
  getMaterialLabel,
  resolveCanonicalMaterial,
  MAX_ADDITIONAL_IMAGES,
} from "./productMerchantAttributes.js";
import {
  GOOGLE_PRODUCT_CATEGORY_BY_CATEGORY,
  getGoogleProductCategoryId,
} from "./googleProductCategories.js";
import { CATEGORIES } from "./categories.js";
import { COLORS } from "./colors.js";
import { MATERIALS, MATERIAL_LABELS } from "./materials.js";

/* ---------- color / material ---------- */

test("getColorLabel: cheie canonică -> label; null/gol/slug necunoscut -> null", () => {
  assert.equal(getColorLabel("grey_light"), "Gri deschis");
  assert.equal(getColorLabel("multicolor"), "Multicolor");
  assert.equal(getColorLabel(null), null);
  assert.equal(getColorLabel(""), null);
  assert.equal(getColorLabel("   "), null);
  assert.equal(getColorLabel("culoare_necunoscuta"), null);
});

test("getColorLabel: nicio culoare canonică nu produce slug sau separator '/' în output", () => {
  for (const key of COLORS) {
    const label = getColorLabel(key);
    assert.ok(label, `culoarea ${key} trebuie să aibă label`);
    assert.ok(!label.includes("/"), `${key} -> ${label}`);
    assert.ok(!label.includes("_"), `${key} -> ${label}`);
  }
});

test("getColorLabel: acceptă și label salvat istoric (cu/fără diacritice)", () => {
  assert.equal(getColorLabel("Roșu"), "Roșu");
  assert.equal(getColorLabel("rosu"), "Roșu");
});

test("getColorLabel: text uman necunoscut e păstrat (nu e slug)", () => {
  assert.equal(getColorLabel("roz-portocaliu"), "roz-portocaliu");
});

test("getMaterialLabel: cheie canonică -> label; toate materialele canonice au label uman", () => {
  assert.equal(getMaterialLabel("wax_soy"), "Ceară de soia");
  for (const key of MATERIALS) {
    assert.equal(getMaterialLabel(key), MATERIAL_LABELS[key]);
  }
  assert.equal(getMaterialLabel(null), null);
  assert.equal(getMaterialLabel("material_inexistent"), null);
});

test("resolveCanonicalMaterial: cheie / label / fără diacritice -> {key,label}; necunoscut -> null", () => {
  const expected = { key: "wax_soy", label: "Ceară de soia" };
  assert.deepEqual(resolveCanonicalMaterial("wax_soy"), expected);
  assert.deepEqual(resolveCanonicalMaterial("Ceară de soia"), expected);
  assert.deepEqual(resolveCanonicalMaterial("  ceara de soia "), expected);
  assert.equal(resolveCanonicalMaterial("argint 925"), null);
  assert.equal(resolveCanonicalMaterial(""), null);
  assert.equal(resolveCanonicalMaterial(undefined), null);
});

/* ---------- categorie ---------- */

test("getCategoryLabel: ierarhic 'Grup > Categorie', fără slug", () => {
  assert.equal(
    getCategoryLabel("home_lumanari-parfumate"),
    "Home & lifestyle handmade > Lumânări parfumate"
  );
  assert.equal(getCategoryLabel("alte"), "Altele");
  assert.equal(getCategoryLabel("categorie_inexistenta"), null);
  assert.equal(getCategoryLabel(null), null);
  assert.equal(getCategoryLabel(""), null);
});

test("getCategoryLabel: fiecare categorie din catalog are label și nu expune slug-ul", () => {
  for (const key of CATEGORIES) {
    const label = getCategoryLabel(key);
    assert.ok(label, `categoria ${key} trebuie să aibă label`);
    assert.ok(
      !label.includes(key),
      `label-ul nu trebuie să conțină slug-ul ${key}`
    );
  }
});

/* ---------- mapping Google Product Category ---------- */

test("mapping Google: fiecare cheie există în CATEGORIES și ID-ul e întreg pozitiv", () => {
  const known = new Set(CATEGORIES);

  for (const [key, entry] of Object.entries(
    GOOGLE_PRODUCT_CATEGORY_BY_CATEGORY
  )) {
    assert.ok(known.has(key), `cheie necunoscută în mapping: ${key}`);
    assert.ok(
      Number.isInteger(entry.id) && entry.id > 0,
      `ID invalid pentru ${key}`
    );
    assert.ok(
      typeof entry.path === "string" && entry.path.includes(">"),
      `path lipsă pentru ${key}`
    );
  }
});

test("mapping Google: categorii mapate/nemapate/ambigue", () => {
  assert.equal(getGoogleProductCategoryId("bijuterii_bratari"), 191);
  assert.equal(getGoogleProductCategoryId("home_lumanari-parfumate"), 588);
  assert.equal(getGoogleProductCategoryId("decor_lumanari-decor"), null);
  assert.equal(getGoogleProductCategoryId("alte"), null);
  assert.equal(getGoogleProductCategoryId(null), null);
  assert.equal(getGoogleProductCategoryId("__proto__"), null);
  assert.equal(getGoogleProductCategoryId("constructor"), null);
});

/* ---------- imagini ---------- */

test("collectProductImageUrls: dedupe, invalide, ordine, resolveUrl", () => {
  const resolveUrl = (u) => (u.startsWith("/") ? `https://x.ro${u}` : u);

  assert.deepEqual(
    collectProductImageUrls(
      [
        "/a.jpg",
        "https://x.ro/a.jpg",
        "https://y.ro/b.jpg",
        "",
        "data:image/png;base64,AA",
        "ftp://x/y.jpg",
        "https://y.ro/has space.jpg",
        undefined,
      ],
      { resolveUrl }
    ),
    ["https://x.ro/a.jpg", "https://y.ro/b.jpg"]
  );

  assert.deepEqual(collectProductImageUrls(null), []);
  assert.deepEqual(collectProductImageUrls("nu-e-array"), []);
});

/* ---------- consistență feed <-> JSON-LD ---------- */

test("buildProductMerchantAttributes: aceleași valori pentru feed și JSON-LD (același helper)", () => {
  const product = {
    category: "bijuterii_coliere",
    color: "gold",
    materialMain: "metal_silver",
    images: [
      "https://cdn.artfest.ro/1.jpg",
      "https://cdn.artfest.ro/2.jpg",
      "https://cdn.artfest.ro/1.jpg",
    ],
  };

  // feed: absoluteUrl(BASE_URL); JSON-LD: resolveFileUrl(+origin) - pe URL-uri
  // deja absolute ambele sunt identitate, deci trebuie să coincidă.
  const forFeed = buildProductMerchantAttributes(product, {
    resolveUrl: (u) => u,
  });
  const forJsonLd = buildProductMerchantAttributes(product, {
    resolveUrl: (u) => `${u}`,
  });

  assert.deepEqual(forFeed, forJsonLd);
  assert.equal(forFeed.color, "Auriu");
  assert.equal(forFeed.material, "Argint");
  assert.equal(forFeed.productType, "Bijuterii & accesorii > Coliere");
  assert.equal(forFeed.googleProductCategory, 196);
  assert.equal(forFeed.image, "https://cdn.artfest.ro/1.jpg");
  assert.deepEqual(forFeed.additionalImages, ["https://cdn.artfest.ro/2.jpg"]);
  assert.deepEqual(forFeed.images, [
    "https://cdn.artfest.ro/1.jpg",
    "https://cdn.artfest.ro/2.jpg",
  ]);
});

test("buildProductMerchantAttributes: produs gol/null nu aruncă și nu inventează date", () => {
  for (const product of [null, undefined, {}]) {
    const attrs = buildProductMerchantAttributes(product);
    assert.equal(attrs.color, null);
    assert.equal(attrs.material, null);
    assert.equal(attrs.productType, null);
    assert.equal(attrs.googleProductCategory, null);
    assert.equal(attrs.image, null);
    assert.deepEqual(attrs.additionalImages, []);
  }
});

test("buildProductMerchantAttributes: additionalImages limitat la MAX_ADDITIONAL_IMAGES", () => {
  const images = Array.from(
    { length: MAX_ADDITIONAL_IMAGES + 5 },
    (_, i) => `https://cdn.artfest.ro/${i}.jpg`
  );
  const attrs = buildProductMerchantAttributes({ images });
  assert.equal(attrs.additionalImages.length, MAX_ADDITIONAL_IMAGES);
  assert.ok(!attrs.additionalImages.includes(attrs.image));
});

/* ---------- disponibilitate (feed + JSON-LD) ---------- */

test("availability: aceeași tabelă pentru Google și schema.org", () => {
  const table = {
    READY: ["in stock", "https://schema.org/InStock"],
    MADE_TO_ORDER: ["in stock", "https://schema.org/InStock"],
    PREORDER: ["preorder", "https://schema.org/PreOrder"],
    SOLD_OUT: ["out of stock", "https://schema.org/OutOfStock"],
  };

  for (const [value, [google, schema]] of Object.entries(table)) {
    assert.equal(availabilityToGoogle(value), google, value);
    assert.equal(availabilityToSchemaOrg(value), schema, value);
  }

  // valori necunoscute/lipsă: același fallback ca înainte (in stock)
  assert.equal(availabilityToGoogle(undefined), "in stock");
  assert.equal(availabilityToSchemaOrg("ceva"), "https://schema.org/InStock");
});

test("availability: doar PREORDER cere availability_date", () => {
  assert.deepEqual([...AVAILABILITY_NEEDS_DATE], ["PREORDER"]);
});

/* ---------- preț feed (price / sale_price / interval) ---------- */

const T0 = "2026-10-01T00:00:00.000Z";
const T1 = "2026-10-10T23:59:59.000Z";

function promo(overrides = {}) {
  return {
    hasDiscount: true,
    finalPriceCents: 8000,
    discount: { startsAt: T0, endsAt: T1 },
    ...overrides,
  };
}

test("buildMerchantPrice: fără pricing/promo => doar price", () => {
  for (const pricing of [undefined, null, {}, { hasDiscount: false, finalPriceCents: 10000 }]) {
    assert.deepEqual(
      buildMerchantPrice({ priceCents: 10000, currency: "RON", pricing }),
      { price: "100.00 RON", salePrice: null, salePriceEffectiveDate: null }
    );
  }
});

test("buildMerchantPrice: promo activă cu interval valid => sale_price + interval ISO fără ms", () => {
  assert.deepEqual(
    buildMerchantPrice({ priceCents: 10000, currency: "RON", pricing: promo() }),
    {
      price: "100.00 RON",
      salePrice: "80.00 RON",
      salePriceEffectiveDate: "2026-10-01T00:00:00Z/2026-10-10T23:59:59Z",
    }
  );
});

test("buildMerchantPrice: interval incomplet sau invalid => sale_price fără interval", () => {
  const cases = [
    { startsAt: null, endsAt: T1 },
    { startsAt: T0, endsAt: null },
    { startsAt: null, endsAt: null },
    { startsAt: "nu-e-data", endsAt: T1 },
    { startsAt: T1, endsAt: T0 }, // start după end
    { startsAt: T0, endsAt: T0 }, // interval gol
  ];

  for (const discount of cases) {
    const out = buildMerchantPrice({
      priceCents: 10000,
      currency: "RON",
      pricing: promo({ discount }),
    });
    assert.equal(out.salePrice, "80.00 RON", JSON.stringify(discount));
    assert.equal(out.salePriceEffectiveDate, null, JSON.stringify(discount));
  }
});

test("buildMerchantPrice: sale_price invalid (>= preț, 0, NaN) => omis", () => {
  for (const finalPriceCents of [10000, 12000, 0, -5, NaN, undefined]) {
    const out = buildMerchantPrice({
      priceCents: 10000,
      currency: "RON",
      pricing: promo({ finalPriceCents }),
    });
    assert.equal(out.salePrice, null, String(finalPriceCents));
    assert.equal(out.salePriceEffectiveDate, null, String(finalPriceCents));
  }
});

test("buildMerchantPrice: moneda produsului; fallback RON", () => {
  assert.equal(
    buildMerchantPrice({ priceCents: 500, currency: "EUR", pricing: promo({ finalPriceCents: 400 }) })
      .salePrice,
    "4.00 EUR"
  );
  assert.equal(buildMerchantPrice({ priceCents: 500 }).price, "5.00 RON");
});
