// src/pages/Admin/AdminDesktop/tabs/adminHelpRequests.js
//
// „Ajutor configurare” în Admin → Produse. Fără date noi, doar citiri separate:
//   - produs salvat: solicitarea „Trimite la verificare Artfest” (reviewRequest), fie din
//     editorul de produs, fie salvat privat pentru ajutor (holdPrivate);
//   - cereri fără produs salvat sau GPSR: tichete de suport existente, cu tipul
//     (category gpsr_help / product_help; tichetele vechi după subiect) și mesajul integral.

import {
  HELP_REQUEST_SUBJECTS,
  HELP_REQUEST_TYPES,
  HELP_STATUS_LABELS,
  PRODUCT_DRAFT_MARKER,
  helpTypeOfTicket,
  parseHelpTicketBody,
} from "../../../../../../backend/src/lib/supportHelpRequests.js";

export const HELP_TICKET_SUBJECT_PREFIX = HELP_REQUEST_SUBJECTS.product_help;
const LEGACY_DRAFT_MARKER = "— Ciorna produsului (Smart Listing, nesalvată ca produs) —";
const NOTE_DETAILS_MARKER = "Ce a încercat să configureze:";

export function helpProductsUrl() {
  return "/api/admin/products?reviewRequested=1&take=200&sort=old";
}

function helpTicketsUrlFor(helpType) {
  const params = new URLSearchParams({
    status: "all",
    audience: "vendor",
    limit: "100",
    helpType,
  });
  return `/api/admin/support/tickets?${params.toString()}`;
}

export function helpTicketsUrl() {
  return helpTicketsUrlFor(HELP_REQUEST_TYPES.PRODUCT);
}

export function gpsrHelpTicketsUrl() {
  return helpTicketsUrlFor(HELP_REQUEST_TYPES.GPSR);
}

/** Produsul din Admin → Produse (deschide fereastra lui). */
export function adminProductLink(productId) {
  return `/admin?tab=products&productId=${encodeURIComponent(productId)}`;
}

export function helpTicketMessagesUrl(ticketId) {
  return `/api/admin/support/tickets/${encodeURIComponent(ticketId)}/messages?limit=1`;
}

export function supportConversationLink(ticket) {
  const params = new URLSearchParams({ ticket: ticket.id, q: ticket.subject || "" });
  return `/admin/support?${params.toString()}`;
}

/**
 * Orice solicitare de ajutor pe un produs salvat: din editorul de produs („Trimite la
 * verificare Artfest”) sau salvat privat din formularul de creare (holdPrivate).
 */
export function isHelpProduct(product) {
  return Boolean(product?.reviewRequest);
}

export function helpProductSource(product) {
  return product?.reviewRequest?.holdPrivate === true ? "Salvat privat pentru ajutor" : "Din editorul de produs";
}

export function isHelpTicketCandidate(ticket) {
  return (ticket?.helpType || helpTypeOfTicket(ticket)) === HELP_REQUEST_TYPES.PRODUCT;
}

/**
 * Tichetele noi au tipul pe server (category). La tichetele vechi subiectul putea fi scris
 * și manual, deci marcajul din mesaj confirmă proveniența.
 */
export function isHelpTicketBody(body, ticket = null) {
  if (ticket?.category === HELP_REQUEST_TYPES.PRODUCT) return true;
  const text = String(body || "");
  return text.includes(LEGACY_DRAFT_MARKER) || text.includes(PRODUCT_DRAFT_MARKER);
}

/** Mesajul vânzătorului, separat de ce a încercat să configureze în formular. */
export function splitHelpNote(note) {
  const text = String(note || "").trim();
  const index = text.indexOf(NOTE_DETAILS_MARKER);
  if (index < 0) return { message: text, details: [] };
  return {
    message: text.slice(0, index).trim(),
    details: text
      .slice(index + NOTE_DETAILS_MARKER.length)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

/** Mesajul integral al vânzătorului + ce a completat în formular + contextul (magazin, produs, ciornă). */
export function splitHelpTicketBody(body) {
  const { message, details, context } = parseHelpTicketBody(body);
  return { message, storeSlug: context.storeSlug, details, context };
}

function contactEntries(pairs) {
  const seen = new Set();
  const out = [];
  for (const [kind, label, value] of pairs) {
    const clean = String(value || "").trim();
    if (!clean || seen.has(`${kind}:${clean.toLowerCase()}`)) continue;
    seen.add(`${kind}:${clean.toLowerCase()}`);
    out.push({ kind, label, value: clean });
  }
  return out;
}

/** Doar contactele pe care Adminul le primește deja în listă, fără dubluri. */
export function productSellerContact(product) {
  return contactEntries([
    ["email", "Email vânzător", product?.vendor?.email],
    ["phone", "Telefon vânzător", product?.vendor?.phone],
    ["email", "Email magazin", product?.service?.email],
    ["phone", "Telefon magazin", product?.service?.phone],
  ]);
}

export function ticketSellerContact(ticket) {
  return contactEntries([["email", "Email cont", ticket?.requester?.email || ticket?.requesterEmail]]);
}

export function ticketSellerName(ticket) {
  const person = [ticket?.requester?.firstName, ticket?.requester?.lastName].filter(Boolean).join(" ").trim();
  return person || ticket?.requesterName || "";
}

// statusurile existente ale tichetului: OPEN / PENDING / CLOSED
export const TICKET_STATUS_LABELS = HELP_STATUS_LABELS;

export function formatHelpDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}
