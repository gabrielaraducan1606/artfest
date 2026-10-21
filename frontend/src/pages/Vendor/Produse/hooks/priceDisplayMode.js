// src/pages/Vendor/Produse/hooks/priceDisplayMode.js
//
// Cum se afișează prețul în ProductDetails, în funcție de orderMode.
// Testat în priceDisplayMode.test.js.
//
// Pentru QUOTE_ONLY, priceCents înseamnă prețul orientativ / „de la”
// (backend/src/routes/vendorProductRoutes.js - validarea prețului), nu
// prețul final: acela se stabilește prin ofertă. Produsele vechi pot avea
// încă priceCents = 0 - pentru ele nu afișăm nimic (fără „0 lei”).

export const PRICE_DISPLAY_MODE = {
  REGULAR: "regular",
  ORIENTATIVE: "orientative",
};

/*
 * null = fără preț afișat.
 * DIRECT / OPTIONS: neschimbat - orice preț numeric primit.
 * QUOTE_ONLY: doar preț > 0, ca preț orientativ.
 */
export function getPriceDisplayMode(orderMode, displayPrice) {
  if (displayPrice === null || displayPrice === undefined) return null;

  if (orderMode === "QUOTE_ONLY") {
    const value = Number(displayPrice);
    return Number.isFinite(value) && value > 0
      ? PRICE_DISPLAY_MODE.ORIENTATIVE
      : null;
  }

  return PRICE_DISPLAY_MODE.REGULAR;
}

export function isQuoteOnlyProduct(product) {
  return (
    String(product?.orderMode || "").toUpperCase() === "QUOTE_ONLY"
  );
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/*
 * Prețul orientativ al unui produs QUOTE_ONLY, în lei - prețul de BAZĂ
 * (originalPriceCents / priceCents), niciodată unul redus: promoțiile nu
 * se aplică acestor produse (backend/src/services/productPromotionPrice.js).
 */
export function getQuoteOrientativePrice(product) {
  const cents =
    finiteOrNull(product?.originalPriceCents) ??
    finiteOrNull(product?.priceCents);

  if (cents !== null) return cents / 100;

  return finiteOrNull(product?.price);
}

/*
 * Eticheta compactă pentru carduri: „De la 99,00 RON”. null dacă produsul
 * nu e QUOTE_ONLY sau nu are preț orientativ > 0 - cardul își păstrează
 * atunci comportamentul existent.
 */
export function getQuoteCardPriceLabel(product) {
  if (!isQuoteOnlyProduct(product)) return null;

  const value = getQuoteOrientativePrice(product);

  if (
    getPriceDisplayMode("QUOTE_ONLY", value) !==
    PRICE_DISPLAY_MODE.ORIENTATIVE
  ) {
    return null;
  }

  const currency = product?.currency || "RON";
  let formatted;

  try {
    formatted = new Intl.NumberFormat("ro-RO", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    formatted = `${value} ${currency}`;
  }

  return `De la ${formatted}`;
}
