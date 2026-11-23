// backend/src/lib/creatorCategorySelection.js
//
// Selecția de categorii a unui profil Artfest Creators (CreatorProfile.preferredCategories,
// String[] - schema NU se schimbă). Modul pur, fără dependențe: folosit de backend
// (validare, viitorul catalog de influenceri pentru vânzători) și de frontend (formular).
//
// Reprezentarea (selecții mixte):
//   "group:<grupă>"          grupa ÎNTREAGĂ - se rezolvă la citire după catalogul curent,
//                             deci include automat subcategoriile adăugate ulterior;
//   "<categorie>"            o categorie individuală (cheia oficială din catalog);
//   "exclude:<categorie>"    o subcategorie scoasă dintr-o grupă selectată integral
//                             (selecție parțială); valabilă doar lângă grupa ei;
//   "<grupă>" (fără prefix)  valoare VECHE (grupele din prima versiune a formularului):
//                             citită ca grupă întreagă; nu se mai scrie așa.
// Limita (maximum 6) numără grupele + categoriile individuale; excluderile nu contează.
// Valorile necunoscute se păstrează (nu se pierd date) și se numără.
//
// `catalog` = lista categoriilor active: [{ value, group }] (ordinea oficială).

export const GROUP_PREFIX = "group:";
export const EXCLUDE_PREFIX = "exclude:";

const isGroupToken = (t) => typeof t === "string" && t.startsWith(GROUP_PREFIX);
const isExcludeToken = (t) => typeof t === "string" && t.startsWith(EXCLUDE_PREFIX);

function catalogIndex(catalog = []) {
  const groupOf = new Map();
  const members = new Map();
  for (const item of Array.isArray(catalog) ? catalog : []) {
    if (!item?.value || !item.group) continue;
    groupOf.set(item.value, item.group);
    if (!members.has(item.group)) members.set(item.group, []);
    members.get(item.group).push(item.value);
  }
  return { groupOf, members };
}

/**
 * Citește lista salvată.
 * @returns {{ groups: Map<string, Set<string>>, singles: Set<string>, unknown: string[], legacyGroups: Set<string> }}
 *   groups: grupă -> subcategoriile excluse; legacyGroups: grupele salvate în forma veche
 */
export function parseCategorySelection(list, catalog) {
  const { groupOf, members } = catalogIndex(catalog);
  const groups = new Map();
  const singles = new Set();
  const unknown = [];
  const legacyGroups = new Set();
  const excludes = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const token = String(raw || "").trim();
    if (!token) continue;
    if (isGroupToken(token)) {
      const g = token.slice(GROUP_PREFIX.length);
      if (members.has(g)) groups.set(g, groups.get(g) || new Set());
      else unknown.push(token);
    } else if (isExcludeToken(token)) {
      excludes.push(token.slice(EXCLUDE_PREFIX.length));
    } else if (groupOf.has(token)) {
      singles.add(token);
    } else if (members.has(token)) {
      groups.set(token, groups.get(token) || new Set());
      legacyGroups.add(token);
    } else {
      unknown.push(token);
    }
  }
  for (const key of excludes) {
    const g = groupOf.get(key);
    if (g && groups.has(g)) groups.get(g).add(key);
  }
  // o categorie individuală dintr-o grupă deja selectată integral e redundantă
  for (const key of [...singles]) if (groups.has(groupOf.get(key))) singles.delete(key);
  return { groups, singles, unknown, legacyGroups };
}

/** Lista de salvat, în forma canonică (grupele vechi rămân neschimbate dacă nu au fost atinse). */
export function serializeCategorySelection(sel, { keepLegacy = new Set() } = {}) {
  const out = [];
  for (const [g, excluded] of sel.groups) {
    out.push(keepLegacy.has(g) && !excluded.size ? g : `${GROUP_PREFIX}${g}`);
    for (const key of excluded) out.push(`${EXCLUDE_PREFIX}${key}`);
  }
  for (const key of sel.singles) out.push(key);
  for (const token of sel.unknown) out.push(token);
  return out;
}

/** Câte preferințe ocupă lista (grupă = 1, categorie = 1, excluderile nu contează). */
export function countCategoryPreferences(list, catalog) {
  const sel = parseCategorySelection(list, catalog);
  return sel.groups.size + sel.singles.size + sel.unknown.length;
}

/** Starea unei grupe: "none" | "partial" | "full". */
export function categoryGroupState(list, group, catalog) {
  const { members } = catalogIndex(catalog);
  const all = members.get(group) || [];
  const sel = parseCategorySelection(list, catalog);
  if (sel.groups.has(group)) return sel.groups.get(group).size ? "partial" : "full";
  return all.some((key) => sel.singles.has(key)) ? "partial" : "none";
}

/** Câte subcategorii ale grupei sunt efectiv selectate. */
export function selectedInGroup(list, group, catalog) {
  const { members } = catalogIndex(catalog);
  const all = members.get(group) || [];
  const sel = parseCategorySelection(list, catalog);
  if (sel.groups.has(group)) return all.filter((key) => !sel.groups.get(group).has(key)).length;
  return all.filter((key) => sel.singles.has(key)).length;
}

