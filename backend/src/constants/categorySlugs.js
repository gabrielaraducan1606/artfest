// backend/src/constants/categorySlugs.js
//
// Slug-urile PAGINILOR de categorie /categorii/:slug, ca sitemap.xml să
// listeze exact URL-urile pe care le rezolvă frontend-ul.
//
// Frontend-ul (frontend/src/constants/seoCategories.js) calculează slug-ul
// din LABEL (slugify(label)); sitemap-ul folosea înainte cheia categoriei
// fără prefixul de grup (ex. "decor_lumanari-decor" -> "lumanari-decor"),
// deci 52 din 125 de URL-uri din sitemap nu existau ca pagini (redirect la
// /produse), iar 52 de pagini reale lipseau din sitemap. Replicăm aici
// algoritmul frontend-ului; testul din sitemap.test.js compară rezultatul
// cu frontend-ul real și pică dacă cele două se desincronizează.

import { CATEGORIES, CATEGORY_LABELS } from "./categories.js";

export function slugifyCategoryLabel(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș/g, "s")
    .replace(/ş/g, "s")
    .replace(/ț/g, "t")
    .replace(/ţ/g, "t")
    .toLowerCase()
    .replace(/&/g, "si")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Categorii care NU au pagină /categorii/:slug în frontend:
//  - "alte": fallback, nu categorie de navigare;
//  - cele două existente doar în backend (lipsesc din
//    frontend/src/constants/productscategories.js). Dacă frontend-ul le
//    adaugă, testul din sitemap.test.js cere scoaterea lor de aici.
export const CATEGORIES_WITHOUT_PAGE = new Set([
  "alte",
  "cadouri_1-iunie",
  "cadouri_final-an-scolar",
]);

// Eticheta din frontend diferă de cea din backend pentru o categorie și
// slug-ul din frontend e cel real.
const FRONTEND_LABEL_OVERRIDES = {
  decor_centrepieces: "Piese centrale",
};

export function getCategoryPageSlug(key) {
  if (CATEGORIES_WITHOUT_PAGE.has(key)) return null;

  const label = FRONTEND_LABEL_OVERRIDES[key] || CATEGORY_LABELS[key];
  return slugifyCategoryLabel(label) || null;
}

/** Slug-urile unice ale paginilor de categorie, în ordinea catalogului. */
export function getCategoryPageSlugs() {
  const seen = new Set();
  const slugs = [];

  for (const key of CATEGORIES) {
    const slug = getCategoryPageSlug(key);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }

  return slugs;
}
