// backend/src/lib/pdfBrowser.js
//
// Browser Puppeteer PARTAJAT pentru PDF-uri: etichetele Târgului Artfest și,
// din 2026-11-13, facturile (htmlToPdfBuffer - vezi htmlToPdf.js).
//
// Instanța Render de 512 MB (2026-11-13): paginile simultane sunt limitate
// (PDF_MAX_CONCURRENT_PAGES), cererile în plus așteaptă la rând cel mult
// PDF_QUEUE_TIMEOUT_MS, iar coada are maximum PDF_MAX_QUEUE locuri - fără
// așteptări nelimitate și fără Chrome-uri multiple.
//
//   - o singură instanță Chrome, pornită la prima cerere (fără pornire la
//     startup); cererile simultane așteaptă aceeași pornire;
//   - pornirea la rece poate dura mult pe unele mașini => timeout generos;
//   - dacă browserul moare (crash / disconnect), următoarea cerere îl
//     recreează; o cerere eșuată din cauza asta e reîncercată o dată;
//   - fiecare PDF folosește o pagină nouă, închisă ÎNTOTDEAUNA (finally);
//   - maximum MAX_CONCURRENT_PAGES pagini simultan (memorie controlată;
//     implicit 2, PDF_MAX_CONCURRENT_PAGES);
//   - după IDLE_CLOSE_MS fără cereri browserul se închide (implicit 2 minute,
//     ca Chrome să nu țină memorie degeaba pe instanța de 512 MB);
//   - la SIGINT / SIGTERM browserul se închide înaintea ieșirii procesului.

import puppeteer from "puppeteer";
import { resolvePdfOptions } from "./pdfOptions.js";

function envPositive(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const LAUNCH_TIMEOUT_MS = envPositive("PDF_BROWSER_LAUNCH_TIMEOUT_MS", 120_000);
const RENDER_TIMEOUT_MS = envPositive("PDF_BROWSER_RENDER_TIMEOUT_MS", 60_000);
const IDLE_CLOSE_MS = envPositive("PDF_BROWSER_IDLE_CLOSE_MS", 2 * 60_000);
const MAX_CONCURRENT_PAGES = Math.floor(envPositive("PDF_MAX_CONCURRENT_PAGES", 2));
const QUEUE_TIMEOUT_MS = envPositive("PDF_QUEUE_TIMEOUT_MS", 90_000);
const MAX_QUEUE = Math.floor(envPositive("PDF_MAX_QUEUE", 20));

/** Coada de PDF-uri e plină / așteptarea a depășit termenul - fără Chrome în plus. */
export class PdfBusyError extends Error {
  constructor(message = "Generarea PDF este ocupată momentan. Încearcă din nou în câteva secunde.") {
    super(message);
    this.name = "PdfBusyError";
    this.code = "pdf_busy";
    this.status = 503;
  }
}

export function getPdfBrowserLimits() {
  return { maxConcurrentPages: MAX_CONCURRENT_PAGES, queueTimeoutMs: QUEUE_TIMEOUT_MS, maxQueue: MAX_QUEUE, idleCloseMs: IDLE_CLOSE_MS };
}

let launcher = puppeteer;
let browser = null;
let launching = null;
let idleTimer = null;
let active = 0;
const waiting = [];
let stats = { launches: 0 };

// doar pentru teste
export function __setPdfBrowserLauncher(next) {
  launcher = next || puppeteer;
}

export function getPdfBrowserStats() {
  return { ...stats, open: Boolean(browser), active, waiting: waiting.length };
}

function isAlive(instance) {
  if (!instance) return false;
  if (typeof instance.connected === "boolean") return instance.connected;
  if (typeof instance.isConnected === "function") return instance.isConnected();
  return true;
}

async function launch() {
  const instance = await launcher.launch({
    headless: "new",
    timeout: LAUNCH_TIMEOUT_MS,
    protocolTimeout: RENDER_TIMEOUT_MS * 2,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=medium", "--disable-dev-shm-usage"],
    // închiderea la semnale o facem noi (vezi registerShutdown), ca să nu
    // concureze cu handler-ele serverului
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  stats.launches += 1;
  registerShutdown();

  instance.on?.("disconnected", () => {
    if (browser === instance) browser = null;
  });
  return instance;
}

async function getBrowser() {
  if (isAlive(browser)) return browser;
  browser = null;

  if (!launching) {
    launching = launch()
      .then((instance) => {
        browser = instance;
        return instance;
      })
      .finally(() => {
        launching = null;
      });
  }
  return launching;
}

async function acquireSlot() {
  if (active < MAX_CONCURRENT_PAGES) {
    active += 1;
    return;
  }
  if (waiting.length >= MAX_QUEUE) throw new PdfBusyError();

  await new Promise((resolve, reject) => {
    const entry = () => {
      clearTimeout(entry.timer);
      resolve();
    };
    entry.timer = setTimeout(() => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(new PdfBusyError());
    }, QUEUE_TIMEOUT_MS);
    entry.timer.unref?.();
    waiting.push(entry);
  });
  active += 1;
}

function releaseSlot() {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active === 0 && waiting.length === 0) closePdfBrowser().catch(() => {});
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

function isBrowserGone(error) {
  const message = String(error?.message || "");
  return /Target closed|Session closed|Connection closed|Browser has disconnected|Protocol error|browser has been closed/i.test(
    message
  );
}

async function renderOnce(html, options) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    page.setDefaultTimeout?.(RENDER_TIMEOUT_MS);
    await page.emulateMediaType("print");
    // "load" + fonturile gata. NU "networkidle0": cu pagini simultane, la
    // pornirea la rece a Chrome, prima pagină rămânea uneori blocată până la
    // termen (măsurat 2026-11-13); HTML-ul facturilor/etichetelor nu face
    // cereri de rețea, iar PDF-ul iese identic octet cu octet.
    await page.setContent(html, { waitUntil: options.waitUntil || "load", timeout: RENDER_TIMEOUT_MS });
    try {
      await page.evaluate(() => document.fonts?.ready);
    } catch {
      /* fără document.fonts: PDF-ul se generează oricum */
    }
    return await page.pdf({ ...resolvePdfOptions(options), timeout: RENDER_TIMEOUT_MS });
  } finally {
    await page.close().catch(() => {});
  }
}

