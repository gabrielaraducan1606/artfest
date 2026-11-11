// src/features/smartListing/smartListingHelpRequest.js
//
// „Cere ajutor echipei Artfest”: salvează produsul NOU privat și deschide solicitarea
// existentă de verificare. Fără endpointuri noi:
//   1. POST /api/vendors/store/:slug/products (validările serverului rămân neschimbate);
//   2. POST .../review-request al produsului creat (notificarea Admin și panoul
//      „Verificare solicitată” există deja; solicitarea e idempotentă pe server).
//
// Privat = isActive:false ȘI isHidden:true: unele căutări publice filtrează doar unul
// dintre câmpuri, iar moderarea AI schimbă doar statusul, niciodată vizibilitatea.
//
// Configurația care nu trece încă de validări (de aceea cere vânzătorul ajutor) nu se
// trimite ca schemă: serverul ar refuza produsul. Ajunge în mesajul către Admin.

import { buildProductPayload } from "../../pages/Vendor/ProfilMagazin/utils/productPayload.js";
import { createEndpoint } from "./smartListingSave.js";

export const HELP_NOTE_MAX = 1000; // REVIEW_REQUEST_NOTE_MAX din backend
// limita afișată vânzătorului: restul rămâne pentru ce a încercat să configureze
export const HELP_MESSAGE_MAX = 700;
const SUMMARY_CUT = "\n[rezumat scurtat]";

export function reviewRequestEndpoint(productId) {
  return `/api/vendors/products/${encodeURIComponent(productId)}/review-request`;
}

/** Ce cere serverul pentru orice produs nou. Fără acestea, nu poate fi salvat nici privat. */
export function missingForPrivateSave(form = {}) {
  const missing = [];
  if (!String(form.title || "").trim()) missing.push({ field: "title", step: "details", label: "titlul" });
  if (!String(form.category || "").trim()) missing.push({ field: "category", step: "details", label: "categoria" });
  if (!(Number(form.price) > 0)) missing.push({ field: "price", step: "sell", label: "prețul de bază" });
  if (!(Array.isArray(form.images) && form.images.some((url) => /^https?:\/\//i.test(String(url))))) {
    missing.push({ field: "images", step: "photos", label: "cel puțin o fotografie încărcată" });
  }
  return missing;
}

/**
 * Forma pentru salvarea privată. Păstrează tot ce e valid; configurația invalidă
 * (`configErrors`) sau termenul lipsă nu blochează salvarea, ci rămân în mesajul către Admin.
 */
export function privateHelpForm(form, { configErrors = [] } = {}) {
  const next = { ...form };
  const madeToOrderWithoutLead = next.availability === "MADE_TO_ORDER" && !(Number(next.leadTimeDays) > 0);
  const emptyOptions = next.orderMode === "OPTIONS" && !(next.optionsSchema?.length || next.customSchema?.length);

  if (configErrors.length || emptyOptions) {
    next.orderMode = "READY_TO_BUY";
    next.acceptsCustom = false;
    next.optionsSchema = [];
    next.customSchema = [];
    next.repeatedGroups = [];
    next.quoteSchema = [];
    next.availability = "READY";
    next.readyQty = next.readyQty === "" || next.readyQty == null ? 0 : next.readyQty;
    next.leadTimeDays = "";
  } else if (madeToOrderWithoutLead) {
    // nu inventăm un termen: produsul e privat, iar termenul se stabilește la configurare
    next.availability = "READY";
    next.readyQty = 0;
    next.leadTimeDays = "";
  }
  return next;
}

/** Payloadul de creare, întotdeauna nevizibil public. */
export function buildPrivateProductPayload(form, options) {
  return { ...buildProductPayload(privateHelpForm(form, options)), isActive: false, isHidden: true };
}

function configSummary({ variants = [], customFields = [], form = {} }) {
  const lines = [];
  for (const variant of variants) {
    const values = (variant.values || []).map((value) => (value.deltaLei ? `${value.label} (+${value.deltaLei} lei)` : value.label)).join(", ");
    if (variant.label || values) lines.push(`Variantă dorită: ${variant.label || "fără nume"}: ${values || "fără valori"}`);
  }
  for (const field of customFields) {
    if (field.label) lines.push(`Personalizare dorită: ${field.label}${field.required ? " (obligatoriu)" : ""}`);
  }
  if (form.availability === "MADE_TO_ORDER" && !(Number(form.leadTimeDays) > 0)) lines.push("Termenul de realizare nu este completat.");
  return lines;
}

/** Mesajul pentru Admin: textul vânzătorului are prioritate, restul încape cât rămâne. */
export function buildHelpNote({ message, variants, customFields, form }) {
  const own = String(message || "").trim();
  const summary = configSummary({ variants, customFields, form });
  const note = summary.length ? `${own}\n\nCe a încercat să configureze:\n${summary.join("\n")}` : own;
  if (note.length <= HELP_NOTE_MAX) return note;
  // se scurtează doar rezumatul, iar Adminul vede asta; mesajul are limita lui în formular
  return `${note.slice(0, HELP_NOTE_MAX - SUMMARY_CUT.length)}${SUMMARY_CUT}`;
}

/**
 * Trimite solicitarea, fără duplicate la reîncercare:
 *   - `state.product` există deja: produsul nu se mai creează, se reia doar solicitarea;
 *   - `state.ambiguous` (răspuns pierdut): căutăm întâi produsul pe server.
 * `state` e un obiect păstrat de pagină între încercări.
 *
 * @returns {Promise<Object>} produsul creat
 */
export async function submitHelpRequest({ api, storeSlug, form, note, configErrors = [], findExisting, state }) {
  if (!state.product) {
    const payload = buildPrivateProductPayload(form, { configErrors });
    let existing = null;
    if (state.ambiguous) existing = await findExisting({ api, storeSlug, form });
    try {
      state.product = existing || (await api(createEndpoint(storeSlug), { method: "POST", body: payload }));
    } catch (error) {
      if (!error?.status) state.ambiguous = true;
      throw error;
    }
    state.ambiguous = false;
  }
  const review = await api(reviewRequestEndpoint(state.product.id), { method: "POST", body: { note, holdPrivate: true } });
  state.reviewRequestId = review?.reviewRequest?.id || null;
  return state.product;
}