export function isCategorySelected(list, key, catalog) {
  const { groupOf } = catalogIndex(catalog);
  const sel = parseCategorySelection(list, catalog);
  const g = groupOf.get(key);
  if (g && sel.groups.has(g)) return !sel.groups.get(g).has(key);
  return sel.singles.has(key);
}

/**
 * „Selectează toate” pentru o grupă: none/partial -> full; full -> none.
 * @returns {{ list: string[], limited: boolean }}
 */
export function toggleCategoryGroup(list, group, catalog, max = 6) {
  const { members } = catalogIndex(catalog);
  if (!members.has(group)) return { list: [...(list || [])], limited: false };
  const sel = parseCategorySelection(list, catalog);
  const keepLegacy = new Set(sel.legacyGroups);
  const state = categoryGroupState(list, group, catalog);
  if (state === "full") {
    sel.groups.delete(group);
    keepLegacy.delete(group);
    return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
  }
  const mine = members.get(group);
  for (const key of mine) sel.singles.delete(key);
  const wasSelected = sel.groups.has(group);
  sel.groups.set(group, new Set());
  keepLegacy.delete(group);
  if (!wasSelected && sel.groups.size + sel.singles.size + sel.unknown.length > max) {
    return { list: [...(list || [])], limited: true };
  }
  return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
}

/**
 * O categorie individuală. Dintr-o grupă selectată integral: o exclude / o readuce
 * (selecție parțială, tot o singură preferință). Altfel: categorie individuală;
 * dacă ajung alese toate subcategoriile grupei, devine automat grupa întreagă.
 * @returns {{ list: string[], limited: boolean }}
 */
export function toggleCategory(list, key, catalog, max = 6) {
  const { groupOf, members } = catalogIndex(catalog);
  const g = groupOf.get(key);
  const sel = parseCategorySelection(list, catalog);
  const keepLegacy = new Set(sel.legacyGroups);
  if (!g) {
    // valoare care nu mai e în catalog: se poate doar scoate
    sel.unknown = sel.unknown.filter((t) => t !== key);
    return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
  }
  if (sel.groups.has(g)) {
    const excluded = sel.groups.get(g);
    keepLegacy.delete(g);
    if (excluded.has(key)) excluded.delete(key);
    else excluded.add(key);
    if (excluded.size >= members.get(g).length) sel.groups.delete(g);
    return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
  }
  if (sel.singles.has(key)) {
    sel.singles.delete(key);
    return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
  }
  sel.singles.add(key);
  const mine = members.get(g);
  if (mine.every((k) => sel.singles.has(k))) {
    for (const k of mine) sel.singles.delete(k);
    sel.groups.set(g, new Set());
  }
  if (sel.groups.size + sel.singles.size + sel.unknown.length > max) return { list: [...(list || [])], limited: true };
  return { list: serializeCategorySelection(sel, { keepLegacy }), limited: false };
}

/**
 * Categoriile concrete acoperite de selecție, după catalogul CURENT (pentru
 * potrivirea cu produsele / viitorul catalog de influenceri pentru vânzători).
 */
export function expandCreatorCategories(list, catalog) {
  const { members } = catalogIndex(catalog);
  const sel = parseCategorySelection(list, catalog);
  const out = new Set(sel.singles);
  for (const [g, excluded] of sel.groups) for (const key of members.get(g) || []) if (!excluded.has(key)) out.add(key);
  return out;
}

/**
 * Validarea la salvare. O valoare NOUĂ trebuie să fie: categorie din catalog,
 * „group:<grupă>” existentă sau „exclude:<categorie>” a unei grupe selectate.
 * Valorile deja salvate (vechi / necunoscute) se păstrează.
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string }}
 */
export function validateCategorySelection(list, { catalog, existing = [], max = 6 } = {}) {
  const { groupOf, members } = catalogIndex(catalog);
  const kept = new Set((Array.isArray(existing) ? existing : []).map((v) => String(v || "")));
  const tokens = [...new Set((Array.isArray(list) ? list : []).map((v) => String(v || "").trim()).filter(Boolean))];
  const selectedGroups = new Set(
    tokens.map((t) => (isGroupToken(t) ? t.slice(GROUP_PREFIX.length) : members.has(t) && !groupOf.has(t) ? t : null)).filter(Boolean)
  );
  for (const t of tokens) {
    if (kept.has(t)) continue;
    if (isGroupToken(t) && members.has(t.slice(GROUP_PREFIX.length))) continue;
    if (isExcludeToken(t) && selectedGroups.has(groupOf.get(t.slice(EXCLUDE_PREFIX.length)))) continue;
    if (!isGroupToken(t) && !isExcludeToken(t) && groupOf.has(t)) continue;
    return { ok: false, error: "Alege categoriile din listă." };
  }
  if (countCategoryPreferences(tokens, catalog) > max) {
    return { ok: false, error: `Poți alege maximum ${max} preferințe (o grupă întreagă contează ca una).` };
  }
  return { ok: true, value: tokens };
}
