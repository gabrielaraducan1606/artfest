// backend/src/services/vendorCollectionRules.js
//
// Reguli comune VendorCollection („Colecții”), fără dependențe - folosite de
// atribuire (vendorAttribution.js), pricing (vendorCollectionPricing.js),
// pagina publică și checkout.
//
// O colecție e ACTIVĂ pentru pricing / atribuire nouă doar dacă:
//   isActive = true; startsAt null sau <= now; endsAt null sau >= now.
// (comenzile deja plasate folosesc snapshot-urile - nu depind de asta)

export function isVendorCollectionLive(collection, now = new Date()) {
  if (!collection || collection.isActive === false) return false;

  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startsAt = collection.startsAt ? new Date(collection.startsAt).getTime() : null;
  const endsAt = collection.endsAt ? new Date(collection.endsAt).getTime() : null;

  if (startsAt !== null && startsAt > t) return false;
  if (endsAt !== null && endsAt < t) return false;
  return true;
}

// starea pentru afișare: LIVE | INACTIVE | SCHEDULED | EXPIRED
export function vendorCollectionStatus(collection, now = new Date()) {
  if (!collection || collection.isActive === false) return "INACTIVE";
  const t = now.getTime();
  if (collection.startsAt && new Date(collection.startsAt).getTime() > t) return "SCHEDULED";
  if (collection.endsAt && new Date(collection.endsAt).getTime() < t) return "EXPIRED";
  return "LIVE";
}

/*
 * Membership PROPRIU (owner == seller): produsul e al ownerului colecției și
 * (allOwnProducts=true SAU e în VendorCollectionItem). Produsele altor vendori
 * nu sunt niciodată „proprii” - pentru ele contează doar VendorCollectionItem
 * (referral cross-vendor, fără reducerea colecției).
 */
export function isOwnCollectionMember(attribution, productId, productVendorId) {
  if (!attribution || !productId) return false;
  if (String(productVendorId) !== String(attribution.vendorId)) return false;
  return Boolean(attribution.allOwnProducts) || attribution.selectedProductIds?.has(String(productId)) === true;
}
