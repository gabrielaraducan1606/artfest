// src/pages/Vendor/Orders/utils/courierCta.js

/*
 * CTA „Conectează un curier” din Comenzi: se afișează DOAR când știm sigur
 * că vendorul nu are niciun cont de curier ACTIVE (lista s-a încărcat fără
 * eroare). În loading / la eroare nu afișăm nimic - fără CTA-uri false.
 */

export function hasActiveCourierAccount(accounts) {
  return (Array.isArray(accounts) ? accounts : []).some(
    (a) => a && a.status === "ACTIVE" && !a.disabledAt
  );
}

export function shouldShowCourierCta({ loading, error, accounts }) {
  if (loading || error) return false;
  if (!Array.isArray(accounts)) return false;
  return !hasActiveCourierAccount(accounts);
}
