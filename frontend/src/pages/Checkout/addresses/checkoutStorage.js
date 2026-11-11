// src/pages/Checkout/addresses/checkoutStorage.js
//
// Datele formularului de checkout (contact, adresă, facturare) păstrate DOAR
// pe durata tabului (sessionStorage) - supraviețuiesc unui refresh sau unui
// login făcut în timpul checkout-ului, dar nu rămân în browser după
// închiderea tabului / browserului.
//
// Înainte, aceleași date stăteau PERMANENT în localStorage („checkoutAddress”),
// inclusiv pentru guest. Cheia veche se șterge la prima încărcare.
// Clientul autentificat își păstrează adresele în cont (UserAddress).

export const CHECKOUT_DRAFT_KEY = "checkout:address:v1";
export const LEGACY_LOCAL_KEY = "checkoutAddress";

function session() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Șterge copia permanentă veche (localStorage) - date personale, nu le mai păstrăm. */
export function removeLegacyCheckoutAddress() {
  try {
    if (typeof window !== "undefined") window.localStorage?.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    /* stocare indisponibilă */
  }
}

export function loadCheckoutDraft() {
  removeLegacyCheckoutAddress();
  const storage = session();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CHECKOUT_DRAFT_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCheckoutDraft(draft) {
  const storage = session();
  if (!storage) return;
  try {
    storage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft || {}));
  } catch {
    /* stocare plină / indisponibilă: datele rămân doar în memorie */
  }
}

export function clearCheckoutDraft() {
  try {
    session()?.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    /* ignorat */
  }
}
