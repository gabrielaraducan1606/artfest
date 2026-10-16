// backend/src/lib/htmlToPdf.js
import puppeteer from "puppeteer";

// valorile folosite de facturi (apelurile fără opțiuni rămân identice)
const DEFAULT_PDF_OPTIONS = Object.freeze({
  format: "A4",
  margin: {
    top: "14mm",
    right: "14mm",
    bottom: "18mm",
    left: "14mm",
  },
});

/*
 * options (opțional), pentru documente cu altă dimensiune (ex. etichetele
 * Târgului Artfest):
 *   - width / height: dimensiune custom (ex. "70mm" / "37mm"); dacă sunt
 *     date, înlocuiesc `format`;
 *   - format: ex. "A4";
 *   - margin: { top, right, bottom, left }.
 */
export function resolvePdfOptions(options = {}) {
  const { width, height, format, margin } = options || {};
  const size = width && height ? { width, height } : { format: format || DEFAULT_PDF_OPTIONS.format };

  return {
    ...size,
    printBackground: true,
    preferCSSPageSize: true,
    margin: margin || DEFAULT_PDF_OPTIONS.margin,
  };
}

export async function htmlToPdfBuffer(html, options = {}) {
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
