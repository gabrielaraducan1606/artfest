// src/services/r2Storage.productImages.test.js
//
// Procesarea imaginilor de produs în uploadToR2 (politica "image"), cu sharp
// REAL și R2 simulat (r2Client.send) - nicio cerere în rețea:
//  - JPEG / PNG / WEBP -> JPEG, latura lungă max 2400 px, proporții păstrate;
//  - orientarea EXIF aplicată, metadatele (EXIF/GPS) eliminate;
//  - PNG transparent -> fundal ALB (nu negru);
//  - fișiere false (text cu extensie .jpg, HTML, SVG) -> refuzate;
//  - HEIC: fără decodor -> heic_unsupported (nu mai e urcat brut);
//          cu decodor -> JPEG; peste plafon -> image_too_many_pixels;
//          politica "document" păstrează fallback-ul vechi.
//
// Rulare: node --test src/services/r2Storage.productImages.test.js

import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { r2Client, uploadToR2 } from "./r2Storage.js";
import { __setHeicDecoderForTests } from "./heicDecoder.js";

let sent = [];
const sendMock = mock.method(r2Client, "send", async (command) => {
  sent.push(command.input);
  return {};
});

beforeEach(() => {
  sent = [];
  __setHeicDecoderForTests(null); // implicit: decodorul HEIC NU e instalat
});

after(() => {
  sendMock.mock.restore();
  __setHeicDecoderForTests(undefined);
});

const file = (buffer, originalname, mimetype = "image/jpeg") => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

const upload = (f, extra = {}) =>
  uploadToR2({ file: f, folder: "products", userId: "u1", policy: "image", maxPixels: 100_000_000, ...extra });

async function solid(width, height, format, { alpha = false, ...options } = {}) {
  const img = sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 200, g: 120, b: 40 },
    },
  });
  return img[format](options).toBuffer();
}

// HEIC minimal: doar header-ul ISO-BMFF „ftyp heic” (suficient pentru detecție)
function fakeHeic(brand = "heic") {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(24, 0);
  buf.write("ftyp", 4, "ascii");
  buf.write(brand, 8, "ascii");
  buf.write("mif1heic", 16, "ascii");
  return buf;
}

test("JPEG mic: convertit JPEG, proporții păstrate, fără mărire", async () => {
  const res = await upload(file(await solid(1200, 800, "jpeg"), "Poza mea.jpg"));
  assert.equal(res.mimeType, "image/jpeg");
  const meta = await sharp(sent[0].Body).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 800]);
  assert.equal(sent[0].ContentType, "image/jpeg");
  assert.match(sent[0].Key, /^products\/u1\/\d+-poza-mea\.jpg$/);
});

test("fotografie foarte mare (6000x4000): redusă la 2400 px pe latura lungă, raport 3:2", async () => {
  await upload(file(await solid(6000, 4000, "jpeg"), "mare.jpg"));
  const meta = await sharp(sent[0].Body).metadata();
  assert.deepEqual([meta.width, meta.height], [2400, 1600]);
});

test("PNG și WEBP: acceptate și convertite în JPEG", async () => {
  await upload(file(await solid(800, 600, "png"), "a.png", "image/png"));
  await upload(file(await solid(800, 600, "webp"), "b.webp", "image/webp"));
  for (const input of sent) {
    assert.equal(input.ContentType, "image/jpeg");
    assert.equal((await sharp(input.Body).metadata()).format, "jpeg");
  }
});

test("PNG transparent: fundal alb (nu negru)", async () => {
  await upload(file(await solid(100, 100, "png", { alpha: true }), "transparent.png", "image/png"));
  const { data } = await sharp(sent[0].Body).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 245 && data[1] > 245 && data[2] > 245, `pixel ${data[0]},${data[1]},${data[2]}`);
});

