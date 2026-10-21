// src/pages/Wishlist/wishlistCart.js
//
// Logica pură a cardurilor din Wishlist (fără React) - testată în
// wishlistCart.test.js. Prețul QUOTE_ONLY vine din același helper ca
// ProductDetails și cardurile din listări (priceDisplayMode.js).

import {
  getQuoteCardPriceLabel,
  isQuoteOnlyProduct,
} from "../Vendor/Produse/hooks/priceDisplayMode.js";

/*
 * De ce NU se poate adăuga un favorit în coș (null = se poate).
 * QUOTE_ONLY nu intră niciodată în coș - backend-ul îl respinge oricum
 * (cartRoutes.js, 409 quote_only); aici doar nu mai oferim acțiunea.
 */
export function getFavoriteCartBlock(card, myVendorId) {
  if (!card) return "unavailable";

  if (myVendorId && card.vendorId && myVendorId === card.vendorId) {
    return "owner";
  }

  if (isQuoteOnlyProduct(card)) return "quote_only";

  if (card.isActive === false || card.stock === 0) return "unavailable";

  return null;
}

/*
 * Prețul afișat pe card:
 *   - QUOTE_ONLY: „De la X RON” sau null (fără „0 lei”);
 *   - restul: neschimbat - suma formatată dacă `price` e număr.
 */
export function getFavoritePriceLabel(card, formatMoney) {
  if (isQuoteOnlyProduct(card)) return getQuoteCardPriceLabel(card);

  return typeof card?.price === "number"
    ? formatMoney(card.price, card.currency)
    : null;
}
