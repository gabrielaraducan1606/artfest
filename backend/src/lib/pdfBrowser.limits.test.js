// src/lib/pdfBrowser.limits.test.js
//
// Limitele browserului PDF partajat pentru instanța Render de 512 MB, cu un
// launcher fals (fără Chrome real):
//  - maximum PDF_MAX_CONCURRENT_PAGES pagini simultan;
//  - coada are PDF_MAX_QUEUE locuri: peste ele -> PdfBusyError imediat;
//  - așteptarea la rând e limitată (PDF_QUEUE_TIMEOUT_MS) -> PdfBusyError,
//    fără locuri „pierdute” (următoarele cereri merg normal);
//  - facturile (htmlToPdfBuffer) folosesc browserul partajat, cu opțiunile A4
//    neschimbate; un browser căzut în timpul unei facturi e recreat automat;
//  - PDF_INVOICE_SHARED_BROWSER=0 revine la implementarea veche.
//
// Rulare: node --test src/lib/pdfBrowser.limits.test.js

process.env.PDF_MAX_CONCURRENT_PAGES = "2";
process.env.PDF_MAX_QUEUE = "3";
process.env.PDF_QUEUE_TIMEOUT_MS = "150";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { __setPdfBrowserLauncher, closePdfBrowser, getPdfBrowserLimits, getPdfBrowserStats, PdfBusyError, renderPdfWithSharedBrowser } =
  await import("./pdfBrowser.js");
const { htmlToPdfBuffer } = await import("./htmlToPdf.js");

let launches;
let browsers;
let openPages;
let maxOpenPages;
let pdfOptions;
let setContentOptions;
let renderDelayMs;
let crashDuringNextRender;

function makeLauncher() {
  return {
    async launch() {
      launches += 1;
      const listeners = {};
      const browser = {
        connected: true,
        closed: false,
        on(event, cb) {
          listeners[event] = cb;
        },
        crash() {
          this.connected = false;
          listeners.disconnected?.();
        },
        async newPage() {
          if (!this.connected) throw new Error("Protocol error: Target closed");
          openPages += 1;
          maxOpenPages = Math.max(maxOpenPages, openPages);
          const page = {
            closed: false,
            setDefaultTimeout() {},
            async emulateMediaType() {},
            async setContent(_html, opts) {
              setContentOptions.push(opts);
              await new Promise((r) => setTimeout(r, renderDelayMs));
              if (crashDuringNextRender) {
                crashDuringNextRender = false;
                browser.crash();
                throw new Error("Protocol error (Page.setContent): Target closed");
              }
            },
            async evaluate() {},
            async pdf(opts) {
              pdfOptions.push(opts);
              return Buffer.from("%PDF-1.4 test");
            },
            async close() {
              if (!page.closed) openPages -= 1;
              page.closed = true;
            },
          };
          return page;
        },
        async close() {
          this.closed = true;
          this.connected = false;
        },
      };
      browsers.push(browser);
      return browser;
    },
  };
}

beforeEach(async () => {
  launches = 0;
  browsers = [];
  openPages = 0;
  maxOpenPages = 0;
  pdfOptions = [];
  setContentOptions = [];
  renderDelayMs = 5;
  crashDuringNextRender = false;
  delete process.env.PDF_INVOICE_SHARED_BROWSER;
  await closePdfBrowser();
  __setPdfBrowserLauncher(makeLauncher());
});

afterEach(async () => {
  await closePdfBrowser();
  __setPdfBrowserLauncher(null);
});

test("limitele citite din env (512 MB): 2 pagini, coadă de 3, termen de așteptare", () => {
  const limits = getPdfBrowserLimits();
  assert.equal(limits.maxConcurrentPages, 2);
  assert.equal(limits.maxQueue, 3);
  assert.equal(limits.queueTimeoutMs, 150);
});

test("facturi: browserul partajat, A4 + marginile facturii neschimbate, un singur Chrome", async () => {
  const pdfs = await Promise.all(Array.from({ length: 4 }, () => htmlToPdfBuffer("<p>factura</p>")));
  assert.equal(pdfs.length, 4);
  assert.equal(launches, 1, "un singur Chrome pentru toate facturile");
  assert.ok(maxOpenPages <= 2);
  for (const opts of pdfOptions) {
    assert.equal(opts.format, "A4");
    assert.deepEqual(opts.margin, { top: "14mm", right: "14mm", bottom: "18mm", left: "14mm" });
    assert.equal(opts.printBackground, true);
    assert.equal(opts.preferCSSPageSize, true);
  }
  assert.ok(setContentOptions.every((o) => o.waitUntil === "load"));
});

