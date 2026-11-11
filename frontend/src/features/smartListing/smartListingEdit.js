// src/features/smartListing/smartListingEdit.js
//
// Editarea unui produs EXISTENT în interfața Smart Listing (doar `vite dev` + flag).
// Regula de bază: datele existente au prioritate față de interfață.
//
//   - Formularul pornește din produsul încărcat cu ACEEAȘI mapare ca editorul actual
//     (productFormFromApi), deci nimic nu e reinterpretat.
//   - La salvare se trimit DOAR câmpurile modificate efectiv: comparăm
//     buildProductPayload(original) cu buildProductPayload(editat) - aceeași funcție,
//     aceleași normalizări -> un câmp neatins dă exact aceeași valoare și NU se trimite.
//     PUT /api/vendors/products/:id e parțial: ce lipsește din cerere rămâne neschimbat.
//   - Câmpurile care se validează împreună pe server pleacă împreună (disponibilitatea,
//     configurația de comandă, GPSR, video).
//   - Variantele, personalizarea, cererea de ofertă și profilul de livrare NU se editează
//     aici (le păstrăm exact cum sunt; „Editorul avansat” rămâne pentru ele).

import { buildProductPayload } from "../../pages/Vendor/ProfilMagazin/utils/productPayload.js";
import { productFormFromApi } from "../../pages/Vendor/ProfilMagazin/utils/productFormFromApi.js";

// sursa confirmării GPSR (setul acceptat de server: smart_listing | product_modal | catalog | other)
export const SMART_LISTING_EDIT_SOURCE = "smart_listing";

// câmpuri care pleacă împreună când oricare dintre ele se schimbă
export const EDIT_FIELD_GROUPS = Object.freeze([
  Object.freeze(["availability", "leadTimeDays", "readyQty", "nextShipDate"]),
  Object.freeze(["orderMode", "optionsSchema", "customSchema", "repeatedGroups", "quoteSchema", "acceptsCustom"]),
  Object.freeze([
    "isOwnManufacturer",
    "manufacturerName",
    "manufacturerAddress",
    "manufacturerEmail",
    "manufacturerInEU",
    "responsiblePersonName",
    "responsiblePersonAddress",
    "responsiblePersonEmail",
    "safetyWarnings",
    "isForChildren",
  ]),
  Object.freeze(["videoUrl", "videoMuted"]),
]);

// ce poate schimba vânzătorul în acest editor (restul rămâne exact cum e)
export const EDITABLE_FIELDS = Object.freeze([
  "title",
  "description",
  "category",
  "images",
  "price",
  "availability",
  "readyQty",
  "leadTimeDays",
  "nextShipDate",
  "color",
  "materialMain",
  "technique",
  "dimensions",
  "styleTags",
  "occasionTags",
  "careInstructions",
  "specialNotes",
  "isOwnManufacturer",
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "manufacturerInEU",
  "responsiblePersonName",
  "responsiblePersonAddress",
  "responsiblePersonEmail",
  "safetyWarnings",
  "isForChildren",
]);

