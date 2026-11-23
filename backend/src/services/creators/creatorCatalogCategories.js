// src/services/creators/creatorCatalogCategories.js
//
// Categoriile de produse din Artfest Creators („Ce categorii de produse ai dori
// să promovezi?”) = TOATE categoriile active din catalogul oficial Artfest, fără
// listă separată și fără condiții legate de produsele publicate:
//   - sursa oficială: constants/categories.js - aceleași chei și etichete ca
//     Product.category, ca filtrele catalogului (GET /api/public/categories) și
//     ca validarea la adăugarea produsului (CATEGORY_SET);
//   - „activă” = cheia face parte din CATEGORIES (lista categoriilor de produs
//     acceptate de catalog). O etichetă rămasă fără cheie validă (ex. „cadouri”
//     simplu) nu e o categorie de produs și nu apare;
//   - o categorie apare chiar dacă are zero produse; una nouă adăugată în
//     catalog apare automat; gruparea e cea oficială (group / groupLabel).
// Structura categoriilor din marketplace nu se modifică aici.

import { CATEGORIES_DETAILED, CATEGORY_GROUP_LABELS, CATEGORY_LABELS, CATEGORY_SET } from "../../constants/categories.js";

/** Opțiunile formularului: categoriile active din catalog, în ordinea și gruparea oficială. */
export function creatorCategoryOptions() {
  return CATEGORIES_DETAILED.filter((c) => CATEGORY_SET.has(c.key)).map((c) => ({
    value: c.key,
    label: c.label,
    group: c.group,
    groupLabel: c.groupLabel,
  }));
}

/** Eticheta oricărei valori salvate: categorie din catalog sau grupă veche (selecții anterioare). */
export function creatorCategoryLabel(key) {
  const value = String(key || "");
  return CATEGORY_GROUP_LABELS[value] || CATEGORY_LABELS[value] || value;
}

/** Etichetele valorilor care pot exista în profiluri (o cheie de grupă veche => numele grupei). */
export function creatorCategoryLabels() {
  return { ...CATEGORY_LABELS, ...CATEGORY_GROUP_LABELS };
}

/** O valoare nouă e acceptată la salvare doar dacă e o categorie activă a catalogului. */
export function isCatalogCategoryKey(key) {
  return CATEGORY_SET.has(String(key || ""));
}
