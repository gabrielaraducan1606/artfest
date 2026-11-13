// src/middleware/imageSearchUpload.test.js
//
// Căutarea după imagine (POST /api/public/products/search-by-image folosește
// acest middleware): rezoluția e verificată din HEADER, înainte de decodare.
//  - fotografii obișnuite (12 / 24 MP) -> ajung la căutare, ca înainte;
//  - fișiere MICI cu rezoluție foarte mare (PNG de câteva sute de KB, 30-256 MP)
//    -> 422 IMAGE_TOO_LARGE, rapid, fără decodare și fără modelul CLIP;
//  - erorile existente (fișier > 4 MB, tip neacceptat) rămân neschimbate.
//
// Rulare: node --expose-gc --experimental-test-module-mocks --test src/middleware/imageSearchUpload.test.js

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import sharp from "sharp";

let server;
let baseUrl;
let handlerCalls = 0;
let pipelineLoads = 0;
let IMAGE_SEARCH_MAX_PIXELS;
let imageToEmbedding;
const restores = [];

before(async () => {
  // modelul CLIP simulat: testul verifică doar că NU e încărcat pentru imaginile refuzate
  restores.push(
    mock.module("@huggingface/transformers", {
      namedExports: {
        pipeline: async () => {
          pipelineLoads += 1;
          return async () => ({ data: new Float32Array(512).fill(0.1) });
        },
        RawImage: { read: async () => ({}) },
      },
    })
  );

  const mod = await import("./imageSearchUpload.js");
  IMAGE_SEARCH_MAX_PIXELS = mod.IMAGE_SEARCH_MAX_PIXELS;
  ({ imageToEmbedding } = await import("../lib/embeddings.js"));

  const app = express();
  app.post("/search", mod.uploadSearchImage, (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true, bytes: req.file?.size || 0 });
  });
  // eroarea multer ajunge la handlerul de erori (ca în aplicație)
  app.use((err, _req, res, _next) => res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code || "upload_error", message: err.message }));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restores.forEach((r) => r.restore());
});

const flat = (width, height, format) =>
  sharp({ create: { width, height, channels: 3, background: { r: 230, g: 225, b: 210 } } })[format]().toBuffer();

async function send(buffer, type = "image/png", name = "poza.png") {
  const body = new FormData();
  body.append("image", new Blob([buffer], { type }), name);
  const res = await fetch(`${baseUrl}/search`, { method: "POST", body });
  return { status: res.status, body: await res.json() };
}

test("limita implicită este 24 MP", () => {
  assert.equal(IMAGE_SEARCH_MAX_PIXELS, 24_000_000);
});

test("fotografii obișnuite (12 MP JPEG, 24 MP la limită) ajung la căutare, ca înainte", async () => {
  const before = handlerCalls;
  let res = await send(await flat(4000, 3000, "jpeg"), "image/jpeg", "telefon.jpg");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await send(await flat(6000, 4000, "jpeg"), "image/jpeg", "24mp.jpg");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  res = await send(await flat(1024, 768, "webp"), "image/webp", "din-frontend.webp");
  assert.equal(res.status, 200);
  assert.equal(handlerCalls - before, 3);
});

test("fișiere MICI cu rezoluție foarte mare -> 422 controlat, rapid, fără decodare și fără CLIP", async () => {
  const cases = [
    [6001, 4000, "png"], // chiar peste 24 MP
    [9238, 6929, "png"], // 64 MP
    [16000, 16000, "png"], // 256 MP, sub 1 MB
    [12000, 9000, "webp"],
  ];
  for (const [w, h, format] of cases) {
    const buffer = await flat(w, h, format);
    assert.ok(buffer.length < 4 * 1024 * 1024, "sub limita de 4 MB - doar rezoluția îl oprește");

    global.gc?.();
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 10);
    const before = handlerCalls;
    const t0 = performance.now();
    const res = await send(buffer, `image/${format}`, `mare.${format}`);
    const ms = performance.now() - t0;
    clearInterval(timer);

    const growth = (peak - base) / 1048576;
    console.log(`[memorie] ${w}x${h} ${format} (${Math.round(buffer.length / 1024)} KB): ${res.status}, +${growth.toFixed(0)} MB, ${ms.toFixed(0)} ms`);
    assert.equal(res.status, 422, `${w}x${h}`);
    assert.equal(res.body.error, "IMAGE_TOO_LARGE");
    assert.match(res.body.message, /maximum 24 MP/);
    assert.equal(handlerCalls, before, "nu ajunge la căutare");
    assert.ok(growth < 60, `creștere ${growth.toFixed(0)} MB`);
  }
  assert.equal(pipelineLoads, 0, "modelul CLIP nu e încărcat pentru imaginile refuzate");
});

test("erorile existente rămân: > 4 MB -> LIMIT_FILE_SIZE; tip neacceptat -> mesajul existent", async () => {
  let res = await send(Buffer.alloc(4 * 1024 * 1024 + 10), "image/jpeg", "mare.jpg");
  assert.equal(res.status, 413);
  assert.equal(res.body.error, "LIMIT_FILE_SIZE");

  res = await send(Buffer.from("text"), "text/plain", "a.txt");
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Tip de fișier neacceptat/);
});

test("fișier nedecodabil cu tip de imagine: comportamentul existent (ajunge la ruta care răspunde cu eroarea ei)", async () => {
  const before = handlerCalls;
  const res = await send(Buffer.from("nu e imagine"), "image/jpeg", "fals.jpg");
  assert.equal(res.status, 200);
  assert.equal(handlerCalls - before, 1);
});

test("a doua barieră (imageToEmbedding, ex. scriptul de backfill cu CLIP_MODEL_ENABLED=1): peste 24 MP -> embedding gol, fără CLIP", async (t) => {
  // modelul e oprit implicit; aici îl activăm explicit (modelul e simulat în acest fișier)
  process.env.CLIP_MODEL_ENABLED = "1";
  t.after(() => delete process.env.CLIP_MODEL_ENABLED);
  const loadsBefore = pipelineLoads;
  const emb = await imageToEmbedding(await flat(9238, 6929, "png"));
  assert.equal(emb.length, 512);
  assert.ok(emb.every((v) => v === 0));
  assert.equal(pipelineLoads, loadsBefore, "modelul nu se încarcă");

  const ok = await imageToEmbedding(await flat(1024, 768, "jpeg"));
  assert.ok(ok.some((v) => v !== 0), "o imagine normală produce în continuare embedding");
});
