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
 * Două formate (aceeași lățime, 70 mm):
 *  - "standard" (implicit): eticheta produsului, 70 × 37 mm - NESCHIMBATĂ;
 *  - "promo": 70 × 74 mm = două celule de 70 × 37 suprapuse: sus creatorul +
 *    Artfest (rămâne la client), jos eticheta standard identică (se detașează).
 *    Linia punctată cade exact pe granița celulelor => pe colile pre-tăiate
 *    3 × 8 coincide cu tăietura existentă; pe hârtie simplă e ghidul de tăiere.
 */
export const LABEL_LAYOUTS = Object.freeze(["standard", "promo"]);
const PROMO_ROWS = LABEL_SHEET_ROWS / 2; // 4 etichete duble pe coloană
const PER_PROMO_SHEET = LABEL_SHEET_COLUMNS * PROMO_ROWS;

export function labelLayout(value) {
  return value === "promo" ? "promo" : "standard";
}

export function labelHeightMm(layout = "standard") {
  return labelLayout(layout) === "promo" ? LABEL_HEIGHT_MM * 2 : LABEL_HEIGHT_MM;
}

export function labelsPerSheet(layout = "standard") {
  return labelLayout(layout) === "promo" ? PER_PROMO_SHEET : PER_SHEET;
}

// QR-ul magazinului: URL-ul public (altă destinație decât QR-ul produsului)
export function storeQrSvg(url) {
  return bwipjs.toSVG({
    bcid: "qrcode",
    text: String(url),
    eclevel: "M",
    paddingwidth: 0,
    paddingheight: 0,
  });
}

function productCellHtml(label, { bar, qr }) {
  return `
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
        </div>`;
}

// sus: 37 mm de promovare; QR-ul magazinului 18 mm; nimic important la mai puțin de 3 mm de linia de tăiere
const PROMO_CSS = `
  .double { position: relative; width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM * 2}mm; display: flex; flex-direction: column; overflow: hidden; }
  .promo { width: ${LABEL_WIDTH_MM}mm; height: ${LABEL_HEIGHT_MM}mm; flex: 0 0 auto; padding: 2.4mm 3mm 3.2mm;
           display: flex; flex-direction: column; overflow: hidden; }
  .creator { display: flex; gap: 2.5mm; align-items: stretch; height: 18mm; flex: 0 0 auto; }
  .creatorText { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .from { font-size: 6.5pt; line-height: 1.2; color: #444; }
  .storeName { font-size: 9pt; font-weight: 800; line-height: 1.15; max-height: 2.3em; overflow: hidden;
               display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .hint { margin-top: auto; font-size: 5.8pt; line-height: 1.25; color: #555; }
  .storeQr { flex: 0 0 18mm; width: 18mm; height: 18mm; background: #fff; }
  .storeQr svg { width: 100%; height: 100%; display: block; }
  .creatorEmpty { flex-direction: column; justify-content: center; align-items: center; gap: 1mm; text-align: center; }
  .wordmark { font-size: 16pt; font-weight: 800; letter-spacing: 0.3pt; line-height: 1; }
  .wordmark span { font-weight: 500; color: #444; }
  .pitch { margin-top: auto; padding-top: 1.3mm; border-top: 0.2mm solid #999; }
  .tagline { font-size: 7pt; font-weight: 800; line-height: 1.2; }
  .pitchText { margin-top: 0.4mm; font-size: 6pt; line-height: 1.25; color: #333; }
  /* ghidul de tăiere manuală: exact pe granița celor două celule de 37 mm */
  .cut { position: absolute; left: 0; right: 0; top: ${LABEL_HEIGHT_MM}mm; height: 0; border-top: 0.3mm dashed #000; }`;

const PROMO_TAGLINE ="Un cadou special? Un eveniment de neuitat?";
const PROMO_TEXT = "Descoperă creații handmade și cadouri personalizate pe artfest.ro.";
const PROMO_STORE_HINT = "Scanează QR-ul și descoperă creațiile acestui magazin.";

