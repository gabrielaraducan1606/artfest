// backend/src/lib/pdfOptions.js
//
// Opțiunile page.pdf() comune pentru toate PDF-urile (facturi, etichete,
// avize). Mutat din htmlToPdf.js NESCHIMBAT, ca htmlToPdf.js și pdfBrowser.js
// să îl folosească fără import circular (htmlToPdf.js îl reexportă).

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
  const { width, height, format, margin, footerTemplate } = options || {};
  const size = width && height ? { width, height } : { format: format || DEFAULT_PDF_OPTIONS.format };

  return {
    ...size,
    printBackground: true,
    preferCSSPageSize: true,
    margin: margin || DEFAULT_PDF_OPTIONS.margin,
    // subsol opțional (ex. „Pagina X din Y” la avize); fără el, PDF-ul rămâne identic
    ...(footerTemplate
      ? { displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate }
      : {}),
  };
}
