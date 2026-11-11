// src/utils/gpsrAddressHelp.js
//
// Ajutor pentru adresa profesională GPSR, prin tichetul de suport existent
// (POST /api/vendor/support/tickets). Nu salvează nimic în datele GPSR: mesajul pleacă
// la echipa Artfest, iar vânzătorul și magazinul vin din cont.
//
// Adresa GPSR e adresa poștală de contact a producătorului. Easybox-ul ține de logistică
// (predarea sau primirea coletelor) și nu o poate înlocui.

import {
  HELP_REQUEST_SUBJECTS,
  HELP_REQUEST_TYPES,
  helpTypeOfTicket,
  parseHelpTicketBody,
} from "../../../backend/src/lib/supportHelpRequests.js";

export const GPSR_HELP_SUBJECT = HELP_REQUEST_SUBJECTS.gpsr_help;
export const GPSR_HELP_ENDPOINT = "/api/vendor/support/tickets";
export const GPSR_HELP_NOTE_MAX = 1000;

export const GPSR_LOCKER_ERROR =
  "Un easybox, locker sau punct de ridicare nu poate fi folosit ca adresă a producătorului. Dacă nu știi ce adresă să completezi, cere ajutor Artfest.";

const LOCKER_PATTERNS = [
  /\beasy\s*box\b/i,
  /\blocker(ul|e)?\b/i,
  /\bpudo\b/i,
  /\bpunct(ul)?\s+de\s+(ridicare|colectare)\b/i,
  /\bout\s*of\s*home\b/i,
  /\bfan\s*box\b/i,
  /\bsameday\b/i,
];

export function isLockerAddress(address) {
  const value = String(address ?? "");
  return LOCKER_PATTERNS.some((pattern) => pattern.test(value));
}

export function storeSlugFromPath(pathname = "") {
  const match = String(pathname).match(/^\/magazin\/([^/?#]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/** O cheie per mesaj: aceeași la reîncercare / dublu-click = un singur tichet pe server. */
export function newHelpRequestKey() {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return random.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/**
 * Tichetul trimis: mesajul vânzătorului NEMODIFICAT + contextul (tip, magazin, produs /
 * ciornă). Fără adrese sau alte date din cont: serverul asociază vânzătorul, data și
 * verifică produsul, apoi adaugă detaliile în tichet.
 */
export function buildGpsrHelpTicket({ note, storeSlug = "", productId = null, draftId = null, requestKey = null }) {
  return {
    subject: GPSR_HELP_SUBJECT,
    category: HELP_REQUEST_TYPES.GPSR,
    priority: "medium",
    message: String(note || "").trim(),
    attachments: [],
    context: {
      type: HELP_REQUEST_TYPES.GPSR,
      ...(storeSlug ? { storeSlug } : {}),
      ...(productId ? { productId: String(productId) } : {}),
      ...(draftId ? { draftId: String(draftId) } : {}),
    },
    ...(requestKey ? { requestKey } : {}),
  };
}

export function sendGpsrHelpRequest({ api, note, storeSlug, productId, draftId, requestKey }) {
  return api(GPSR_HELP_ENDPOINT, { method: "POST", body: buildGpsrHelpTicket({ note, storeSlug, productId, draftId, requestKey }) });
}

export function isGpsrHelpTicket(ticket) {
  return (ticket?.helpType || helpTypeOfTicket(ticket)) === HELP_REQUEST_TYPES.GPSR;
}

/** Mesajul integral al vânzătorului + magazinul / produsul, pentru Admin (și tichetele vechi). */
export function splitGpsrHelpBody(body) {
  const { message, details, context } = parseHelpTicketBody(body);
  return { message, storeSlug: context.storeSlug, details, context };
}
