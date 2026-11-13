// Rulare: node --test src/lib/productImages/productImages.test.js
//
// Fluxul COMUN de fotografii de produs (Smart Listing adăugare/editare,
// ProductModal, asistent): validare după conținut, mesaje RO, coadă (status,
// concurență, retry, eliminare, duplicate, ordine), upload cu progres / erori /
// termene - totul cu fișiere și XHR simulate, fără rețea.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { setImmediate } from "node:timers";

import {
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_PHOTOS,
  MAX_PRODUCT_SOURCE_BYTES,
  checkUploadSize,
  PRODUCT_IMAGE_UPLOAD_ENDPOINT,
  ProductImageUploadError,
  checkProductImageFile,
  fileFingerprint,
  isPersistentImageUrl,
  isRetryableUploadError,
  retryDelayMs,
  sniffImageKind,
  uploadErrorMessage,
} from "./productImageRules.js";
import { jpegFileName, shouldProcessInBrowser, targetDimensions } from "./prepareProductImage.js";
import { createProductImageQueue } from "./productImageQueue.js";
import { uploadProductImage, uploadProductImageWithRetry, urlFromUploadResponse } from "./uploadProductImage.js";

/* ---------------- fișiere de test ---------------- */

const HEADS = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52],
  webp: [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 ")],
  heic: [0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0],
  heif: [0, 0, 0, 0x18, ...Buffer.from("ftypmif1"), 0, 0, 0, 0],
  avif: [0, 0, 0, 0x1c, ...Buffer.from("ftypavif"), 0, 0, 0, 0],
  gif: [...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
};

let fileSeq = 0;
function makeFile(name, kind = "jpeg", { size = 2048, lastModified } = {}) {
  const head = kind === "text" ? [...Buffer.from("acesta nu este o imagine")] : HEADS[kind];
  const body = new Uint8Array(Math.max(size, head.length));
  body.set(head);
  return new File([body], name, { type: kind === "text" ? "image/jpeg" : `image/${kind}`, lastModified: lastModified ?? 1_700_000_000_000 + (fileSeq += 1) });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await tick();
}

/** upload controlat din test: fiecare apel așteaptă până îl rezolvi / respingi */
function controlledUpload() {
  const calls = [];
  const upload = (file, ctx) =>
    new Promise((resolve, reject) => {
      const call = { file, ctx, resolve, reject };
      calls.push(call);
      ctx.signal.addEventListener("abort", () => reject(new ProductImageUploadError({ kind: "aborted" })));
    });
  return { calls, upload };
}

function newQueue(extra = {}) {
  const previews = [];
  const revoked = [];
  const queue = createProductImageQueue({
    createPreview: (file) => {
      const url = `blob:test/${file.name}`;
      previews.push(url);
      return url;
    },
    revokePreview: (url) => revoked.push(url),
    sleep: async () => {},
    ...extra,
  });
  return { queue, previews, revoked };
}

/* ======================= reguli ======================= */

test("sniffImageKind: JPEG, PNG, WEBP, HEIC, HEIF, AVIF, GIF după conținut; text/HTML -> null", () => {
  for (const kind of ["jpeg", "png", "webp", "heic", "avif", "gif"]) {
    assert.equal(sniffImageKind(Uint8Array.from(HEADS[kind])), kind);
  }
  assert.equal(sniffImageKind(Uint8Array.from(HEADS.heif)), "heic", "HEIF (mif1) = familia HEIC");
  assert.equal(sniffImageKind(Uint8Array.from(Buffer.from("<!doctype html><script>"))), null);
  assert.equal(sniffImageKind(new Uint8Array()), null);
});

test("checkProductImageFile: extensie falsificată, fișier gol, prea mare -> mesaje clare în română", () => {
  const fake = checkProductImageFile({ name: "poza.jpg", size: 500 }, Uint8Array.from(Buffer.from("text simplu, nu imagine")));
  assert.equal(fake.ok, false);
  assert.match(fake.message, /nu este o fotografie validă/);

  assert.match(checkProductImageFile({ name: "gol.jpg", size: 0 }, Uint8Array.from(HEADS.jpeg)).message, /gol/);

  // la selecție: până la 100 MB (browserul o micșorează înainte de upload)
  assert.equal(checkProductImageFile({ name: "60mb.jpg", size: 60 * 1024 * 1024 }, Uint8Array.from(HEADS.jpeg)).ok, true);
  const big = checkProductImageFile({ name: "mare.jpg", size: MAX_PRODUCT_SOURCE_BYTES + 1 }, Uint8Array.from(HEADS.jpeg));
  assert.equal(big.ok, false);
  assert.match(big.message, /maximum 100,0 MB per fotografie aleasă/);

  // PNG redenumit .jpg: acceptat după conținut (serverul îl convertește)
  assert.deepEqual(checkProductImageFile({ name: "x.jpg", size: 10 }, Uint8Array.from(HEADS.png)), { ok: true, kind: "png" });
  assert.deepEqual(checkProductImageFile({ name: "IMG_1.HEIC", size: 10 }, Uint8Array.from(HEADS.heic)), { ok: true, kind: "heic" });
});

test("mesaje de eroare: 413 / 415 / 429 / 503 / rețea / timp; serverul are prioritate", () => {
  assert.match(uploadErrorMessage({ kind: "http", status: 413 }), /prea mare/);
  assert.match(uploadErrorMessage({ kind: "http", status: 415 }), /Formatul nu este acceptat/);
  assert.match(uploadErrorMessage({ kind: "http", status: 429 }), /ocupat/);
  assert.match(uploadErrorMessage({ kind: "http", status: 503 }), /ocupat/);
  assert.match(uploadErrorMessage({ kind: "network" }), /Conexiunea s-a întrerupt/);
  assert.match(uploadErrorMessage({ kind: "timeout" }), /conexiune lentă/);
  assert.match(uploadErrorMessage({ kind: "http", status: 415, code: "heic_unsupported" }), /HEIC/);
  assert.equal(uploadErrorMessage({ kind: "http", status: 500, serverMessage: "Mesaj server" }), "Mesaj server");
});

test("ce se reîncearcă automat: rețea, timp, 429, 5xx - nu 413/415/422/401", () => {
  for (const info of [{ kind: "network" }, { kind: "timeout" }, { status: 429 }, { status: 503 }, { status: 500 }]) {
    assert.equal(isRetryableUploadError(new ProductImageUploadError({ kind: "http", ...info })), true, JSON.stringify(info));
  }
  for (const status of [400, 401, 413, 415, 422]) {
    assert.equal(isRetryableUploadError(new ProductImageUploadError({ kind: "http", status })), false, String(status));
  }
  assert.equal(retryDelayMs(1, 7), 7000, "Retry-After de la server");
  assert.deepEqual([retryDelayMs(1), retryDelayMs(2), retryDelayMs(3)], [1500, 4000, 8000]);
});

test("URL-uri: doar cele definitive sunt salvate (blob:/data: niciodată)", () => {
  assert.equal(isPersistentImageUrl("https://media.artfest.ro/products/a.jpg"), true);
  assert.equal(isPersistentImageUrl("/uploads/a.jpg"), true);
  assert.equal(isPersistentImageUrl("blob:http://localhost/abc"), false);
  assert.equal(isPersistentImageUrl("data:image/png;base64,AAA"), false);
  assert.equal(urlFromUploadResponse({ url: "blob:x" }), "");
  assert.equal(urlFromUploadResponse({ items: [{ url: "https://cdn/x.jpg" }] }), "https://cdn/x.jpg");
  assert.equal(fileFingerprint({ name: "a.jpg", size: 3, lastModified: 9 }), "a.jpg|3|9");
});

/* ======================= limita de 40 MB (Render 512 MB) ======================= */

test("limite: 40 MB per fișier TRIMIS, 100 MB per fotografie aleasă; 413 explică limita", () => {
  assert.equal(MAX_PRODUCT_IMAGE_BYTES, 40 * 1024 * 1024);
  assert.equal(MAX_PRODUCT_SOURCE_BYTES, 100 * 1024 * 1024);
  assert.deepEqual(checkUploadSize({ size: 40 * 1024 * 1024 }, "ok.jpg"), { ok: true });
  const over = checkUploadSize({ size: 40 * 1024 * 1024 + 1 }, "animatie.gif");
  assert.equal(over.ok, false);
  assert.match(over.message, /„animatie\.gif” .* nu a putut fi micșorată automat sub 40,0 MB/);
  assert.match(uploadErrorMessage({ kind: "http", status: 413 }), /maximum 40,0 MB după optimizare/);
});

test("fotografie de 60 MB micșorată în browser -> se încarcă; rămasă peste 40 MB -> eroare fără „Reîncearcă”", async () => {
  const uploads = [];
  const { queue } = newQueue({
    upload: async (file) => {
      uploads.push(file.size);
      return { url: `https://cdn/${file.name}` };
    },
    prepare: async (file) =>
      file.name.startsWith("mare")
        ? { file: new File([new Uint8Array(1024)], "mare.jpg", { type: "image/jpeg" }), processed: true }
        : { file, processed: false },
  });

  const big = makeFile("mare.jpg", "jpeg", { size: 60 * 1024 * 1024 });
  const gif = makeFile("animatie.gif", "gif", { size: 41 * 1024 * 1024 });
  await queue.addFiles([big, gif]);
  await settle(60);

  const [first, second] = queue.getSnapshot().items;
  assert.equal(first.status, "done");
  assert.deepEqual(uploads, [1024], "s-a trimis doar varianta micșorată; GIF-ul prea mare nu a plecat la server");
  assert.equal(second.status, "error");
  assert.equal(second.retryable, false);
  assert.match(second.error, /nu a putut fi micșorată automat sub 40,0 MB/);
  assert.equal(queue.retry(second.id), false, "reîncercarea nu ar schimba nimic");
});

/* ======================= optimizare ======================= */

test("dimensiuni: max 2400 px pe latura lungă, proporții păstrate, fără mărire", () => {
  assert.deepEqual(targetDimensions(8064, 6048), { width: 2400, height: 1800 });
  assert.deepEqual(targetDimensions(3000, 4000), { width: 1800, height: 2400 });
  assert.deepEqual(targetDimensions(1200, 900), { width: 1200, height: 900 });
});

test("procesare în browser doar când e nevoie (fără compresie repetată pentru fotografii mici)", () => {
  assert.equal(shouldProcessInBrowser({ kind: "jpeg", size: 900_000, width: 1600, height: 1200 }), false);
  assert.equal(shouldProcessInBrowser({ kind: "jpeg", size: 9_000_000, width: 4032, height: 3024 }), true);
  assert.equal(shouldProcessInBrowser({ kind: "png", size: 1_000_000, width: 3000, height: 2000 }), true);
  assert.equal(shouldProcessInBrowser({ kind: "heic", size: 2_000_000 }), true, "HEIC -> JPEG dacă browserul poate");
  assert.equal(shouldProcessInBrowser({ kind: "gif", size: 9_000_000 }), false, "GIF rămâne la server");
  assert.equal(jpegFileName("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(jpegFileName(""), "fotografie.jpg");
});

/* ======================= coadă ======================= */

test("1 JPEG: în așteptare -> se pregătește -> se încarcă (progres) -> încărcată; URL definitiv", async () => {
  const { calls, upload } = controlledUpload();
  const { queue } = newQueue({ upload });
  const statuses = [];
  queue.subscribe(() => statuses.push(queue.getSnapshot().items[0]?.status));

  const result = await queue.addFiles([makeFile("produs.jpg")]);
  assert.deepEqual(result, { added: 1, rejected: [] });
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(queue.getSnapshot().items[0].status, "uploading");

  calls[0].ctx.onProgress(0.4);
  assert.equal(queue.getSnapshot().items[0].progress, 0.4);
  assert.deepEqual(queue.getSnapshot().urls, [], "nimic salvabil cât timp se încarcă");
  assert.equal(queue.getSnapshot().pendingCount, 1);

  calls[0].resolve({ url: "https://cdn/produs.jpg" });
  await settle();
  const snap = queue.getSnapshot();
  assert.equal(snap.items[0].status, "done");
  assert.deepEqual(snap.urls, ["https://cdn/produs.jpg"]);
  assert.equal(snap.pendingCount, 0);
  for (const s of ["queued", "processing", "uploading", "done"]) assert.ok(statuses.includes(s), s);
});

test("mai multe fotografii: o singură procesare odată, maximum 2 uploaduri simultane, ordinea păstrată", async () => {
  const { calls, upload } = controlledUpload();
  let preparing = 0;
  let maxPreparing = 0;
  const prepare = async (file) => {
    preparing += 1;
    maxPreparing = Math.max(maxPreparing, preparing);
    await tick();
    preparing -= 1;
    return { file };
  };
  const { queue } = newQueue({ upload, prepare });

  await queue.addFiles(["a", "b", "c", "d", "e"].map((n) => makeFile(`${n}.jpg`)));
  await settle(60);
  assert.equal(maxPreparing, 1, "procesare câte una (memorie pe telefon)");
  assert.equal(calls.length, 2, "maximum 2 uploaduri simultane");

  calls[0].resolve({ url: "https://cdn/a.jpg" });
  await settle(60);
  assert.equal(calls.length, 3);
  calls.slice(1).forEach((call, i) => call.resolve({ url: `https://cdn/${"bcde"[i]}.jpg` }));
  await settle(60);
  calls.slice(3).forEach((call, i) => call.resolve({ url: `https://cdn/${"de"[i]}.jpg` }));
  await settle(60);

  assert.deepEqual(queue.getSnapshot().urls, ["a", "b", "c", "d", "e"].map((n) => `https://cdn/${n}.jpg`));
});

test("eșecul uneia nu le oprește pe celelalte; cele încărcate rămân; retry individual fără reprocesare", async () => {
  const { calls, upload } = controlledUpload();
  let prepared = 0;
  const { queue } = newQueue({
    upload,
    maxAutoRetries: 0, // eroarea trecătoare rămâne „error” -> retry manual
    prepare: async (file) => {
      prepared += 1;
      return { file };
    },
  });

  await queue.addFiles([makeFile("ok1.jpg"), makeFile("rau.jpg"), makeFile("ok2.jpg")]);
  await settle(40);
  calls[0].resolve({ url: "https://cdn/ok1.jpg" });
  calls[1].reject(new ProductImageUploadError({ kind: "http", status: 503, code: "server_busy" }));
  await settle(40);
  calls[2].resolve({ url: "https://cdn/ok2.jpg" });
  await settle(40);

  let snap = queue.getSnapshot();
  assert.deepEqual(snap.items.map((i) => i.status), ["done", "error", "done"]);
  assert.match(snap.items[1].error, /ocupat/);
  assert.equal(snap.items[1].retryable, true);
  assert.deepEqual(snap.urls, ["https://cdn/ok1.jpg", "https://cdn/ok2.jpg"], "cele reușite nu se pierd");
  assert.equal(snap.failedCount, 1);

  assert.equal(queue.retry(snap.items[1].id), true);
  await settle(40);
  assert.equal(calls.length, 4);
  assert.equal(prepared, 3, "retry-ul refolosește fișierul pregătit (fără reconversie)");
  calls[3].resolve({ url: "https://cdn/rau.jpg" });
  await settle(40);
  snap = queue.getSnapshot();
  assert.deepEqual(snap.urls, ["https://cdn/ok1.jpg", "https://cdn/rau.jpg", "https://cdn/ok2.jpg"]);
  assert.equal(snap.failedCount, 0);
});

test("conexiune instabilă: erorile trecătoare se reîncearcă automat (cu Retry-After), apoi eroare cu retry manual", async () => {
  const delays = [];
  let attempts = 0;
  const upload = async () => {
    attempts += 1;
    if (attempts === 1) throw new ProductImageUploadError({ kind: "network" });
    if (attempts === 2) throw new ProductImageUploadError({ kind: "http", status: 503, retryAfterSeconds: 3 });
    return { url: "https://cdn/x.jpg" };
  };
  const { queue } = newQueue({ upload, sleep: async (ms) => delays.push(ms) });
  await queue.addFiles([makeFile("x.jpg")]);
  await settle(40);
  assert.equal(queue.getSnapshot().items[0].status, "done");
  assert.deepEqual(delays, [1500, 3000]);

  // mereu căzut: după 2 reîncercări automate -> eroare + „Reîncearcă”
  const { queue: q2 } = newQueue({ upload: async () => Promise.reject(new ProductImageUploadError({ kind: "timeout" })) });
  await q2.addFiles([makeFile("y.jpg")]);
  await settle(40);
  assert.equal(q2.getSnapshot().items[0].status, "error");
  assert.match(q2.getSnapshot().items[0].error, /conexiune lentă/);
});

test("refuz DEFINITIV (422: HEIC de 50 MP) -> fără reîncercări automate, fără „Reîncearcă”, mesajul exact al serverului", async () => {
  const serverMessage =
    "Fotografia HEIC are 50 MP, iar pentru conversie acceptăm maximum 16 MP. Fă poza la 12 MP sau ca JPG (Samsung: ...).";
  let attempts = 0;
  const delays = [];
  const { queue } = newQueue({
    upload: async () => {
      attempts += 1;
      throw new ProductImageUploadError({ kind: "http", status: 422, code: "image_too_many_pixels", message: serverMessage });
    },
    sleep: async (ms) => delays.push(ms),
  });
  await queue.addFiles([makeFile("20261112_091459.heic", "heic")]);
  await settle(40);

  const [item] = queue.getSnapshot().items;
  assert.equal(attempts, 1, "o singură încercare - reîncercarea nu ar schimba nimic");
  assert.deepEqual(delays, []);
  assert.equal(item.status, "error");
  assert.equal(item.retryable, false);
  assert.equal(item.error, serverMessage, "mesajul corespunde cauzei reale (rezoluție), nu „server ocupat”");
  assert.equal(queue.retry(item.id), false);
});

test("413 / 415 / 422 sunt definitive; 503 / 429 / rețea nu", async () => {
  const { isPermanentUploadError } = await import("./productImageRules.js");
  for (const status of [413, 415, 422]) assert.equal(isPermanentUploadError(new ProductImageUploadError({ kind: "http", status })), true, String(status));
  for (const status of [429, 500, 503]) assert.equal(isPermanentUploadError(new ProductImageUploadError({ kind: "http", status })), false, String(status));
  assert.equal(isPermanentUploadError(new ProductImageUploadError({ kind: "network" })), false);
});

test("refuz temporar de memorie (503 server_busy, Retry-After 10): reîncercare automată după 10 s, apoi încărcată", async () => {
  const delays = [];
  let attempts = 0;
  const { queue } = newQueue({
    upload: async () => {
      attempts += 1;
      if (attempts === 1) throw new ProductImageUploadError({ kind: "http", status: 503, code: "server_busy", retryAfterSeconds: 10 });
      return { url: "https://cdn/dupa-refuz.jpg" };
    },
    sleep: async (ms) => delays.push(ms),
  });
  await queue.addFiles([makeFile("produs.jpg")]);
  await settle(40);
  assert.deepEqual(delays, [10_000], "așteaptă exact cât cere serverul");
  assert.equal(queue.getSnapshot().items[0].status, "done");
  assert.deepEqual(queue.getSnapshot().urls, ["https://cdn/dupa-refuz.jpg"]);
});

test("eliminarea unei fotografii în timpul upload-ului îl oprește și eliberează previzualizarea", async () => {
  const { calls, upload } = controlledUpload();
  const { queue, revoked } = newQueue({ upload });
  await queue.addFiles([makeFile("a.jpg"), makeFile("b.jpg")]);
  await settle();
  const [a] = queue.getSnapshot().items;
  queue.remove(a.id);
  await settle();
  assert.equal(calls[0].ctx.signal.aborted, true);
  assert.deepEqual(revoked, ["blob:test/a.jpg"]);
  assert.deepEqual(queue.getSnapshot().items.map((i) => i.name), ["b.jpg"]);
  calls[1].resolve({ url: "https://cdn/b.jpg" });
  await settle();
  assert.deepEqual(queue.getSnapshot().urls, ["https://cdn/b.jpg"]);
});

test("duplicate accidentale și fișiere invalide sunt refuzate; limita de 12 include fotografiile existente", async () => {
  const { upload } = controlledUpload();
  const { queue } = newQueue({ upload, initialUrls: Array.from({ length: 10 }, (_, i) => `https://cdn/vechi${i}.jpg`) });

  const same = makeFile("dublu.jpg", "jpeg", { lastModified: 42 });
  const twin = makeFile("dublu.jpg", "jpeg", { lastModified: 42 });
  const result = await queue.addFiles([same, twin, makeFile("fals.jpg", "text"), makeFile("a.png", "png"), makeFile("b.webp", "webp"), makeFile("c.heic", "heic")]);

  assert.equal(result.added, 2, "10 existente + 2 noi = 12");
  const messages = result.rejected.map((r) => r.message).join("\n");
  assert.match(messages, /„dublu\.jpg” este deja adăugată/);
  assert.match(messages, /„fals\.jpg” nu este o fotografie validă/);
  assert.match(messages, /cel mult 12 fotografii/);
  assert.equal(queue.getSnapshot().items.length, MAX_PRODUCT_PHOTOS);
  assert.equal(queue.getSnapshot().canAddMore, false);
});

test("PNG, WEBP, HEIC și HEIF sunt acceptate în coadă (tipul real ajunge la pregătire)", async () => {
  const kinds = [];
  const { queue } = newQueue({
    upload: async (file) => ({ url: `https://cdn/${file.name}` }),
    prepare: async (file, { kind }) => {
      kinds.push(kind);
      return { file };
    },
  });
  await queue.addFiles([makeFile("a.png", "png"), makeFile("b.webp", "webp"), makeFile("c.HEIC", "heic"), makeFile("d.heif", "heif")]);
  await settle(60);
  assert.deepEqual(kinds, ["png", "webp", "heic", "heic"]);
  assert.equal(queue.getSnapshot().doneCount, 4);
});

test("editare: lista de imagini existente rămâne IDENTICĂ fără acțiunea vânzătorului (inclusiv valori vechi neobișnuite)", () => {
  // tot ce poate exista în Product.images (String[]) - păstrat exact, în aceeași ordine
  const legacy = [
    "https://media.artfest.ro/products/u1/1-a.jpg",
    "products/fara-slash.jpg",
    "/uploads/2.jpg",
    " https://cdn/cu-spatii.jpg ",
    "",
    "data:image/png;base64,AAAA",
    "blob:http://localhost/vechi",
    ...Array.from({ length: 9 }, (_, i) => `https://cdn/x${i}.jpg`),
  ];
  const { queue } = newQueue({ upload: async () => ({ url: "https://cdn/nou.jpg" }) });
  queue.reset([...legacy]);
  assert.deepEqual(queue.getSnapshot().urls, legacy, "nimic filtrat, tăiat, normalizat sau reordonat");
  assert.equal(queue.getSnapshot().pendingCount, 0);
});

test("editare: imaginile existente se păstrează (inclusiv URL-uri vechi și peste 12); reordonare + principală", async () => {
  const legacy = ["https://cdn/1.jpg", "products/vechi.jpg", "/uploads/2.jpg", ...Array.from({ length: 11 }, (_, i) => `https://cdn/x${i}.jpg`)];
  const { queue } = newQueue({ upload: async () => ({ url: "https://cdn/nou.jpg" }) });
  queue.reset(legacy);
  const snap = queue.getSnapshot();
  assert.equal(snap.urls.length, 14, "nimic tăiat la 12");
  assert.deepEqual(snap.urls.slice(0, 3), ["https://cdn/1.jpg", "products/vechi.jpg", "/uploads/2.jpg"]);

  const third = snap.items[2];
  queue.makeMain(third.id);
  assert.equal(queue.getSnapshot().urls[0], "/uploads/2.jpg");
  queue.move(third.id, 1);
  assert.deepEqual(queue.getSnapshot().urls.slice(0, 2), ["https://cdn/1.jpg", "/uploads/2.jpg"]);
  queue.move(queue.getSnapshot().items[0].id, -1); // deja prima: nicio schimbare
  assert.equal(queue.getSnapshot().urls[0], "https://cdn/1.jpg");

  const added = await queue.addFiles([makeFile("peste.jpg")]);
  assert.equal(added.added, 0, "peste limită nu se mai adaugă");
});

test("destroy (închiderea formularului) oprește uploadurile în curs", async () => {
  const { calls, upload } = controlledUpload();
  const { queue } = newQueue({ upload });
  await queue.addFiles([makeFile("a.jpg")]);
  await settle();
  queue.destroy();
  assert.equal(calls[0].ctx.signal.aborted, true);
});

/* ======================= request XHR ======================= */

function fakeXhrFactory(script) {
  const instances = [];
  class FakeXHR {
    constructor() {
      this.upload = {};
      this.headers = {};
      this.status = 0;
      this.responseText = "";
      instances.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    getResponseHeader(name) {
      return this.headers[name.toLowerCase()] ?? null;
    }
    abort() {
      this.aborted = true;
    }
    send(body) {
      this.body = body;
      script(this);
    }
  }
  return { FakeXHR, instances };
}

test("XHR: ruta de produse, cookie-uri, progres real și URL din răspuns", async () => {
  const progress = [];
  const { FakeXHR, instances } = fakeXhrFactory((xhr) => {
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onload();
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ ok: true, url: "https://cdn/p.jpg", items: [{ url: "https://cdn/p.jpg" }] });
    xhr.onload();
  });
  const result = await uploadProductImage(new File([new Uint8Array(HEADS.jpeg)], "p.jpg"), { XHR: FakeXHR, onProgress: (f) => progress.push(f) });
  assert.equal(result.url, "https://cdn/p.jpg");
  assert.equal(instances[0].method, "POST");
  assert.equal(instances[0].url, `/api${PRODUCT_IMAGE_UPLOAD_ENDPOINT.replace(/^\/api/, "")}`);
  assert.equal(instances[0].withCredentials, true);
  assert.ok(instances[0].body instanceof FormData && instances[0].body.get("file"));
  assert.deepEqual(progress, [0.5, 1]);
});

test("XHR: 413 cu mesajul serverului, 503 cu Retry-After, eroare de rețea, răspuns fără URL", async () => {
  const run = (script) => {
    const { FakeXHR } = fakeXhrFactory(script);
    return uploadProductImage(new File([new Uint8Array(4)], "x.jpg"), { XHR: FakeXHR });
  };

  await assert.rejects(
    run((xhr) => {
      xhr.status = 413;
      xhr.responseText = JSON.stringify({ error: "file_too_large", message: "Imaginea este prea mare (max 100MB)." });
      xhr.onload();
    }),
    (err) => err.status === 413 && err.message === "Imaginea este prea mare (max 100MB)." && !isRetryableUploadError(err)
  );

  await assert.rejects(
    run((xhr) => {
      xhr.status = 503;
      xhr.headers["retry-after"] = "5";
      xhr.onload();
    }),
    (err) => err.status === 503 && err.retryAfterSeconds === 5 && isRetryableUploadError(err)
  );

  await assert.rejects(run((xhr) => xhr.onerror()), (err) => err.kind === "network");

  await assert.rejects(
    run((xhr) => {
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ ok: true });
      xhr.onload();
    }),
    (err) => err.kind === "invalid_response"
  );
});

