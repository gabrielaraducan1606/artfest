// backend/.puppeteerrc.cjs
//
// Chrome-ul Puppeteer (PDF: facturi, etichete și avize Târg) se descarcă ÎN
// proiect, la `npm ci` / `npm install` (postinstall puppeteer), nu în
// $HOME/.cache. Pe Render cu runtime Node nativ doar directorul proiectului
// (/opt/render/project/src) ajunge la rulare; $HOME/.cache de la build nu
// => „Could not find Chrome”. Același director e citit și la pornirea
// browserului, deci build și runtime caută în același loc.
// În Docker (WORKDIR /app) rezultă /app/.cache/puppeteer, identic cu
// PUPPETEER_CACHE_DIR din Dockerfile.
const { join } = require("path");

module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
