// src/utils/gpsrNotice.js
//
// Informarea GPSR pentru creatori (Smart Listing + ProductModal). Textele vin
// din sursa unică de pe server (backend/src/lib/gpsrNoticeVersions.js), ca
// versiunea afișată să fie exact cea înregistrată la confirmare. Text de
// informare, NU consultanță juridică și NU certificare oferită de Artfest.

import {
  CURRENT_GPSR_NOTICE,
  CURRENT_GPSR_NOTICE_VERSION,
  GPSR_REGULATION_URL as REGULATION_URL,
} from "../../../backend/src/lib/gpsrNoticeVersions.js";

export const GPSR_NOTICE_VERSION = CURRENT_GPSR_NOTICE_VERSION;
export const GPSR_REGULATION_URL = REGULATION_URL;
export const GPSR_NOTICE_TITLE = CURRENT_GPSR_NOTICE.title;
export const GPSR_NOTICE_SUMMARY = CURRENT_GPSR_NOTICE.summary;
export const GPSR_NOTICE_POINTS = CURRENT_GPSR_NOTICE.points;
export const GPSR_NOTICE_DISCLAIMER = CURRENT_GPSR_NOTICE.disclaimer;
export const GPSR_CONFIRMATION_TEXT = CURRENT_GPSR_NOTICE.confirmationText;

// Indicație de interfață (nu face parte din informarea versionată): rezumatul vizibil
// inițial. Informarea completă (rezumat, puncte, mențiune) rămâne în secțiunea extensibilă.
export const GPSR_NOTICE_TEASER =
  "Produsele comercializate trebuie să respecte cerințele de siguranță aplicabile. Verifică datele producătorului și informațiile de siguranță înainte de publicare.";
export const GPSR_NOTICE_MORE_LABEL = "Ce trebuie să știu despre GPSR?";

// Câmpurile de siguranță, aceleași în Smart Listing și ProductModal (datele salvate nu se schimbă:
// safetyWarnings = null nerăspuns, "" = nu sunt necesare, text = avertismentele).
export const GPSR_WARNINGS_QUESTION = "Are nevoie de avertismente sau instrucțiuni de siguranță?";
export const GPSR_WARNINGS_HINT =
  "De exemplu: piese mici, flacără deschisă, materiale fragile, alergeni sau o anumită folosire. Scrie-le clar, în limba română.";
export const GPSR_CHILDREN_QUESTION = "Este destinat copiilor?";
export const GPSR_CHILDREN_HINT =
  "Pentru jucării și alte articole pentru copii se pot aplica reguli suplimentare (de exemplu marcajul CE pentru jucării). Verifică-le înainte de publicare.";

/** Răspunsul afișat la întrebarea despre avertismente: "yes" | "no" | null (nerăspuns). */
export function gpsrWarningsAnswer(safetyWarnings, chosenYes = false) {
  if (safetyWarnings === "") return "no";
  if (typeof safetyWarnings === "string" && safetyWarnings.trim()) return "yes";
  return chosenYes ? "yes" : null;
}
