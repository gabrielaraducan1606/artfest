// src/components/Returns/returnPdf.js
//
// Eticheta AWB de retur (PDF de la Sameday, prin backend-ul Artfest):
// descărcare sau deschidere pentru tipărire. Răspunsul e binar, deci nu trece
// prin api() (care parsează JSON) - aceeași rezolvare de URL (buildApiUrl).

import { buildApiUrl } from "../../lib/api";

async function fetchPdf(path) {
  const res = await fetch(buildApiUrl(path), { credentials: "include" });
  if (!res.ok) {
    let message = "Eticheta nu este disponibilă momentan.";
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
  return res.blob();
}

/** Descarcă eticheta ca fișier. */
export async function downloadReturnLabel(path, filename) {
  const url = URL.createObjectURL(await fetchPdf(path));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Deschide eticheta într-o filă nouă, pentru tipărire (dialogul de tipărire al
 * vizualizatorului PDF). Fila se deschide sincron (fără blocarea pop-up-ului),
 * apoi primește PDF-ul.
 */
export async function printReturnLabel(path) {
  const win = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await fetchPdf(path));
    if (win) win.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}
