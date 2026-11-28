// Rulare: node --test src/lib/fairLabelPhotos.test.js
// Etichete „Cu fotografie produs”: miniaturi din fotografia existentă (fără rețea reală: fetch simulat).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { allowedPhotoHosts, clearLabelPhotoCache, isAllowedPhotoUrl, loadLabelThumbnails, photoStats, withLabelPhotos } from "./fairLabelPhotos.js";
import { buildLabelsHtml, expandLabelCopies } from "./fairLabels.js";

const env = { R2_PUBLIC_BASE_URL: "https://media.artfest.ro" };
const URL_A = "https://media.artfest.ro/products/a.jpg";
const URL_B = "https://media.artfest.ro/products/b.webp";

let jpeg;
let webp;
beforeEach(async () => {
  clearLabelPhotoCache();
  jpeg ??= await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
  webp ??= await sharp({ create: { width: 600, height: 1800, channels: 3, background: { r: 40, g: 40, b: 200 } } }).webp().toBuffer();
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("nu există", { status: 404 });
    return new Response(r.body, { status: 200, headers: { "content-type": r.type, ...(r.length ? { "content-length": String(r.length) } : {}) } });
  };
  fn.calls = calls;
  return fn;
}

async function decode(dataUri) {
  return sharp(Buffer.from(dataUri.split(",")[1], "base64")).metadata();
}

test("gazde permise: doar https pe gazda fotografiilor Artfest (fără SSRF)", () => {
  const hosts = allowedPhotoHosts(env);
  assert.ok(isAllowedPhotoUrl(URL_A, hosts));
  assert.equal(isAllowedPhotoUrl("http://media.artfest.ro/a.jpg", hosts), false);
  assert.equal(isAllowedPhotoUrl("https://169.254.169.254/latest", hosts), false);
  assert.equal(isAllowedPhotoUrl("https://media.artfest.ro.evil.test/a.jpg", hosts), false);
  assert.ok(isAllowedPhotoUrl("https://cdn.test/x.jpg", allowedPhotoHosts({ ...env, LABEL_PHOTO_HOSTS: "cdn.test" })));
});

test("miniatură mică (≤ 240 px), proporții păstrate, JPEG; aceeași fotografie descărcată o singură dată (și din cache la regenerare)", async () => {
  const fetchImpl = fakeFetch({ [URL_A]: { body: jpeg, type: "image/jpeg" }, [URL_B]: { body: webp, type: "image/webp" } });
  const items = [{ imageUrlSnapshot: URL_A }, { imageUrlSnapshot: URL_A }, { imageUrlSnapshot: URL_B }];
  const thumbs = await loadLabelThumbnails(items, { fetchImpl, env });
  assert.equal(fetchImpl.calls.length, 2, "fiecare URL o singură dată");
  const a = await decode(thumbs.get(URL_A));
  assert.deepEqual([a.format, a.width, a.height], ["jpeg", 240, 120], "2:1 păstrat");
  const b = await decode(thumbs.get(URL_B));
  assert.deepEqual([b.width, b.height], [80, 240], "1:3 păstrat");
  assert.ok(Buffer.from(thumbs.get(URL_A).split(",")[1], "base64").length < 20_000, "miniatură de câțiva KB");
  // regenerare: din cache, fără descărcare
  await loadLabelThumbnails(items, { fetchImpl, env });
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(photoStats.cacheHits >= 2);
});

test("fotografie indisponibilă (404, prea mare, nu e imagine, coruptă, gazdă nepermisă) => fără fotografie, eticheta normală", async () => {
  const fetchImpl = fakeFetch({
    "https://media.artfest.ro/big.jpg": { body: jpeg, type: "image/jpeg", length: 50 * 1024 * 1024 },
    "https://media.artfest.ro/page.html": { body: "<html>", type: "text/html" },
    "https://media.artfest.ro/broken.jpg": { body: Buffer.from("nu e jpeg"), type: "image/jpeg" },
  });
  const items = ["https://media.artfest.ro/missing.jpg", "https://media.artfest.ro/big.jpg", "https://media.artfest.ro/page.html", "https://media.artfest.ro/broken.jpg", "https://evil.test/a.jpg", null]
    .map((u, i) => ({ id: `l${i}`, imageUrlSnapshot: u }));
  const out = await withLabelPhotos(items, { fetchImpl, env });
  assert.ok(out.every((i) => !i.labelPhoto));
  assert.equal(fetchImpl.calls.includes("https://evil.test/a.jpg"), false, "gazda nepermisă nu se descarcă");
});

test("limita de fotografii distincte per PDF", async () => {
  const routes = {};
  const items = [];
  for (let i = 0; i < 5; i += 1) {
    const u = `https://media.artfest.ro/p${i}.jpg`;
    routes[u] = { body: jpeg, type: "image/jpeg" };
    items.push({ imageUrlSnapshot: u });
  }
  const fetchImpl = fakeFetch(routes);
  const thumbs = await loadLabelThumbnails(items, { fetchImpl, env, limits: { maxBytes: 8e6, totalBytes: 64e6, timeoutMs: 5000, maxDistinct: 2, concurrency: 2, thumbPx: 120, maxInputPixels: 24e6, cacheEntries: 10, cacheTtlMs: 1e6 } });
  assert.equal(thumbs.size, 2);
  assert.equal(fetchImpl.calls.length, 2);
});

test("HTML: miniatura doar cu fotografie, o singură dată în CSS pentru toate copiile; QR, cod de bare, preț și cod AF neschimbate", async () => {
  const item = { titleSnapshot: "Înger din lut", storeNameSnapshot: "Atelier", priceSnapshotCents: 5000, barcode: "AF23456789", declaredQty: 24, vendorId: null };
  const plain = buildLabelsHtml(expandLabelCopies([item]));
  const fetchImpl = fakeFetch({ [URL_A]: { body: jpeg, type: "image/jpeg" } });
  const [withPhoto] = await withLabelPhotos([{ ...item, imageUrlSnapshot: URL_A }], { fetchImpl, env });
  const html = buildLabelsHtml(expandLabelCopies([withPhoto]));
  assert.equal((plain.match(/class="thumb /g) || []).length, 0);
  assert.equal((html.match(/class="thumb ph1"/g) || []).length, 24, "o miniatură pe fiecare etichetă");
  assert.equal((html.match(/data:image\/jpeg;base64,/g) || []).length, 1, "data URI o singură dată");
  for (const doc of [plain, html]) {
    assert.equal((doc.match(/<div class="qr"><svg/g) || []).length, 24);
    assert.equal((doc.match(/<div class="barcode"><svg/g) || []).length, 24);
    assert.ok(doc.includes("AF-2345-6789") && doc.includes(">50 lei<"));
  }
  // formatul fizic neschimbat
  assert.ok(html.includes("size: A4") && html.includes("repeat(3, 70mm)") && html.includes("grid-auto-rows: 37mm"));
});
