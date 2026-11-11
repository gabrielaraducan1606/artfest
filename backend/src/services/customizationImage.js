// backend/src/services/customizationImage.js
//
// Fotografiile trimise de client la personalizarea unui produs
// (POST /api/upload/customization - rută publică, merge și pentru guest).
//
// Spre deosebire de uploadToR2 (r2Storage.js, folosit de produse/avatar/
// suport/importuri și lăsat NESCHIMBAT), aici:
//   - tipul e stabilit DOAR din conținut (magic bytes + decodare sharp),
//     nu din MIME-ul / extensia trimise de browser;
//   - NU există fallback la fișierul brut: dacă sharp nu decodează
//     imaginea, upload-ul e refuzat (altfel XML/PDF/MP4/TXT ajungeau
//     publici pe domeniul R2);
//   - limită de pixeli verificată din header, înainte de decodare;
//   - transparența devine fundal alb (nu negru);
//   - ieșirea e mereu JPEG re-encodat, fără EXIF/GPS (sharp nu copiază
//     metadatele decât la cerere explicită - keepMetadata/withMetadata).

import crypto from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import {
  r2Client,
  buildPublicUrl,
  sanitizeFileName,
  detectRealFileKind,
  pixelLimitForHeader,
} from "./r2Storage.js";

const { R2_BUCKET_NAME } = process.env;

export const CUSTOMIZATION_MAX_BYTES = 10 * 1024 * 1024;

/* 60 MP acoperă fotografiile de telefon la rezoluție maximă (48-50 MP). */
export const CUSTOMIZATION_MAX_PIXELS = 60_000_000;

/*
 * Formatele decodate integral în memorie (JPEG progresiv, PNG întrețesut,
 * AVIF) primesc o limită mai mică - vezi pixelLimitForHeader (r2Storage.js)
 * pentru valorile măsurate.
 */

export const CUSTOMIZATION_FORMATS_LABEL = "JPG, PNG, WEBP sau AVIF";

const OUTPUT_MAX_SIDE = 2400;

/*
 * Câte decodări rulează simultan (restul așteaptă la rând). Măsurat local
 * la 60 MP: JPEG ~+60 MB, PNG RGBA ~+160 MB per fotografie; fără coadă,
 * 3 PNG-uri simultane urcau RSS-ul cu ~425 MB.
 */
const MAX_CONCURRENT_DECODES = Math.max(
  1,
  Number(process.env.CUSTOMIZATION_IMAGE_CONCURRENCY || 2)
);

/*
 * Câte așteaptă la rând înainte de a răspunde 503 (server ocupat), în loc
 * să ținem în memorie un număr nelimitat de fotografii de câte 10 MB.
 */
const MAX_QUEUED_DECODES = Math.max(
  0,
  Number(process.env.CUSTOMIZATION_IMAGE_MAX_QUEUE ?? 6)
);

let activeDecodes = 0;
const decodeQueue = [];

export function decodeQueueStats() {
  return { active: activeDecodes, queued: decodeQueue.length };
}

async function withDecodeSlot(fn) {
  if (activeDecodes >= MAX_CONCURRENT_DECODES) {
    if (decodeQueue.length >= MAX_QUEUED_DECODES) {
      throw serverBusy();
    }

    // locul e predat direct de cel care termină (activeDecodes rămâne la fel)
    await new Promise((resolve) => decodeQueue.push(resolve));
  } else {
    activeDecodes += 1;
  }

  try {
    return await fn();
  } finally {
    const next = decodeQueue.shift();

    if (next) next();
    else activeDecodes -= 1;
  }
}

/* kind din detectRealFileKind -> format raportat de sharp.metadata() */
const ACCEPTED_KINDS = {
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "heif",
};

export class CustomizationImageError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "CustomizationImageError";
    this.code = code;
    this.status = status;
  }
}

const invalidImage = () =>
  new CustomizationImageError(
    "invalid_image",
    415,
    `Fișierul nu este o fotografie acceptată. Folosește ${CUSTOMIZATION_FORMATS_LABEL}.`
  );

const heicNotSupported = () =>
  new CustomizationImageError(
    "heic_not_supported",
    415,
    "Fotografiile HEIC/HEIF nu pot fi procesate momentan. Salvează fotografia ca JPG sau PNG și încearcă din nou."
  );

