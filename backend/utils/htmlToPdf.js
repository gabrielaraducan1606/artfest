// backend/utils/htmlToPdf.js
import puppeteer from "puppeteer";
import path from "path";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=medium"];

export default async function htmlToPdfBuffer(html, opts = {}) {
  if (!html || typeof html !== "string") throw new Error("htmlToPdfBuffer: HTML invalid.");

  const browser = await puppeteer.launch({
    headless: "new",
    args: LAUNCH_ARGS,
    // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // dacă vrei Chrome-ul tău
  });

  try {
    const page = await browser.newPage();

    // base pentru resurse relative (dacă vei adăuga imagini locale etc.)
    const baseDir = path.join(process.cwd(), "backend").replace(/\\/g, "/");
    const baseHref = `file:///${baseDir.replace(/^\/+/, "")}/`;

    await page.setContent(
      `<!doctype html><html><head><base href="${baseHref}"></head><body>${html}</body></html>`,
      { waitUntil: "domcontentloaded" }
    );

    await page.emulateMediaType("screen");
    // așteaptă fonturile
    try { await page.evaluateHandle("document.fonts && document.fonts.ready"); } catch {}
    await page.waitForTimeout(100);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "12mm", bottom: "20mm", left: "12mm" },
      ...opts,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
