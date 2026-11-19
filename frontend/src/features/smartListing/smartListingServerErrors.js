// src/features/smartListing/smartListingServerErrors.js
//
// Răspunsurile de validare ale API-ului de creare a produsului
// (POST /api/vendors/store/:slug/products) -> unde le arătăm în Smart Listing.
//
// Păstrăm ce trimite serverul: `error` (codul), `message`, `field` și, la
// protecția datelor de contact (422), `issues[].field`. Fără câmp cunoscut,
// eroarea rămâne GENERALĂ (afișată lângă butonul de publicare), dar cu codul
// serverului vizibil, ca să poată fi diagnosticată.
//
// Pur, fără React / rețea.

// câmpul din payload -> pasul și ancora din formular
const FIELD_TARGETS = {
  title: { step: "details", anchor: "sl-title" },
  description: { step: "details", anchor: "sl-description" },
  category: { step: "details", anchor: "sl-category" },
  additionalCategories: { step: "details", anchor: "sl-category" },
  color: { step: "details", anchor: "sl-color" },
  styleTags: { step: "details", anchor: "sl-style" },
  occasionTags: { step: "details", anchor: "sl-occasions" },
  materialMain: { step: "details", anchor: "sl-material" },
  technique: { step: "details", anchor: "sl-technique" },
  careInstructions: { step: "details", anchor: "sl-care" },
  dimensions: { step: "details", anchor: "sl-dimensions" },
  specialNotes: { step: "details", anchor: "sl-description" },
  images: { step: "photos", anchor: "sl-photos" },
  videoUrl: { step: "photos", anchor: "sl-photos" },
  price: { step: "sell", anchor: "sl-price" },
  readyQty: { step: "sell", anchor: "sl-stock" },
  availability: { step: "sell", anchor: "sl-stock" },
  leadTimeDays: { step: "sell", anchor: "sl-lead" },
  nextShipDate: { step: "sell", anchor: "sl-lead" },
  orderMode: { step: "sell", anchor: "sl-options" },
  optionsSchema: { step: "sell", anchor: "sl-options" },
  customSchema: { step: "sell", anchor: "sl-personalization" },
  quoteSchema: { step: "sell", anchor: "sl-options" },
  safety: { step: "review", anchor: "sl-safety" },
};

// codul serverului -> câmpul (pentru răspunsurile care nu trimit `field`)
const FIELD_BY_CODE = {
  invalid_title: "title",
  category_required: "category",
  invalid_category: "category",
  invalid_additional_category: "additionalCategories",
  invalid_additional_categories: "additionalCategories",
  too_many_additional_categories: "additionalCategories",
  invalid_price: "price",
  quote_price_required: "price",
  product_image_required: "images",
  invalid_product_images: "images",
  availability_required: "availability",
  invalid_availability: "availability",
  invalid_ready_qty: "readyQty",
  invalid_lead_time: "leadTimeDays",
  invalid_next_ship_date: "nextShipDate",
  invalid_order_mode: "orderMode",
  invalid_price_delta: "optionsSchema",
  invalid_combination_price: "optionsSchema",
  gpsr_confirmation_required: "safety",
  gpsr_notice_outdated: "safety",
};

// mesaje pentru codurile pe care un server mai vechi le trimite fără `message`
const MESSAGE_BY_CODE = {
  invalid_title: "Completează titlul produsului.",
  invalid_category: "Categoria aleasă nu mai există. Alege din nou categoria principală.",
  invalid_additional_category: "Una dintre categoriile suplimentare nu mai există. Alege din nou categoria produsului.",
  invalid_additional_categories: "Categoriile suplimentare nu sunt valide. Alege din nou categoria produsului.",
  too_many_additional_categories: "Poți alege cel mult 3 categorii suplimentare.",
  availability_required: "Alege dacă produsul este în stoc sau se face la comandă.",
  invalid_availability: "Alege dacă produsul este în stoc sau se face la comandă.",
  invalid_ready_qty: "Stocul trebuie să fie un număr întreg, 0 sau mai mare.",
  invalid_lead_time: "Scrie în câte zile realizezi produsul (cel puțin 1).",
  invalid_next_ship_date: "Data de livrare nu este validă.",
  invalid_order_mode: "Alege cum se comandă produsul.",
};

const GPSR_FIELD = /^(isOwnManufacturer|manufacturer|responsiblePerson|safetyWarnings|isForChildren|gpsr)/;

function targetForField(field) {
  const key = String(field || "").trim();
  if (!key) return null;
  if (FIELD_TARGETS[key]) return { field: key, ...FIELD_TARGETS[key] };
  if (GPSR_FIELD.test(key)) return { field: key, ...FIELD_TARGETS.safety };
  return null;
}

function targetForCode(code) {
  const key = String(code || "");
  if (FIELD_BY_CODE[key]) return targetForField(FIELD_BY_CODE[key]);
  // validateGpsrConsistency: manufacturer_name_required, responsible_person_email_invalid, ...
  if (/^(manufacturer_|responsible_person_|gpsr_|safety_warnings|is_for_children)/.test(key)) return targetForField("safety");
  return null;
}

/**
 * @returns {{
 *   code: string, status: number|null, message: string,
 *   field: string|null, step: string|null, anchor: string|null,
 *   fieldErrors: Record<string, string[]>   // ancoră -> mesaje
 * }}
 */
export function readServerValidation(error) {
  const status = Number(error?.status) || null;
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  // fără cod în răspuns (ex. pagină HTML de la un proxy): statusul HTTP
  const code = String(data.error || (status ? `http_${status}` : error?.code || "invalid"));
  const message = String(data.message || MESSAGE_BY_CODE[code] || "").trim();

  const fieldErrors = {};
  const add = (target, text) => {
    if (!target?.anchor || !text) return;
    const list = (fieldErrors[target.anchor] ||= []);
    if (!list.includes(text)) list.push(text);
  };

  // 422 date de contact: câte un mesaj pe fiecare câmp găsit
  const issues = Array.isArray(data.issues) ? data.issues : [];
  let first = null;
  for (const issue of issues) {
    const target = targetForField(issue?.field);
    add(target, issue?.message);
    first ||= target;
  }

  if (!first) {
    first = targetForField(data.field) || targetForCode(code);
    add(first, message || "Valoarea nu a fost acceptată. Verifică acest câmp.");
  }

  return {
    code,
    status,
    // o eroare fără explicație primește codul serverului, ca să poată fi raportată
    message: message || `Artfest nu a acceptat publicarea (cod: ${code}). Datele tale au rămas în ciornă. Dacă problema continuă, trimite-ne acest cod.`,
    field: first?.field || null,
    step: first?.step || null,
    anchor: first?.anchor || null,
    fieldErrors,
  };
}

/** Unește erorile locale cu cele ale serverului (ancoră -> mesaje), fără dubluri. */
export function mergeFieldErrors(...maps) {
  const out = {};
  for (const map of maps) {
    for (const [anchor, messages] of Object.entries(map || {})) {
      const list = (out[anchor] ||= []);
      for (const message of messages || []) if (message && !list.includes(message)) list.push(message);
    }
  }
  return out;
}

/**
 * Fotografiile pe care serverul NU le-ar păstra pe produs: normalizeProductImages
 * (vendorProductRoutes) acceptă doar adrese http(s). Uploaderul acceptă și căi
 * relative ("/uploads/..."), deci verificarea „gata de publicare” trebuie să le prindă.
 */
export function countUnsavableImages(urls = []) {
  return (Array.isArray(urls) ? urls : []).filter((url) => !/^https?:\/\//i.test(String(url || "").trim())).length;
}
