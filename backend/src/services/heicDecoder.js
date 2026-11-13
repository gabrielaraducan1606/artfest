// backend/src/services/heicDecoder.js
//
// Conversia fotografiilor HEIC / HEIF (iPhone, Samsung „imagini cu eficiență
// ridicată”) într-un format afișabil în orice browser.
//
// DE CE: sharp-ul nostru (binarele precompilate) are libheif DOAR cu AV1
// (AVIF) - nu decodează HEVC. Fără conversie, un HEIC ar fi urcat brut pe R2
// (image/heic): vizibil doar în Safari, nu în Chrome / Firefox / Android.
//
// Decodorul: pachetul npm `heic-decode` (libheif compilat în WebAssembly,
// gratuit, local - fără serviciu extern). Dacă lipsește, `decodeHeic`
// întoarce `null`, iar apelantul refuză fișierul cu un mesaj clar.
//
// SIGURANȚĂ (măsurat local, 2026-11-13):
//  - memoria WASM NU se eliberează în proces după decodare (45 MP: ~665 MB
//    rămași după GC) -> fiecare fotografie se decodează într-un WORKER separat
//    (heicDecodeWorker.js), oprit imediat după; memoria pleacă odată cu el;
//  - vârful e ~13-14 MB per megapixel (45 MP ≈ 630 MB, 0,9 MP ≈ 30 MB) ->
//    plafon propriu HEIC_DECODE_MAX_PIXELS (implicit 16 MP), verificat de
//    worker din container ÎNAINTE de alocarea pixelilor;
//  - o singură decodare HEIC odată în proces (coadă), oricare ar fi ruta;
//  - termen HEIC_DECODE_TIMEOUT_MS (implicit 60 s) -> worker-ul e oprit.
//
// libheif aplică transformările din container (rotire / oglindire „irot” /
// „imir”), deci orientarea rezultatului e cea corectă, fără EXIF.

import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

export const DEFAULT_HEIC_DECODE_MAX_PIXELS = 16_000_000;
export const DEFAULT_HEIC_DECODE_TIMEOUT_MS = 60_000;

function envPositiveInt(env, name, fallback) {
  const value = Number.parseInt(env?.[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function heicDecodeMaxPixels(env = process.env) {
  return envPositiveInt(env, "HEIC_DECODE_MAX_PIXELS", DEFAULT_HEIC_DECODE_MAX_PIXELS);
}

export function heicDecodeTimeoutMs(env = process.env) {
  return envPositiveInt(env, "HEIC_DECODE_TIMEOUT_MS", DEFAULT_HEIC_DECODE_TIMEOUT_MS);
}

export class HeicDecodeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function tooManyPixels(maxPixels) {
  const error = new HeicDecodeError("image_too_many_pixels", "HEIC peste plafonul de decodare");
  error.maxPixels = maxPixels;
  return error;
}

/* ---------------- decodorul (worker sau injectat în teste) ---------------- */

let decoderOverride; // doar pentru teste: funcție ({ buffer }) => { width, height, data } sau null

/** Teste: injectează un decodor (sau `null` = „nu e instalat”); `undefined` = cel real. */
export function __setHeicDecoderForTests(decoder) {
  decoderOverride = decoder;
}

let installed = null;
/** heic-decode e instalat? (fără să încarce WASM-ul în procesul principal) */
export function heicDecoderInstalled() {
  if (decoderOverride !== undefined) return Boolean(decoderOverride);
  if (installed === null) {
    try {
      createRequire(import.meta.url).resolve("heic-decode");
      installed = true;
    } catch {
      installed = false;
      console.warn("[UPLOAD] heic-decode nu e instalat - fotografiile HEIC/HEIF vor fi refuzate.");
    }
  }
  return installed;
}

// o singură decodare HEIC odată în proces (memorie)
let chain = Promise.resolve();
function exclusive(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

function decodeInWorker(buffer, { maxPixels, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // copie proprie, transferată worker-ului (bufferul cererii rămâne neatins)
    const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const worker = new Worker(new URL("./heicDecodeWorker.js", import.meta.url), {
      workerData: { buffer: copy, maxPixels },
      transferList: [copy],
    });

    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // oprirea worker-ului eliberează memoria WASM
      worker.terminate().catch(() => {});
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, new HeicDecodeError("heic_decode_timeout", "Decodarea HEIC a depășit termenul")),
      timeoutMs
    );

    worker.once("message", (message) => {
      if (message?.ok) {
        finish(resolve, { width: message.width, height: message.height, data: Buffer.from(message.data) });
      } else if (message?.unavailable) {
        installed = false;
        finish(resolve, null);
      } else if (message?.tooLarge) {
        finish(reject, tooManyPixels(maxPixels));
      } else {
        finish(reject, new HeicDecodeError("heic_decode_failed", message?.message || "HEIC corupt"));
      }
    });
    worker.once("error", (error) =>
      finish(reject, new HeicDecodeError("heic_decode_failed", error?.message || "Worker HEIC eșuat"))
    );
    worker.once("exit", (code) => {
      if (!done) finish(reject, new HeicDecodeError("heic_decode_failed", `Worker HEIC oprit (${code})`));
    });
  });
}

/**
 * HEIC/HEIF -> pixeli RGBA { data: Buffer, width, height, channels: 4 } sau
 * `null` dacă decodorul nu e instalat. Aruncă HeicDecodeError:
 * image_too_many_pixels | heic_decode_failed | heic_decode_timeout.
 *
 * @param {Buffer} buffer
 * @param {{ width?: number, height?: number, maxPixels?: number, timeoutMs?: number }} [options]
 *   width/height din header (sharp.metadata) - verificate înainte de pornirea worker-ului
 */
export async function decodeHeic(
  buffer,
  { width, height, maxPixels = heicDecodeMaxPixels(), timeoutMs = heicDecodeTimeoutMs() } = {}
) {
  if (width && height && width * height > maxPixels) throw tooManyPixels(maxPixels);
  if (!heicDecoderInstalled()) return null;

  // maximum O decodare HEIC odată în proces (și cu decodorul injectat în teste)
  const image = await exclusive(() =>
    decoderOverride !== undefined
      ? Promise.resolve(decoderOverride({ buffer })).catch((error) => {
          throw new HeicDecodeError("heic_decode_failed", error?.message || "HEIC corupt");
        })
      : decodeInWorker(buffer, { maxPixels, timeoutMs })
  );

  if (!image) return null;

  const w = Number(image.width);
  const h = Number(image.height);
  if (!w || !h || !image.data) throw new HeicDecodeError("heic_decode_failed", "HEIC fără date de imagine");
  if (w * h > maxPixels) throw tooManyPixels(maxPixels);

  const data = Buffer.isBuffer(image.data)
    ? image.data
    : Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  if (data.length !== w * h * 4) throw new HeicDecodeError("heic_decode_failed", "HEIC cu dimensiuni neconcordante");

  return { data, width: w, height: h, channels: 4 };
}
