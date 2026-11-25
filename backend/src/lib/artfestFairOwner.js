// src/lib/artfestFairOwner.js
//
// Proprietarul unei linii a Târgului Artfest:
//  - participant: vendorId + registrationId setate; la vânzare comisionul târgului
//    (fair.commissionBps, 10%) din prețul efectiv, vânzătorul primește restul (90%);
//  - Artfest - stoc propriu: vendorId = registrationId = NULL (CHECK AFII_owner_chk); la
//    vânzare încasarea e integral Artfest: commissionBps 10000, commissionCents = brut,
//    vendorNetCents 0 (CHECK AFSL_artfest_owned_chk). Același calcul (computeLine), deci
//    orice raport care adună „partea Artfest” / „partea vânzătorului” rămâne corect.
// Liniile de vânzare / retur / mișcările păstrează vendorId-ul liniei (NULL pentru Artfest).

export const ARTFEST_OWNER_NAME = "Artfest (stoc propriu)";
// 100%: produsul Artfest nu are vânzător
export const ARTFEST_OWN_COMMISSION_BPS = 10000;

/** Linia (de inventar, vânzare, retur, mișcare) aparține Artfest (stoc propriu). */
export function isArtfestOwned(row) {
  return Boolean(row) && !row.vendorId;
}

/** Comisionul aplicat liniei la vânzare: 100% pentru Artfest, altfel comisionul târgului. */
export function lineCommissionBps(line, fairCommissionBps) {
  return isArtfestOwned(line) ? ARTFEST_OWN_COMMISSION_BPS : fairCommissionBps;
}

/** Id-urile distincte (fără NULL - Prisma nu acceptă `in: [null]`). */
export function distinctIds(rows, key = "vendorId") {
  return [...new Set((rows || []).map((r) => r?.[key]).filter(Boolean))];
}

/** Numele proprietarului: vânzătorul (din `names`) sau „Artfest (stoc propriu)”. */
export function ownerName(vendorId, names) {
  if (!vendorId) return ARTFEST_OWNER_NAME;
  return (names instanceof Map ? names.get(vendorId) : names?.[vendorId]) || null;
}
