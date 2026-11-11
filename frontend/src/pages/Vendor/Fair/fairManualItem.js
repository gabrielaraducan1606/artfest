// src/pages/Vendor/Fair/fairManualItem.js
//
// Produs manual în inventarul târgului (fără produs în magazinul online):
// validare client (aceleași reguli ca serverul, care rămâne autoritatea),
// prețul în lei <-> bani și id-ul cererii pentru salvări repetate fără duplicate.

export const MANUAL_TITLE_MAX = 200;
export const MANUAL_QTY_MAX = 1000;
export const MANUAL_PHOTO_MAX_BYTES = 15 * 1024 * 1024;

const PRICE_RE = /^\d{1,7}(?:[.,]\d{1,2})?$/;

export function newClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function parsePriceRon(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!PRICE_RE.test(text)) return null;
  const [lei, bani = ""] = text.split(/[.,]/);
  const cents = Number(lei) * 100 + Number((bani + "00").slice(0, 2));
  return cents > 0 ? cents : null;
}

// 4550 -> "45,50"; 4500 -> "45" (valoarea inițială din formularul de editare)
export function centsToPriceInput(cents) {
  const n = Number(cents || 0);
  if (!n) return "";
  return n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2).replace(".", ",");
}

export function validateManualItem({ title, declaredQty, priceRon }) {
  const errors = {};
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!cleanTitle) errors.title = "Scrie denumirea produsului.";
  else if (cleanTitle.length > MANUAL_TITLE_MAX) errors.title = `Maximum ${MANUAL_TITLE_MAX} de caractere.`;

  const qty = Number(declaredQty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MANUAL_QTY_MAX) {
    errors.declaredQty = `Cantitatea trebuie să fie un număr întreg între 1 și ${MANUAL_QTY_MAX}.`;
  }

  if (parsePriceRon(priceRon) === null) errors.priceRon = "Introdu un preț mai mare decât zero (ex. 45 sau 45,50).";
  return errors;
}

export function validatePhotoFile(file) {
  if (!file) return "";
  if (!String(file.type || "").startsWith("image/")) return "Alege o fotografie (JPG, PNG, WEBP sau HEIC).";
  if (file.size > MANUAL_PHOTO_MAX_BYTES) return "Fotografia este prea mare (maximum 15 MB).";
  return "";
}
