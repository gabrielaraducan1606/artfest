// src/lib/productValidationErrors.js
//
// Corpul răspunsurilor 400 de la salvarea unui produs (vendorProductRoutes:
// creare + editare) pentru codurile care până acum nu aveau `message`.
// Codul `error` rămâne neschimbat (compatibil cu clienții existenți); se adaugă
// doar explicația pentru vânzător și câmpul din payload la care se referă.

const MESSAGES = {
  invalid_title: "Completează titlul produsului.",
  invalid_category: "Categoria aleasă nu există. Alege din nou categoria principală.",
  invalid_additional_category: "Una dintre categoriile suplimentare nu există. Alege din nou categoriile produsului.",
  invalid_additional_categories: "Categoriile suplimentare nu sunt valide.",
  too_many_additional_categories: "Poți alege cel mult 3 categorii suplimentare.",
  availability_required: "Alege dacă produsul este în stoc sau se face la comandă.",
  invalid_availability: "Alege dacă produsul este în stoc sau se face la comandă.",
  invalid_ready_qty: "Stocul trebuie să fie un număr, 0 sau mai mare.",
  invalid_lead_time: "Scrie în câte zile realizezi produsul (cel puțin 1).",
  invalid_next_ship_date: "Data de livrare nu este validă.",
  invalid_order_mode: "Alege cum se comandă produsul.",
};

const FIELDS = {
  invalid_title: "title",
  invalid_category: "category",
  invalid_additional_category: "additionalCategories",
  invalid_additional_categories: "additionalCategories",
  too_many_additional_categories: "additionalCategories",
  availability_required: "availability",
  invalid_availability: "availability",
  invalid_ready_qty: "readyQty",
  invalid_lead_time: "leadTimeDays",
  invalid_next_ship_date: "nextShipDate",
  invalid_order_mode: "orderMode",
};

/**
 * @param {string} error - codul existent
 * @param {object} [extra] - câmpuri suplimentare (ex. `detail`); un `message` explicit are prioritate
 */
export function productValidationBody(error, extra = {}) {
  const body = { error };
  if (FIELDS[error]) body.field = FIELDS[error];
  if (MESSAGES[error]) body.message = MESSAGES[error];
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}