test("XHR: conexiune blocată (fără progres) -> timp depășit; anulare -> oprit", async () => {
  const { FakeXHR, instances } = fakeXhrFactory(() => {});
  await assert.rejects(
    uploadProductImage(new File([new Uint8Array(4)], "lent.jpg"), { XHR: FakeXHR, stallTimeoutMs: 20 }),
    (err) => err.kind === "timeout" && /conexiune lentă/.test(err.message)
  );
  assert.equal(instances[0].aborted, true);

  const controller = new AbortController();
  const pending = uploadProductImage(new File([new Uint8Array(4)], "a.jpg"), { XHR: FakeXHR, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (err) => err.kind === "aborted");
});

test("uploadProductImageWithRetry (ProductModal / asistent): reîncearcă 503, nu reîncearcă 415", async () => {
  let n = 0;
  const url = await uploadProductImageWithRetry(new File([new Uint8Array(4)], "a.jpg"), {
    sleep: async () => {},
    upload: async () => {
      n += 1;
      if (n < 3) throw new ProductImageUploadError({ kind: "http", status: 503 });
      return { url: "https://cdn/a.jpg" };
    },
  });
  assert.equal(url, "https://cdn/a.jpg");
  assert.equal(n, 3);

  let m = 0;
  await assert.rejects(
    uploadProductImageWithRetry(new File([new Uint8Array(4)], "b.jpg"), {
      sleep: async () => {},
      upload: async () => {
        m += 1;
        throw new ProductImageUploadError({ kind: "http", status: 415 });
      },
    }),
    (err) => err.status === 415
  );
  assert.equal(m, 1);
});
