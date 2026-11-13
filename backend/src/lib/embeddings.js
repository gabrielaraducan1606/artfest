// backend/src/lib/embeddings.js
//
// Embedding-uri de imagine cu modelul CLIP (Xenova/clip-vit-base-patch32).
//
// OPRIT IMPLICIT (2026-11-13, instanța Render de 512 MB): modelul ocupă
// ~650 MB RAM la prima încărcare și rămâne în memorie - singur depășește
// instanța. Căutarea vizuală din aplicație se face prin Asistentul AI
// (/api/assistant/products/search-by-image), fără CLIP; ruta publică veche
// răspunde 410 (publicProductRoutes.js).
//
// Codul și fișierele modelului sunt PĂSTRATE pentru o reimplementare viitoare
// (ex. un serviciu separat cu mai multă memorie). Protecții:
//  - biblioteca `@huggingface/transformers` NU se mai importă la pornirea
//    serverului (import dinamic, doar la cerere) - economie ~15 MB RSS;
//  - modelul se încarcă DOAR cu CLIP_MODEL_ENABLED=1 (ex. scriptul de
//    backfill rulat manual, pe o mașină cu memorie suficientă); altfel orice
//    apel întoarce embedding gol, fără să atingă modelul.

import sharp from "sharp";
import { Blob } from "buffer";
import { IMAGE_SEARCH_MAX_PIXELS } from "../middleware/imageSearchUpload.js";

let extractorPromise = null;
let transformersPromise = null;
let modelLoadAttempts = 0;

/** Modelul CLIP poate fi încărcat? Doar la activare explicită. */
export function clipModelEnabled(env = process.env) {
  return env.CLIP_MODEL_ENABLED === "1";
}

/** Diagnostic / teste: de câte ori s-a încercat încărcarea reală a modelului. */
export function clipModelLoadAttempts() {
  return modelLoadAttempts;
}

export class ClipModelDisabledError extends Error {
  constructor() {
    super("Modelul CLIP este dezactivat (CLIP_MODEL_ENABLED != 1).");
    this.name = "ClipModelDisabledError";
    this.code = "clip_model_disabled";
  }
}

function loadTransformers() {
  if (!transformersPromise) transformersPromise = import("@huggingface/transformers");
  return transformersPromise;
}

async function getExtractor() {
  if (!clipModelEnabled()) throw new ClipModelDisabledError();
  if (!extractorPromise) {
    modelLoadAttempts += 1;
    extractorPromise = loadTransformers().then(({ pipeline }) =>
      pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32")
    );
    // o încercare eșuată nu blochează una ulterioară
    extractorPromise.catch(() => {
      extractorPromise = null;
    });
  }
  return extractorPromise;
}

function zeroEmbedding() {
  return new Float32Array(512).fill(0);
}

export async function imageToEmbedding(buffer) {
  // modelul oprit: nici nu decodăm imaginea (embedding gol = „nu s-a putut calcula”)
  if (!clipModelEnabled()) {
    console.warn("[clip] modelul CLIP e dezactivat (CLIP_MODEL_ENABLED != 1) - embedding gol.");
    return zeroEmbedding();
  }

  let jpeg;

  try {
    // a doua barieră (prima: middleware/imageSearchUpload.js, din header): peste
    // plafon sharp refuză înainte de decodare -> embedding gol (răspunsul existent)
    jpeg = await sharp(buffer, { failOnError: false, limitInputPixels: IMAGE_SEARCH_MAX_PIXELS })
      .rotate()
      .resize(224, 224, {
        fit: "cover",
        position: "centre",
      })
      .removeAlpha()
      .toColourspace("srgb")
      .jpeg({
        quality: 70,
        mozjpeg: true,
      })
      .toBuffer();
  } catch (err) {
    console.error("sharp error:", err);
    return zeroEmbedding();
  }

  let extractor;
  try {
    extractor = await getExtractor();
  } catch (err) {
    console.error("pipeline load error:", err);
    return zeroEmbedding();
  }

  try {
    const { RawImage } = await loadTransformers();
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    const img = await RawImage.read(blob);

    const out = await extractor(img, {
      pooling: "mean",
      normalize: true,
    });

    const arr = out?.data;
    if (!arr || !arr.length) {
      console.error("CLIP extract error: empty embedding");
      return zeroEmbedding();
    }

    let norm = 0;
    for (let i = 0; i < arr.length; i++) {
      norm += arr[i] * arr[i];
    }

    norm = Math.sqrt(norm) || 1;

    for (let i = 0; i < arr.length; i++) {
      arr[i] /= norm;
    }

    return arr;
  } catch (err) {
    console.error("CLIP extract error:", err);
    return zeroEmbedding();
  }
}

export function isAllZeroEmbedding(arr) {
  if (!arr?.length) return true;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) return false;
  }
  return true;
}

export function toPgVectorLiteral(floatArray) {
  return `[${Array.from(floatArray).join(",")}]`;
}