// fără magazin identificat sigur: doar promovarea Artfest (fără nume, fără QR)
function promoCellHtml(store, storeQr) {
  const creator = store
    ? `
          <div class="creator">
            <div class="creatorText">
              <div class="from">De la Spiridușul:</div>
              <div class="storeName">${escapeHtml(store.name)}</div>
              <div class="hint">${escapeHtml(PROMO_STORE_HINT)}</div>
            </div>
            <div class="storeQr">${storeQr}</div>
          </div>`
    : `
          <div class="creator creatorEmpty">
            <div class="wordmark">artfest<span>.ro</span></div>
          </div>`;
  return `
        <div class="promo">${creator}
          <div class="pitch">
            <div class="tagline">${escapeHtml(PROMO_TAGLINE)}</div>
            <div class="pitchText">${escapeHtml(PROMO_TEXT)}</div>
          </div>
        </div>`;
}

/*
 * labels: [{ title, variantLabel, storeName, priceCents, barcode, store?: { name, url } | null }]
 */
export function buildLabelsHtml(labels, { mode = "sheet", layout = "standard" } = {}) {
  const promo = labelLayout(layout) === "promo";
  // același cod => aceleași SVG-uri (o coală are des multe copii ale aceleiași etichete)
  const cache = new Map();
  const svgsFor = (code) => {
    if (!cache.has(code)) cache.set(code, { bar: barcodeSvg(code), qr: qrSvg(code) });
    return cache.get(code);
  };
  const storeCache = new Map();
  const storeSvg = (url) => {
    if (!storeCache.has(url)) storeCache.set(url, storeQrSvg(url));
    return storeCache.get(url);
  };
  const cells = labels.map((label) => {
    const product = productCellHtml(label, svgsFor(label.barcode));
    if (!promo) return `\n      <div class="label">${product}\n      </div>`;
    const store = label.store?.url && label.store?.name ? label.store : null;
    return `
      <div class="double">${promoCellHtml(store, store ? storeSvg(store.url) : "")}
        <div class="cut" aria-hidden="true"></div>
        <div class="label">${product}
        </div>
      </div>`;
  });

  const perSheet = labelsPerSheet(layout);
  const height = labelHeightMm(layout);
  const pages = [];
  if (mode === "single") {
    pages.push(cells.join(""));
  } else {
    for (let i = 0; i < cells.length; i += perSheet) pages.push(cells.slice(i, i + perSheet).join(""));
  }

  const rows = promo ? PROMO_ROWS : LABEL_SHEET_ROWS;
  const pageCss =
    mode === "single"
      ? `@page { size: ${LABEL_WIDTH_MM}mm ${height}mm; margin: 0; }
         .sheet { width: ${LABEL_WIDTH_MM}mm; height: ${height}mm; }`
      : `@page { size: A4; margin: 0; }
         .sheet { width: 210mm; height: 297mm; padding-top: ${(297 - rows * height) / 2}mm;
                  display: grid; grid-template-columns: repeat(${LABEL_SHEET_COLUMNS}, ${LABEL_WIDTH_MM}mm);
                  grid-auto-rows: ${height}mm; align-content: start; }`;

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
  .site { color: #444; }${promo ? PROMO_CSS : ""}
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
      store: item.labelStore || null,
    };
    const copies = item.labelCopies ?? item.declaredQty;
    for (let i = 0; i < Math.max(1, copies || 0); i += 1) labels.push(label);
  }
  return labels;
}

export async function renderSingleLabelPdf(item, { toPdf = renderPdfWithSharedBrowser, layout = "standard" } = {}) {
  const html = buildLabelsHtml(expandLabelCopies([{ ...item, declaredQty: 1 }]), { mode: "single", layout });
  return toPdf(html, { width: `${LABEL_WIDTH_MM}mm`, height: `${labelHeightMm(layout)}mm`, margin: NO_MARGIN });
}

