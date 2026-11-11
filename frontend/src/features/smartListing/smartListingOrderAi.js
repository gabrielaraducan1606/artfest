// src/features/smartListing/smartListingOrderAi.js
//
// Configurarea variantelor și a personalizării din limbaj natural, cu asistentul
// EXISTENT: POST /api/ai/product-order-assistant (aiRoutes.js, același model și
// același prompt ca VendorProductWizard). Aici doar transformăm răspunsul într-o
// propunere pe care vânzătorul o verifică. Nu se aplică nimic automat.
//
// Din răspuns folosim doar structura. Prețul, stocul, termenul și disponibilitatea
// se ignoră mereu, chiar dacă modelul le întoarce.
//
// Diferențele de preț vin doar din sumele spuse explicit de vânzător (verificate pe
// server: optionPriceDeltas). Apar precompletate în rezumat, unde le poate modifica.

import { normalizeForCompare } from "./smartListingProposal.js";

export const ORDER_AI_ENDPOINT = "/api/ai/product-order-assistant";
export const ORDER_AI_MAX_MESSAGE = 3000;
export const ORDER_AI_MAX_IMAGES = 4;

export const APPLY_MODES = Object.freeze({
  COMPLETE: "complete",
  REPLACE: "replace",
});

const CUSTOM_TYPES = new Set(["text", "textarea", "date", "file"]);
// câmpurile implicite ale cererii de ofertă, adăugate oricum de formular
const DEFAULT_QUOTE_KEYS = new Set(["description", "inspiration_images", "inspirationImages"]);

function context(form = {}) {
  return {
    title: form.title || "",
    description: form.description || "",
    category: form.category || "",
    color: form.color || "",
    materialMain: form.materialMain || "",
    technique: form.technique || "",
    dimensions: form.dimensions || "",
    orderMode: form.orderMode || "READY_TO_BUY",
  };
}

function realValues(options) {
  const seen = new Set();
  const values = [];
  for (const raw of Array.isArray(options) ? options : []) {
    const label = String(raw ?? "").trim();
    const key = normalizeForCompare(label);
    // `[object Object]` = un obiect transformat în text de server, nu o valoare reală
    if (!label || label.startsWith("[object") || seen.has(key)) continue;
    seen.add(key);
    values.push({ label, deltaLei: "" });
  }
  return values;
}

/** Răspunsul endpointului -> propunerea afișată. Fără preț, stoc sau termen. */
export function proposalFromOrderAssistant(response = {}) {
  const patch = response?.patch && typeof response.patch === "object" ? response.patch : {};
  const orderMode = String(patch.orderMode || "").toUpperCase();

  const variants = (Array.isArray(patch.optionsSchema) ? patch.optionsSchema : [])
    .map((field) => ({
      key: String(field?.key || ""),
      label: String(field?.label || "").trim(),
      required: field?.required !== false,
      values: realValues(field?.options),
    }))
    .filter((variant) => variant.label);

  for (const item of Array.isArray(response?.optionPriceDeltas) ? response.optionPriceDeltas : []) {
    const variant = variants.find((entry) => entry.key === item?.optionKey);
    const value = variant?.values.find((entry) => normalizeForCompare(entry.label) === normalizeForCompare(item?.value));
    if (value && Number(item?.deltaLei) > 0) value.deltaLei = String(item.deltaLei).replace(".", ",");
  }

  const source =
    orderMode === "QUOTE_ONLY"
      ? (Array.isArray(patch.quoteSchema) ? patch.quoteSchema : []).filter((field) => !DEFAULT_QUOTE_KEYS.has(field?.key))
      : Array.isArray(patch.customSchema)
        ? patch.customSchema
        : [];

  const customFields = source
    .map((field) => ({
      label: String(field?.label || "").trim(),
      type: CUSTOM_TYPES.has(field?.type) ? field.type : "text",
      required: field?.required === true,
      description: String(field?.description || "").trim(),
    }))
    .filter((field) => field.label);

  return {
    message: String(response?.message || "").trim(),
    questions: (Array.isArray(response?.questions) ? response.questions : []).map((item) => String(item || "").trim()).filter(Boolean),
    suggestsQuote: orderMode === "QUOTE_ONLY",
    variants,
    customFields,
    hasConfig: variants.length > 0 || customFields.length > 0,
  };
}

