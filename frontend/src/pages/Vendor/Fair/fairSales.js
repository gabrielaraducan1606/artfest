// src/pages/Vendor/Fair/fairSales.js
//
// Vânzările vendorului la Târgul Artfest + raportul zilnic: helper-e fără React
// (testabile cu node --test). Toate sumele vin calculate de server.

export const SALES_API = "/api/vendor/artfest-fair/sales";
export const VENDOR_REPORT_API = "/api/vendor/artfest-fair/reports/daily";
export const FAIR_TIMEZONE = "Europe/Bucharest";

export const PAYMENT_LABEL = { CASH: "Numerar", CARD: "Card" };

export function formatLei(cents) {
  const value = Number(cents || 0) / 100;
  return `${value.toFixed(2).replace(".", ",")} lei`;
}

// ziua de azi în ora târgului (AAAA-LL-ZZ), nu în UTC și nu în fusul browserului
export function todayFairDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FAIR_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function reportUrl(base, date, { csv = false } = {}) {
  return `${base}${csv ? ".csv" : ""}?date=${encodeURIComponent(date)}`;
}

export const LINE_STATUS_LABEL = {
  COMPLETED: "Finalizată",
  PARTIALLY_RETURNED: "Returnată parțial",
  RETURNED: "Returnată",
  VOIDED: "Anulată",
};

export const DISPOSITION_LABEL = {
  RESTOCKED: "returnat, revine în stocul târgului",
  NOT_RESTOCKED: "returnat, nevandabil",
  NOT_RETURNED: "rambursare fără produs",
};

// ziua din link-ul notificării (?date=AAAA-LL-ZZ); altfel azi, în ora târgului
export function initialFairDate(search, now = new Date()) {
  const value = new URLSearchParams(search || "").get("date");
  return isValidDate(value) ? value : todayFairDate(now);
}
