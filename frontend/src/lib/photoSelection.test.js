// Rulare: node --test src/lib/photoSelection.test.js
//
// Selecția comună de fotografii pentru formularele care nu sunt de produs
// (recenzii max 5, retururi max 6 / PNG-JPG-WebP / 3 MB, recepție Târg max 10):
// adăugare la cele existente, fără duplicate, limita secțiunii, motive clare.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fileFingerprint, selectPhotos, selectionMessage } from "./photoSelection.js";

let seq = 0;
const photo = (name, { type = "image/jpeg", size = 1024, lastModified } = {}) =>
  new File([new Uint8Array(size)], name, { type, lastModified: lastModified ?? 1_700_000_000_000 + (seq += 1) });

test("o fotografie / 5-10 fotografii deodată: toate acceptate în limita secțiunii, ordinea păstrată", () => {
  const one = selectPhotos({ incoming: [photo("a.jpg")], max: 5 });
  assert.equal(one.accepted.length, 1);
  assert.deepEqual(one.rejected, []);

  const ten = Array.from({ length: 10 }, (_, i) => photo(`p${i + 1}.jpg`));
  const result = selectPhotos({ incoming: ten, max: 10 });
  assert.deepEqual(result.accepted.map((f) => f.name), ten.map((f) => f.name));
  assert.equal(result.fingerprints.length, 10);
});

test("a doua selecție se adaugă la cele existente; peste limită -> mesaj, nimic pierdut în tăcere", () => {
  const first = selectPhotos({ incoming: [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], max: 5 });
  const second = selectPhotos({
    existingCount: first.accepted.length,
    existingFingerprints: first.fingerprints,
    incoming: [photo("d.jpg"), photo("e.jpg"), photo("f.jpg"), photo("g.jpg")],
    max: 5,
  });
  assert.deepEqual(second.accepted.map((f) => f.name), ["d.jpg", "e.jpg"]);
  assert.match(selectionMessage(second.rejected), /cel mult 5 fotografii - 2 fotografii nu au fost adăugate/);
});

test("duplicate: același fișier ales din nou sau de două ori în aceeași selecție -> sărit, cu motiv", () => {
  const same = photo("dublu.jpg", { lastModified: 42 });
  const twin = photo("dublu.jpg", { lastModified: 42 });
  const within = selectPhotos({ incoming: [same, twin], max: 5 });
  assert.equal(within.accepted.length, 1);
  assert.match(within.rejected[0].message, /„dublu\.jpg” este deja adăugată/);

  const again = selectPhotos({ existingCount: 1, existingFingerprints: [fileFingerprint(same)], incoming: [twin], max: 5 });
  assert.equal(again.accepted.length, 0);
});

test("formatele și mărimea secțiunii (retururi: PNG / JPG / WebP, max 3 MB) -> refuz explicat, restul continuă", () => {
  const result = selectPhotos({
    incoming: [photo("ok.jpg"), photo("iphone.heic", { type: "image/heic" }), photo("mare.png", { type: "image/png", size: 4 * 1024 * 1024 }), photo("ok.webp", { type: "image/webp" })],
    max: 6,
    accept: (f) => /^image\/(png|jpe?g|webp)$/i.test(f.type),
    acceptMessage: "nu este acceptată: folosim doar PNG / JPG / WebP",
    maxBytes: 3 * 1024 * 1024,
  });
  assert.deepEqual(result.accepted.map((f) => f.name), ["ok.jpg", "ok.webp"]);
  const message = selectionMessage(result.rejected);
  assert.match(message, /„iphone\.heic” nu este acceptată/);
  assert.match(message, /„mare\.png” depășește 3 MB/);
});

test("fișierele care nu sunt fotografii sunt refuzate (implicit doar image/*)", () => {
  const result = selectPhotos({ incoming: [new File(["x"], "doc.pdf", { type: "application/pdf" })], max: 5 });
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].message, /„doc\.pdf” nu este o fotografie/);
});
