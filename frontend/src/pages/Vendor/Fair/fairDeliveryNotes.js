// src/pages/Vendor/Fair/fairDeliveryNotes.js
//
// Avize de însoțire a mărfii (Târgul Artfest) - căi API și funcții pure
// pentru formular (fără apeluri de rețea).

import { centsToPriceInput, parsePriceRon } from "./fairManualItem.js";
import { downloadLabelsPdf } from "./fairInventory.js";
import { buildApiUrl } from "../../../lib/api";

export const DELIVERY_NOTES_API = "/api/vendor/fair/delivery-notes";

// pagina de facturare existentă a vânzătorului (Setări -> „Date facturare”)
export const BILLING_SETTINGS_URL = "/setari?tab=billing";

/*
 * PDF de previzualizare („PREVIZUALIZARE – NEEMIS”) din datele formularului.
 * Serverul nu salvează nimic. Întoarce un Blob; erorile au mesajul și câmpurile serverului.
 */
export async function fetchDeliveryNotePreviewPdf(body) {
  const res = await fetch(buildApiUrl(`${DELIVERY_NOTES_API}/preview.pdf`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* răspuns fără JSON */
    }
    const error = new Error(data?.message || "Nu am putut genera previzualizarea.");
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return res.blob();
}

// browserul poate afișa PDF în pagină? (pe mobil, de regulă nu => se deschide separat)
export function canEmbedPdf() {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.pdfViewerEnabled === "boolean") return navigator.pdfViewerEnabled;
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

// PDF-ul unui aviz (din datele înghețate la emitere; aceeași descărcare => același document)
export function downloadDeliveryNotePdf(note) {
  return downloadLabelsPdf(
    `${DELIVERY_NOTES_API}/${encodeURIComponent(note.id)}/pdf?download=1`,
    `aviz-${note.series}-${note.number}${note.status === "CANCELLED" ? "-ANULAT" : ""}.pdf`,
    "Nu am putut genera PDF-ul avizului."
  );
}

export const SERIES_RE = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `dn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

export function formatLei(cents) {
  if (cents === null || cents === undefined) return "—";
  return `${(Number(cents) / 100).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`;
}

export function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Bucharest" });
}

// rândurile formularului din previzualizare; `from` = liniile unui aviz anulat (aviz înlocuitor)
export function initialRows(items, from = null) {
  const previous = new Map((from?.lines || []).map((l) => [l.inventoryItemId, l]));
  return (items || []).map((item) => {
    const prev = previous.get(item.inventoryItemId);
    const selectable = item.remainingQty > 0;
    return {
      ...item,
      selected: selectable && (from ? Boolean(prev) : true),
      quantity: String(selectable ? Math.min(prev?.quantity || item.remainingQty, item.remainingQty) : 0),
      unit: prev?.unit || "buc",
      // prețul ARTIZANULUI (valoarea la care facturează către Artfest). Inventarul are doar prețul
      // de vânzare la târg (fairPriceCents), care NU se folosește aici; la aviz înlocuitor se
      // păstrează prețul avizului anulat.
      price: prev?.unitPriceCents ? centsToPriceInput(prev.unitPriceCents) : "",
    };
  });
}

export function rowValueCents(row) {
  const unit = parsePriceRon(row.price);
  const qty = Number(row.quantity);
  return unit && Number.isInteger(qty) && qty > 0 ? unit * qty : null;
}

// validare locală + corpul cererii; erorile sunt pe chei (series, rows.<id>.quantity ...)
export function buildIssueBody(form, rows) {
  const errors = {};
  const series = String(form.series || "").trim().toUpperCase();
  if (!SERIES_RE.test(series)) errors.series = "Seria are 1-16 caractere: litere, cifre sau cratimă.";
  if (form.isNewSeries && form.startNumber !== "") {
    const n = Number(form.startNumber);
    if (!Number.isInteger(n) || n < 1) errors.startNumber = "Numărul de început trebuie să fie un număr întreg pozitiv.";
  }
  if (!String(form.reason || "").trim()) errors.reason = "Completează motivul expedierii.";
  const destination = String(form.destination || "").replace(/\s+/g, " ").trim();
  if (destination.length < 10) errors.destination = "Scrie adresa completă de livrare.";

  const selected = rows.filter((r) => r.selected);
  if (!selected.length) errors.rows = "Alege cel puțin un produs.";
  const lines = selected.map((r) => {
    const qty = Number(r.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > r.remainingQty) {
      errors[`rows.${r.inventoryItemId}.quantity`] = `Între 1 și ${r.remainingQty}.`;
    }
    let unitPriceCents = null;
    if (!form.withoutValues) {
      unitPriceCents = parsePriceRon(r.price);
      if (!unitPriceCents) errors[`rows.${r.inventoryItemId}.price`] = String(r.price || "").trim() ? "Preț invalid." : "Completează prețul.";
    }
    return { inventoryItemId: r.inventoryItemId, quantity: qty, unit: String(r.unit || "buc").trim() || "buc", unitPriceCents };
  });
  if (!form.withoutValues && !form.valuesConfirmed) {
    errors.valuesConfirmed = "Bifează confirmarea prețurilor.";
  }

  const body = {
    series,
    startNumber: form.isNewSeries && form.startNumber !== "" ? Number(form.startNumber) : null,
    reason: String(form.reason || "").trim(),
    destination,
    withoutValues: Boolean(form.withoutValues),
    valuesConfirmed: Boolean(form.valuesConfirmed),
    withoutInvoice: Boolean(form.withoutInvoice),
    notes: form.notes || null,
    delegateName: form.delegateName || null,
    delegateIdSeries: form.delegateIdSeries || null,
    delegateIdNumber: form.delegateIdNumber || null,
    delegateIdIssuedBy: form.delegateIdIssuedBy || null,
    vehicle: form.vehicle || null,
    // datetime-local (ora României, a browserului) -> ISO
    shippedAt: form.shippedAt ? new Date(form.shippedAt).toISOString() : null,
    replacesNoteId: form.replacesNoteId || null,
    lines,
  };
  const totalValueCents = form.withoutValues ? null : lines.reduce((s, l) => s + (l.unitPriceCents || 0) * (l.quantity || 0), 0);
  return { errors, body, totalValueCents, totalQuantity: lines.reduce((s, l) => s + (l.quantity || 0), 0) };
}
