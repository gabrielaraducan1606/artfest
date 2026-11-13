// src/services/uploadMemoryGuard.test.js
//
// Protecția de memorie pentru fotografiile de produs (Render 512 MB / 0,5 CPU):
//  - estimarea costului acoperă vârfurile MĂSURATE (sharp 0.34, 1 fir, 2026-11-13);
//  - memorie insuficientă -> 503 (server_busy, Retry-After 10), niciodată proces oprit;
//  - limita de 40 MB per fotografie; HEIC: plafon 16 MP, o singură conversie odată.
//
// Rulare: node --test src/services/uploadMemoryGuard.test.js

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_UPLOAD_MEMORY_LIMIT_MB,
  PRODUCT_IMAGE_MAX_BYTES,
  UploadMemoryBusyError,
  assertUploadMemoryAvailable,
  estimateImageProcessingBytes,
  uploadMemoryLimitBytes,
} from "./uploadMemoryGuard.js";
import {
  DEFAULT_HEIC_DECODE_MAX_PIXELS,
  __setHeicDecoderForTests,
  decodeHeic,
  heicDecodeMaxPixels,
} from "./heicDecoder.js";

const MB = 1024 * 1024;
const silent = { warn() {} };

after(() => __setHeicDecoderForTests(undefined));

test("limite pentru instanța de 512 MB: 40 MB / fotografie, prag de memorie 460 MB, HEIC 16 MP", () => {
  assert.equal(PRODUCT_IMAGE_MAX_BYTES, 40 * MB);
  assert.equal(DEFAULT_UPLOAD_MEMORY_LIMIT_MB, 460);
  assert.equal(uploadMemoryLimitBytes({}), 460 * MB);
  assert.equal(uploadMemoryLimitBytes({ UPLOAD_MEMORY_LIMIT_MB: "300" }), 300 * MB);
  assert.equal(uploadMemoryLimitBytes({ UPLOAD_MEMORY_LIMIT_MB: "0" }), 0, "0 = oprit explicit");
  assert.equal(uploadMemoryLimitBytes({ UPLOAD_MEMORY_LIMIT_MB: "abc" }), 460 * MB);
  assert.equal(DEFAULT_HEIC_DECODE_MAX_PIXELS, 16_000_000);
  assert.equal(heicDecodeMaxPixels({}), 16_000_000);
});

test("estimarea costului acoperă vârfurile MĂSURATE pentru fiecare format (fișierul inclus)", () => {
  // [header, octeți fișier, vârf măsurat peste bază (MB), 1 fir sharp]
  const measured = [
    [{ format: "jpeg", width: 9500, height: 6333 }, 40.9 * MB, 85],
    [{ format: "jpeg", width: 12247, height: 8165 }, 22.6 * MB, 66],
    [{ format: "jpeg", width: 7348, height: 4899, isProgressive: true }, 21.9 * MB, 164],
    [{ format: "png", width: 12247, height: 8165 }, 1.3 * MB, 94],
    [{ format: "png", width: 4300, height: 3000 }, 34.3 * MB, 89],
    [{ format: "png", width: 6124, height: 4082, isProgressive: true }, 74.7 * MB, 186],
    [{ format: "webp", width: 9000, height: 6000 }, 35 * MB, 90],
    [{ format: "webp", width: 12247, height: 8165 }, 27.9 * MB, 77],
    [{ format: "gif", width: 6124, height: 4082 }, 0.05 * MB, 152],
    [{ format: "tiff", width: 12247, height: 8165 }, 0.3 * MB, 93],
    [{ format: "heif", compression: "av1", width: 3464, height: 2309 }, 3.5 * MB, 159],
    [{ format: "heif", compression: "hevc", width: 8256, height: 5504 }, 4.3 * MB, 412],
  ];
  for (const [header, fileBytes, peakMb] of measured) {
    const estimate = estimateImageProcessingBytes({ header, fileBytes }) / MB;
    assert.ok(estimate >= peakMb, `${header.format}${header.isProgressive ? " progresiv" : ""} ${header.width}x${header.height}: estimat ${estimate.toFixed(0)} MB < măsurat ${peakMb} MB`);
  }
});

test("cel mai scump caz permis încape într-o instanță de 512 MB peste un proces de ~250 MB", () => {
  const worst = [
    { format: "heif", compression: "hevc", width: 4618, height: 3464 }, // HEIC 16 MP (plafon)
    { format: "jpeg", width: 7348, height: 4899, isProgressive: true }, // JPEG progresiv 36 MP (plafon)
    { format: "png", width: 6124, height: 4082, isProgressive: true }, // PNG întrețesut 25 MP (plafon)
    { format: "gif", width: 6124, height: 4082 }, // GIF 25 MP (plafon)
    { format: "heif", compression: "av1", width: 3464, height: 2309 }, // AVIF 8 MP (plafon)
  ].map((header) => estimateImageProcessingBytes({ header, fileBytes: PRODUCT_IMAGE_MAX_BYTES }));
  const max = Math.max(...worst) / MB;
  assert.ok(max < 512 - 250, `cel mai mare cost estimat ${max.toFixed(0)} MB`);
});

test("fișier nedecodabil / header necunoscut: cost = copii ale fișierului + rezervă fixă", () => {
  assert.equal(estimateImageProcessingBytes({ header: null, fileBytes: 10 * MB }), 60 * MB);
  assert.equal(estimateImageProcessingBytes({ header: { format: "jpeg" }, fileBytes: 0 }), 40 * MB);
});

test("memorie insuficientă ACUM -> 503 server_busy cu Retry-After, nu oprirea procesului", () => {
  const limitBytes = 460 * MB;
  assert.doesNotThrow(() => assertUploadMemoryAvailable(150 * MB, { rss: () => 300 * MB, limitBytes, logger: silent }));

  assert.throws(
    () => assertUploadMemoryAvailable(200 * MB, { rss: () => 300 * MB, limitBytes, logger: silent }),
    (err) =>
      err instanceof UploadMemoryBusyError &&
      err.status === 503 &&
      err.code === "server_busy" &&
      err.retryAfterSeconds === 10 &&
      /Reîncercăm automat/.test(err.message)
  );

  // protecția oprită explicit (UPLOAD_MEMORY_LIMIT_MB=0)
  assert.doesNotThrow(() => assertUploadMemoryAvailable(10_000 * MB, { rss: () => 500 * MB, limitBytes: 0 }));
});

test("HEIC: peste 16 MP -> refuzat înainte de decodare; o singură conversie odată în proces", async () => {
  let calls = 0;
  __setHeicDecoderForTests(async () => {
    calls += 1;
    return { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  });
  await assert.rejects(decodeHeic(Buffer.alloc(8), { width: 5712, height: 4284 }), (err) => err.code === "image_too_many_pixels" && err.maxPixels === 16_000_000);
  assert.equal(calls, 0, "iPhone 24 MP: refuzat din header, fără decodare");

  let active = 0;
  let maxActive = 0;
  __setHeicDecoderForTests(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active -= 1;
    return { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  });
  await Promise.all([1, 2, 3].map(() => decodeHeic(Buffer.alloc(8), { width: 4032, height: 3024 })));
  assert.equal(maxActive, 1, "conversiile HEIC simultane așteaptă la rând");
});
