// src/pages/Admin/AdminDesktop/tabs/posReceiveSheet.js
//
// POS -> fișa unui produs trimis de vânzător, dar NErecepționat (scanat cu cod AF), și căutarea
// produselor asemănătoare la „Adaugă produs într-un magazin”. Fără React - testabil cu node --test.
// Salvarea folosește serviciile existente, în ordine: preț final -> recepție (posSale) -> coș.
// Pașii deja reușiți nu se repetă la „Reia” (iar serverul e idempotent la fiecare pas).

import { parseLeiToCents } from "../../../Vendor/Fair/fairAccessories.js";

/** De ce NU se poate recepționa pentru vânzare din POS (null = se poate). */
export function sheetBlockReason(line) {
  if (!line) return "Produs necunoscut.";
  if (line.artfestOwned) return null;
  if (line.registrationStatus && line.registrationStatus !== "APPROVED") {
    return "Participarea vânzătorului nu este activă: produsul nu se recepționează și nu se vinde din POS.";
  }
  if (line.saleBlocked) return `Produs blocat de la vânzare${line.saleBlocked.reason ? `: ${line.saleBlocked.reason}` : ""}.`;
  if (line.eligibility && line.eligibility.eligible === false) {
    const why = (line.eligibility.reasons || []).join(" ");
    return `Produsul nu este eligibil pentru vânzare${why ? `: ${why}` : "."}`;
  }
  if (line.status !== "SUBMITTED") return line.status === "RECEIVED" ? null : "Linia nu poate fi recepționată (nu a fost trimisă de vânzător sau a fost anulată).";
  return null;
}

/*
 * Câmpurile fișei -> { ok, fields, qty, priceCents }.
 *  - cantitatea primită fizic: 1 … (declarat − deja recepționat); peste => suplimentarea stocului;
 *  - prețul final: gol = prețul de vânzare actual; altfel > 0;
 *  - confirmarea explicită a primirii fizice (prezența o confirmă Adminul, nu scanarea).
 */
export function validateSheet({ qtyText, priceText, confirmed }, line) {
  const fields = {};
  const max = Math.max(0, (Number(line?.declaredQty) || 0) - (Number(line?.receivedQty) || 0));
  const qty = Number(String(qtyText ?? "").trim());
  if (!Number.isInteger(qty) || qty < 1) fields.qty = "Introdu câte bucăți ai primit fizic (număr întreg ≥ 1).";
  else if (qty > max) {
    fields.qty = `Cel mult ${max} buc. (cantitatea declarată). Pentru marfă suplimentară folosește „Suplimentează stocul” după recepție.`;
  }
  let priceCents = null;
  if (String(priceText ?? "").trim()) {
    priceCents = parseLeiToCents(priceText);
    if (priceCents === null) fields.price = "Preț final invalid (ex. 120 sau 99,90).";
  }
  if (!fields.qty && confirmed !== true) fields.confirm = `Confirmă că ai primit fizic ${qty} buc.`;
  return { ok: Object.keys(fields).length === 0, fields, qty: fields.qty ? null : qty, priceCents };
}

export const SHEET_STEPS = Object.freeze(["price", "receive", "cart"]);
export const SHEET_STEP_LABEL = Object.freeze({
  price: "Preț final salvat",
  receive: "Recepție înregistrată",
  cart: "Adăugat în coș",
});

/** Pașii rămași (în ordine), după cei deja reușiți. Prețul doar dacă diferă de cel actual. */
export function pendingSteps(done, { priceChanged }) {
  return SHEET_STEPS.filter((s) => !done.includes(s) && (s !== "price" || priceChanged));
}

/* ===================== Produse asemănătoare ===================== */

const STOP = new Set(["de", "din", "cu", "si", "pentru", "la", "in", "mic", "mica", "mare"]);

export function titleWords(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/*
 * Produsele existente ale participantului care seamănă cu denumirea scrisă (un cuvânt semnificativ
 * comun, fără diacritice / majuscule), cele mai asemănătoare primele. Fără anulate / ciorne.
 */
export function findSimilarProducts(lines, title, limit = 5) {
  const wanted = titleWords(title);
  if (!wanted.length) return [];
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => !["CANCELLED", "DRAFT"].includes(l?.status))
    .map((l) => {
      const words = new Set(titleWords(l.title));
      const score = wanted.filter((w) => words.has(w) || [...words].some((x) => x.startsWith(w) || w.startsWith(x))).length;
      return { line: l, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.line.title).localeCompare(String(b.line.title), "ro"))
    .slice(0, limit)
    .map((x) => x.line);
}
