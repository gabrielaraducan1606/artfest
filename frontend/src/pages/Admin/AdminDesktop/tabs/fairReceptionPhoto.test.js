// src/pages/Admin/AdminDesktop/tabs/fairReceptionPhoto.test.js
// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/fairReceptionPhoto.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECEPTION_PHOTO_MAX_BYTES, RECEPTION_PHOTO_TOO_LARGE, prepareReceptionPhoto } from "./fairReceptionPhoto.js";
import { prepareImageForUpload } from "../../../../lib/productImages/prepareAndUploadImage.js";

const MB = 1024 * 1024;
const fakeFile = (size, type = "image/jpeg") => ({ name: "f.jpg", type, size });
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test("limita afișată = limita reală a serverului (10 MB)", () => {
  assert.equal(RECEPTION_PHOTO_MAX_BYTES, 10 * MB);
  assert.match(RECEPTION_PHOTO_TOO_LARGE, /10 MB/);
});

test("fotografie micșorată sub 10 MB: trece neschimbată", async () => {
  const small = fakeFile(0.4 * MB);
  const out = await prepareReceptionPhoto(fakeFile(19 * MB), {}, async () => ({ file: small, processed: true }));
  assert.equal(out.file, small);
  assert.equal(out.fatalMessage, undefined);
});

test("fișier care ar pleca peste 10 MB (nemicșorat): refuz clar în browser, fără upload", async () => {
  const big = fakeFile(12 * MB);
  const out = await prepareReceptionPhoto(big, {}, async (file) => ({ file, processed: false, via: "server" }));
  assert.equal(out.fatalMessage, RECEPTION_PHOTO_TOO_LARGE);
  // pipeline-ul comun transformă fatalMessage într-un refuz permanent (fără „Reîncearcă”)
  const error = await prepareImageForUpload(big, {
    readHead: async () => JPEG_HEAD,
    prepare: (file, options) => prepareReceptionPhoto(file, options, async (f) => ({ file: f, processed: false })),
  }).catch((e) => e);
  assert.equal(error.message, RECEPTION_PHOTO_TOO_LARGE);
  assert.equal(error.permanent, true);
});

test("un refuz existent al pregătirii (ex. HEIC prea mare) nu e înlocuit", async () => {
  const out = await prepareReceptionPhoto(fakeFile(30 * MB), {}, async (file) => ({ file, processed: false, fatalMessage: "HEIC prea mare" }));
  assert.equal(out.fatalMessage, "HEIC prea mare");
});
