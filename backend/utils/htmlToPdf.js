// backend/utils/htmlToPdf.js
import puppeteer from "puppeteer";

export default async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--allow-file-access-from-files",
      "--disable-dev-shm-usage",
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.emulateMediaType("screen");
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return pdf;
  } finally {
    await browser.close();
  }
}
