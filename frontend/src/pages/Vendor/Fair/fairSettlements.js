// src/pages/Vendor/Fair/fairSettlements.js
//
// Deconturile Târgului Artfest - helper-e fără React, comune Admin / Vendor
// (testabile cu node --test). Toate sumele vin calculate de server.

import { FAIR_TIMEZONE, formatLei, todayFairDate } from "./fairSales.js";

export const ADMIN_SETTLEMENTS_API = "/api/admin/artfest-fair/settlements";
export const VENDOR_SETTLEMENTS_API = "/api/vendor/artfest-fair/settlements";

export const SETTLEMENT_STATUS_LABEL = {
  DRAFT: "Ciornă",
  FINALIZED: "Finalizat",
  PAID: "Plătit",
  CARRIED_FORWARD: "Sold reportat",
  CANCELLED: "Anulat",
};

export const SETTLEMENT_STATUS_TONE = {
  DRAFT: "muted",
  FINALIZED: "info",
  PAID: "success",
  CARRIED_FORWARD: "danger",
  CANCELLED: "muted",
};

export { formatLei };

// „+15,00 lei” / „-4,00 lei” / „0,00 lei”
export function signedLei(cents) {
  const n = Number(cents || 0);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatLei(Math.abs(n))}`;
}

// ziua locală AAAA-LL-ZZ a unui moment
export function localDate(value) {
  if (!value) return "";
  return todayFairDate(new Date(value));
}

// periodTo e exclusiv (00:00 a zilei următoare) => ultima zi inclusă
export function periodText(periodFrom, periodTo) {
  if (!periodFrom || !periodTo) return "";
  return `${localDate(periodFrom)} – ${localDate(new Date(new Date(periodTo).getTime() - 1))}`;
}

export function formatDateRo(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: FAIR_TIMEZONE });
}

/*
 * „15,50” / „-4” / „+12.3” => bani întregi (1550 / -400 / 1230). Maximum 2 zecimale.
 * Întoarce null dacă textul nu e o sumă validă.
 */
export function parseLeiToCents(text) {
  const raw = String(text ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(raw)) return null;
  const negative = raw.startsWith("-");
  const [intPart, frac = ""] = raw.replace(/^[+-]/, "").split(".");
  const cents = Number(intPart) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

// perioada propusă: de la sfârșitul ultimului decont (sau începutul târgului) până azi
export function defaultPeriod({ nextPeriodFrom = null, fairStartsAt = null, now = new Date() } = {}) {
  const today = todayFairDate(now);
  const from = nextPeriodFrom ? localDate(nextPeriodFrom) : fairStartsAt ? localDate(fairStartsAt) : today;
  return { periodFrom: from <= today ? from : today, periodTo: today };
}

// textul principal pentru vendor
export function amountHeadline(s) {
  if (s.status === "CARRIED_FORWARD") return `Sold reportat: ${signedLei(s.finalDueCents)}`;
  if (s.status === "PAID") return `Plătit: ${formatLei(s.finalDueCents)}`;
  if (s.finalDueCents === 0) return "Nimic de plătit (0,00 lei)";
  return `Sumă de primit: ${formatLei(s.finalDueCents)}`;
}
