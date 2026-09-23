// src/pages/Vendor/Produse/hooks/similarProductsScoring.js
//
// Scoring PUR (fără React/DOM) pentru "Produse similare" din
// ProductDetails.jsx - înlocuiește filtrarea în cascadă (strict pe
// category+color+tags, cu praguri rigide de "sub 4 rezultate") cu un
// scor cumulat, ponderat pe criterii, exact ordinea cerută de business:
//
//   1. aceeași categorie/subcategorie
//   2. material comun
//   3. ocazie comună
//   4. styleTags comune
//   5. culoare
//   6. personalizabil
//   7. interval de preț apropiat
//   8. disponibilitate
//
// Niciun criteriu nu e obligatoriu - un produs cu 0 potriviri tot
// primește scor 0 (rămâne în listă, doar ultimul la sortare), ceea ce
// implementează NATURAL fallback-ul cerut ("completează din aceeași
// categorie, apoi din produse relevante disponibile") FĂRĂ un al
// doilea fetch: același pool candidat (un singur request), doar
// reordonat. Secțiunea nu rămâne goală cât timp pool-ul conține orice
// produs valid.
//
// Testat separat cu `node --test` (similarProductsScoring.test.js).

export const SIMILAR_PRODUCTS_WEIGHTS = {
  categoryExact: 100,
  categoryGroup: 40, // grupul de sus al categoriei (prefixul dinaintea "_"), dacă nu e exact aceeași subcategorie
  material: 60,
  occasionTag: 50, // + mic bonus per tag suplimentar comun (capat)
  occasionTagExtra: 5,
  styleTag: 40,
  styleTagExtra: 4,
  color: 25,
  personalizable: 15,
  priceProximity: 15, // maxim - scade liniar cu diferența relativă de preț
  availability: 10,
};

// diferență relativă de preț peste care proximitatea devine 0
const PRICE_TOLERANCE_RATIO = 0.6;

// nr. maxim de tag-uri suplimentare comune care mai aduc bonus (evită
// ca un produs cu 10 tag-uri identice să domine nerezonabil scorul)
const MAX_EXTRA_TAG_BONUS_COUNT = 2;

function toText(value) {
  return String(value ?? "").trim();
}

function sameText(a, b) {
  const ta = toText(a).toLowerCase();
  const tb = toText(b).toLowerCase();
  return Boolean(ta) && Boolean(tb) && ta === tb;
}

/**
 * Acceptă atât array (`String[]`, cum vine azi din API), cât și un
 * string separat prin virgulă (format vechi/defensiv) - normalizează
 * la o listă de token-uri lowercase, fără duplicate.
 */
export function splitTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const t = toText(item).toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }

  return out;
}

/**
 * "Subcategoria" nu e un câmp DB separat - e codificată ca prefix în
 * slug-ul de categorie (ex. "decor_aranjamente-florale-naturale" ->
 * grup "decor" - vezi backend/src/constants/categories.js). Folosim
 * asta pentru potrivire PARȚIALĂ (același grup, categorie diferită),
 * fără date noi.
 */
export function categoryGroup(category) {
  const value = toText(category).toLowerCase();
  const idx = value.indexOf("_");
  return idx > 0 ? value.slice(0, idx) : value;
}

function countOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let count = 0;
  for (const tag of a) {
    if (setB.has(tag)) count += 1;
  }
  return count;
}

function extractPrice(item) {
  if (Number.isFinite(item?.priceCents) && item.priceCents >= 0) {
    return item.priceCents / 100;
  }
  if (typeof item?.price === "number" && Number.isFinite(item.price)) {
    return item.price;
  }
  return null;
}

/**
 * Scor cumulat pentru cât de "similar" e `candidate` față de `base`
 * (produsul curent, pagina pe care se află userul). Valorile mai mari
 * = mai relevant. NU aruncă și NU necesită ca toate câmpurile să
 * existe - fiecare criteriu lipsă contribuie pur și simplu cu 0.
 */
export function scoreSimilarProduct(base, candidate) {
  if (!base || !candidate) return 0;

  const w = SIMILAR_PRODUCTS_WEIGHTS;
  let score = 0;

  // 1. categorie / subcategorie
  if (sameText(base.category, candidate.category)) {
    score += w.categoryExact;
  } else {
    const baseGroup = categoryGroup(base.category);
    if (baseGroup && baseGroup === categoryGroup(candidate.category)) {
      score += w.categoryGroup;
    }
  }

  // 2. material comun
  if (sameText(base.materialMain, candidate.materialMain)) {
    score += w.material;
  }

  // 3. ocazie comună
  const occasionOverlap = countOverlap(
    splitTags(base.occasionTags),
    splitTags(candidate.occasionTags)
  );
  if (occasionOverlap > 0) {
    score +=
      w.occasionTag +
      Math.min(occasionOverlap - 1, MAX_EXTRA_TAG_BONUS_COUNT) *
        w.occasionTagExtra;
  }

  // 4. styleTags comune
  const styleOverlap = countOverlap(
    splitTags(base.styleTags),
    splitTags(candidate.styleTags)
  );
  if (styleOverlap > 0) {
    score +=
      w.styleTag +
      Math.min(styleOverlap - 1, MAX_EXTRA_TAG_BONUS_COUNT) * w.styleTagExtra;
  }

  // 5. culoare
  if (sameText(base.color, candidate.color)) {
    score += w.color;
  }

  // 6. personalizabil (trăsătură comună relevantă - contează doar
  // când ambele sunt personalizabile, nu doar candidatul)
  if (base.acceptsCustom && candidate.acceptsCustom) {
    score += w.personalizable;
  }

  // 7. interval de preț apropiat (falloff liniar, 0 peste ±60% diferență)
  const basePrice = extractPrice(base);
  const candidatePrice = extractPrice(candidate);
  if (basePrice != null && basePrice > 0 && candidatePrice != null) {
    const diffRatio = Math.abs(candidatePrice - basePrice) / basePrice;
    const proximity = Math.max(0, 1 - diffRatio / PRICE_TOLERANCE_RATIO);
    score += w.priceProximity * proximity;
  }

  // 8. disponibilitate
  if (candidate.isAvailable === true || candidate.canBuyDirect === true) {
    score += w.availability;
  }

  return score;
}

/**
 * Ordonează `candidates` descrescător după scor față de `base`. Stabil
 * la egalitate de scor (păstrează ordinea de intrare - de regulă deja
 * "popular"/"nou" din backend), ca rezultatul să fie determinist.
 */
export function rankSimilarProducts(base, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];

  return list
    .map((item, index) => ({
      item,
      index,
      score: scoreSimilarProduct(base, item),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
