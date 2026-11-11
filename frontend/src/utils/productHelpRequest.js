// src/utils/productHelpRequest.js
//
// „Ajutor la adăugarea unui produs” (fără produs salvat) -> sistemul EXISTENT de suport:
//   POST /api/vendor/support/tickets  (vendorSupportRoutes.js)
//   { subject, category: "product_help", priority, message, attachments, context, requestKey }
// Folosit de ProductModal (produs nou) și de Smart Listing. NU creează și NU publică
// produsul; nu trimite adrese și nici datele producătorului - doar ce descrie produsul.
// Serverul stabilește vânzătorul, contul și data și adaugă contextul în tichet.

import { CATEGORY_LABELS } from "../../../backend/src/constants/categories.js";
import {
  HELP_MESSAGE_MAX,
  HELP_REQUEST_SUBJECTS,
  HELP_REQUEST_TYPES,
  PRODUCT_DRAFT_MARKER,
} from "../../../backend/src/lib/supportHelpRequests.js";

export const HELP_ENDPOINT = "/api/vendor/support/tickets";
export const HELP_CATEGORY = HELP_REQUEST_TYPES.PRODUCT;
const MAX_ATTACHMENTS = 5;

const STEP_LABELS = {
  photos: "Fotografii și video",
  details: "Detalii",
  sell: "Preț și opțiuni",
  review: "Publicare",
};

const SOURCE_LABELS = {
  smart_listing: "Adaugă produs (formularul nou)",
  product_modal: "Editorul de produs",
};

function formatLei(cents) {
  if (!Number.isFinite(cents)) return "-";
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return `${value.endsWith(",00") ? value.slice(0, -3) : value} lei`;
}

/**
 * Mesajul vânzătorului e trimis NEMODIFICAT, urmat de ce a completat deja în formular.
 *
 * @param {{ note: string, step?: string, form: Object, photos: string[], storeSlug: string,
 *   draftId?: string|null, source?: "smart_listing"|"product_modal", requestKey?: string|null }} input
 */
export function buildHelpTicket({ note, step, form = {}, photos = [], storeSlug = "", draftId = null, source = "smart_listing", requestKey = null }) {
  const own = String(note || "").trim();
  const lines = [
    own,
    "",
    PRODUCT_DRAFT_MARKER,
    `Formular: ${SOURCE_LABELS[source] || source}`,
    ...(step ? [`Pasul curent: ${STEP_LABELS[step] || step}`] : []),
    `Titlu: ${form.title || "-"}`,
    `Categorie: ${CATEGORY_LABELS[form.category] || form.category || "-"}`,
    `Preț: ${Number(form.price) > 0 ? formatLei(Math.round(Number(form.price) * 100)) : "-"}`,
    `Mod de vânzare: ${form.orderMode || "-"}`,
    `Variante: ${(form.optionsSchema || []).map((field) => `${field.label} (${(field.options || []).length})`).join(", ") || "-"}`,
    `Personalizare: ${(form.customSchema || []).map((field) => field.label).join(", ") || "-"}`,
    `Fotografii: ${photos.length}`,
  ];

  const attachments = photos
    .filter((url) => /^https?:\/\//i.test(String(url)))
    .slice(0, MAX_ATTACHMENTS)
    .map((url, index) => ({ url, name: `fotografie-produs-${index + 1}` }));

  // mesajul vânzătorului nu se taie niciodată; doar detaliile din formular, dacă e nevoie
  let message = lines.join("\n");
  while (message.length > HELP_MESSAGE_MAX && lines.length > 3) {
    lines.pop();
    message = `${lines.join("\n")}\n[detalii scurtate]`;
  }

  return {
    subject: `${HELP_REQUEST_SUBJECTS.product_help}${form.title ? `: ${String(form.title).slice(0, 80)}` : ""}`,
    category: HELP_CATEGORY,
    priority: "medium",
    message,
    attachments,
    context: {
      type: HELP_REQUEST_TYPES.PRODUCT,
      ...(storeSlug ? { storeSlug } : {}),
      ...(draftId ? { draftId: String(draftId) } : {}),
    },
    ...(requestKey ? { requestKey } : {}),
  };
}

/**
 * Solicitare pe un produs SALVAT (salvat privat pentru ajutor sau „Trimite la verificare
 * Artfest”): aceeași cerere apare și ca tichet în Admin → Suport, ca adminul să poată
 * răspunde. Mesajul vânzătorului e trimis nemodificat; serverul verifică produsul.
 * Cheia derivă din solicitare: o reîncercare nu creează un al doilea tichet.
 */
export function buildSavedProductHelpTicket({ note, productId, title = "", storeSlug = "", reviewRequestId = null }) {
  return {
    subject: `${HELP_REQUEST_SUBJECTS.product_help}${title ? `: ${String(title).slice(0, 80)}` : ""}`,
    category: HELP_CATEGORY,
    priority: "medium",
    message: String(note || "").trim(),
    attachments: [],
    context: {
      type: HELP_REQUEST_TYPES.PRODUCT,
      productId: String(productId),
      ...(storeSlug ? { storeSlug } : {}),
    },
    requestKey: `rr-${String(reviewRequestId || productId).replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64),
  };
}

export async function openSavedProductHelpTicket({ api, ...input }) {
  if (!input.productId || String(input.note || "").trim().length < 3) return null;
  const response = await api(HELP_ENDPOINT, { method: "POST", body: buildSavedProductHelpTicket(input) });
  return response?.ticket?.id || null;
}

/** Trimite tichetul. Succes = doar după confirmarea serverului. @returns {Promise<{ ticketId: string }>} */
export async function requestArtfestHelp({ api, ...input }) {
  const body = buildHelpTicket(input);
  const response = await api(HELP_ENDPOINT, { method: "POST", body });
  const ticketId = response?.ticket?.id || response?.id || null;
  if (!ticketId) throw Object.assign(new Error("Nu am primit confirmarea salvării. Încearcă din nou."), { status: 0 });
  return { ticketId };
}
