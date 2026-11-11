// backend/src/lib/productShipping.js
//
// Profilul logistic al produsului (produsul AMBALAT, gata de expediere):
// greutatea în grame (obligatorie pentru produsele noi cu checkout Sameday,
// în afară de QUOTE_ONLY) și, opțional, dimensiunile coletului în cm (toate
// trei sau niciuna). Fără valori implicite inventate.
//
// Pur, fără Prisma: refolosit de server (sursa de adevăr) și de editorul
// vânzătorului (frontend/src/utils/productPublishCheck.js).
//
// Coletul unui shipment pentru estimate-cost: greutatea însumată
// (greutate × cantitate, pe toate produsele), packageNumber = 1, dimensiuni
// DOAR pentru un singur produs cu qty = 1 și toate cele 3 completate.

export const SHIPPING_PROFILE_FIELDS = Object.freeze(["shippingWeightGrams", "shippingLengthCm", "shippingWidthCm", "shippingHeightCm"]);
export const SHIPPING_DIMENSION_FIELDS = Object.freeze(["shippingLengthCm", "shippingWidthCm", "shippingHeightCm"]);

export const SHIPPING_LIMITS = Object.freeze({
  minWeightGrams: 1,
  maxWeightGrams: 100_000,
  minDimensionCm: 1,
  maxDimensionCm: 300,
  // Sameday (PDF v3.6, „Types of parcels”): peste 38 kg = colet supraponderal,
  // cu acord comercial -> fără estimare automată
  maxEstimateWeightGrams: 38_000,
  smallParcelMaxGrams: 1_000,
});

export const SHIPPING_MESSAGES = Object.freeze({
  weightInvalid: "Greutatea coletului trebuie să fie un număr întreg de grame, între 1 g și 100 kg (100000 g).",
  dimensionInvalid: "Dimensiunile coletului trebuie să fie numere întregi de centimetri, între 1 și 300 cm.",
  dimensionsIncomplete: "Completează toate cele trei dimensiuni ale coletului (lungime, lățime, înălțime) sau lasă-le pe toate goale.",
  weightRequired: "Completează greutatea coletului (produsul ambalat, gata de expediere). Fără ea nu putem calcula transportul Sameday.",
  weightMissingPublished:
    "Lipsește greutatea coletului. Până o completezi, transportul pentru acest produs se calculează cu tariful de rezervă al magazinului.",
  weightRecommendedQuote:
    "Recomandat: completează greutatea coletului, ca să poți estima mai ușor transportul în ofertă.",
});

const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// număr întreg strict (fără zecimale / text / exponent); null = gol
function intOrInvalid(v) {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isInteger(v) ? v : NaN;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

/**
 * Validează câmpurile logistice trimise (doar cele prezente în `body`).
 * @param {Object} body
 * @param {Object} [current]  valorile salvate (pentru regula „toate trei sau niciuna”)
 * @returns {{ ok: true, data: Object } | { ok: false, error: string, field: string, message: string }}
 */
export function validateShippingProfile(body = {}, current = {}) {
  const data = {};
  const present = SHIPPING_PROFILE_FIELDS.filter((f) => body && Object.prototype.hasOwnProperty.call(body, f));

  for (const field of present) {
    const value = intOrInvalid(body[field]);
    const isWeight = field === "shippingWeightGrams";
    const [min, max] = isWeight
      ? [SHIPPING_LIMITS.minWeightGrams, SHIPPING_LIMITS.maxWeightGrams]
      : [SHIPPING_LIMITS.minDimensionCm, SHIPPING_LIMITS.maxDimensionCm];
    if (value !== null && (Number.isNaN(value) || value < min || value > max)) {
      return {
        ok: false,
        error: isWeight ? "shipping_weight_invalid" : "shipping_dimension_invalid",
        field,
        message: isWeight ? SHIPPING_MESSAGES.weightInvalid : SHIPPING_MESSAGES.dimensionInvalid,
      };
    }
    data[field] = value;
  }

  if (SHIPPING_DIMENSION_FIELDS.some((f) => present.includes(f))) {
    const merged = SHIPPING_DIMENSION_FIELDS.map((f) => (f in data ? data[f] : current?.[f] ?? null));
    const filled = merged.filter((v) => v !== null).length;
    if (filled !== 0 && filled !== 3) {
      const field = SHIPPING_DIMENSION_FIELDS[merged.findIndex((v) => v === null)];
      return { ok: false, error: "shipping_dimensions_incomplete", field, message: SHIPPING_MESSAGES.dimensionsIncomplete };
    }
  }

  return { ok: true, data };
}

export function hasShippingWeight(product) {
  const w = Number(product?.shippingWeightGrams);
  return Number.isInteger(w) && w >= SHIPPING_LIMITS.minWeightGrams && w <= SHIPPING_LIMITS.maxWeightGrams;
}

export function hasShippingDimensions(product) {
  return SHIPPING_DIMENSION_FIELDS.every((f) => {
    const v = Number(product?.[f]);
    return Number.isInteger(v) && v >= SHIPPING_LIMITS.minDimensionCm && v <= SHIPPING_LIMITS.maxDimensionCm;
  });
}

/**
 * Cât de obligatorie e greutatea pentru publicare:
 *   "required"    produs NOU, comandă directă / cu opțiuni, checkout Sameday activ;
 *   "recommended" produs existent (nu-l blocăm) sau QUOTE_ONLY;
 *   "none"        checkout Sameday oprit.
 */
export function shippingWeightRequirement({ orderMode, isNew, samedayEnabled }) {
  if (!samedayEnabled) return "none";
  if (String(orderMode || "").toUpperCase() === "QUOTE_ONLY") return "recommended";
  return isNew ? "required" : "recommended";
}

/** Greutatea în kg pentru Sameday: rotunjită în SUS la 0,01 kg (minimul Sameday). */
export function gramsToSamedayKg(grams) {
  return Math.max(1, Math.ceil(grams / 10)) / 100;
}

/**
 * Coletul unui shipment (toate liniile unui magazin) pentru estimate-cost.
 * @param {Array<{ qty, shippingWeightGrams, shippingLengthCm?, shippingWidthCm?, shippingHeightCm? }>} lines
 * @returns {{ parcels: Array<{weightKg, lengthCm?, widthCm?, heightCm?}>, totalGrams: number } | { reason: string }}
 */
export function buildShipmentParcels(lines = []) {
  const list = (lines || []).filter((l) => Number(l?.qty) > 0);
  if (!list.length || list.some((l) => !hasShippingWeight(l))) return { reason: "parcel_weight_unknown" };

  const totalGrams = list.reduce((sum, l) => sum + Number(l.shippingWeightGrams) * Number(l.qty), 0);
  if (totalGrams > SHIPPING_LIMITS.maxEstimateWeightGrams) return { reason: "parcel_oversized" };

  const parcel = { weightKg: gramsToSamedayKg(totalGrams) };
  const single = list.length === 1 && Number(list[0].qty) === 1;
  if (single && hasShippingDimensions(list[0])) {
    parcel.lengthCm = Number(list[0].shippingLengthCm);
    parcel.widthCm = Number(list[0].shippingWidthCm);
    parcel.heightCm = Number(list[0].shippingHeightCm);
  }
  return { parcels: [parcel], totalGrams };
}
