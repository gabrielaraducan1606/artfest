// backend/src/lib/fairLabels.js
//
// Etichetele Târgului Artfest: 70 × 37 mm, cod de bare Code128 pentru scannerul
// USB + cod QR pentru camera telefonului (bwip-js, SVG vectorial => clar la
// print). AMBELE codifică EXACT același identificator (ex. AF7K3M9QXT), deci
// intră prin aceeași logică de recepție / vânzare. Două formate:
//   - "single": o etichetă pe o pagină de 70 × 37 mm;
//   - "sheet":  A4, 3 coloane × 8 rânduri = 24 etichete / pagină.
// PDF-ul se face din HTML pe browserul Puppeteer partajat (pdfBrowser.js):
// fără o instanță Chrome nouă per etichetă.

import bwipjs from "bwip-js";
import { renderPdfWithSharedBrowser } from "./pdfBrowser.js";
import {
  LABEL_HEIGHT_MM,
  LABEL_SHEET_COLUMNS,
  LABEL_SHEET_ROWS,
  LABEL_SITE_TEXT,
  LABEL_WIDTH_MM,
} from "../config/artfestFair.js";

const PER_SHEET = LABEL_SHEET_COLUMNS * LABEL_SHEET_ROWS;
const NO_MARGIN = { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatLabelPrice(priceCents) {
  const value = Number(priceCents || 0) / 100;
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(".", ",");
  return `${text} lei`;
}

// AF-7K3M-9QXT (codul de bare conține AF7K3M9QXT)
export function formatLabelCode(barcode) {
  const raw = String(barcode || "");
  return raw.length === 10 ? `${raw.slice(0, 2)}-${raw.slice(2, 6)}-${raw.slice(6)}` : raw;
}

export function barcodeSvg(code) {
  return bwipjs.toSVG({
    bcid: "code128",
    text: String(code),
    height: 9, // mm (înălțimea barelor)
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
}

// QR cu EXACT același identificator ca codul de bare (fără alt token / alt ID)
export function qrSvg(code) {
  return bwipjs.toSVG({
    bcid: "qrcode",
    text: String(code),
    eclevel: "M",
    paddingwidth: 0,
    paddingheight: 0,
  });
}

/*
 * labels: [{ title, variantLabel, storeName, priceCents, barcode }]
 */
export function buildLabelsHtml(labels, { mode = "sheet" } = {}) {
  // același cod => aceleași SVG-uri (o coală are des multe copii ale aceleiași etichete)
  const cache = new Map();
  const svgsFor = (code) => {
    if (!cache.has(code)) cache.set(code, { bar: barcodeSvg(code), qr: qrSvg(code) });
    return cache.get(code);
  };
  const cells = labels
    .map((label) => {
      const { bar, qr } = svgsFor(label.barcode);
      return `
      <div class="label">
        <div class="top">
          <div class="text">
            <div class="title">${escapeHtml(label.title)}</div>
            ${label.variantLabel ? `<div class="variant">${escapeHtml(label.variantLabel)}</div>` : ""}
            ${label.storeName ? `<div class="store">${escapeHtml(label.storeName)}</div>` : ""}
            <div class="price">${escapeHtml(formatLabelPrice(label.priceCents))}</div>
          </div>
          <div class="qr">${qr}</div>
        </div>
        <div class="barcode">${bar}</div>
        <div class="bottom">
          <span class="code">${escapeHtml(formatLabelCode(label.barcode))}</span>
          <span class="site">${escapeHtml(LABEL_SITE_TEXT)}</span>
        </div>
      </div>`;
    });

  const pages = [];
  if (mode === "single") {
    pages.push(cells.join(""));
  } else {
    for (let i = 0; i < cells.length; i += PER_SHEET) pages.push(cells.slice(i, i + PER_SHEET).join(""));
  }

  const pageCss =
    mode === "single"
      ? `@page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
         .sheet { width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM}mm; }`
      : `@page { size: A4; margin: 0; }
         .sheet { width: 210mm; height: 297mm; padding-top: ${(297 - LABEL_SHEET_ROWS * LABEL_HEIGHT_MM) / 2}mm;
                  display: grid; grid-template-columns: repeat(${LABEL_SHEET_COLUMNS}, ${LABEL_WIDTH_MM}mm);
                  grid-auto-rows: ${LABEL_HEIGHT_MM}mm; align-content: start; }`;

  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<style>
  ${pageCss}
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Inter", "Segoe UI", "DejaVu Sans", Arial, sans-serif; color: #111; }
  .sheet { page-break-after: always; overflow: hidden; }
  .sheet:last-child { page-break-after: auto; }
  .label { width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM}mm; padding: 2.2mm 3mm 1.6mm;
           display: flex; flex-direction: column; overflow: hidden; }
  /* sus: text + preț în stânga, QR (15 mm, pentru telefon) în dreapta */
  .top { display: flex; gap: 2mm; align-items: stretch; height: 16mm; flex: 0 0 auto; }
  .text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .title { font-size: 8pt; font-weight: 700; line-height: 1.15; max-height: 2.3em; overflow: hidden;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .variant, .store { font-size: 6pt; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .store { color: #444; }
  .price { margin-top: auto; font-size: 11pt; font-weight: 800; white-space: nowrap; line-height: 1.1; }
  .qr { flex: 0 0 16mm; width: 16mm; height: 16mm; padding: 0.5mm; background: #fff; }
  .qr svg { width: 100%; height: 100%; display: block; }
  /* jos: codul 1D pe toată lățimea (aceeași densitate ca înainte, pentru scannerul USB) */
  .barcode { height: 9.5mm; margin: 1.4mm 2mm 0.6mm; flex: 0 0 auto; }
  .barcode svg { width: 100%; height: 100%; display: block; }
  .bottom { display: flex; justify-content: space-between; font-size: 6.5pt; line-height: 1; }
  .code { font-weight: 700; letter-spacing: 0.3pt; }
  .site { color: #444; }
</style>
</head>
<body>
${pages.map((page) => `<div class="sheet">${page}</div>`).join("\n")}
</body>
</html>`;
}

/*
 * Câte etichete pe linie (Admin): "declared" = una pe bucată declarată (implicit),
 * "received" = una pe bucată recepționată (doar liniile recepționate), "one" = una
 * pe produs. Codul de bare e mereu cel existent al liniei - nu se generează coduri noi.
 */
export const LABEL_COPY_MODES = Object.freeze(["declared", "received", "one"]);

export function applyLabelCopies(items, mode = "declared") {
  if (mode === "one") return items.map((item) => ({ ...item, labelCopies: 1 }));
  if (mode === "received") {
    return items
      .filter((item) => item.status === "RECEIVED" && (item.receivedQty || 0) > 0)
      .map((item) => ({ ...item, labelCopies: item.receivedQty }));
  }
  return items.map((item) => ({ ...item, labelCopies: item.declaredQty }));
}

// o etichetă pentru fiecare bucată declarată (sau labelCopies, dacă e setat)
export function expandLabelCopies(items) {
  const labels = [];
  for (const item of items) {
    const label = {
      title: item.titleSnapshot,
      variantLabel: item.variantLabel || null,
      storeName: item.storeNameSnapshot || null,
      priceCents: item.priceSnapshotCents,
      barcode: item.barcode,
    };
    const copies = item.labelCopies ?? item.declaredQty;
    for (let i = 0; i < Math.max(1, copies || 0); i += 1) labels.push(label);
  }
  return labels;
}

export async function renderSingleLabelPdf(item, { toPdf = renderPdfWithSharedBrowser } = {}) {
  const html = buildLabelsHtml(expandLabelCopies([{ ...item, declaredQty: 1 }]), { mode: "single" });
  return toPdf(html, { width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`, margin: NO_MARGIN });
}

export async function renderLabelSheetPdf(items, { toPdf = renderPdfWithSharedBrowser } = {}) {
  const labels = expandLabelCopies(items);
  const html = buildLabelsHtml(labels, { mode: "sheet" });
  const pdf = await toPdf(html, { format: "A4", margin: NO_MARGIN });
  return { pdf, labelCount: labels.length, pageCount: Math.ceil(labels.length / PER_SHEET) };
}
