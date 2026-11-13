// src/routes/uploadRoutes.productImages.test.js
//
// Ruta REALĂ POST /api/upload/products (folosită acum de TOATE formularele de
// produs), cu sharp real și R2 simulat - fără rețea:
//  - JPEG / PNG / WEBP -> 200 + URL;
//  - fișier text cu extensie .jpg -> 415 (upload_content_mismatch);
//  - HEIC fără decodor -> 415 heic_unsupported (mesaj în română), cu decodor -> 200 JPEG;
//  - extensie neacceptată -> 415 înainte de procesare;
//  - doar VENDOR / ADMIN.
// (413 peste 100 MB nu e testat aici: ar cere un corp de 100 MB; mesajul e
//  acoperit de testele frontend ale maparii statusurilor.)
//
// Rulare: node --experimental-test-module-mocks --test src/routes/uploadRoutes.productImages.test.js

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import sharp from "sharp";

let role = "VENDOR";
let server;
let baseUrl;
let sent = [];
let sendMock;
let setDecoder;
const restores = [];

before(async () => {
  restores.push(mock.module("../db.js", { namedExports: { prisma: {} } }));
  restores.push(
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, _res, next) => {
          req.user = { sub: "user-1", role };
          next();
        },
        optionalAuth: (_req, _res, next) => next(),
        enforceTokenVersion: (_req, _res, next) => next(),
        requireRole:
          (...roles) =>
          (req, res, next) =>
            roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" }),
      },
    })
  );

  const storage = await import("../services/r2Storage.js");
  sendMock = mock.method(storage.r2Client, "send", async (command) => {
    sent.push(command.input);
    return {};
  });
  ({ __setHeicDecoderForTests: setDecoder } = await import("../services/heicDecoder.js"));

  const { default: uploadRoutes } = await import("./uploadRoutes.js");
  const app = express();
  app.use("/api/upload", uploadRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  sendMock?.mock.restore();
  setDecoder?.(undefined);
  if (server) await new Promise((resolve) => server.close(resolve));
  restores.forEach((r) => r.restore());
});

beforeEach(() => {
  role = "VENDOR";
  sent = [];
  setDecoder(null);
});

async function post(buffer, name, type = "image/jpeg") {
  const body = new FormData();
  body.append("file", new Blob([buffer], { type }), name);
  const res = await fetch(`${baseUrl}/api/upload/products`, { method: "POST", body });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const image = (format, w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } })[format]().toBuffer();

function fakeHeic() {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(24, 0);
  buf.write("ftypheic", 4, "ascii");
  return buf;
}

test("JPEG, PNG și WEBP -> 200, URL și JPEG pe R2 (folder products)", async () => {
  for (const [format, name] of [["jpeg", "a.jpg"], ["png", "b.png"], ["webp", "c.webp"]]) {
    const res = await post(await image(format), name, `image/${format}`);
    assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.url, name);
    assert.deepEqual(res.body.urls, [res.body.url]);
  }
  assert.equal(sent.length, 3);
  assert.ok(sent.every((input) => input.ContentType === "image/jpeg" && input.Key.startsWith("products/user-1/")));
});

test("fișier text cu extensie .jpg (extensie falsificată) -> 415, nimic pe R2", async () => {
  const res = await post(Buffer.from("nu sunt o imagine ".repeat(30)), "poza.jpg");
  assert.equal(res.status, 415);
  assert.equal(res.body.error, "upload_content_mismatch");
  assert.equal(sent.length, 0);
});

test("extensie neacceptată (.exe) -> 415 înainte de procesare", async () => {
  const res = await post(Buffer.from("MZ"), "program.exe", "application/x-msdownload");
  assert.equal(res.status, 415);
  assert.equal(res.body.error, "invalid_file_type");
});

