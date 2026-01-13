// backend/src/lib/htmlToPdf.js
import puppeteer from "puppeteer";

export async function htmlToPdfBuffer(html) {
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

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "14mm",
        right: "14mm",
        bottom: "18mm",
        left: "14mm",
      },
    });

    return pdf;
  } finally {
    await browser.close();
  }
}
