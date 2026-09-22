// Verificare statică: fetch() brut din InfluencerCollectionsModal.jsx
// (căutarea de produse) a fost înlocuit cu helperul central api()/
// buildApiUrl - același endpoint, același query, același AbortController,
// backend neatins.
//
// Rulare: node --test src/pages/Influencer/components/InfluencerCollectionsModal.apiFix.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./InfluencerCollectionsModal.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("nu mai există niciun fetch() brut către /api/public/products/suggest", () => {
  assert.equal(/fetch\(\s*\n?\s*`\/api\/public\/products\/suggest/.test(source), false);
});

test("căutarea de produse trece prin api(), cu același endpoint și AbortController", () => {
  assert.match(source, /await\s*\n?\s*api\(\s*\n?\s*`\/api\/public\/products\/suggest\?q=\$\{encodeURIComponent/);
  assert.match(source, /signal:\s*\n?\s*controller\.signal/);
});

test("niciun fetch() brut rămas în fișier (afară de eventuale comentarii)", () => {
  const codeLines = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));

  assert.equal(codeLines.some((line) => /\bfetch\(/.test(line)), false);
});
