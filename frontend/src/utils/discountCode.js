// src/utils/discountCode.js

/*
 * Persistență Cart -> Checkout pentru codul de reducere introdus
 * de client. Cheie separată de campaignAttribution/influencerAttribution
 * (concept diferit - nu e un token semnat, ci un cod simplu, mereu
 * revalidat server-side, niciodată de încredere de unul singur).
 *
 * sessionStorage, nu localStorage: codul e legat de sesiunea curentă
 * de cumpărare, nu are sens să supraviețuiască zile/săptămâni ca
 * atribuirea de campanie/influencer.
 */

const STORAGE_KEY = "artfest.discountCode";

export function getStoredDiscountCode() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? String(raw) : "";
  } catch {
    return "";
  }
}

export function storeDiscountCode(code) {
  try {
    const trimmed = String(code || "").trim();
    if (!trimmed) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // sessionStorage indisponibil (mod privat etc.) - degradăm silențios.
  }
}

export function clearStoredDiscountCode() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
