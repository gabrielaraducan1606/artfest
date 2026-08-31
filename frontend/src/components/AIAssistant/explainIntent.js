// src/components/AIAssistant/explainIntent.js

/*
 * Ghid comun pentru ambele widget-uri AI (Vendor Assistant și
 * AiAssistant client) - regulă semantică generală, NU hardcodată
 * pe fraze specifice: dacă mesajul e formulat ca întrebare
 * explicativă ("cum", "unde", "ce este", "pot", "există" etc.),
 * NU e o cerere de execuție/acțiune locală, indiferent ce verbe
 * de acțiune sau nume proprii conține mai departe - trebuie
 * deferat întotdeauna la copilotul general (knowledge retrieval +
 * clasificare LLM completă), care distinge EXPLAIN de EXECUTE la
 * nivel semantic.
 *
 * Extras din vendorIntent.js (unde a fost introdus inițial ca
 * fix pentru "Cum adaug produse cu Shopify?") ca să nu existe
 * două implementări care pot diverge - AiAssistant.jsx avea
 * propriul router de cuvinte-cheie, fără nicio protecție
 * echivalentă, ceea ce permitea unor întrebări pur explicative să
 * deschidă direct fluxuri de suport/căutare/tracking.
 */

export function normalizeForIntentDetection(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPLAIN_INTENT_PREFIXES = [
  "cum pot",
  "cum fac",
  "cum se",
  "cum imi",
  "cum ii",
  "cum",
  "unde gasesc",
  "unde",
  "ce este",
  "ce inseamna",
  "ce fac",
  "ce se intampla",
  "ce pot face",
  "pot sa",
  "pot",
  "se poate",
  "exista",
  "care este diferenta",
  "care e diferenta",
  "care",
  "cine",
  "de ce",
  "ma ajuti",
  "ma poti ajuta",
  "ma puteti ajuta",
  "aveti",
  "puteti",
  "trebuie sa",
  "e nevoie sa",
  "am nevoie sa",
];

export function isExplainIntentMessage(normalized) {
  if (!normalized) return false;

  return EXPLAIN_INTENT_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix} `)
  );
}

/*
 * BUGFIX (audit) - fix SISTEMIC, nu whack-a-mole: o listă de
 * prefixe, oricât de lungă, tot rămâne finită și pică pentru orice
 * formulare nouă neanticipată ("Cine vinde produsele de pe
 * Artfest?", "Artfest are stoc propriu?" - nu încep cu niciun
 * prefix din listă, deși sunt clar întrebări explicative). Regulă
 * generală, pe FORMA propoziției: dacă mesajul se termină cu semnul
 * întrebării și NU începe cu un verb la imperativ/o comandă directă
 * cunoscută, e o întrebare - trebuie deferată la copilotul general
 * (clasificare LLM completă), nu interceptată de un regex local de
 * cuvinte-cheie. Verificat pe textul BRUT (înainte de normalizare -
 * normalizeForIntentDetection elimină semnul "?").
 */
const IMPERATIVE_COMMAND_PREFIXES = [
  "cauta",
  "caută",
  "gaseste",
  "găsește",
  "gaseste-mi",
  "găsește-mi",
  "arata-mi",
  "arată-mi",
  "adauga",
  "adaugă",
  "sterge",
  "șterge",
  "du-ma",
  "du-mă",
  "deschide",
  "trimite",
  "creeaza",
  "creează",
  "schimba",
  "schimbă",
  "muta",
  "mută",
  "pune",
];

export function isLikelyExplainQuestion(rawText = "") {
  const trimmed = String(rawText || "").trim();

  if (!trimmed.endsWith("?")) {
    return false;
  }

  const normalized = normalizeForIntentDetection(trimmed);

  if (!normalized) {
    return false;
  }

  const startsWithImperative = IMPERATIVE_COMMAND_PREFIXES.some(
    (verb) =>
      normalized === verb ||
      normalized.startsWith(`${verb} `)
  );

  return !startsWithImperative;
}