test("orientarea EXIF e aplicată (portret rămâne portret), iar EXIF/GPS sunt eliminate", async () => {
  // 600x400 stocat, orientare 6 (rotit 90°) => afișat 400x600
  const input = await sharp(await solid(600, 400, "jpeg"))
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Make: "Telefon", Model: "Test" }, IFD3: { GPSLatitudeRef: "N" } })
    .jpeg()
    .toBuffer();
  assert.equal((await sharp(input).metadata()).orientation, 6);

  await upload(file(input, "telefon.jpg"));
  const meta = await sharp(sent[0].Body).metadata();
  assert.deepEqual([meta.width, meta.height], [400, 600]);
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined, "fără EXIF (model telefon, GPS)");
});

test("fișiere false: text redenumit .jpg, HTML, SVG -> refuzate, nimic urcat", async () => {
  const cases = [
    file(Buffer.from("doar text, nu e imagine ".repeat(20)), "poza.jpg"),
    file(Buffer.from("<!doctype html><script>alert(1)</script>"), "poza.png", "image/png"),
    file(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "poza.webp", "image/webp"),
  ];
  for (const f of cases) {
    await assert.rejects(upload(f), (err) => err.code === "upload_content_mismatch", f.originalname);
  }
  assert.equal(sent.length, 0);
});

test("JPEG corupt (header valid, restul gunoi) -> refuzat (fără fallback brut)", async () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  await assert.rejects(upload(file(buf, "corupt.jpg")), (err) => err.code === "upload_content_mismatch");
  assert.equal(sent.length, 0);
});

test("HEIC fără decodor instalat: refuzat clar (heic_unsupported), NU urcat brut", async () => {
  await assert.rejects(upload(file(fakeHeic(), "IMG_0001.HEIC", "image/heic")), (err) => err.code === "heic_unsupported");
  assert.equal(sent.length, 0);
});

test("HEIC cu decodor: convertit în JPEG afișabil, nume .jpg", async () => {
  const width = 300;
  const height = 200;
  __setHeicDecoderForTests(async ({ buffer }) => {
    assert.ok(Buffer.isBuffer(buffer));
    const data = new Uint8ClampedArray(width * height * 4).fill(180);
    return { width, height, data };
  });

  const res = await upload(file(fakeHeic(), "IMG_0002.heic", "image/heic"));
  assert.equal(res.mimeType, "image/jpeg");
  assert.equal(sent[0].ContentType, "image/jpeg");
  assert.match(sent[0].Key, /img_0002\.jpg$/);
  const meta = await sharp(sent[0].Body).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 300, 200]);
});

test("HEIF (brand mif1) cu decodor: acceptat; HEIC uriaș peste plafon -> image_too_many_pixels", async () => {
  __setHeicDecoderForTests(async () => ({ width: 10, height: 10, data: new Uint8ClampedArray(400).fill(90) }));
  await upload(file(fakeHeic("mif1"), "poza.heif", "image/heif"));
  assert.equal(sent.length, 1);

  __setHeicDecoderForTests(async () => ({ width: 10000, height: 6000, data: new Uint8ClampedArray(4) }));
  await assert.rejects(upload(file(fakeHeic(), "uriasa.heic", "image/heic")), (err) => err.code === "image_too_many_pixels");
  assert.equal(sent.length, 1);
});

test("HEIC corupt (decodorul eșuează) -> refuzat, nimic urcat", async () => {
  __setHeicDecoderForTests(async () => {
    throw new Error("bad heif");
  });
  await assert.rejects(upload(file(fakeHeic(), "stricat.heic", "image/heic")), (err) => err.code === "upload_content_mismatch");
  assert.equal(sent.length, 0);
});

/* ---------- culori: profilul Display P3 al iPhone-ului ---------- */

