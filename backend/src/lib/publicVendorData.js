// backend/src/lib/publicVendorData.js
//
// Liste EXPLICITE de câmpuri permise (allowlist) pentru datele de
// vânzător / magazin / produs incluse în răspunsurile PUBLICE (fără
// autentificare). Răspunsurile publice nu serializează direct rândurile
// Prisma Vendor, VendorService, ServiceProfile sau Product: orice câmp nou
// adăugat în schema.prisma rămâne privat până e adăugat explicit aici.
//
// De ce allowlist și nu blocklist (lib/publicStoreContact.js): o listă de
// câmpuri interzise ratează orice câmp nou (ex. entitySelfDeclaredIp,
// stripeAccountId, ServiceProfile.address = adresa de RETUR), iar acestea
// au ajuns public prin rutele homepage, care întorceau rândurile complete.
//
// Rămân private (exemple, nu listă exhaustivă - allowlist-ul decide):
//   - adresa de retur (ServiceProfile.address), telefon, email, website,
//     socials (Vendor + ServiceProfile);
//   - adresa de ridicare (VendorPickupAddress), datele fiscale (VendorBilling);
//   - IP / user-agent / meta ale declarației (Vendor.entitySelfDeclared*);
//   - Stripe (stripe*), referral, terminare cont, limite de plan, setări email;
//   - datele GPSR brute ale vendorului (gpsrManufacturer*): pe pagina
//     produsului ajung DOAR prin gpsrCompliance.buildPublicGpsrInfo.
//
// `userId` rămâne public deocamdată: frontend-ul îl folosește ca să
// recunoască proprietarul (ProfilMagazin, Products, ProductDetails). E un
// identificator opac, fără date personale; înlocuirea lui cu un câmp
// `isOwner` calculat pe server e un pas separat.

export const PUBLIC_VENDOR_FIELDS = Object.freeze([
  "id",
  "userId",
  "displayName",
  "about",
  "logoUrl",
  "coverUrl",
  "city",
  "citySlug",
  "isActive",
]);

// ServiceProfile: fără address (retur), phone, email, website, socials
export const PUBLIC_SERVICE_PROFILE_FIELDS = Object.freeze([
  "id",
  "serviceId",
  "slug",
  "displayName",
  "logoUrl",
  "coverUrl",
  "about",
  "shortDescription",
  "tagline",
  "city",
  "citySlug",
  "delivery",
  "createdAt",
  "updatedAt",
]);

// VendorService: fără attributes (configurare internă), shippingNotes,
// prag de transport gratuit / tarife estimate (afișate separat, unde e cazul)
export const PUBLIC_VENDOR_SERVICE_FIELDS = Object.freeze([
  "id",
  "vendorId",
  "typeId",
  "title",
  "description",
  "city",
  "citySlug",
  "mediaUrls",
  "status",
  "isActive",
  "createdAt",
  "updatedAt",
]);

// Product: datele de catalog. Fără moderare / AI / feed / stoc intern /
// profil logistic / câmpuri GPSR brute (GPSR public = buildPublicGpsrInfo).
export const PUBLIC_PRODUCT_FIELDS = Object.freeze([
  "id",
  "serviceId",
  "title",
  "description",
  "priceCents",
  "currency",
  "images",
  "videoUrl",
  "videoMuted",
  "category",
  "color",
  "orderMode",
  "availability",
  "leadTimeDays",
  "readyQty",
  "nextShipDate",
  "acceptsCustom",
  "optionsSchema",
  "customSchema",
  "repeatedGroups",
  "quoteSchema",
  "materialMain",
  "technique",
  "styleTags",
  "occasionTags",
  "dimensions",
  "careInstructions",
  "specialNotes",
  "isActive",
  "isHidden",
  "moderationStatus",
  "createdAt",
  "updatedAt",
]);

/**
 * Nume de câmpuri care NU au voie să apară în niciun răspuns public
 * (folosit de teste ca plasă de siguranță, pe lângă allowlist).
 */
export const FORBIDDEN_PUBLIC_KEYS = Object.freeze([
  "address",
  "phone",
  "email",
  "publicEmail",
  "website",
  "socials",
  "entitySelfDeclaredIp",
  "entitySelfDeclaredUa",
  "entitySelfDeclaredMeta",
  "stripeAccountId",
  "stripeChargesEnabled",
  "stripePayoutsEnabled",
  "stripeDetailsSubmitted",
  "stripeConnectStatus",
  "stripeRequirementsDue",
  "stripeDisabledReason",
  "stripeOnboardedAt",
  "referralCode",
  "referralCommissionBps",
  "terminationReason",
  "terminationExceptionReason",
  "productLimitOverride",
  "emailOnNewOrder",
  "gpsrManufacturerName",
  "gpsrManufacturerAddress",
  "gpsrManufacturerEmail",
  "iban",
  "aiModeration",
  "moderationMessage",
  "shippingNotes",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copie cu DOAR câmpurile permise (cele absente rămân absente). */
export function pickFields(source, fields) {
  if (!isPlainObject(source)) return null;
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  return out;
}

export function toPublicVendor(vendor) {
  return pickFields(vendor, PUBLIC_VENDOR_FIELDS);
}

export function toPublicServiceProfile(profile) {
  return pickFields(profile, PUBLIC_SERVICE_PROFILE_FIELDS);
}

/**
 * VendorService public, cu relațiile cunoscute (profile, vendor, products,
 * _count) mapate tot prin allowlist. Alte relații nu trec.
 *
 * @param {Object} service
 * @param {{ mapProduct?: (product: Object) => Object }} [options]
 */
export function toPublicVendorService(service, { mapProduct = toPublicProduct } = {}) {
  const base = pickFields(service, PUBLIC_VENDOR_SERVICE_FIELDS);
  if (!base) return null;

  if ("profile" in service) base.profile = toPublicServiceProfile(service.profile);
  if ("vendor" in service) base.vendor = toPublicVendor(service.vendor);
  if (Array.isArray(service.products)) base.products = service.products.map((product) => mapProduct(product));
  if (isPlainObject(service._count) && Number.isFinite(service._count.products)) {
    base._count = { products: service._count.products };
  }

  return base;
}

/**
 * Produs public; `service` (dacă e inclus) trece prin toPublicVendorService,
 * fără lista de produse a magazinului.
 */
export function toPublicProduct(product) {
  const base = pickFields(product, PUBLIC_PRODUCT_FIELDS);
  if (!base) return null;
  if (isPlainObject(product.service)) {
    const { products: _ignored, ...service } = product.service;
    base.service = toPublicVendorService(service);
  }
  return base;
}

/**
 * Plasă de siguranță pentru teste: căile (ex. "artisan.vendor.phone") ale
 * cheilor interzise găsite oriunde într-un răspuns. Nu modifică nimic.
 */
export function findForbiddenPublicKeys(value, path = "", out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenPublicKeys(item, `${path}[${index}]`, out));
    return out;
  }
  if (!isPlainObject(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_PUBLIC_KEYS.includes(key)) out.push(childPath);
    findForbiddenPublicKeys(child, childPath, out);
  }
  return out;
}
