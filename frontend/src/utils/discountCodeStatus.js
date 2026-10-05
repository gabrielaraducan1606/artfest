// src/utils/discountCodeStatus.js
//
// Afișarea statusului unui cod de reducere - DOAR din `effectiveStatus`
// derivat de backend (deriveDiscountCodeStatus, aceeași regulă ca validarea
// la checkout). Frontend-ul NU mai recalculează statusul din isActive /
// startsAt / endsAt: un cod expirat cu isActive=true apare „Expirat”.
// Butonul Activează / Oprește rămâne pe isActive (acțiune separată).

export const DISCOUNT_CODE_STATUS_LABELS = Object.freeze({
  ACTIVE: "Activ",
  SCHEDULED: "Programat",
  EXPIRED: "Expirat",
  DISABLED: "Inactiv",
  EXHAUSTED: "Epuizat",
});

export function getDiscountCodeStatusLabel(code) {
  return DISCOUNT_CODE_STATUS_LABELS[code?.effectiveStatus] || "—";
}

// doar ACTIVE folosește stilul „activ”; restul - stilul „inactiv”
export function isDiscountCodeEffectivelyActive(code) {
  return code?.effectiveStatus === "ACTIVE";
}
