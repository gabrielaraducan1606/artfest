// Rulare: node --test src/lib/fairLabels.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import bwipjs from "bwip-js";
import { barcodeSvg, buildLabelsHtml, qrSvg } from "./fairLabels.js";

const label = (barcode, extra = {}) => ({ title: "Spiriduș", variantLabel: "Mărime: M", storeName: "Atelier", priceCents: 3900, barcode, ...extra });

test("eticheta are cod 1D (Code128) ȘI QR, ambele cu EXACT același identificator AF...", () => {
  const html = buildLabelsHtml([label("AF7K3M9QXT")], { mode: "single" });
  assert.equal((html.match(/<svg/g) || []).length, 2);
  assert.ok(html.includes(barcodeSvg("AF7K3M9QXT")), "Code128 cu AF7K3M9QXT");
  assert.ok(html.includes(qrSvg("AF7K3M9QXT")), "QR cu AF7K3M9QXT");
  // QR-ul e exact cel al textului AF... (fără alt token / prefix / URL)
  const reference = bwipjs.toSVG({ bcid: "qrcode", text: "AF7K3M9QXT", eclevel: "M", paddingwidth: 0, paddingheight: 0 });
  assert.equal(qrSvg("AF7K3M9QXT"), reference);
  assert.notEqual(qrSvg("AF7K3M9QXT"), qrSvg("AF22222222"));
  assert.ok(html.includes("AF-7K3M-9QXT"));
  assert.ok(html.includes("artfest.ro"));
  assert.ok(html.includes("39 lei"));
});

test("coala A4 3×8: fiecare etichetă are propriul cod 1D + QR; codurile diferite nu se amestecă", () => {
  const labels = [...Array(25)].map((_, i) => label(i % 2 ? "AF22222222" : "AF33333333"));
  const html = buildLabelsHtml(labels, { mode: "sheet" });
  assert.equal((html.match(/class="label"/g) || []).length, 25);
  assert.equal((html.match(/<svg/g) || []).length, 50);
  assert.equal((html.match(/class="sheet"/g) || []).length, 2);
  // fiecare etichetă: QR și Code128 pentru același cod
  for (const cell of html.split('<div class="label">').slice(1)) {
    const code = cell.includes("AF-2222-2222") ? "AF22222222" : "AF33333333";
    assert.ok(cell.includes(qrSvg(code)) && cell.includes(barcodeSvg(code)));
  }
});
