// backend/src/lib/htmlToPdf.js
import puppeteer from "puppeteer";
import { resolvePdfOptions } from "./pdfOptions.js";
import { renderPdfWithSharedBrowser } from "./pdfBrowser.js";

// compatibilitate: importat din acest modul de alte fișiere
export { resolvePdfOptions };

/*
 * Facturi (client / vânzător / Admin) -> PDF.
 *
 * Implicit pe browserul Chrome PARTAJAT (pdfBrowser.js): o singură instanță,
 * număr limitat de pagini simultane (PDF_MAX_CONCURRENT_PAGES). Înainte,
 * fiecare factură pornea un Chrome nou (~150-250 MB pe Linux, măsurat ~395 MB
 * pe Windows), fără limită - câteva descărcări simultane puteau depăși
 * memoria instanței Render de 512 MB.
 *
 * Conținutul nu se schimbă: același HTML, aceleași opțiuni page.pdf, media
 * „print”. Așteptarea e "load" + fonturile gata (șablonul facturii nu face
 * cereri de rețea - verificat); PDF-ul rezultat e identic octet cu octet cu
 * cel vechi (testat: htmlToPdf.invoices.test.js). Comutator de revenire fără
 * cod: PDF_INVOICE_SHARED_BROWSER=0 -> comportamentul vechi (un Chrome per PDF).
 */
export async function htmlToPdfBuffer(html, options = {}) {
  if (process.env.PDF_INVOICE_SHARED_BROWSER === "0") {
    return htmlToPdfBufferIsolated(html, options);
  }
  return renderPdfWithSharedBrowser(html, options);
}

/** Implementarea veche, păstrată NESCHIMBATĂ: un Chrome nou pentru fiecare PDF. */
export async function htmlToPdfBufferIsolated(html, options = {}) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--font-render-hinting=medium",
    ],
  });

  try {
    const page = await browser.newPage();

    // Important: setăm media print ca să respecte @page
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf(resolvePdfOptions(options));

    return pdf;
  } finally {
    await browser.close();
  }
}
