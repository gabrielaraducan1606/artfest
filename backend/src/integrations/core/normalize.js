// backend/src/integrations/core/normalize.js
//
// Forma comună a produselor externe (toate adaptoarele întorc aceeași formă)
// și ajutoarele de normalizare. Nimic de aici nu inventează date: lipsa
// unei informații rămâne null; textul liber produce doar INDICII.
//
// @typedef {Object} ExternalStock
// @property {boolean} managed         magazinul urmărește cantitatea
// @property {number|null} quantity    cantitatea, dacă e urmărită
// @property {"instock"|"outofstock"|"onbackorder"} status
// @property {"no"|"notify"|"yes"} backorders
//
// @typedef {Object} ExternalVariation
// @property {string} externalId
// @property {string|null} sku
// @property {number|null} priceCents
// @property {number|null} salePriceCents
// @property {{ key: string, name: string, option: string }[]} attributes  option "" = „oricare”
// @property {string|null} image
// @property {"VARIANT"|"PARENT"|"NONE"} stockManagedAt
// @property {ExternalStock} stock
// @property {ExternalShipping} shipping   (valorile moștenite de la părinte apar ca la părinte)
//
// @typedef {Object} ExternalShipping   profilul logistic, convertit în unitățile Artfest
// @property {number|null} weightGrams
// @property {number|null} lengthCm
// @property {number|null} widthCm
// @property {number|null} heightCm
// @property {string[]} issues   weight_missing / weight_unit_unknown / weight_invalid /
//                               dimensions_incomplete / dimension_unit_unknown / dimensions_invalid
// @property {{ weight: string|null, weightUnit: string|null, length: string|null, width: string|null,
//              height: string|null, dimensionUnit: string|null }} source   valorile originale din magazin
//
// @typedef {Object} ExternalProduct
// @property {string} externalId
// @property {"simple"|"variable"|"other"} type
// @property {string} name
// @property {string} descriptionHtml
// @property {string} shortDescriptionHtml
// @property {string|null} sku
// @property {string|null} status            ex. publish / draft
// @property {number|null} priceCents         prețul de bază (fără reducerea din magazin)
// @property {number|null} salePriceCents
// @property {string[]} images
// @property {string[]} categories
// @property {{ key: string, name: string, options: string[], variation: boolean }[]} attributes
// @property {{ key: string, label: string, type: string, required: boolean, source: string }[]} personalizationFields
// @property {string[]} unsupportedAddons    opțiuni suplimentare nerecunoscute (doar avertizare)
// @property {ExternalStock} stock
// @property {ExternalShipping} shipping
// @property {ExternalVariation[]} variations
// @property {string|null} modifiedAt

import { SHIPPING_LIMITS } from "../../lib/productShipping.js";

/** "12.50" / 12.5 -> 1250; gol / invalid -> null. */
export function moneyToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/* ===================== greutate / dimensiuni ===================== */

// unitățile pe care le poate întoarce magazinul (WooCommerce: kg / g / lbs / oz
// și m / cm / mm / in / yd); factori exacți (1 lb = 453,59237 g, 1 in = 2,54 cm)
export const GRAMS_PER_UNIT = Object.freeze({ g: 1, kg: 1000, lbs: 453.59237, lb: 453.59237, oz: 28.349523125 });
export const CM_PER_UNIT = Object.freeze({ cm: 1, mm: 0.1, m: 100, in: 2.54, yd: 91.44 });

const DIMENSIONS = ["length", "width", "height"];
const blankMeasure = (v) => v === undefined || v === null || String(v).trim() === "";
// rotunjire în sus la întreg (nu declarăm mai puțin decât în magazin); pasul
// prin 1e-6 anulează erorile de virgulă mobilă (0.45 * 1000 = 450.00000000000006)
const ceilUnit = (x) => Math.ceil(Math.round(x * 1e6) / 1e6);

function convertMeasure(value, factor) {
  const n = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return ceilUnit(n * factor);
}

/**
 * Greutatea și dimensiunile din magazin -> profilul logistic Artfest (grame /
 * cm întregi, aceleași limite ca în editor - lib/productShipping.js). Nimic
 * inventat: lipsă, unitate necunoscută sau valoare invalidă = null + motivul
 * în `issues`; dimensiunile se păstrează doar toate trei.
 *
 * @param {{ weight?: string|number|null, weightUnit?: string|null, length?: string|number|null,
 *           width?: string|number|null, height?: string|number|null, dimensionUnit?: string|null }} input
 * @returns {ExternalShipping}
 */