function serverBusy() {
  const error = new CustomizationImageError(
    "server_busy",
    503,
    "Serverul procesează acum multe fotografii. Încearcă din nou peste câteva secunde."
  );
  error.retryAfterSeconds = 5;
  return error;
}

const corruptImage = () =>
  new CustomizationImageError(
    "image_corrupt",
    422,
    "Fotografia pare deteriorată și nu poate fi citită. Alege altă fotografie."
  );

async function readHeader(buffer) {
  try {
    // doar header-ul, fără decodare -> limita de pixeli o verificăm noi
    return await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    return null;
  }
}

/**
 * Validează și re-encodează fotografia. Întoarce { buffer, width, height,
 * sourceFormat } sau aruncă CustomizationImageError. Folosit de
 * personalizare și de imaginile din recenzii (aceleași reguli).
 *
 * Opțiuni (mesaje): maxBytes - altă limită de mărime; allowGif - GIF
 * acceptat, păstrat doar primul cadru (moderat și salvat ca JPEG).
 */
export async function processSafeImage(
  buffer,
  { maxBytes = CUSTOMIZATION_MAX_BYTES, allowGif = false } = {}
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new CustomizationImageError(
      "empty_file",
      400,
      "Fișierul trimis este gol. Alege altă fotografie."
    );
  }

  if (buffer.length > maxBytes) {
    throw new CustomizationImageError(
      "file_too_large",
      413,
      `Fișierul este prea mare (max ${Math.round(maxBytes / 1048576)}MB).`
    );
  }

  const detected = detectRealFileKind(buffer);

  if (!detected) {
    throw invalidImage();
  }

  let kind = detected.kind;
  const header = await readHeader(buffer);

  /*
   * detectRealFileKind clasifică brandul ISO-BMFF generic "mif1" ca HEIC,
   * dar îl folosesc și unele AVIF-uri - decide compresia reală (av1).
   */
  if (kind === "heic") {
    if (header?.format === "heif" && header?.compression === "av1") {
      kind = "avif";
    } else {
      throw heicNotSupported();
    }
  }

  if (kind === "avif" && header?.format === "heif" && header?.compression !== "av1") {
    throw heicNotSupported();
  }

  const expectedFormat = allowGif && kind === "gif" ? "gif" : ACCEPTED_KINDS[kind];

  if (!expectedFormat) {
    throw invalidImage();
  }

  if (!header || header.format !== expectedFormat || !header.width || !header.height) {
    throw corruptImage();
  }

  const pixelLimit = pixelLimitForHeader(header, CUSTOMIZATION_MAX_PIXELS);

  if (header.width * header.height > pixelLimit) {
    throw new CustomizationImageError(
      "image_too_many_pixels",
      422,
      `Fotografia are o rezoluție prea mare (maxim ${pixelLimit / 1_000_000} MP pentru acest format). Micșorează-o sau salveaz-o ca JPG și încearcă din nou.`
    );
  }

  try {
    const { data, info } = await withDecodeSlot(() =>
      sharp(buffer, {
        failOn: "error",
        animated: false,
        limitInputPixels: pixelLimit,
      })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({
          width: OUTPUT_MAX_SIDE,
          height: OUTPUT_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
    );

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      sourceFormat: kind,
    };
  } catch (error) {
    if (error instanceof CustomizationImageError) throw error;
    throw corruptImage();
  }
}

export const processCustomizationImage = processSafeImage;

/**
 * Procesează și urcă pe R2. Cheia păstrează structura de până acum:
 * customizations/<userId|guest-…>/<timestamp>-<nume>.jpg
 */
export async function uploadCustomizationImage({ buffer, originalname, ownerId }) {
  const processed = await processCustomizationImage(buffer);

  const baseName = String(originalname || "fotografie").replace(/\.[^.]*$/, "");
  const safeName = sanitizeFileName(`${baseName || "fotografie"}.jpg`);
  const key = `customizations/${ownerId}/${Date.now()}-${safeName}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: processed.buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  console.info("[UPLOAD] customization stored:", {
    key,
    sourceFormat: processed.sourceFormat,
    originalSize: buffer.length,
    finalSize: processed.buffer.length,
  });

  return {
    url: buildPublicUrl(key),
    key,
    name: safeName,
    size: processed.buffer.length,
    mimeType: "image/jpeg",
    width: processed.width,
    height: processed.height,
  };
}

export function newGuestUploaderId() {
  return `guest-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}