test("coada plină -> PdfBusyError imediat (fără Chrome / pagini în plus); restul se termină normal", async () => {
  renderDelayMs = 60;
  const jobs = Array.from({ length: 6 }, (_, i) => htmlToPdfBuffer(`<p>${i}</p>`).then(() => "ok", (e) => e));
  const results = await Promise.all(jobs);
  const busy = results.filter((r) => r instanceof PdfBusyError);
  assert.equal(busy.length, 1, "2 rulează + 3 la rând; a 6-a e refuzată");
  assert.equal(busy[0].code, "pdf_busy");
  assert.equal(busy[0].status, 503);
  assert.match(busy[0].message, /Încearcă din nou/);
  assert.equal(results.filter((r) => r === "ok").length, 5);
  assert.equal(launches, 1);
  assert.ok(maxOpenPages <= 2);
  assert.deepEqual([getPdfBrowserStats().active, getPdfBrowserStats().waiting], [0, 0]);
});

test("așteptare peste termen -> PdfBusyError, fără locuri pierdute; cererile următoare merg", async () => {
  renderDelayMs = 400; // ocupă ambele pagini mai mult decât termenul de 150 ms
  const running = [htmlToPdfBuffer("<p>a</p>"), htmlToPdfBuffer("<p>b</p>")];
  const t0 = Date.now();
  await assert.rejects(htmlToPdfBuffer("<p>c</p>"), (err) => err instanceof PdfBusyError);
  const waited = Date.now() - t0;
  assert.ok(waited >= 140 && waited < 380, `a așteptat ${waited} ms`);
  await Promise.all(running);

  assert.deepEqual([getPdfBrowserStats().active, getPdfBrowserStats().waiting], [0, 0], "niciun loc blocat");
  renderDelayMs = 5;
  const after = await htmlToPdfBuffer("<p>d</p>");
  assert.ok(after.toString().startsWith("%PDF"));
});

test("browserul cade în timpul unei facturi -> recreat și factura reîncercată o dată", async () => {
  await htmlToPdfBuffer("<p>1</p>");
  crashDuringNextRender = true;
  const pdf = await htmlToPdfBuffer("<p>2</p>");
  assert.ok(pdf.toString().startsWith("%PDF"));
  assert.equal(launches, 2, "Chrome nou pornit automat");
  assert.equal(browsers[0].connected, false, "cel căzut nu mai e folosit");
  assert.equal(browsers[1].connected, true);
  assert.equal(openPages, 0, "nicio pagină rămasă deschisă");
  assert.deepEqual([getPdfBrowserStats().active, getPdfBrowserStats().waiting], [0, 0]);
});

test("browserul cade între facturi -> următoarea îl repornește", async () => {
  await htmlToPdfBuffer("<p>1</p>");
  browsers[0].crash();
  const pdf = await htmlToPdfBuffer("<p>2</p>");
  assert.ok(pdf.toString().startsWith("%PDF"));
  assert.equal(launches, 2);
});

test("comutatorul de revenire PDF_INVOICE_SHARED_BROWSER=0 nu folosește browserul partajat", async () => {
  process.env.PDF_INVOICE_SHARED_BROWSER = "0";
  const { htmlToPdfBufferIsolated } = await import("./htmlToPdf.js");
  assert.equal(typeof htmlToPdfBufferIsolated, "function");
  // implementarea veche pornește Chrome real: aici verificăm doar că ramura partajată NU e atinsă
  const call = htmlToPdfBuffer("<p>x</p>").catch(() => "fără Chrome real în teste");
  await Promise.race([call, new Promise((r) => setTimeout(r, 50))]);
  assert.equal(launches, 0, "launcherul partajat nu a fost apelat");
  delete process.env.PDF_INVOICE_SHARED_BROWSER;
  await call;
});

test("etichetele Târgului rămân pe același browser, cu aceleași dimensiuni", async () => {
  await renderPdfWithSharedBrowser("<p>eticheta</p>", { width: "70mm", height: "37mm", margin: {} });
  assert.equal(pdfOptions[0].width, "70mm");
  assert.equal(pdfOptions[0].height, "37mm");
  assert.equal(setContentOptions[0].waitUntil, "load");
});