test("HEIC fără decodor -> 415 heic_unsupported, mesaj clar în română; cu decodor -> 200 JPEG", async () => {
  let res = await post(fakeHeic(), "IMG_0001.HEIC", "image/heic");
  assert.equal(res.status, 415);
  assert.equal(res.body.error, "heic_unsupported");
  assert.match(res.body.message, /HEIC\/HEIF/);
  assert.equal(sent.length, 0);

  setDecoder(async () => ({ width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(128) }));
  res = await post(fakeHeic(), "IMG_0001.HEIC", "image/heic");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.url, /img_0001\.jpg$/);
  assert.equal(sent[0].ContentType, "image/jpeg");
});

/* ---------- limitele pentru instanța Render de 512 MB ---------- */

// JPEG valid + octeți de umplutură până la mărimea cerută (sharp ignoră restul după EOI)
async function paddedJpeg(totalBytes) {
  const jpeg = await image("jpeg", 1200, 900);
  return Buffer.concat([jpeg, Buffer.alloc(totalBytes - jpeg.length, 0)]);
}

test("40 MB per fotografie: 39,9 MB trece; 40 MB + 1 octet -> 413 cu mesaj explicit, nimic pe R2", async () => {
  let res = await post(await paddedJpeg(40 * 1024 * 1024 - 100 * 1024), "mare-dar-ok.jpg");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(sent.length, 1);

  res = await post(await paddedJpeg(40 * 1024 * 1024 + 1), "prea-mare.jpg");
  assert.equal(res.status, 413);
  assert.equal(res.body.error, "file_too_large");
  assert.match(res.body.message, /maximum 40 MB/);
  assert.equal(sent.length, 1, "fișierul prea mare nu ajunge pe R2");
});

test("memorie insuficientă -> 503 server_busy + Retry-After 10 (frontend-ul reîncearcă), nimic pe R2", async () => {
  process.env.UPLOAD_MEMORY_LIMIT_MB = "1"; // simulează un proces deja aproape de limită
  try {
    const res = await post(await image("jpeg"), "a.jpg");
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "server_busy");
    assert.ok(res.body.message);
    assert.equal(sent.length, 0);
  } finally {
    delete process.env.UPLOAD_MEMORY_LIMIT_MB;
  }

  const after = await post(await image("jpeg"), "a.jpg");
  assert.equal(after.status, 200, "după eliberarea memoriei, upload-ul merge");
});

test("Retry-After e trimis la 503 de memorie", async () => {
  process.env.UPLOAD_MEMORY_LIMIT_MB = "1";
  try {
    const body = new FormData();
    body.append("file", new Blob([await image("jpeg")], { type: "image/jpeg" }), "a.jpg");
    const res = await fetch(`${baseUrl}/api/upload/products`, { method: "POST", body });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "10");
    await res.text();
  } finally {
    delete process.env.UPLOAD_MEMORY_LIMIT_MB;
  }
});

