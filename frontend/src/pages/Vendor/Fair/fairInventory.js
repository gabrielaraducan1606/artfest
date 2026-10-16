// src/pages/Vendor/Fair/fairInventory.js
//
// Inventarul vendorului pentru Târgul Artfest - apeluri API, etichete
// de afișare și descărcarea PDF-urilor cu etichete.

import { buildApiUrl } from "../../../lib/api";

export const INVENTORY_API = "/api/vendor/fair/inventory";

export const INVENTORY_STATUS_LABEL = {
  DRAFT: "Netrimis",
  SUBMITTED: "Trimis",
  RECEIVED: "Recepționat",
  REJECTED: "Refuzat",
  CANCELLED: "Eliminat",
  CLOSED: "Închis",
};

export const INVENTORY_STATUS_TONE = {
  DRAFT: "muted",
  SUBMITTED: "info",
  RECEIVED: "success",
  REJECTED: "danger",
  CLOSED: "muted",
};

export function formatPrice(priceCents) {
  const value = Number(priceCents || 0) / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
  return `${text} lei`;
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest",
  });
}

/*
 * Descarcă un fișier generat de server (PDF cu etichete, CSV cu raportul) -
 * cookie-ul de sesiune merge cu credentials. Erorile de la server (ex. preț
 * nesincronizat) sunt aruncate cu mesajul lor.
 */
export async function downloadLabelsPdf(path, filename, fallbackMessage = "Nu am putut genera etichetele.") {
  const res = await fetch(buildApiUrl(path), { credentials: "include" });

  if (!res.ok) {
    let message = fallbackMessage;
    try {
      const data = await res.json();
      message = data?.message || message;
    } catch {
      /* răspuns fără JSON */
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
