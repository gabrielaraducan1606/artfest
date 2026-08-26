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
  "pot sa",
  "pot",
  "se poate",
  "exista",
  "care este diferenta",
  "de ce",
];

export function isExplainIntentMessage(normalized) {
  if (!normalized) return false;

  return EXPLAIN_INTENT_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix} `)
  );
}