/*
 * HTML -> PDF pe browserul partajat. options: aceleași ca htmlToPdfBuffer
 * (width/height sau format, margin).
 */
export async function renderPdfWithSharedBrowser(html, options = {}) {
  clearTimeout(idleTimer);
  await acquireSlot();
  try {
    try {
      return await renderOnce(html, options);
    } catch (error) {
      if (!isBrowserGone(error)) throw error;
      // browserul a murit între timp: îl recreăm și reîncercăm o singură dată
      await closePdfBrowser().catch(() => {});
      return await renderOnce(html, options);
    }
  } finally {
    releaseSlot();
    scheduleIdleClose();
  }
}

export async function closePdfBrowser() {
  clearTimeout(idleTimer);
  const pending = launching;
  const instance = browser;
  browser = null;
  if (instance) await instance.close().catch(() => {});
  else if (pending) {
    const late = await pending.catch(() => null);
    browser = null;
    if (late) await late.close().catch(() => {});
  }
}

/*
 * Închide browserul la oprirea serverului. Handler-ele existente (server.js,
 * db.js) rămân cele care opresc procesul; aici doar închidem Chrome. Dacă
 * nu există alt handler, semnalul e retrimis, ca procesul să se oprească
 * normal. (Puppeteer omoară oricum procesul Chrome la ieșirea Node.)
 * Înregistrat doar după prima pornire a browserului.
 */
let shutdownRegistered = false;
function registerShutdown() {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      const others = process.listenerCount(signal);
      closePdfBrowser()
        .catch(() => {})
        .finally(() => {
          if (others === 0) process.kill(process.pid, signal);
        });
    });
  }
  process.once("beforeExit", () => {
    closePdfBrowser().catch(() => {});
  });
}