export async function renderLabelSheetPdf(items, { toPdf = renderPdfWithSharedBrowser, layout = "standard" } = {}) {
  const labels = expandLabelCopies(items);
  const html = buildLabelsHtml(labels, { mode: "sheet", layout });
  const pdf = await toPdf(html, { format: "A4", margin: NO_MARGIN });
  return { pdf, labelCount: labels.length, pageCount: Math.ceil(labels.length / labelsPerSheet(layout)) };
}

/* ---------- magazinul de pe eticheta „promo” (doar citire din DB) ---------- */

// aceleași condiții ca pagina publică GET /api/public/store/:slug (altfel 404)
export function isPublicProductStore(service) {
  return Boolean(
    service?.profile?.slug &&
      service.isActive &&
      service.status === "ACTIVE" &&
      service.vendor?.isActive &&
      service.type?.code === "products"
  );
}

function storeFromService(service, baseUrl) {
  if (!isPublicProductStore(service)) return null;
  const name = String(service.profile.displayName || service.title || "").trim();
  if (!name) return null;
  return { name: name.slice(0, 160), url: `${baseUrl}/magazin/${encodeURIComponent(service.profile.slug)}` };
}

const STORE_SELECT = {
  id: true,
  vendorId: true,
  title: true,
  isActive: true,
  status: true,
  type: { select: { code: true } },
  vendor: { select: { isActive: true } },
  profile: { select: { slug: true, displayName: true } },
};

/*
 * Magazinul fiecărei linii, DOAR când e sigur:
 *  - produs din catalog: magazinul produsului (Product.serviceId), indiferent câte
 *    magazine are participantul;
 *  - linie fără produs (manuală): doar dacă participantul are UN SINGUR magazin de
 *    produse și acela e public; altfel null (eticheta arată doar promovarea Artfest).
 * Fără pagină publică (slug lipsă, magazin inactiv) -> null: niciun QR către o
 * pagină inexistentă. Nu scrie nimic în DB.
 * @returns {Promise<Map<string, {name: string, url: string} | null>>} itemId -> magazin
 */
export async function resolveLabelStores(items, { db, baseUrl = publicSiteUrl() }) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const result = new Map();
  const productIds = [...new Set(items.filter((i) => i.productId).map((i) => i.productId))];
  const manualVendorIds = [...new Set(items.filter((i) => !i.productId).map((i) => i.vendorId))];

  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, serviceId: true } })
    : [];
  const serviceIdByProduct = new Map(products.map((p) => [p.id, p.serviceId]));
  const serviceIds = [...new Set(products.map((p) => p.serviceId))];
  const [productServices, vendorServices] = await Promise.all([
    serviceIds.length ? db.vendorService.findMany({ where: { id: { in: serviceIds } }, select: STORE_SELECT }) : [],
    manualVendorIds.length
      ? db.vendorService.findMany({
          where: { vendorId: { in: manualVendorIds }, type: { is: { code: "products" } } },
          select: STORE_SELECT,
        })
      : [],
  ]);
  const serviceById = new Map(productServices.map((s) => [s.id, s]));
  const storesByVendor = new Map();
  for (const service of vendorServices) {
    if (!storesByVendor.has(service.vendorId)) storesByVendor.set(service.vendorId, []);
    storesByVendor.get(service.vendorId).push(service);
  }

  for (const item of items) {
    let service = null;
    if (item.productId) {
      service = serviceById.get(serviceIdByProduct.get(item.productId)) || null;
    } else {
      const stores = storesByVendor.get(item.vendorId) || [];
      service = stores.length === 1 ? stores[0] : null; // mai multe magazine: nu ghicim
    }
    result.set(item.id, storeFromService(service, base));
  }
  return result;
}

export function publicSiteUrl(env = process.env) {
  return String(env.APP_URL || "https://www.artfest.ro").replace(/\/+$/, "");
}

export async function withLabelStores(items, { db, layout, baseUrl } = {}) {
  if (labelLayout(layout) !== "promo") return items;
  const stores = await resolveLabelStores(items, { db, baseUrl });
  return items.map((item) => ({ ...item, labelStore: stores.get(item.id) || null }));
}
