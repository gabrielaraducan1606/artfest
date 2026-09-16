// backend/src/services/r2Storage.js

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET_NAME
) {
  console.warn(
    "[R2] Env incomplet. Verifică R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."
  );
}

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export function buildPublicUrl(key) {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
  }

  return `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

/**
 * URL semnat, cu expirare scurtă, generat DOAR după ce apelantul a
 * verificat ownership/admin access (vezi influencerFilesRoutes.js,
 * adminInfluencersRoutes.js) - pentru documente sensibile care NU
 * trebuie expuse ca URL public permanent (ex. InfluencerFile).
 *
 * Nu ține cont de R2_PUBLIC_BASE_URL - semnează direct pe endpointul
 * S3-compatible al R2, folosind aceleași credențiale server-side deja
 * configurate (niciun secret nu ajunge în frontend).
 */
export async function getSignedDownloadUrl({
  key,
  filename,
  expiresInSeconds = 300,
}) {
  const safeFilename = filename
    ? String(filename).replace(/["\r\n]/g, "")
    : undefined;

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,

    ResponseContentDisposition: safeFilename
      ? `attachment; filename="${safeFilename}"`
      : undefined,
  });

  return getSignedUrl(r2Client, command, {
    expiresIn: expiresInSeconds,
  });
}

export function sanitizeFileName(name = "file") {
  const safe = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "file";
}

export function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

/* =========================================================
   DETECȚIE REALĂ A TIPULUI DE FIȘIER (magic bytes)

   NU ne bazăm pe file.mimetype (declarat de client, ușor de
   falsificat) sau doar pe extensie - citim semnătura reală din
   buffer. Folosit ca a doua barieră, DUPĂ ce sharp încearcă
   decodarea ca imagine (vezi uploadToR2 mai jos).

   Acoperă exact tipurile deja acceptate undeva în aplicație
   (uploadRoutes.js, influencerFilesRoutes.js,
   influencerPayoutsRoutes.js, adminInfluencerResourcesRoutes.js) -
   NU extinde lista de formate acceptate (ex. SVG rămâne exclus
   intenționat - nu apare în nicio whitelist existentă).
========================================================= */

const ISO_BMFF_HEIC_BRANDS = new Set([
  "heic", "heix", "heim", "heis",
  "hevc", "hevx", "hevm", "hevs",
  "mif1", "msf1",
]);

const ISO_BMFF_AVIF_BRANDS = new Set(["avif", "avis"]);

/*
 * Sharp decodează nativ jpeg/png/webp/gif - dacă semnătura reală e
 * una dintre acestea DAR sharp tot a eșuat mai sus, fișierul e
 * corupt sau un polyglot (payload ascuns după un header valid) -
 * NU acceptăm fallback pentru aceste tipuri, doar pentru cele pe
 * care sharp nu are treabă să le decodeze (document/video/etc.).
 */
const STRICT_SHARP_KINDS = new Set(["jpeg", "png", "webp", "gif"]);

function readAscii(buf, start, end) {
  return buf.toString("ascii", start, Math.min(end, buf.length));
}

function looksLikeXml(buf) {
  let offset = 0;

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    offset = 3; // BOM UTF-8
  }

  const head = buf
    .toString("utf8", offset, Math.min(offset + 200, buf.length))
    .trimStart();

  return /^<\?xml[\s?]/i.test(head);
}

function looksLikePlainText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));

  if (sample.includes(0)) return false; // byte null -> conținut binar

  let printable = 0;
  for (const byte of sample) {
    if (
      byte === 9 || byte === 10 || byte === 13 ||
      (byte >= 32 && byte <= 126) ||
      byte >= 128
    ) {
      printable += 1;
    }
  }

  if (sample.length && printable / sample.length < 0.95) return false;

  const head = sample
    .toString("utf8", 0, Math.min(sample.length, 300))
    .trimStart()
    .toLowerCase();

  /*
   * Respinge HTML/JS mascat sub extensia .txt (vector XSS stocat
   * dacă fișierul e vreodată deschis direct din browser).
   */
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.includes("<script")
  ) {
    return false;
  }

  return true;
}

export function detectRealFileKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: "jpeg", mime: "image/jpeg", exts: ["jpg", "jpeg", "jfif"] };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { kind: "png", mime: "image/png", exts: ["png"] };
  }

  if (
    buffer.length >= 12 &&
    readAscii(buffer, 0, 4) === "RIFF" &&
    readAscii(buffer, 8, 12) === "WEBP"
  ) {
    return { kind: "webp", mime: "image/webp", exts: ["webp"] };
  }

  if (
    buffer.length >= 6 &&
    (readAscii(buffer, 0, 6) === "GIF87a" || readAscii(buffer, 0, 6) === "GIF89a")
  ) {
    return { kind: "gif", mime: "image/gif", exts: ["gif"] };
  }

  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { kind: "bmp", mime: "image/bmp", exts: ["bmp"] };
  }

  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return { kind: "tiff", mime: "image/tiff", exts: ["tif", "tiff"] };
  }

  if (buffer.length >= 12 && readAscii(buffer, 4, 8) === "ftyp") {
    const brand = readAscii(buffer, 8, 12).trim().toLowerCase();

    if (ISO_BMFF_HEIC_BRANDS.has(brand)) {
      return { kind: "heic", mime: "image/heic", exts: ["heic", "heif"] };
    }

    if (ISO_BMFF_AVIF_BRANDS.has(brand)) {
      return { kind: "avif", mime: "image/avif", exts: ["avif"] };
    }

    // Orice alt brand ISO-BMFF (isom/mp41/mp42/avc1/qt...) -> MP4/video.
    return { kind: "mp4", mime: "video/mp4", exts: ["mp4"] };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  ) {
    return { kind: "webm", mime: "video/webm", exts: ["webm"] };
  }

  if (readAscii(buffer, 0, 5) === "%PDF-") {
    return { kind: "pdf", mime: "application/pdf", exts: ["pdf"] };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    // ZIP - DOCX/XLSX sunt containere ZIP; nu putem distinge exact
    // formatul din magic bytes, doar confirmăm că e cu adevărat un
    // pachet Office (nu un ZIP oarecare redenumit).
    return { kind: "zip-office", mime: null, exts: ["docx", "xlsx"] };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1
  ) {
    // OLE2/CFB - format legacy DOC/XLS.
    return { kind: "ole2", mime: null, exts: ["doc", "xls"] };
  }

  if (looksLikeXml(buffer)) {
    return { kind: "xml", mime: "application/xml", exts: ["xml"] };
  }

  if (looksLikePlainText(buffer)) {
    return { kind: "text", mime: "text/plain", exts: ["txt"] };
  }

  return null;
}

function resolveMimeForDetectedKind(detected, declaredExt) {
  if (detected.mime) return detected.mime;

  if (detected.kind === "zip-office") {
    return declaredExt === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (detected.kind === "ole2") {
    return declaredExt === "xls"
      ? "application/vnd.ms-excel"
      : "application/msword";
  }

  return "application/octet-stream";
}

/**
 * Extras identic din backend/src/routes/uploadRoutes.js - comportamentul
 * (resize/convert JPEG cu fallback la fișierul original, structura cheii
 * R2) rămâne neschimbat pentru imagini reale. Orice apelant existent al
 * acelei rute continuă să primească exact același rezultat pentru un
 * upload legitim.
 *
 * SIGURANȚĂ (vezi audit): NU se mai are încredere în file.mimetype
 * (declarat de client) când sharp nu poate decoda imaginea - bufferul
 * e verificat prin semnătura reală (magic bytes, detectRealFileKind
 * mai sus) înainte de a fi urcat ca atare pe R2. Dacă semnătura reală
 * nu corespunde extensiei declarate (sau nu e recunoscută deloc),
 * upload-ul e respins.
 */
export async function uploadToR2({
  file,
  folder,
  userId,
  index = null,
}) {
  const originalMime = file.mimetype || "application/octet-stream";
  const originalName = file.originalname || "file";

  let body = file.buffer;
  let mime = originalMime;

  let safeOriginalName = sanitizeFileName(
    originalName.replace(/\.[^.]+$/, ".jpg")
  );

  try {
    body = await sharp(file.buffer, {
      failOn: "none",
      animated: false,
      limitInputPixels: false,
    })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 88,
        mozjpeg: true,
      })
      .toBuffer();

    mime = "image/jpeg";
  } catch (err) {
    console.error("[UPLOAD] Sharp convert failed, checking real file signature:", {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      error: err?.message || err,
    });

    const detected = detectRealFileKind(file.buffer);
    const declaredExt = getFileExtension(originalName);

    const rejected =
      !detected ||
      STRICT_SHARP_KINDS.has(detected.kind) ||
      !detected.exts.includes(declaredExt);

    if (rejected) {
      console.warn("[UPLOAD] Rejected - content does not match a known/allowed file type:", {
        originalname: file.originalname,
        mimetype: file.mimetype,
        declaredExt,
        detectedKind: detected?.kind || null,
      });

      const rejectionError = new Error("UPLOAD_CONTENT_MISMATCH");
      rejectionError.code = "upload_content_mismatch";
      throw rejectionError;
    }

    body = file.buffer;
    mime = resolveMimeForDetectedKind(detected, declaredExt);
    safeOriginalName = sanitizeFileName(originalName);
  }

  const timestamp = Date.now();
  const indexPart =
    index === null || index === undefined ? "" : `${index}-`;

  const key = `${folder}/${userId}/${timestamp}-${indexPart}${safeOriginalName}`;

  const putCommand = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: mime,
    CacheControl: "public, max-age=31536000, immutable",
  });

  console.info("[UPLOAD] Start R2 upload:", {
    folder,
    userId,
    key,
    originalMime,
    finalMime: mime,
    originalSize: file.size,
    finalSize: body.length,
    originalname: file.originalname,
    convertedToJpeg: mime === "image/jpeg",
  });

  await r2Client.send(putCommand);

  console.info("[UPLOAD] R2 upload success:", {
    folder,
    userId,
    key,
  });

  return {
    url: buildPublicUrl(key),
    key,
    name: safeOriginalName,
    size: body.length,
    mimeType: mime,
  };
}