export function normalizeShippingMeasures({ weight, weightUnit, length, width, height, dimensionUnit } = {}) {
  const raw = { length, width, height };
  const text = (v) => (blankMeasure(v) ? null : String(v).trim());
  const source = {
    weight: text(weight),
    weightUnit: text(weightUnit)?.toLowerCase() ?? null,
    length: text(length),
    width: text(width),
    height: text(height),
    dimensionUnit: text(dimensionUnit)?.toLowerCase() ?? null,
  };
  const issues = [];

  let weightGrams = null;
  if (source.weight === null) issues.push("weight_missing");
  else if (!Object.hasOwn(GRAMS_PER_UNIT, source.weightUnit ?? "")) issues.push("weight_unit_unknown");
  else {
    const grams = convertMeasure(source.weight, GRAMS_PER_UNIT[source.weightUnit]);
    if (Number.isNaN(grams) || grams < SHIPPING_LIMITS.minWeightGrams || grams > SHIPPING_LIMITS.maxWeightGrams) issues.push("weight_invalid");
    else weightGrams = grams;
  }

  let dims = { lengthCm: null, widthCm: null, heightCm: null };
  const filled = DIMENSIONS.filter((d) => source[d] !== null).length;
  if (filled > 0 && filled < 3) issues.push("dimensions_incomplete");
  else if (filled === 3) {
    if (!Object.hasOwn(CM_PER_UNIT, source.dimensionUnit ?? "")) issues.push("dimension_unit_unknown");
    else {
      const cm = DIMENSIONS.map((d) => convertMeasure(raw[d], CM_PER_UNIT[source.dimensionUnit]));
      if (cm.some((v) => Number.isNaN(v) || v < SHIPPING_LIMITS.minDimensionCm || v > SHIPPING_LIMITS.maxDimensionCm)) {
        issues.push("dimensions_invalid");
      } else {
        dims = { lengthCm: cm[0], widthCm: cm[1], heightCm: cm[2] };
      }
    }
  }

  return { weightGrams, ...dims, issues, source };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };

/** HTML -> text simplu, cu rânduri noi la paragrafe / liste. */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Cheie stabilă pentru atribute / câmpuri: "Mărime pantof" -> "marime_pantof". */
export function slugKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^pa_/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const fold = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// atribute / câmpuri care descriu o personalizare a clientului, nu o variantă de stoc
const PERSONALIZATION_WORDS = [
  "personaliz",
  "gravur",
  "gravat",
  "nume",
  "mesaj",
  "dedicati",
  "text pe",
  "textul",
  "initial",
  "monogram",
  "custom text",
  "engraving",
  "your name",
  "message",
];

export function looksLikePersonalization(name) {
  const text = fold(name);
  return PERSONALIZATION_WORDS.some((word) => text.includes(word));
}

/**
 * Indicii de disponibilitate din textul produsului. Doar INDICII - decizia
 * rămâne „propusă” și cere confirmarea vânzătorului.
 * @returns {{ preorder: boolean, madeToOrder: boolean, leadTimeDays: number|null }}
 */
export function availabilityHints(...texts) {
  const text = fold(texts.join(" \n "));
  const preorder = /\b(precomand|pre-comand|pre-order|preorder|disponibil din|lansare)/.test(text);
  const madeToOrder = /\b(la comanda|realizat(a|e)? la comanda|executat(a|e)? la comanda|lucrat(a|e)? manual|made to order|handmade la comanda|se realizeaza in)/.test(text);

  // „în 5-7 zile lucrătoare” -> 7 (limita superioară, ca să nu promitem mai repede)
  let leadTimeDays = null;
  const range = text.match(/(\d{1,2})\s*(?:-|–|pana la|si)\s*(\d{1,2})\s*zile/);
  const single = text.match(/(\d{1,2})\s*zile/);
  if (range) leadTimeDays = Math.max(Number(range[1]), Number(range[2]));
  else if (single) leadTimeDays = Number(single[1]);
  if (leadTimeDays !== null && (leadTimeDays < 1 || leadTimeDays > 120)) leadTimeDays = null;

  return { preorder, madeToOrder, leadTimeDays };
}
