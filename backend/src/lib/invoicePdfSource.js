// backend/src/lib/invoicePdfSource.js
//
// De unde servim PDF-ul unei facturi DEJA EMISE (fără să emitem nimic nou):
//
//   1. fișierul local salvat la emitere (providerPdfUrl / pdfUrl);
//   2. dacă lipsește (discul Render se golește la fiecare deploy/restart) și
//      factura e emisă în SmartBill cu serie + număr -> PDF-ul OFICIAL
//      descărcat din nou din SmartBill (GET /invoice/pdf, doar citire);
//      copia locală se reface best-effort, la aceeași cale (fără scriere în DB);
//   3. altfel null -> apelantul decide (ex. factură LOCAL generată din HTML).
//
// Autorizarea (factura aparține vânzătorului / adminului) rămâne în rută.

import fs from "node:fs/promises";
import path from "node:path";

import { getSmartBillInvoicePdfBuffer } from "./smartbill.js";

const UPLOADS_DIR = "uploads";

/** Calea absolută a unui URL local de tip /uploads/...; null dacă iese din uploads/. */
export function localPdfPath(pdfUrl, cwd = process.cwd()) {
  if (typeof pdfUrl !== "string" || !pdfUrl.startsWith("/")) return null;
  const root = path.resolve(cwd, UPLOADS_DIR);
  const abs = path.resolve(cwd, pdfUrl.replace(/^\/+/, ""));
  return abs.startsWith(root + path.sep) && abs.toLowerCase().endsWith(".pdf") ? abs : null;
}

export function smartBillPdfRef(invoice) {
  if (invoice?.provider !== "SMARTBILL") return null;
  const seriesName = invoice.providerSeries || invoice.series;
  const number = invoice.providerNumber || invoice.number;
  if (!seriesName || !number) return null;
  return { seriesName: String(seriesName), number: String(number) };
}

export class SmartBillPdfUnavailableError extends Error {
  constructor(cause) {
    super("SMARTBILL_PDF_UNAVAILABLE");
    this.code = "SMARTBILL_PDF_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * @returns {Promise<
 *   | { kind: "redirect", url: string }
 *   | { kind: "file", absPath: string, fileName: string, source: "local" }
 *   | { kind: "buffer", buffer: Buffer, fileName: string, source: "smartbill" }
 *   | null>}
 * @throws {SmartBillPdfUnavailableError} factură SmartBill fără copie locală,
 *   iar SmartBill nu a returnat PDF-ul
 */
export async function resolveInvoicePdf(
  invoice,
  { cwd = process.cwd(), fetchSmartBillPdf = getSmartBillInvoicePdfBuffer, logger = console } = {}
) {
  const candidates = [...new Set([invoice?.providerPdfUrl, invoice?.pdfUrl].filter(Boolean))];

  for (const url of candidates) {
    if (/^https?:\/\//i.test(url)) return { kind: "redirect", url };
    const absPath = localPdfPath(url, cwd);
    if (!absPath) continue;
    try {
      await fs.access(absPath);
      return { kind: "file", absPath, fileName: path.basename(absPath), source: "local" };
    } catch {
      // lipsă local (ex. după un deploy) -> încercăm SmartBill
    }
  }

  const ref = smartBillPdfRef(invoice);
  if (!ref) return null;

  let buffer;
  try {
    buffer = await fetchSmartBillPdf(ref);
  } catch (error) {
    logger.error?.("[invoicePdf] PDF SmartBill indisponibil", {
      invoiceId: invoice.id,
      series: ref.seriesName,
      number: ref.number,
      error: error?.message,
    });
    throw new SmartBillPdfUnavailableError(error);
  }

  const fileName = `${ref.seriesName}-${ref.number}.pdf`.replace(/[^\w.-]/g, "_");

  // copie locală refăcută la calea deja salvată pe factură (best-effort)
  const cachePath =
    candidates.map((url) => localPdfPath(url, cwd)).find(Boolean) ||
    localPdfPath(`/${UPLOADS_DIR}/invoices/${fileName}`, cwd);
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, buffer);
  } catch (error) {
    logger.warn?.("[invoicePdf] copia locală nu a putut fi salvată", { invoiceId: invoice.id, error: error?.message });
  }

  logger.info?.("[invoicePdf] PDF oficial recuperat din SmartBill", { invoiceId: invoice.id, bytes: buffer.length });
  return { kind: "buffer", buffer, fileName, source: "smartbill" };
}