export function describeOrderAiError(error) {
  const status = Number(error?.status) || null;
  if (error?.code === "preview_blocked") return "Previzualizare: asistentul AI este dezactivat.";
  if (status === 401 || status === 403) return "Sesiunea a expirat. Autentifică-te din nou. Ce ai completat rămâne în ciornă.";
  if (status === 429) return "Ai atins limita de cereri AI pentru moment. Poți configura manual sau poți cere ajutor echipei Artfest.";
  return "Asistentul AI nu este disponibil acum. Poți configura manual sau poți cere ajutor echipei Artfest.";
}

/**
 * @param {{ api: Function, message: string, form: Object, history?: Array, images?: string[] }} input
 * @returns {Promise<Object>} propunerea (proposalFromOrderAssistant)
 */
export async function askOrderAssistant({ api, message, form, history = [], images = [] }) {
  const clean = String(message || "").trim().slice(0, ORDER_AI_MAX_MESSAGE);
  if (!clean) throw new Error("Scrie ce variante și personalizări vrei să oferi.");
  const response = await api(ORDER_AI_ENDPOINT, {
    method: "POST",
    body: {
      message: clean,
      product: context(form),
      history: history.slice(-10),
      images: images.filter((url) => /^https?:\/\//i.test(String(url))).slice(0, ORDER_AI_MAX_IMAGES),
    },
  });
  return proposalFromOrderAssistant(response);
}

function sameLabel(a, b) {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

/**
 * Aplică propunerea peste configurația vânzătorului.
 *   complete: adaugă doar ce lipsește; ce a scris vânzătorul rămâne neschimbat;
 *   replace:  folosește propunerea (doar după confirmare explicită în interfață).
 * Nu atinge prețul, stocul, termenul sau alte câmpuri.
 *
 * @param {{ variants: Array, customFields: Array }} current
 * @param {{ variants: Array, customFields: Array }} proposal
 * @param {string} mode APPLY_MODES
 * @param {(prefix: string) => string} makeId
 */
export function mergeOrderConfig(current, proposal, mode, makeId) {
  const toVariant = (variant) => ({
    id: makeId("variant"),
    label: variant.label,
    required: variant.required !== false,
    values: (variant.values || []).map((value) => ({ id: makeId("value"), label: value.label, deltaLei: value.deltaLei || "" })),
  });
  const toField = (field) => ({
    id: makeId("custom"),
    label: field.label,
    type: field.type || "text",
    required: field.required === true,
    description: field.description || "",
  });

  if (mode === APPLY_MODES.REPLACE) {
    return { variants: (proposal.variants || []).map(toVariant), customFields: (proposal.customFields || []).map(toField) };
  }

  const variants = (current.variants || []).map((variant) => ({ ...variant }));
  for (const proposed of proposal.variants || []) {
    const existing = variants.find((variant) => sameLabel(variant.label, proposed.label));
    if (!existing) {
      variants.push(toVariant(proposed));
      continue;
    }
    // aceeași variantă: doar valorile noi; diferențele scrise de vânzător rămân
    const extra = (proposed.values || []).filter((value) => !(existing.values || []).some((item) => sameLabel(item.label, value.label)));
    // o sumă propusă completează doar o valoare fără sumă
    const kept = (existing.values || []).map((item) => {
      const match = (proposed.values || []).find((value) => sameLabel(value.label, item.label));
      return !String(item.deltaLei || "").trim() && match?.deltaLei ? { ...item, deltaLei: match.deltaLei } : item;
    });
    existing.values = [...kept, ...extra.map((value) => ({ id: makeId("value"), label: value.label, deltaLei: value.deltaLei || "" }))];
  }

  const customFields = [...(current.customFields || [])];
  for (const proposed of proposal.customFields || []) {
    if (!customFields.some((field) => sameLabel(field.label, proposed.label))) customFields.push(toField(proposed));
  }

  return { variants, customFields };
}
