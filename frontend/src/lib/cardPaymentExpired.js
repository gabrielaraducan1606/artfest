// src/lib/cardPaymentExpired.js
//
// Comandă anulată AUTOMAT pentru că plata cu cardul nu a fost finalizată la
// termen (backend: services/cardPaymentExpiry.js, câmpul
// `cardPaymentExpired` din detaliile comenzii). Celelalte comenzi anulate
// își păstrează afișarea obișnuită.

export const CARD_PAYMENT_EXPIRED_LABEL = "Expirată - plată nefinalizată";

export const CARD_PAYMENT_EXPIRED_MESSAGE =
  "Comanda a fost anulată automat, pentru că plata cu cardul nu a fost finalizată în 2 ore de la plasare. " +
  "Nu am înregistrat nicio plată finalizată pentru această comandă. Dacă îți dorești în continuare produsele, poți plasa o comandă nouă.";

export function isCardPaymentExpired(order) {
  return order?.cardPaymentExpired === true;
}

/**
 * Eticheta și explicația statusului: cele de expirare doar pentru comenzile
 * expirate, altfel exact valorile primite.
 */
export function orderStatusDisplay(order, { label, help }) {
  return isCardPaymentExpired(order)
    ? { label: CARD_PAYMENT_EXPIRED_LABEL, help: CARD_PAYMENT_EXPIRED_MESSAGE }
    : { label, help };
}
