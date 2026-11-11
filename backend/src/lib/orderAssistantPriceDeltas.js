// backend/src/lib/orderAssistantPriceDeltas.js
//
// Diferențele de preț propuse de /api/ai/product-order-assistant. Modelul le poate
// propune doar pentru sume spuse explicit de vânzător, iar aici se verifică: orice
// sumă care nu apare în mesajele lui, sau pentru o variantă inexistentă, se elimină.
//
// Câmp separat de `patch`, ca să nu schimbe ce citesc ceilalți consumatori. Rezultatul
// e doar o propunere: nu se salvează nimic, iar vânzătorul o confirmă în formular.

import { MAX_PRICE_DELTA_CENTS } from "./variantPricing.js";

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function toCents(raw) {
  const cents = Math.round(Number(String(raw).replace(",", ".")) * 100);
  return Number.isFinite(cents) ? cents : null;
}

// „15 lei”, „15,50 ron”, „+15”, „cu 15 în plus”, „15 mai mult”; „3 culori” nu e sumă
const AMOUNT_PATTERN =
  /\+\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:de\s+)?(?:lei|leu|ron|in plus|mai mult)/g;

/** Sumele (în bani) scrise de vânzător. */
export function amountsMentioned(texts = []) {
  const found = new Set();
  for (const text of texts) {
    for (const match of normalize(text).matchAll(AMOUNT_PATTERN)) {
      const cents = toCents(match[1] ?? match[2]);
      if (cents !== null) found.add(cents);
    }
  }
  return found;
}

/**
 * @param {unknown} raw lista întoarsă de model
 * @param {{ optionsSchema: Array, message: string, history: Array<{role: string, text: string}> }} context
 * @returns {Array<{ optionKey: string, value: string, deltaLei: number }>}
 */
export function sanitizeOptionPriceDeltas(raw, { optionsSchema = [], message = "", history = [] } = {}) {
  if (!Array.isArray(raw) || !raw.length) return [];

  const mentioned = amountsMentioned([
    message,
    ...history.filter((entry) => entry?.role === "user").map((entry) => entry.text),
  ]);
  if (!mentioned.size) return [];

  const seen = new Set();
  const out = [];

  for (const item of raw) {
    const cents = toCents(item?.deltaLei);
    if (cents === null || cents <= 0 || cents > MAX_PRICE_DELTA_CENTS || !mentioned.has(cents)) continue;

    const field = optionsSchema.find((option) => option.key === item?.optionKey);
    const value = (field?.options || []).find((option) => normalize(option) === normalize(item?.value));
    if (!value) continue;

    const id = `${field.key}:${normalize(value)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ optionKey: field.key, value, deltaLei: cents / 100 });
  }

  return out;
}
