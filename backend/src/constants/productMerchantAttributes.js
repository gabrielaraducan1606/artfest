// backend/src/constants/productMerchantAttributes.js
//
// Helper COMUN pentru reprezentarea "umană/canonică" a datelor unui produs
// în afara DB: folosit de feed-ul Google Shopping (backend) ȘI de JSON-LD-ul
// din ProductDetails (frontend), ca ambele să descrie același produs cu
// aceleași valori.
//
// Stă în constants/ (nu în lib/) din același motiv ca restul dicționarelor:
// frontend-ul importă deja cross-folder din backend/src/constants (vezi
// frontend/src/utils/optionLabels.js), deci trebuie să rămână PUR - fără
// dependențe de Node/Prisma/Express, doar alte constante.
//
// NU modifică date în DB. Doar transformă valorile deja salvate.

import { CATEGORY_LABELS, CATEGORY_GROUP_LABELS } from "./categories.js";
import { COLOR_LABELS } from "./colors.js";
import { MATERIAL_LABELS } from "./materials.js";
import { getGoogleProductCategoryId } from "./googleProductCategories.js";

// Google acceptă 1 imagine principală + maxim 10 suplimentare.
export const MAX_ADDITIONAL_IMAGES = 10;

/* =========================================================
   Text / lookup
========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

// "wax_soy", "grey_light" - cheie internă, nu text pentru oameni.
// Doar cu "_" - un text uman poate conține cratimă ("roz-portocaliu").
const SLUG_LIKE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/i;

function findLabelByKeyOrLabel(value, labels) {
  const needle = normalizeText(value);
  if (!needle) return null;

  for (const [key, label] of Object.entries(labels)) {
    if (normalizeText(key) === needle || normalizeText(label) === needle) {
      return label;
    }
  }

  return null;
}

/*
 * Cheie canonică -> label. Valoare care e deja un label (date istorice
 * salvate ca text) -> label-ul canonic. Text uman necunoscut -> păstrat
 * ca atare (ex. "argint 925" introdus manual). Slug necunoscut -> null:
 * nu trimitem niciodată chei interne către Google/utilizatori.
 */
function toHumanValue(value, labels, maxLength) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const canonical = findLabelByKeyOrLabel(raw, labels);
  if (canonical) return canonical;

  if (SLUG_LIKE.test(raw)) return null;

  return raw.slice(0, maxLength);
}

/* =========================================================
   Culoare / material
========================================================= */

/**
 * Label uman al culorii (Product.color). Null dacă lipsește sau e un slug
 * necunoscut.
 *
 * Google interpretează "/" din `color` ca separator între culori, iar unele
 * label-uri canonice au alias după "/" ("Ivory / ivoire") - păstrăm doar
 * prima parte, ca produsul să nu apară ca bicolor.
 */
export function getColorLabel(color) {
  const label = toHumanValue(color, COLOR_LABELS, 100);
  if (!label) return null;

  const first = label.split("/")[0].trim();
  return first || null;
}

/**
 * Label uman al materialului (Product.materialMain). Null dacă lipsește sau
 * e un slug necunoscut.
 */
export function getMaterialLabel(material) {
  return toHumanValue(material, MATERIAL_LABELS, 200);
}

/**
 * Rezolvă o valoare (cheie sau label, cu/fără diacritice) la un material din
 * catalogul canonic, sau null. Folosit de /ai/product-analyze ca AI-ul să nu
 * poată introduce un material în afara catalogului.
 */
export function resolveCanonicalMaterial(value) {
  const needle = normalizeText(value);
  if (!needle) return null;

  for (const [key, label] of Object.entries(MATERIAL_LABELS)) {
    if (normalizeText(key) === needle || normalizeText(label) === needle) {
      return { key, label };
    }
  }

  return null;
}

/* =========================================================
   Categorie
========================================================= */

/**
 * Eticheta umană a categoriei pentru product_type / JSON-LD category.
 * Format ierarhic "Grup > Categorie" (recomandat de Google pentru
 * product_type). Null pentru categorii necunoscute/goale - nu expunem slug-ul.
 */
export function getCategoryLabel(category) {
  const key = String(category ?? "").trim();
  if (!key) return null;

  if (!Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, key)) {
    return null;
  }

  const label = CATEGORY_LABELS[key];
  const groupKey = key.split("_")[0];
  const groupLabel = CATEGORY_GROUP_LABELS[groupKey];

  if (!groupLabel || groupLabel === label) return label;

  return `${groupLabel} > ${label}`;
}

/* =========================================================
   Imagini
========================================================= */

/**
 * Lista curată de imagini publice: string-uri, rezolvate la URL absolut
 * http(s) prin `resolveUrl`, fără duplicate (păstrează prima apariție, deci
 * ordinea produsului) și fără valori invalide (goale, data:/blob:, relative
 * nerezolvate). Prima = imaginea principală.
 */
