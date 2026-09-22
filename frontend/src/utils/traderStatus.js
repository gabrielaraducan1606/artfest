// src/utils/traderStatus.js
//
// Statutul Vânzătorului (profesionist / neprofesionist) afișat Clientului
// ÎNAINTE de plasarea Comenzii (TOS v2 §26.1e / §5.5). Sursa datelor:
// VendorBilling.traderStatus, livrat de sumarul checkout în
// vendorBilling.traderStatus al fiecărui item din `summary.items`.
//
// IMPORTANT: itemii din `summary.groups[].items` (construiți de
// mapCartItemForCheckout pe backend) NU conțin vendorBilling - doar
// `summary.items` îl are. De aceea statusul unui grup se caută întâi în
// itemii grupului (dacă îl au, ex. checkout din ofertă) și apoi în lista
// de itemi de nivel superior, potrivită după vendorId/serviceId.
//
// Valoare necunoscută (null/absentă/invalidă) -> null, fără excepții.

export const TRADER_PROFESSIONAL = "PROFESSIONAL";
export const TRADER_NON_PROFESSIONAL = "NON_PROFESSIONAL";

export function normalizeTraderStatus(value) {
  return value === TRADER_PROFESSIONAL || value === TRADER_NON_PROFESSIONAL
    ? value
    : null;
}

function firstStatus(list) {
  if (!Array.isArray(list)) return null;

  for (const item of list) {
    const status = normalizeTraderStatus(item?.vendorBilling?.traderStatus);
    if (status) return status;
  }

  return null;
}

const sameId = (a, b) =>
  a !== null && a !== undefined && b !== null && b !== undefined &&
  String(a) === String(b);

export function getGroupTraderStatus(group, items = []) {
  try {
    const fromGroup = firstStatus(group?.items);
    if (fromGroup) return fromGroup;

    const vendorId = group?.vendorId;
    const serviceId = group?.serviceId;

    if (
      (vendorId === null || vendorId === undefined) &&
      (serviceId === null || serviceId === undefined)
    ) {
      return null;
    }

    const matching = (Array.isArray(items) ? items : []).filter(
      (item) =>
        sameId(item?.vendorId, vendorId) || sameId(item?.serviceId, serviceId)
    );

    return firstStatus(matching);
  } catch {
    return null;
  }
}

export function getTraderStatusLabel(status) {
  switch (normalizeTraderStatus(status)) {
    case TRADER_NON_PROFESSIONAL:
      return "Neprofesionist (persoană fizică, în afara unei activități comerciale)";
    case TRADER_PROFESSIONAL:
      return "Profesionist/comerciant";
    default:
      return null;
  }
}

export const NON_PROFESSIONAL_WARNING =
  "Acest Vânzător este declarat neprofesionist. Este posibil ca anumite drepturi specifice protecției consumatorilor, aplicabile contractelor încheiate cu profesioniști, să nu se aplice comenzii plasate la acest magazin.";
