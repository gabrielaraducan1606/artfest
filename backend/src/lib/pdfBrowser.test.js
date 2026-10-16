// Teste pentru browserul Puppeteer partajat (etichetele Târgului Artfest),
// cu un launcher fals - fără Chrome real.
//
// Rulare: node --test src/lib/pdfBrowser.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __setPdfBrowserLauncher,
  closePdfBrowser,
  getPdfBrowserStats,
  renderPdfWithSharedBrowser,
} from "./pdfBrowser.js";

let launches;
let browsers;
let maxConcurrentPages;
let openPages;
let failNextPdf;

function makeLauncher() {
  return {
    async launch(options) {
      launches += 1;
      assert.equal(options.handleSIGINT, false);
      await new Promise((r) => setTimeout(r, 5)); // pornire „lentă”
      const listeners = {};
      const browser = {
        connected: true,
        closed: false,
        pages: 0,
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
          maxConcurrentPages = Math.max(maxConcurrentPages, openPages);
          const page = {
            closed: false,
            setDefaultTimeout() {},
            async emulateMediaType() {},
            async setContent() {
              await new Promise((r) => setTimeout(r, 3));
            },
            async pdf(opts) {
              if (failNextPdf) {
                const error = failNextPdf;
                failNextPdf = null;
                throw error;
              }
              return Buffer.from(`%PDF ${opts.width || opts.format}`);
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
  maxConcurrentPages = 0;
  openPages = 0;
  failNextPdf = null;
  await closePdfBrowser();
  __setPdfBrowserLauncher(makeLauncher());
});

afterEach(async () => {
  await closePdfBrowser();
  __setPdfBrowserLauncher(null);
});

test("cereri simultane: un singur Chrome, pagini închise, max 3 pagini deodată", async () => {
  const results = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      renderPdfWithSharedBrowser(`<p>${i}</p>`, { width: "70mm", height: "37mm", margin: {} })
    )
  );
  assert.equal(results.length, 7);
  assert.ok(results.every((buf) => buf.toString().startsWith("%PDF 70mm")));
  assert.equal(launches, 1);
  assert.ok(maxConcurrentPages <= 3, `max pages ${maxConcurrentPages}`);
  assert.equal(openPages, 0);

  // a doua rundă refolosește același browser
  await renderPdfWithSharedBrowser("<p>x</p>", { format: "A4" });
  assert.equal(launches, 1);
  assert.equal(getPdfBrowserStats().open, true);
});

test("browserul moare => următoarea cerere îl recreează", async () => {
  await renderPdfWithSharedBrowser("<p>1</p>");
  browsers[0].crash();
  const out = await renderPdfWithSharedBrowser("<p>2</p>");
  assert.ok(out.toString().startsWith("%PDF"));
  assert.equal(launches, 2);
});

test("eroare de conexiune în timpul randării => o singură reîncercare pe browser nou", async () => {
  await renderPdfWithSharedBrowser("<p>1</p>");
  failNextPdf = new Error("Protocol error (Page.printToPDF): Target closed");
  const out = await renderPdfWithSharedBrowser("<p>2</p>");
  assert.ok(out.toString().startsWith("%PDF"));
  assert.equal(launches, 2);
  assert.equal(browsers[0].closed, true);
  assert.equal(openPages, 0);
});

test("altă eroare: propagată, pagina tot închisă, browserul păstrat", async () => {
  await renderPdfWithSharedBrowser("<p>1</p>");
  failNextPdf = new Error("layout_failed");
  await assert.rejects(renderPdfWithSharedBrowser("<p>2</p>"), /layout_failed/);
  assert.equal(openPages, 0);
  assert.equal(launches, 1);
  assert.equal(getPdfBrowserStats().active, 0);
});

test("closePdfBrowser închide instanța; următoarea cerere pornește alta", async () => {
  await renderPdfWithSharedBrowser("<p>1</p>");
  await closePdfBrowser();
  assert.equal(browsers[0].closed, true);
  assert.equal(getPdfBrowserStats().open, false);
  await renderPdfWithSharedBrowser("<p>2</p>");
  assert.equal(launches, 2);
});
