// src/components/Returns/returnUtils.js
//
// Constante și helperi comuni pentru cardurile de retur (separat de
// componente, pentru fast refresh). Doar afișare - statusurile și acțiunile
// permise vin de la backend (services/returnRequestRules.js).

import styles from "./Returns.module.css";

export const RETURN_STATUS_SHORT = {
  NEW: "Nouă",
  IN_REVIEW: "Informații cerute",
  APPROVED: "Acceptată",
  PICKUP_REQUESTED: "În transport",
  REJECTED: "Respinsă",
  CLOSED: "Închisă",
};

export const REASON_KIND_LABELS = {
  WITHDRAWAL: "Retragere fără motiv",
  CONFORMITY: "Neconformitate",
};

// Ton pentru mesajul de status afișat clientului (NU expedia înainte de APPROVED).
export const CLIENT_STATUS_TONE = {
  NEW: "info",
  IN_REVIEW: "warning",
  APPROVED: "success",
  PICKUP_REQUESTED: "success",
  REJECTED: "danger",
  CLOSED: "info",
};

export function formatReturnDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
}

export { styles as returnStyles };
