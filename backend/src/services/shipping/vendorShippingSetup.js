// backend/src/services/shipping/vendorShippingSetup.js
//
// „Tarif de rezervă pentru transport” (VendorService.estimatedShippingFeeCents):
// tariful folosit la checkout DOAR când tariful Sameday nu poate fi calculat
// temporar. Fără el, o cădere Sameday ar bloca comenzile acelui magazin.
//
// OBLIGATORIU pentru magazinele care vând produse fizice prin checkout-ul
// standard: tip „products” și cel puțin un produs care NU e QUOTE_ONLY (sau
// niciun produs încă - magazinul de produse e pe cale să vândă).
// NU e obligatoriu pentru:
//   - celelalte tipuri de servicii (foto, decor, restaurant...) - fără livrare fizică prin checkout;
//   - magazinele cu produse DOAR QUOTE_ONLY - se comandă prin ofertă (transportul e în ofertă,
//     checkout-ul standard le refuză).
// Nu există produse digitale în platformă.
// Pragul de transport gratuit rămâne separat; tariful de rezervă e tariful de bază.
// Nicio valoare implicită: lipsa e semnalată, nu completată.

export const PHYSICAL_STORE_TYPE = "products";

export const SHIPPING_SETUP_MESSAGES = Object.freeze({
  incomplete: "Configurare livrare incompletă",
  fallbackMissing:
    "Completează tariful de rezervă pentru transport. Se folosește doar dacă tariful Sameday nu poate fi calculat temporar; fără el, comenzile pot fi oprite în acele momente.",
  fallbackRequired: "Tariful de rezervă pentru transport este obligatoriu pentru magazinele cu produse livrate prin curier.",
});

const isSetCents = (v) => v !== null && v !== undefined && v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;

/**
 * @param {{ typeCode?: string|null, checkoutProducts?: number, quoteOnlyProducts?: number }} store
 */
export function isShippingFallbackRequired({ typeCode, checkoutProducts = 0, quoteOnlyProducts = 0 } = {}) {
  if (String(typeCode || "") !== PHYSICAL_STORE_TYPE) return false;
  // doar produse cu ofertă -> fără transport prin checkout-ul standard
  if (checkoutProducts === 0 && quoteOnlyProducts > 0) return false;
  return true;
}

/**
 * Starea configurării livrării pentru un magazin.
 * @returns {{ status: "complete"|"incomplete"|"not_required", fallbackRequired: boolean, fallbackConfigured: boolean, missing: string[], message: string|null }}
 */
export function vendorShippingSetup({ typeCode, estimatedShippingFeeCents, checkoutProducts = 0, quoteOnlyProducts = 0 } = {}) {
  const fallbackRequired = isShippingFallbackRequired({ typeCode, checkoutProducts, quoteOnlyProducts });
  const fallbackConfigured = isSetCents(estimatedShippingFeeCents);
  if (!fallbackRequired) {
    return { status: "not_required", fallbackRequired, fallbackConfigured, missing: [], message: null };
  }
  if (!fallbackConfigured) {
    return { status: "incomplete", fallbackRequired, fallbackConfigured, missing: ["fallback_shipping_price"], message: SHIPPING_SETUP_MESSAGES.fallbackMissing };
  }
  return { status: "complete", fallbackRequired, fallbackConfigured, missing: [], message: null };
}

/**
 * Numărul de produse pe magazin: prin checkout-ul standard vs. doar ofertă.
 * @returns {Promise<Map<string, {checkoutProducts:number, quoteOnlyProducts:number}>>}
 */
export async function productCountsByService(db, serviceIds = []) {
  const out = new Map(serviceIds.map((id) => [id, { checkoutProducts: 0, quoteOnlyProducts: 0 }]));
  if (!serviceIds.length) return out;
  const rows = await db.product.groupBy({ by: ["serviceId", "orderMode"], where: { serviceId: { in: serviceIds } }, _count: { _all: true } });
  for (const r of rows) {
    const entry = out.get(r.serviceId);
    if (!entry) continue;
    const n = Number(r._count?._all || 0);
    if (r.orderMode === "QUOTE_ONLY") entry.quoteOnlyProducts += n;
    else entry.checkoutProducts += n;
  }
  return out;
}
