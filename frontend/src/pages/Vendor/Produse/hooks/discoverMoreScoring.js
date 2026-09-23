// src/pages/Vendor/Produse/hooks/discoverMoreScoring.js
//
// Scoring PUR (fără React/DOM) pentru "Descoperă și alte produse pe
// Artfest" - a treia secțiune din ProductDetails.jsx, DUPĂ "Produse
// similare" și "Mai multe din acest magazin". Scop diferit de
// scoring-ul de similaritate (similarProductsScoring.js): nu
// relevanță strictă, ci DESCOPERIRE largă a marketplace-ului, cu
// diversitate de magazine.
//
// Priorități (ordinea cerută explicit de business):
//   1. categorii apropiate (grup de categorie, NU exact aceeași -
//      altfel ar deveni "Produse similare" duplicat);
//   2. popularitate (poziția în pool-ul deja sortat `sort=popular`
//      de backend - NU recalculăm popularitatea, o citim din ordine);
//   3. noutate (`createdAt`, decădere exponențială);
//   4. disponibilitate.
//
// Testat separat cu `node --test` (discoverMoreScoring.test.js).

import { categoryGroup } from "./similarProductsScoring.js";

export const DISCOVER_WEIGHTS = {
  categoryGroup: 50,
  popularity: 30,
  newness: 20,
  availability: 10,
};

// scorul de noutate scade la jumătate la fiecare `NEWNESS_HALF_LIFE_DAYS`
const NEWNESS_HALF_LIFE_DAYS = 30;

export const DEFAULT_MAX_PER_VENDOR = 2;
export const DEFAULT_DISCOVER_LIMIT = 16;

function popularityScoreFromIndex(index, poolSize) {
  if (
    !Number.isFinite(index) ||
    !Number.isFinite(poolSize) ||
    poolSize <= 1
  ) {
    return 0;
  }
  // index 0 (primul, cel mai popular din pool) -> 1; ultimul -> 0
  return Math.max(0, 1 - index / (poolSize - 1));
}

function newnessScoreFromDate(createdAt, now) {
  const t = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return 0;

  const ageDays = Math.max(0, (now - t) / 86400000);
  return Math.pow(0.5, ageDays / NEWNESS_HALF_LIFE_DAYS);
}

/**
 * Scor pentru un candidat din pool-ul "Descoperă și alte produse".
 * `index`/`poolSize` = poziția în pool-ul BRUT (`sort=popular`,
 * ÎNAINTE de excludere/deduplicare) - popularitatea reflectă ordinea
 * dată deja de backend, nu o reinventăm.
 */
export function scoreDiscoverCandidate(
  base,
  candidate,
  { index, poolSize, now = Date.now() } = {}
) {
  if (!candidate) return 0;

  const w = DISCOVER_WEIGHTS;
  let score = 0;

  const baseGroup = categoryGroup(base?.category);
  if (baseGroup && baseGroup === categoryGroup(candidate?.category)) {
    score += w.categoryGroup;
  }

  score += w.popularity * popularityScoreFromIndex(index, poolSize);
  score += w.newness * newnessScoreFromDate(candidate?.createdAt, now);

  if (candidate?.isAvailable === true || candidate?.canBuyDirect === true) {
    score += w.availability;
  }

  return score;
}

function vendorKeyFor(item) {
  return (
    item?.service?.vendorId ||
    item?.storeSlug ||
    item?.service?.profile?.slug ||
    item?.storeName ||
    item?.id
  );
}

/**
 * Selectează din `rankedList` (deja ordonată descrescător după scor),
 * respectând `maxPerVendor` - produsele care ar depăși limita per
 * vendor sunt AMÂNATE, nu eliminate: dacă lista "curată" (diversă) nu
 * ajunge la `limit`, se completează din cele amânate, în aceeași
 * ordine de relevanță. Diversitatea e o PREFERINȚĂ, nu un motiv de a
 * afișa mai puține produse decât există disponibile.
 */
export function applyVendorDiversityCap(
  rankedList,
  { maxPerVendor = DEFAULT_MAX_PER_VENDOR, limit = DEFAULT_DISCOVER_LIMIT } = {}
) {
  const list = Array.isArray(rankedList) ? rankedList : [];
  const counts = new Map();
  const included = [];
  const deferred = [];

  for (const item of list) {
    if (included.length >= limit) break;

    const key = vendorKeyFor(item);
    const count = counts.get(key) || 0;

    if (count < maxPerVendor) {
      counts.set(key, count + 1);
      included.push(item);
    } else {
      deferred.push(item);
    }
  }

  if (included.length < limit) {
    for (const item of deferred) {
      if (included.length >= limit) break;
      included.push(item);
    }
  }

  return included;
}

/**
 * Pipeline complet: exclude (produsul curent + tot ce e deja afișat
 * în "Produse similare"/"Mai multe din acest magazin"), scorează,
 * ordonează, aplică diversitatea de vendor, taie la `limit`.
 *
 * @param {object} params
 * @param {object} params.baseProduct - produsul curent al paginii.
 * @param {Array} params.candidates - pool BRUT (`sort=popular`, ordinea
 *   originală contează pentru scorul de popularitate).
 * @param {Set<string>|string[]} params.excludeIds - id-uri de exclus
 *   (produsul curent + Produse similare + Mai multe din magazin).
 * @param {number} [params.now]
 * @param {number} [params.maxPerVendor]
 * @param {number} [params.limit]
 */
export function buildDiscoverSelection({
  baseProduct,
  candidates,
  excludeIds,
  now = Date.now(),
  maxPerVendor = DEFAULT_MAX_PER_VENDOR,
  limit = DEFAULT_DISCOVER_LIMIT,
}) {
  const pool = Array.isArray(candidates) ? candidates : [];
  const poolSize = pool.length;
  const excl = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);

  const ranked = pool
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item?.id && !excl.has(item.id))
    .map(({ item, index }) => ({
      item,
      score: scoreDiscoverCandidate(baseProduct, item, { index, poolSize, now }),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  return applyVendorDiversityCap(ranked, { maxPerVendor, limit });
}