/** Produsul din GET /api/vendors/products/:id -> formularul (aceeași mapare ca editorul actual). */
export function editFormFromProduct(full) {
  return productFormFromApi(full || {});
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

const same = (a, b) => stableStringify(a) === stableStringify(b);

/*
 * Payloadul ORIGINALULUI, doar pentru comparație. Un produs vechi poate avea un câmp
 * pe care buildProductPayload îl cere (titlu / categorie); punem un substituent DOAR
 * aici, ca acel câmp să apară „schimbat” numai dacă vânzătorul îl completează.
 */
function originalPayload(originalForm) {
  try {
    return buildProductPayload(originalForm);
  } catch {
    return buildProductPayload({
      ...originalForm,
      title: originalForm.title || "\u0000",
      category: originalForm.category || "\u0000",
      price: Number.isFinite(Number(originalForm.price)) && Number(originalForm.price) >= 0 ? originalForm.price : 0,
    });
  }
}

/**
 * Ce se trimite la salvare. Aruncă validările lui buildProductPayload pentru forma
 * editată (titlu, categorie, preț), ca vânzătorul să le vadă.
 * @returns {{ payload: Object, changed: string[] }}
 */
export function buildEditPayload(originalForm, editedForm) {
  const before = originalPayload(originalForm);
  const after = buildProductPayload(editedForm);

  const changed = new Set(
    Object.keys(after).filter((key) => key !== "gpsrConfirmation" && !same(before[key], after[key]))
  );
  for (const group of EDIT_FIELD_GROUPS) {
    if (group.some((key) => changed.has(key))) for (const key of group) if (key in after) changed.add(key);
  }

  const payload = {};
  for (const key of changed) payload[key] = after[key];
  if (after.gpsrConfirmation) payload.gpsrConfirmation = after.gpsrConfirmation;
  return { payload, changed: [...changed] };
}

export function hasEditChanges(originalForm, editedForm) {
  try {
    return buildEditPayload(originalForm, { ...editedForm, gpsrConfirmed: false }).changed.length > 0;
  } catch {
    // formular invalid (ex. titlu șters) = modificat
    return true;
  }
}

/** Produsul s-a schimbat pe server după ce l-am deschis? (altă fereastră / alt dispozitiv) */
export function changedSinceLoaded(loaded, current) {
  const a = loaded?.updatedAt ? new Date(loaded.updatedAt).getTime() : null;
  const b = current?.updatedAt ? new Date(current.updatedAt).getTime() : null;
  return a !== null && b !== null && a !== b;
}

/* ---------------- AI: doar propuneri, acceptate una câte una ---------------- */

// AI-ul poate propune doar text de prezentare; NICIODATĂ preț, stoc, variante, poze,
// dimensiuni, materiale, producător, GPSR sau avertismente.
export const EDIT_AI_FIELDS = Object.freeze(["title", "description", "category", "styleTags", "occasionTags", "careInstructions"]);
// completare, nu înlocuire: propus doar dacă e gol acum
const FILL_ONLY_FIELDS = new Set(["careInstructions"]);

const asFormValue = (field, value) =>
  (field === "styleTags" || field === "occasionTags") && Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).join(", ")
    : typeof value === "string"
    ? value
    : value == null
    ? ""
    : String(value);

const normText = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Propunerile AI pentru editare (nimic aplicat). */
export function editSuggestionsFromProposal(form, proposal) {
  const out = [];
  for (const field of EDIT_AI_FIELDS) {
    const entry = proposal?.fields?.[field];
    if (!entry) continue;
    const proposed = asFormValue(field, entry.value);
    if (!proposed.trim()) continue;
    const current = form?.[field] ?? "";
    if (FILL_ONLY_FIELDS.has(field) && String(current).trim()) continue;
    if (normText(current) === normText(proposed)) continue;
    out.push({ field, current: String(current ?? ""), proposed, reason: entry.reason || "" });
  }
  return out;
}

/** Acceptă O propunere: doar acel câmp se schimbă. */
export function acceptEditSuggestion(form, suggestion) {
  if (!suggestion || !EDIT_AI_FIELDS.includes(suggestion.field)) return form;
  return { ...form, [suggestion.field]: suggestion.proposed };
}

/* ---------------- colecții ---------------- */

/**
 * Ce se schimbă în colecții. Se elimină DOAR din colecțiile în care știm sigur că
 * produsul era (încărcate cu succes); nimic nu se elimină „din necunoaștere”.
 */
export function planCollectionChanges({ initialIds = [], selectedIds = [], knownIds = [] }) {
  const initial = new Set(initialIds);
  const selected = new Set(selectedIds);
  const known = new Set(knownIds);
  return {
    attach: [...selected].filter((id) => !initial.has(id)),
    detach: [...initial].filter((id) => !selected.has(id) && known.has(id)),
  };
}
