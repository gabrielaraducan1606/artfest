// src/pages/Vendor/CostsProfit/formatMoney.js

export function formatRon(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "0 lei";
  }

  return `${numeric.toLocaleString("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} lei`;
}

export function centsToRon(cents) {
  const numeric = Number(cents);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric) / 100;
}

export function formatRonFromCents(cents) {
  return formatRon(centsToRon(cents));
}