export function collectProductImageUrls(images, { resolveUrl } = {}) {
  if (!Array.isArray(images)) return [];

  const resolve =
    typeof resolveUrl === "function" ? resolveUrl : (value) => value;

  const seen = new Set();
  const result = [];

  for (const item of images) {
    if (typeof item !== "string") continue;

    const trimmed = item.trim();
    if (!trimmed) continue;

    const url = String(resolve(trimmed) ?? "").trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) continue;

    if (seen.has(url)) continue;
    seen.add(url);

    result.push(url);
  }

  return result;
}

/* =========================================================
   Disponibilitate (feed + JSON-LD) - o singură sursă
========================================================= */

/*
 * ProductAvailability -> valorile celor două destinații:
 *  - feed Google Shopping (g:availability)
 *  - schema.org (JSON-LD offers.availability)
 *
 * MADE_TO_ORDER = produs care se poate comanda ACUM, dar se execută după
 * comandă -> "in stock" / InStock. leadTimeDays rămâne doar informație
 * afișată clientului (timp de execuție); NU se transformă în
 * availability_date. Doar PREORDER are nevoie de o dată reală
 * (nextShipDate) în feed.
 */
const AVAILABILITY_MAP = {
  READY: {
    google: "in stock",
    schema: "https://schema.org/InStock",
  },
  MADE_TO_ORDER: {
    google: "in stock",
    schema: "https://schema.org/InStock",
  },
  PREORDER: {
    google: "preorder",
    schema: "https://schema.org/PreOrder",
  },
  SOLD_OUT: {
    google: "out of stock",
    schema: "https://schema.org/OutOfStock",
  },
};

export function availabilityToGoogle(value) {
  return (AVAILABILITY_MAP[value] || AVAILABILITY_MAP.READY).google;
}

export function availabilityToSchemaOrg(value) {
  return (AVAILABILITY_MAP[value] || AVAILABILITY_MAP.READY).schema;
}

/*
 * Doar disponibilitățile care cer o dată reală în feed
 * (g:availability_date). MADE_TO_ORDER NU e aici.
 */
export const AVAILABILITY_NEEDS_DATE = new Set(["PREORDER"]);

/* =========================================================
   Preț (feed)
========================================================= */

function formatMoney(cents, currency) {
  return `${(cents / 100).toFixed(2)} ${currency || "RON"}`;
}

function toGoogleDate(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // ISO 8601 fără milisecunde, ex. 2026-10-01T00:00:00Z
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Prețurile pentru feed. `g:price` rămâne mereu prețul normal (DB).
 * `pricing` = rezultatul lui calculateProductPromotionPricing /
 * getPromotionPricingForProducts din services/productPromotionPrice.js,
 * calculat DOAR cu promoțiile publice (colecție + homepage feature), adică
 * exact ce vede și crawlerul pe landing page - fără campanie din query
 * param și fără cod de reducere din checkout.
 *
 * - sale_price doar dacă există o reducere activă și reală
 *   (0 < preț final < preț normal).
 * - sale_price_effective_date doar dacă promoția are startsAt ȘI endsAt
 *   valide (start < end); Google cere ambele capete. Fără interval complet
 *   trimitem sale_price fără dată (atributul e opțional în feed).
 *
 * @returns {{ price: string, salePrice: string|null,
 *             salePriceEffectiveDate: string|null }}
 */
export function buildMerchantPrice({ priceCents, currency, pricing } = {}) {
  const regularCents = Number(priceCents);
  const price = formatMoney(regularCents, currency);

  const finalCents = Number(pricing?.finalPriceCents);

  const hasSale =
    pricing?.hasDiscount === true &&
    Number.isFinite(regularCents) &&
    Number.isFinite(finalCents) &&
    finalCents > 0 &&
    finalCents < regularCents;

  if (!hasSale) {
    return { price, salePrice: null, salePriceEffectiveDate: null };
  }

  const start = toGoogleDate(pricing?.discount?.startsAt);
  const end = toGoogleDate(pricing?.discount?.endsAt);

  const hasValidInterval =
    start && end && new Date(start).getTime() < new Date(end).getTime();

  return {
    price,
    salePrice: formatMoney(finalCents, currency),
    salePriceEffectiveDate: hasValidInterval ? `${start}/${end}` : null,
  };
}

/* =========================================================
   Atribute comune (feed + JSON-LD)
========================================================= */

/**
 * @returns {{
 *   color: string|null,
 *   material: string|null,
 *   productType: string|null,
 *   googleProductCategory: number|null,
 *   images: string[],
 *   image: string|null,
 *   additionalImages: string[],
 * }}
 */
export function buildProductMerchantAttributes(product, { resolveUrl } = {}) {
  const images = collectProductImageUrls(product?.images, { resolveUrl });

  return {
    color: getColorLabel(product?.color),
    material: getMaterialLabel(product?.materialMain),
    productType: getCategoryLabel(product?.category),
    googleProductCategory: getGoogleProductCategoryId(product?.category),
    images,
    image: images[0] || null,
    additionalImages: images.slice(1, 1 + MAX_ADDITIONAL_IMAGES),
  };
}
