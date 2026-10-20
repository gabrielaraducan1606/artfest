// Etichetele Târgului Artfest: coala A4 pentru cazurile uzuale (un produs, mai multe,
// cantități, reimprimare, fără date opționale). Randarea PDF e injectată (toPdf) - fără Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLabelCopies,
  barcodeSvg,
  formatLabelCode,
  qrSvg,
  renderLabelSheetPdf,
  renderSingleLabelPdf,
} from "./fairLabels.js";

const item = (extra = {}) => ({
  id: "i1",
  titleSnapshot: "Spiridușul Ella",
  variantLabel: "Roșu",
  storeNameSnapshot: "Atelier Ana",
  priceSnapshotCents: 3900,
  barcode: "AF7K3M9QXT",
  declaredQty: 1,
  receivedQty: 1,
  status: "RECEIVED",
  ...extra,
});

async function sheet(items, mode = "declared") {
  const calls = [];
  const toPdf = async (html, options) => {
    calls.push({ html, options });
    return Buffer.from("%PDF-test");
  };
  const result = await renderLabelSheetPdf(applyLabelCopies(items, mode), { toPdf });
  return { ...result, html: calls[0].html, options: calls[0].options, calls: calls.length };
}

const labelCount = (html) => (html.match(/class="label"/g) || []).length;

test("un produs: o etichetă, A4 fără margini, cod de bare + QR + preț", async () => {
  const r = await sheet([item()]);
  assert.equal(r.calls, 1);
  assert.equal(r.labelCount, 1);
  assert.equal(r.pageCount, 1);
  assert.equal(labelCount(r.html), 1);
  assert.deepEqual(r.options, { format: "A4", margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" } });
  assert.ok(r.html.includes(barcodeSvg("AF7K3M9QXT")) && r.html.includes(qrSvg("AF7K3M9QXT")));
  assert.ok(r.html.includes("39 lei") && r.html.includes("AF-7K3M-9QXT") && r.html.includes("artfest.ro"));
});

test("mai multe produse: fiecare cu codul lui", async () => {
  const r = await sheet([item(), item({ id: "i2", titleSnapshot: "Lumânare", barcode: "AF22334455", priceSnapshotCents: 2550 })]);
  assert.equal(r.labelCount, 2);
  assert.ok(r.html.includes(formatLabelCode("AF7K3M9QXT")) && r.html.includes(formatLabelCode("AF22334455")));
  assert.ok(r.html.includes("25,50 lei"));
});

test("cantități multiple: o etichetă pe bucată, pagini noi după 24", async () => {
  const r = await sheet([item({ declaredQty: 30, receivedQty: 26 })]);
  assert.equal(r.labelCount, 30);
  assert.equal(r.pageCount, 2);
  assert.equal((r.html.match(/class="sheet"/g) || []).length, 2);
  assert.equal((await sheet([item({ declaredQty: 30, receivedQty: 26 })], "received")).labelCount, 26);
  assert.equal((await sheet([item({ declaredQty: 30 })], "one")).labelCount, 1);
});

test("reimprimare: același cod, același conținut, liniile nu sunt modificate", async () => {
  const lines = [item({ declaredQty: 2 })];
  const snapshot = JSON.stringify(lines);
  const first = await sheet(lines);
  const second = await sheet(lines);
  assert.equal(first.html, second.html);
  assert.equal(JSON.stringify(lines), snapshot); // fără coduri noi, fără câmpuri schimbate pe linii
});

test("fără date opționale (variantă / magazin): fără rânduri goale, fără null / undefined", async () => {
  const r = await sheet([item({ variantLabel: null, storeNameSnapshot: null })]);
  assert.equal(r.labelCount, 1);
  assert.equal(r.html.includes('class="variant"'), false);
  assert.equal(r.html.includes('class="store"'), false);
  assert.doesNotMatch(r.html, /\b(null|undefined|NaN)\b/);
  assert.ok(r.html.includes("Spiridușul Ella"));
});

test("eticheta individuală (70 × 37 mm) folosește același cod", async () => {
  let call = null;
  await renderSingleLabelPdf(item({ declaredQty: 5 }), {
    toPdf: async (html, options) => {
      call = { html, options };
      return Buffer.from("%PDF-test");
    },
  });
  assert.equal(labelCount(call.html), 1);
  assert.equal(call.options.width, "70mm");
  assert.equal(call.options.height, "37mm");
  assert.ok(call.html.includes(barcodeSvg("AF7K3M9QXT")));
});

test("eroare la randare (ex. Chrome lipsă) => excepția ajunge la apelant", async () => {
  const boom = new Error("Could not find Chrome (ver. 143.0.7499.169).");
  await assert.rejects(
    renderLabelSheetPdf(applyLabelCopies([item()]), { toPdf: async () => { throw boom; } }),
    /Could not find Chrome/
  );
});
