// src/lib/htmlToPdf.invoices.test.js
//
// Facturi PDF pe Chrome REAL: implementarea veche (un Chrome per factură,
// htmlToPdfBufferIsolated) vs. cea nouă (browserul partajat, htmlToPdfBuffer).
// Aceleași facturi (client / vânzător / Admin; 1 pagină și mai multe pagini;
// TVA 19% / 9% / 0%; diacritice) trebuie să iasă IDENTIC octet cu octet,
// după eliminarea doar a datei de generare (/CreationDate, /ModDate).
// PDF identic => același conținut, valori, TVA, numerotare, fonturi, aspect și paginare.
//
// Opt-in (pornește Chrome real, ~1 minut):
//   PDF_REAL_CHROME=1 node --test src/lib/htmlToPdf.invoices.test.js

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

import { renderInvoiceHtml } from "./invoiceHtmlTemplate.js";
import { htmlToPdfBuffer, htmlToPdfBufferIsolated } from "./htmlToPdf.js";
import { closePdfBrowser, getPdfBrowserStats } from "./pdfBrowser.js";

const REAL = process.env.PDF_REAL_CHROME === "1";
const skip = REAL ? false : "setează PDF_REAL_CHROME=1 (pornește Chrome real)";

after(() => closePdfBrowser());

const billingProfile = {
  vendorName: "Atelierul Țesătoarei Ștefănescu",
  companyName: "Ștefănescu Artizanat SRL",
  legalType: "SRL",
  cui: "RO12345678",
  regCom: "J40/1234/2020",
  address: "Str. Mărășești nr. 12, București",
  email: "contact@exemplu.ro",
  phone: "0712345678",
  iban: "RO49AAAA1B31007593840000",
  bank: "Banca Exemplu",
  vatStatus: "payer",
  vatRate: 19,
};

const platform = { name: "ArtFest", supportEmail: "support@artfest.ro", website: "artfest.ro" };

function invoice(lines, extra = {}) {
  return {
    id: "inv_test_1",
    series: "AF",
    number: "000123",
    currency: "RON",
    issueDate: "2026-11-13T10:00:00.000Z",
    dueDate: "2026-11-28T10:00:00.000Z",
    client: { name: "Ana Popescu", address: "Iași, Bd. Ștefan cel Mare 3" },
    notes: "Mulțumim pentru comandă!\nProdusele sunt realizate manual.",
    lines,
    ...extra,
  };
}

const line = (i, vatRate = 19) => ({
  description: `Lumânare parfumată „Grădina bunicii” nr. ${i} - ceară de soia, fitil din bumbac`,
  quantity: (i % 3) + 1,
  unitNet: 42.5 + i,
  vatRate,
});

const CASES = {
  "client - 1 linie": renderInvoiceHtml({ invoice: invoice([line(1)]), billingProfile }),
  "vânzător - TVA mixt 19/9/0": renderInvoiceHtml({
    invoice: invoice([line(1, 19), line(2, 9), line(3, 0), line(4, 19)]),
    billingProfile,
    platform,
  }),
  "Admin - 70 linii (mai multe pagini)": renderInvoiceHtml({
    invoice: invoice(Array.from({ length: 70 }, (_, i) => line(i, i % 2 ? 19 : 9)), { notes: "Factură de test cu paginare." }),
    billingProfile: { ...billingProfile, vatStatus: "non_payer" },
    platform,
  }),
};

// doar data generării diferă între două randări ale aceluiași HTML
function normalized(pdf) {
  return Buffer.from(pdf)
    .toString("latin1")
    .replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()")
    .replace(/\/ModDate \(D:[^)]*\)/g, "/ModDate ()");
}
const sha = (text) => createHash("sha256").update(text, "latin1").digest("hex");

test("facturi: browserul partajat produce EXACT același PDF ca implementarea veche (client / vânzător / Admin)", { skip, timeout: 300_000 }, async () => {
  for (const [name, html] of Object.entries(CASES)) {
    let t0 = Date.now();
    const before = await htmlToPdfBufferIsolated(html);
    const msBefore = Date.now() - t0;
    t0 = Date.now();
    const after = await htmlToPdfBuffer(html);
    const msAfter = Date.now() - t0;
    console.log(`[timp] ${name}: vechi ${msBefore} ms, nou ${msAfter} ms`);

    const [docBefore, docAfter] = await Promise.all([PDFDocument.load(before), PDFDocument.load(after)]);
    const pages = docBefore.getPageCount();
    assert.equal(docAfter.getPageCount(), pages, `${name}: număr de pagini`);
    const { width, height } = docAfter.getPage(0).getSize();
    assert.deepEqual([Math.round(width), Math.round(height)], [595, 842], `${name}: A4`);

    assert.equal(sha(normalized(after)), sha(normalized(before)), `${name}: PDF diferit`);
    console.log(`[factură] ${name}: ${pages} pagini, ${before.length} B, identic`);
  }
  assert.ok(Object.keys(CASES).length === 3);
});

test("facturi simultane pe Chrome real: un singur browser, toate generate corect", { skip, timeout: 300_000 }, async () => {
  await closePdfBrowser();
  const html = CASES["vânzător - TVA mixt 19/9/0"];
  const reference = sha(normalized(await htmlToPdfBuffer(html)));
  const results = await Promise.all(Array.from({ length: 6 }, () => htmlToPdfBuffer(html)));
  assert.ok(results.every((pdf) => sha(normalized(pdf)) === reference));
  const stats = getPdfBrowserStats();
  assert.equal(stats.launches >= 1, true);
  assert.equal(stats.active, 0);
  assert.equal(stats.waiting, 0);
});
