// backend/src/lib/publicStoreContact.js

/*
 * Datele de contact DEDICATE ale magazinului (telefon, email, website,
 * linkuri sociale) NU se expun în răspunsurile PUBLICE ale magazinului /
 * campaniilor. Pe Artfest clientul contactează vânzătorul prin mesageria
 * platformei (vezi și lib/contactInfoGuard.js pentru textele libere).
 *
 * Datele rămân neatinse în DB și în rutele private (proprietar/admin) și
 * sunt folosite în continuare intern: retururi, facturi, Stripe, emailuri,
 * notificări. Secțiunea GPSR „Producător” de pe pagina produsului NU trece
 * prin acest helper (informație legală, construită separat în
 * lib/gpsrCompliance.js -> buildPublicGpsrInfo).
 *
 * Curățare RECURSIVĂ: răspunsurile publice includ uneori și obiecte
 * brute (ex. `profile` cu `service.vendor`), deci nu ajunge să scoatem
 * doar cheile de la primul nivel.
 */

export const PRIVATE_STORE_CONTACT_KEYS = Object.freeze([
  "phone",
  "email",
  "publicEmail",
  "website",
  "socials",
]);

const PRIVATE_KEYS = new Set(PRIVATE_STORE_CONTACT_KEYS);

export function omitPrivateStoreContact(value) {
  if (Array.isArray(value)) {
    return value.map(omitPrivateStoreContact);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  // doar obiecte „simple” - Date, Decimal (Prisma) etc. rămân neatinse
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  const out = {};

  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) continue;
    out[key] = omitPrivateStoreContact(child);
  }

  return out;
}
