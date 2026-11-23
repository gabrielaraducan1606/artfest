// backend/src/lib/fairPromoLabels.js
//
// Etichete FĂRĂ PREȚ ale Târgului Artfest (promovare): numele + un QR către o pagină
// publică + un text scurt. NU sunt pentru POS: fără preț, fără produs, fără cod AF;
// nu înregistrează vânzări și nu mișcă stocul.
//   - "store":   numele magazinului + QR către pagina lui publică + „Scanează și descoperă magazinul”;
//   - "artfest": „Artfest” + QR către https://www.artfest.ro + „Descoperă creația românească” + artfest.ro.
//
// Același format și aceeași așezare ca etichetele existente (fairLabels.js, varianta
// „standard”): 70 × 37 mm, A4 cu 3 coloane × 8 rânduri, aceeași margine de sus.
// Se generează EXACT numărul cerut; pozițiile rămase pe ultima coală sunt goale.
// Fundal alb, text negru, QR negru pe alb cu margine liberă (fără elemente peste el).

import { storeQrSvg } from "./fairLabels.js";
import { renderPdfWithSharedBrowser } from "./pdfBrowser.js";
import { LABEL_HEIGHT_MM, LABEL_SHEET_COLUMNS, LABEL_SHEET_ROWS, LABEL_SITE_TEXT, LABEL_WIDTH_MM } from "../config/artfestFair.js";

export const PROMO_LABEL_KINDS = Object.freeze(["store", "artfest"]);
export const PROMO_LABEL_MAX_COPIES = 240; // 10 coli A4
export const PROMO_LABELS_PER_SHEET = LABEL_SHEET_COLUMNS * LABEL_SHEET_ROWS;

export const ARTFEST_PROMO = Object.freeze({
  name: "Artfest",
  url: "https://www.artfest.ro",
  text: "Descoperă creația românească",
  site: LABEL_SITE_TEXT,
});
export const STORE_PROMO_TEXT = "Scanează și descoperă magazinul";

// QR: 25 mm (module ≈ 0,8 mm la adresele obișnuite) + 3 mm margine liberă albă în jur
// (+1 mm până la marginea din dreapta a etichetei: ≥ 4 mm, ~4 module, liber pe toate laturile)
const QR_MM = 25;
const QR_QUIET_MM = 3;

const NO_MARGIN = { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Număr de exemplare: întreg 1..PROMO_LABEL_MAX_COPIES; altfel null. */
export function parsePromoCopies(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= PROMO_LABEL_MAX_COPIES ? n : null;
}

/** Același CSS de coală ca etichetele existente (fairLabels.buildLabelsHtml, „standard”). */
export function promoSheetCss() {
  return `@page { size: A4; margin: 0; }
         .sheet { width: 210mm; height: 297mm; padding-top: ${(297 - LABEL_SHEET_ROWS * LABEL_HEIGHT_MM) / 2}mm;
                  display: grid; grid-template-columns: repeat(${LABEL_SHEET_COLUMNS}, ${LABEL_WIDTH_MM}mm);
                  grid-auto-rows: ${LABEL_HEIGHT_MM}mm; align-content: start; }`;
}

/**
 * @param {{ name: string, url: string, text: string, site?: string|null }} target
 * @param {number} copies
 */
export function buildPromoLabelsHtml(target, copies) {
  const qr = storeQrSvg(target.url);
  const cell = `
      <div class="label">
        <div class="text">
          <div class="name">${escapeHtml(target.name)}</div>
          <div class="pitch">${escapeHtml(target.text)}</div>
          ${target.site ? `<div class="site">${escapeHtml(target.site)}</div>` : ""}
          <div class="blankPrice">Preț: <span class="blankLine"></span> lei</div>
        </div>
        <div class="qr">${qr}</div>
      </div>`;
  const pages = [];
  for (let i = 0; i < copies; i += PROMO_LABELS_PER_SHEET) {
    pages.push(cell.repeat(Math.min(PROMO_LABELS_PER_SHEET, copies - i)));
  }
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<style>
  ${promoSheetCss()}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Inter", "Segoe UI", "DejaVu Sans", Arial, sans-serif; color: #000; }
  .sheet { page-break-after: always; overflow: hidden; }
  .sheet:last-child { page-break-after: auto; }
  .label { width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM}mm; padding: 0 1mm 0 3mm; background: #fff;
           display: flex; align-items: center; gap: 1mm; overflow: hidden; }
  .text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1.2mm; }
  .name { font-size: 10.5pt; font-weight: 800; line-height: 1.15; max-height: 2.3em; overflow: hidden;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .pitch { font-size: 7pt; line-height: 1.25; }
  .site { font-size: 7pt; font-weight: 700; }
  /* loc alb pentru prețul scris cu pixul (fără preț tipărit) */
  .blankPrice { display: flex; align-items: baseline; gap: 1mm; font-size: 9pt; font-weight: 700; margin-top: 1mm; }
  .blankLine { flex: 1 1 auto; min-width: 14mm; height: 4.5mm; border-bottom: 0.3mm solid #000; }
  /* QR negru pe alb, cu margine liberă albă (quiet zone) de ${QR_QUIET_MM} mm pe fiecare latură */
  .qr { flex: 0 0 ${QR_MM + 2 * QR_QUIET_MM}mm; width: ${QR_MM + 2 * QR_QUIET_MM}mm; height: ${QR_MM + 2 * QR_QUIET_MM}mm;
        padding: ${QR_QUIET_MM}mm; background: #fff; }
  .qr svg { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
${pages.map((page) => `<div class="sheet">${page}</div>`).join("\n")}
</body>
</html>`;
}

export async function renderPromoLabelsPdf(target, copies, { toPdf = renderPdfWithSharedBrowser } = {}) {
  const html = buildPromoLabelsHtml(target, copies);
  const pdf = await toPdf(html, { format: "A4", margin: NO_MARGIN });
  return { pdf, labelCount: copies, pageCount: Math.ceil(copies / PROMO_LABELS_PER_SHEET) };
}