test("culori HEIC: pixelii Display P3 sunt convertiți corect în sRGB (nu afișați spălăcit); sRGB rămâne neatins", async () => {
  const { sharpInputForDecoded, isSrgbProfile } = await import("./iccTaggedRaw.js");
  const p3Icc = (await sharp(await solid(4, 4, "png")).withIccProfile("p3").png().toBuffer().then((b) => sharp(b).metadata())).icc;
  const srgbIcc = (await sharp(await solid(4, 4, "png")).withIccProfile("srgb").png().toBuffer().then((b) => sharp(b).metadata())).icc;
  assert.equal(isSrgbProfile(p3Icc), false);
  assert.equal(isSrgbProfile(srgbIcc), true);
  assert.equal(isSrgbProfile(undefined), true);

  const width = 8;
  const height = 8;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([200, 100, 100, 255], i);
  const decoded = { data, width, height, channels: 4 };

  const pixel = async (icc) => {
    const { input, options } = await sharpInputForDecoded(decoded, icc);
    const out = await sharp(input, options).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
    const { data: px } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    return [px[0], px[1], px[2]];
  };

  const [r, g, b] = await pixel(p3Icc);
  // P3 (200,100,100) în sRGB ≈ (215,93,97): roșul mai intens, ca pe telefon
  assert.ok(r >= 209 && g <= 97 && b <= 101, `P3 -> sRGB: ${r},${g},${b}`);

  const plain = await pixel(srgbIcc);
  assert.ok(Math.abs(plain[0] - 200) <= 3 && Math.abs(plain[1] - 100) <= 3, `sRGB neatins: ${plain}`);
});

/* ---------- decodorul REAL (heic-decode în worker) ---------- */

const REAL_FIXTURE = process.env.HEIC_TEST_FIXTURE || "";

function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("decodor real: heic-decode e instalat; HEIC corupt -> refuzat în worker, nimic urcat", async () => {
  __setHeicDecoderForTests(undefined);
  const { heicDecoderInstalled } = await import("./heicDecoder.js");
  assert.equal(heicDecoderInstalled(), true, "rulează `npm install` în backend");

  const corrupt = Buffer.concat([fakeHeic(), Buffer.alloc(2048, 0x5a)]);
  await assert.rejects(upload(file(corrupt, "stricat.heic", "image/heic")), (err) => err.code === "upload_content_mismatch");
  assert.equal(sent.length, 0);
});

test(
  "decodor real + fotografie HEIC reală (HEIC_TEST_FIXTURE): JPEG max 2400 px, fără EXIF; plafon și termen respectate",
  { skip: REAL_FIXTURE ? false : "setează HEIC_TEST_FIXTURE=<cale .heic> pentru testul cu o fotografie reală" },
  async () => {
    __setHeicDecoderForTests(undefined);
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(REAL_FIXTURE);
    const header = await sharp(buffer).metadata();
    const pixels = header.width * header.height;

    await withEnv({ HEIC_DECODE_MAX_PIXELS: String(pixels + 1) }, async () => {
      const res = await upload(file(buffer, "real.heic", "image/heic"));
      assert.equal(res.mimeType, "image/jpeg");
      const meta = await sharp(sent[0].Body).metadata();
      assert.equal(meta.format, "jpeg");
      assert.ok(Math.max(meta.width, meta.height) <= 2400);
      assert.equal(
        Math.round((meta.width / meta.height) * 100),
        Math.round((header.width / header.height) * 100),
        "proporții păstrate"
      );
      assert.equal(meta.exif, undefined);
    });

    await withEnv({ HEIC_DECODE_MAX_PIXELS: String(pixels - 1) }, async () => {
      await assert.rejects(
        upload(file(buffer, "real.heic", "image/heic")),
        (err) => err.code === "image_too_many_pixels" && err.format === "heic"
      );
    });

    await withEnv({ HEIC_DECODE_MAX_PIXELS: String(pixels + 1), HEIC_DECODE_TIMEOUT_MS: "1" }, async () => {
      await assert.rejects(upload(file(buffer, "real.heic", "image/heic")), (err) => err.code === "heic_decode_timeout");
    });

    assert.equal(sent.length, 1, "doar conversia reușită a ajuns pe R2");
  }
);

test("politica document (suport) fără decodor: fallback-ul vechi rămâne (HEIC păstrat ca atașament)", async () => {
  const res = await uploadToR2({ file: file(fakeHeic(), "atasament.heic", "image/heic"), folder: "support", userId: "u1", policy: "document" });
  assert.equal(res.mimeType, "image/heic");
  assert.equal(sent.length, 1);
});