test("două uploaduri simultane de fotografii mari: procesate pe rând, memoria monitorizată rămâne sub pragul de 512 MB", async () => {
  // fotografie „grea”: 30 MP cu zgomot (decodare reală, fișier ~25-30 MB)
  const heavy = await sharp({ create: { width: 6700, height: 4500, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .jpeg({ quality: 90 })
    .toBuffer();
  assert.ok(heavy.length < 40 * 1024 * 1024);

  let inFlight = 0;
  let maxInFlight = 0;
  sendMock.mock.mockImplementation(async (command) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 50));
    inFlight -= 1;
    sent.push(command.input);
    return {};
  });

  global.gc?.();
  const base = process.memoryUsage().rss;
  let peak = base;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
  try {
    const [a, b] = await Promise.all([post(heavy, "unu.jpg"), post(heavy, "doi.jpg")]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
  } finally {
    clearInterval(timer);
    sendMock.mock.mockImplementation(async (command) => {
      sent.push(command.input);
      return {};
    });
  }

  assert.equal(maxInFlight, 1, "procesarea fotografiilor de produs e serializată (UPLOAD_PROCESSING_CONCURRENCY=1)");
  const growthMb = (peak - base) / 1024 / 1024;
  console.log(`[memorie] 2 uploaduri simultane de ${(heavy.length / 1048576).toFixed(1)} MB: +${growthMb.toFixed(0)} MB peste bază, vârf ${(peak / 1048576).toFixed(0)} MB RSS`);
  // ambele fișiere sunt în memorie (cerere + test) - procesarea rămâne una singură
  assert.ok(growthMb < 260, `creștere ${growthMb.toFixed(0)} MB`);
});

test("upload în timp ce se generează o factură: Chrome ocupă memoria containerului -> 503 + Retry-After; după factură, reîncercarea reușește; factura nu e afectată", async () => {
  const { __setContainerMemoryReaderForTests } = await import("../services/uploadMemoryGuard.js");
  const { __setPdfBrowserLauncher, closePdfBrowser } = await import("../lib/pdfBrowser.js");
  const { htmlToPdfBuffer } = await import("../lib/htmlToPdf.js");

  // Chrome simulat: cât timp pagina facturii e deschisă, containerul are +260 MB
  let openPages = 0;
  let releaseInvoice;
  const invoiceHeld = new Promise((resolve) => (releaseInvoice = resolve));
  __setPdfBrowserLauncher({
    async launch() {
      return {
        connected: true,
        on() {},
        async newPage() {
          openPages += 1;
          return {
            setDefaultTimeout() {},
            async emulateMediaType() {},
            async setContent() {
              await invoiceHeld;
            },
            async evaluate() {},
            async pdf() {
              return Buffer.from("%PDF-1.4 factura");
            },
            async close() {
              openPages -= 1;
            },
          };
        },
        async close() {},
      };
    },
  });
  // memoria containerului (cgroup simulat): Node ~200 MB + Chrome când lucrează; limită 512 MB
  __setContainerMemoryReaderForTests(async () => {
    const workingSetBytes = (200 + openPages * 260) * 1024 * 1024;
    return { ok: true, version: "v2", usageBytes: workingSetBytes, inactiveFileBytes: 0, workingSetBytes, limitBytes: 512 * 1024 * 1024 };
  });

  try {
    const invoice = htmlToPdfBuffer("<p>Factură</p>");
    while (openPages === 0) await new Promise((r) => setTimeout(r, 5));

    const body = new FormData();
    body.append("file", new Blob([await image("jpeg")], { type: "image/jpeg" }), "produs.jpg");
    const busy = await fetch(`${baseUrl}/api/upload/products`, { method: "POST", body });
    const busyJson = await busy.json();
    assert.equal(busy.status, 503, JSON.stringify(busyJson));
    assert.equal(busy.headers.get("retry-after"), "10");
    assert.equal(busyJson.error, "server_busy");
    assert.equal(sent.length, 0, "fotografia nu a fost procesată cât Chrome lucra");

    releaseInvoice();
    const pdf = await invoice;
    assert.ok(pdf.toString().startsWith("%PDF"), "factura s-a generat normal");
    assert.equal(openPages, 0);

    await new Promise((r) => setTimeout(r, 1100)); // citirea cgroup e reținută 1 s; frontend-ul așteaptă oricum Retry-After
    const retry = await post(await image("jpeg"), "produs.jpg");
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(sent.length, 1);
  } finally {
    __setContainerMemoryReaderForTests(null);
    __setPdfBrowserLauncher(null);
    await closePdfBrowser();
  }
});

test("rutele care NU sunt de produs își păstrează limitele: avatar (/api/upload) tot 10 MB", async () => {
  const body = new FormData();
  body.append("file", new Blob([await paddedJpeg(11 * 1024 * 1024)], { type: "image/jpeg" }), "avatar.jpg");
  const res = await fetch(`${baseUrl}/api/upload`, { method: "POST", body });
  const json = await res.json();
  assert.equal(res.status, 413);
  assert.match(json.message, /max 10MB/);
});

test("doar vânzători / Admin: client obișnuit -> 403", async () => {
  role = "USER";
  const res = await post(await image("jpeg"), "a.jpg");
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
});
