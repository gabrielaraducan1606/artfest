// Imaginea Docker a backendului trebuie să conțină Chrome-ul folosit de Puppeteer
// (PDF-uri: etichetele Târgului Artfest, facturi). Cauza erorii 500 la
// /api/admin/artfest-fair/inventory/labels.pdf: Chrome se descărca la `npm ci`
// în /root/.cache/puppeteer (builder), iar runner-ul copia doar /app =>
// "Could not find Chrome (ver. ...)" la prima generare de PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dockerfile = read("../../Dockerfile");
const dockerignore = read("../../.dockerignore");

const stages = dockerfile.split(/^FROM /m).slice(1);
const builder = stages.find((s) => / AS builder/.test(s.split("\n")[0]));
const runner = stages.find((s) => / AS runner/.test(s.split("\n")[0]));
const CACHE_ENV = "ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer";

test("builder: Chrome se descarcă în /app (cache setat ÎNAINTE de npm ci)", () => {
  assert.ok(builder && runner, "Dockerfile cu etapele builder + runner");
  const env = builder.indexOf(CACHE_ENV);
  const install = builder.indexOf("RUN npm ci");
  assert.ok(env >= 0, "PUPPETEER_CACHE_DIR în builder");
  assert.ok(install > env, "npm ci (postinstall Puppeteer) rulează după setarea cache-ului");
});

test("runner: copiază /app (deci și /app/.cache) și caută Chrome în același director", () => {
  assert.ok(runner.includes(CACHE_ENV), "PUPPETEER_CACHE_DIR în runner");
  assert.match(runner, /COPY --from=builder \/app \.\//);
});

// pachetele Debian bookworm care acoperă bibliotecile declarate (DT_NEEDED) de binarul
// Chrome for Testing 143.0.7499.169 linux64 folosit de Puppeteer 24.34 (libc6 / libgcc-s1 sunt în imaginea de bază)
const CHROME_DEB_PACKAGES = [
  "libglib2.0-0", "libnspr4", "libnss3", "libdbus-1-3", "libatk1.0-0", "libatk-bridge2.0-0", "libatspi2.0-0",
  "libcups2", "libexpat1", "libxcb1", "libxkbcommon0", "libx11-6", "libxcomposite1", "libxdamage1", "libxext6",
  "libxfixes3", "libxrandr2", "libgbm1", "libcairo2", "libpango-1.0-0", "libudev1", "libasound2",
];

test("runner: bibliotecile de sistem ale Chrome headless + fonturi cu diacritice", () => {
  for (const lib of CHROME_DEB_PACKAGES) {
    assert.match(runner, new RegExp(`(^|\\s)${lib.replace(/[.+]/g, "\\$&")}(\\s|$)`, "m"), lib);
  }
  assert.ok(runner.includes("fonts-dejavu-core"));
  assert.match(runner, /rm -rf \/var\/lib\/apt\/lists\/\*/);
});

test(".dockerignore: cache-ul local de Chrome nu intră în imagine", () => {
  assert.ok(dockerignore.split("\n").map((l) => l.trim()).includes(".cache"));
});

test("PDF-urile nu fixează o cale proprie de Chrome (folosesc configurarea Puppeteer)", () => {
  for (const rel of ["./pdfBrowser.js", "./htmlToPdf.js"]) {
    assert.doesNotMatch(read(rel), /executablePath/, rel);
  }
});
