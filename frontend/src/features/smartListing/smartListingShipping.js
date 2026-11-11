// src/features/smartListing/smartListingShipping.js
//
// Greutatea coletului pentru produsele NOI: vânzătorul introduce greutatea
// produsului, alege cum îl ambalează, sistemul PROPUNE greutatea ambalată, iar
// vânzătorul o confirmă sau o corectează. Valoarea finală merge în câmpul
// EXISTENT Product.shippingWeightGrams (validat de lib/productShipping.js).
//
// Nu atinge produsele existente și nici regulile Sameday (conversia în kg
// rămâne gramsToSamedayKg, la checkout / AWB).
//
// Profilurile sunt ESTIMĂRI configurabile (adaos de ambalaj, în grame) - nu
// valori garantate; vânzătorul confirmă mereu greutatea finală.

import {
  SHIPPING_LIMITS,
  gramsToSamedayKg,
  validateShippingProfile,
} from "../../../../backend/src/lib/productShipping.js";

export const PACKAGING_PROFILES = Object.freeze([
  { id: "envelope", label: "Plic căptușit", hint: "bijuterii, accesorii plate", addGrams: 40 },
  { id: "small_box", label: "Cutie mică", hint: "lumânări, săpunuri, cani mici", addGrams: 150 },
  { id: "medium_box", label: "Cutie medie", hint: "decorațiuni, textile", addGrams: 300 },
  { id: "fragile_box", label: "Cutie cu protecție pentru obiecte fragile", hint: "sticlă, ceramică", addGrams: 450 },
  { id: "large_box", label: "Cutie mare", hint: "obiecte voluminoase", addGrams: 700 },
]);

function toGrams(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return NaN;
  return Number(raw);
}

/**
 * Propunerea de greutate ambalată (grame întregi, rotunjite în sus).
 * @returns {{ ok: true, grams: number, profile: Object } | { ok: false, message: string }}
 */
export function estimatePackedWeight(productGrams, profileId) {
  const grams = toGrams(productGrams);
  if (grams === null) return { ok: false, message: "Scrie greutatea produsului, în grame." };
  if (Number.isNaN(grams) || grams <= 0) return { ok: false, message: "Greutatea produsului trebuie să fie un număr pozitiv (grame)." };

  const profile = PACKAGING_PROFILES.find((item) => item.id === profileId);
  if (!profile) return { ok: false, message: "Alege cum ambalezi produsul." };

  const total = Math.ceil(grams + profile.addGrams);
  const max = SHIPPING_LIMITS.maxWeightGrams;
  if (total > max) return { ok: false, message: "Coletul depășește greutatea maximă acceptată pentru livrare." };

  return { ok: true, grams: total, profile };
}

/**
 * Greutatea FINALĂ confirmată de vânzător -> validată cu regula serverului.
 * @returns {{ ok: true, grams: number, kg: number } | { ok: false, message: string }}
 */
export function checkConfirmedWeight(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, message: "Confirmă greutatea coletului." };
  const result = validateShippingProfile({ shippingWeightGrams: raw });
  if (!result.ok) return { ok: false, message: result.message };
  const grams = result.data.shippingWeightGrams;
  return { ok: true, grams, kg: gramsToSamedayKg(grams) };
}
