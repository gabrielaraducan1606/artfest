// backend/src/services/collectionAiQuery.js
//
// Asistentul AI al colecțiilor de vânzător - partea DETERMINISTĂ (fără AI):
//  - interpretarea cererii scrise de vânzător („20 de cadouri de Crăciun,
//    sub 100 lei, din magazine diferite”) în filtre reale de catalog;
//  - cuvintele-cheie pentru preselecția candidaților;
//  - diversitatea pe magazine, aplicată pe server (nu ne bazăm pe AI);
//  - ziua de referință (Europe/Bucharest) pentru limitele din aiUsageService.js.
// AI-ul doar ALEGE și ORDONEAZĂ dintre candidații reali găsiți aici.

import { OCCASION_LABELS } from "../constants/occasinsTags.js";

export const AI_DEFAULT_RESULTS = 12;
export const AI_MAX_RESULTS = 30;
export const AI_MAX_PROMPT_LENGTH = 600;

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Ocazii: eticheta din catalog (OCCASION_LABELS) + câteva forme uzuale.
 * Cheile sunt cele folosite de filtrul de ocazie al căutării.
 */
const OCCASION_SYNONYMS = {
  christmas: ["craciun", "craciunul", "mos craciun"],
  baptism: ["botez", "botezul"],
  wedding: ["nunta", "nunti", "miri", "cununie"],
  engagement: ["logodna"],
  birthday: ["zi de nastere", "zile de nastere", "ziua de nastere", "aniversar copil"],
  anniversary: ["aniversare", "aniversari"],
  valentines_day: ["valentine", "dragobete", "indragostiti"],
  mothers_day: ["ziua mamei", "pentru mama", "mamici"],
  fathers_day: ["ziua tatalui", "pentru tata"],
  easter: ["paste", "pascal"],
  new_home: ["casa noua", "mutare"],
  baby_shower: ["baby shower"],
  corporate: ["corporate", "firma", "angajati", "colegi"],
  thank_you: ["multumesc", "multumire"],
  winter_holidays: ["sarbatori de iarna", "sarbatori"],
};

function occasionPhrases() {
  const out = [];
  for (const [key, label] of Object.entries(OCCASION_LABELS)) {
    out.push([key, normalizeText(label)]);
  }
  for (const [key, list] of Object.entries(OCCASION_SYNONYMS)) {
    for (const phrase of list) out.push([key, phrase]);
  }
  // fraza cea mai lungă câștigă („sarbatori de iarna” înaintea lui „sarbatori”)
  return out.sort((a, b) => b[1].length - a[1].length);
}

const OCCASION_PHRASES = occasionPhrases();

function parseAmount(text) {
  const amount = Number(String(text).replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

// cuvinte fără valoare de căutare
const STOPWORDS = new Set(
  "vreau caut cauta gaseste gasesc gaseste-mi imi pentru din de la cu si sau sub peste pana in intre lei ron produse produs cadouri cadou bucati buc magazine magazin diferite diferit mai multe care sa fie un o unei unui niste cele cel cea al ale ai artfest colectie colectia colectii pt minim maxim aprox aproximativ".split(
    " "
  )
);

/**
 * Interpretează cererea scrisă de vânzător. Nu inventează nimic: ce nu se
 * poate deduce sigur rămâne null.
 * @returns {{ maxPrice: number|null, minPrice: number|null, count: number|null,
 *   occasion: string|null, diverseStores: boolean, personalizable: boolean,
 *   keywords: string[] }}
 */
export function interpretCollectionPrompt(prompt) {
  const text = normalizeText(prompt).slice(0, AI_MAX_PROMPT_LENGTH);

  let maxPrice = null;
  let minPrice = null;

  const between = text.match(/intre\s+(\d+(?:[.,]\d+)?)\s*(?:si|-)\s*(\d+(?:[.,]\d+)?)\s*(?:lei|ron)?/);
  if (between) {
    minPrice = parseAmount(between[1]);
    maxPrice = parseAmount(between[2]);
  }

  const under = text.match(/(?:sub|pana (?:in|la)|maxim(?:um)?|cel mult|<)\s*(\d+(?:[.,]\d+)?)\s*(?:de\s*)?(?:lei|ron)\b/);
  if (under && maxPrice === null) maxPrice = parseAmount(under[1]);

  const over = text.match(/(?:peste|minim(?:um)?|de la|>)\s*(\d+(?:[.,]\d+)?)\s*(?:de\s*)?(?:lei|ron)\b/);
  if (over && minPrice === null) minPrice = parseAmount(over[1]);

  // „20 de cadouri”, „15 produse” - un număr care NU e o sumă în lei
  let count = null;
  const countMatch = text.match(/(?:^|\s)(\d{1,2})\s+(?:de\s+)?(?!lei\b|ron\b)([a-z]+)/);
  if (countMatch) {
    const value = Number(countMatch[1]);
    if (value >= 1 && value <= AI_MAX_RESULTS) count = value;
  }

  let occasion = null;
  for (const [key, phrase] of OCCASION_PHRASES) {
    if (phrase && new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text)) {
      occasion = key;
      break;
    }
  }

  const diverseStores = /magazin(?:e)? diferit|creator(?:i)? diferit|vanzator(?:i)? diferit|cat mai multe magazine/.test(text);
  const personalizable = /personaliz/.test(text);

  const keywords = [
    ...new Set(
      text
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    ),
  ].slice(0, 6);

  return { maxPrice, minPrice, count, occasion, diverseStores, personalizable, keywords };
}

/**
 * Filtrele finale: ce a ales vânzătorul explicit în interfață are prioritate;
 * ce lipsește se completează din cererea scrisă.
 */
export function mergeAiFilters(uiFilters = {}, interpreted = {}) {
  const pick = (value) => (value === undefined || value === null || value === "" ? null : value);
  return {
    scope: uiFilters.scope === "own" ? "own" : "marketplace",
    category: pick(uiFilters.category),
    occasion: pick(uiFilters.occasion) ?? interpreted.occasion ?? null,
    availability: pick(uiFilters.availability),
    store: pick(uiFilters.store),
    minPrice: pick(uiFilters.minPrice) ?? interpreted.minPrice ?? null,
    maxPrice: pick(uiFilters.maxPrice) ?? interpreted.maxPrice ?? null,
    personalizable:
      uiFilters.personalizable === true || uiFilters.personalizable === "1" || interpreted.personalizable === true,
  };
}

/**
 * Păstrează ordinea propusă de AI, dar cu cel mult `perStore` produse din
 * același magazin (când vânzătorul a cerut magazine diferite).
 */
export function applyStoreDiversity(products, { perStore = 1, limit = AI_DEFAULT_RESULTS } = {}) {
  const counts = new Map();
  const out = [];
  for (const product of products) {
    const store = product.storeKey || product.vendorId || product.storeName || product.id;
    const used = counts.get(store) || 0;
    if (used >= perStore) continue;
    counts.set(store, used + 1);
    out.push(product);
    if (out.length >= limit) break;
  }
  return out;
}

/* =========================================================
   Ziua de referință pentru limitele AI (Europe/Bucharest).
   Limitele în sine sunt PERSISTENTE: vezi aiUsageService.js (AiUsageDaily).
========================================================= */

export function bucharestDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
