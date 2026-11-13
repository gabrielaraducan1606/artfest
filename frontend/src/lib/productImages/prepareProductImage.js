// src/lib/productImages/prepareProductImage.js
//
// Pregătirea unei fotografii ÎNAINTE de upload, în browser:
//  - fotografiile mari (latura > 2400 px sau > 4 MB) sunt micșorate la
//    2400 px pe latura lungă (aceeași limită ca serverul - deci fără pierdere
//    de claritate în Product Details) și codate JPEG 0,9;
//  - proporțiile se păstrează; orientarea EXIF e aplicată
//    (imageOrientation: "from-image"); canvas-ul NU copiază metadatele
//    (EXIF, GPS, model telefon);
//  - transparența devine fundal alb (ca pe server);
//  - fotografiile deja potrivite (JPEG/PNG/WEBP mici) se trimit NEATINSE:
//    serverul le codează o singură dată -> fără compresie repetată;
//  - HEIC/HEIF: dacă browserul îl poate decoda (Safari), îl convertim aici;
//    altfel originalul merge la server, care îl convertește;
//  - orice eșec / timp depășit -> originalul (serverul procesează oricum).
//
// Memorie (telefoane): apelantul procesează O SINGURĂ fotografie odată
// (productImageQueue.js); bitmap-ul și canvas-ul sunt eliberate imediat.

export const TARGET_MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.9;
export const PROCESS_ABOVE_BYTES = 4 * 1024 * 1024;
export const DECODE_TIMEOUT_MS = 20_000;

// formate trimise ca atare dacă sunt deja mici (serverul le decodează nativ)
const PASSTHROUGH_KINDS = new Set(["jpeg", "png", "webp"]);
// formate pe care nu le atingem în browser (animație, decodare incertă)
const NEVER_PROCESS_KINDS = new Set(["gif"]);

/** Dimensiunea țintă (latura lungă max `maxEdge`, fără mărire). */
export function targetDimensions(width, height, maxEdge = TARGET_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const ratio = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

/**
 * Trebuie fotografia procesată în browser?
 * @param {{ kind: string, size: number, width?: number, height?: number }} info
 */
export function shouldProcessInBrowser({ kind, size, width, height }) {
  if (NEVER_PROCESS_KINDS.has(kind)) return false;
  if (!PASSTHROUGH_KINDS.has(kind)) return true; // HEIC / AVIF / BMP / TIFF -> JPEG dacă browserul poate
  if (Number(size) > PROCESS_ABOVE_BYTES) return true;
  if (width && height && Math.max(width, height) > TARGET_MAX_EDGE) return true;
  return false;
}

/** Numele fișierului rezultat (.jpg). */
export function jpegFileName(name) {
  const base = String(name || "").replace(/\.[^.]+$/, "").trim();
  return `${base || "fotografie"}.jpg`;
}

function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function decodeBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* încercăm prin <img> mai jos */
    }
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") throw new Error("NO_DECODER");

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
      image.src = url;
    });
    // <img> aplică orientarea EXIF (image-orientation: from-image implicit)
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToJpeg(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/**
 * @param {File} file
 * @param {{ kind: string }} info tipul real (sniffImageKind)
 * @returns {Promise<{ file: File|Blob, processed: boolean, width?: number, height?: number }>}
 */
export async function prepareProductImage(file, { kind } = {}) {
  if (!file || NEVER_PROCESS_KINDS.has(kind)) return { file, processed: false };

  let bitmap = null;
  let canvas = null;
  try {
    bitmap = await withTimeout(decodeBitmap(file), DECODE_TIMEOUT_MS, "DECODE_TIMEOUT");

    // mică, format nativ și sub 2400 px: originalul (serverul o codează o singură dată)
    if (!shouldProcessInBrowser({ kind, size: file.size, width: bitmap.width, height: bitmap.height })) {
      return { file, processed: false, width: bitmap.width, height: bitmap.height };
    }

    const { width, height } = targetDimensions(bitmap.width, bitmap.height);
    canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return { file, processed: false };

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap.source || bitmap, 0, 0, width, height);

    const blob = await withTimeout(canvasToJpeg(canvas), DECODE_TIMEOUT_MS, "ENCODE_TIMEOUT");
    if (!blob || !blob.size) return { file, processed: false };

    // JPEG/PNG/WEBP deja în limită și mai mici decât rezultatul: originalul e mai bun
    const sameSize = width === bitmap.width && height === bitmap.height;
    if (PASSTHROUGH_KINDS.has(kind) && sameSize && blob.size >= file.size) {
      return { file, processed: false, width, height };
    }

    const name = jpegFileName(file.name);
    const out = typeof File === "function" ? new File([blob], name, { type: "image/jpeg" }) : blob;
    return { file: out, processed: true, width, height };
  } catch {
    // HEIC în Chrome, memorie insuficientă, timp depășit: serverul procesează originalul
    return { file, processed: false };
  } finally {
    bitmap?.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
