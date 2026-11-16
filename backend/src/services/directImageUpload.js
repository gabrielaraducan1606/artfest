// backend/src/services/directImageUpload.js
//
// Upload DIRECT în Cloudflare R2 pentru fotografiile deja optimizate în
// browser (max 2400 px, JPEG, fără metadate): fișierul NU mai trece prin
// Render / Vercel, deci nu consumă CPU (recodare mozjpeg) sau RAM pe server.
//
//   1. POST /api/upload/direct/intent   -> URL PUT semnat (10 min) pentru o
//      cheie TEMPORARĂ generată de server:
//        staging/direct-images/<scop>/<userId>/<uuid>.jpg
//      Semnătura fixează Content-Type (image/jpeg) și Content-Length.
//   2. browserul încarcă fișierul DIRECT în R2 (PUT);
//   3. POST /api/upload/direct/complete { purpose, uploadId } -> serverul
//      reconstruiește cheia din utilizatorul AUTENTIFICAT (nu din ce trimite
//      clientul), citește obiectul (max 10 MB, fără decodare completă),
//      verifică semnătura reală JPEG, dimensiunile, lipsa EXIF și integritatea,
//      apoi îl scrie în locația DEFINITIVĂ, compatibilă cu URL-urile existente:
//        product        -> products/<userId>/<uuid>.jpg
//        fair-reception -> artfest-fair-reception/<userId>/<uuid>.jpg
//      și șterge cheia temporară. Repetarea confirmării e idempotentă (același URL).
//
// Fișierele care NU sunt deja „web-ready” (EXIF, > 2400 px, alt format) sunt
// refuzate cu `fallback: true`: browserul le trimite pe ruta veche
// POST /api/upload/products (procesare pe server) - cheia temporară e ștearsă,
// deci nu rămân dubluri. Încărcările abandonate (fără confirmare) sunt șterse
// de regula de ciclu de viață R2 pe prefixul staging/ (configurare Cloudflare).
//
// Comutator: DIRECT_IMAGE_UPLOAD_ENABLED=1 (implicit OPRIT -> 404
// direct_upload_disabled, iar browserul folosește ruta veche).

import crypto from "node:crypto";
import sharp from "sharp";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildPublicUrl, detectRealFileKind, r2Client } from "./r2Storage.js";

const MB = 1024 * 1024;

export const DIRECT_IMAGE_MAX_BYTES = 10 * MB;
export const DIRECT_IMAGE_MIN_BYTES = 128;
export const DIRECT_IMAGE_MAX_EDGE = 2400;
export const DIRECT_UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DIRECT_STAGING_PREFIX = "staging/direct-images";
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/*
 * Scopurile permise: cine le poate folosi (rol din BAZA DE DATE, nu din token)
 * și folderul DEFINITIV - același cu al rutelor vechi, deci URL-urile trec
 * validările existente (isAllowedManualImageUrl, validatePhotoUrls).
 */
export const DIRECT_UPLOAD_PURPOSES = Object.freeze({
  // fotografii de produs (marketplace) + produsul manual din inventarul Târgului
  product: Object.freeze({ roles: ["VENDOR", "ADMIN"], finalFolder: "products" }),
  // recepția Târgului (Admin): refuz / deteriorare
  "fair-reception": Object.freeze({ roles: ["ADMIN"], finalFolder: "artfest-fair-reception" }),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class DirectUploadError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message mesaj pentru vânzător (RO)
   * @param {{ fallback?: boolean, retryAfterSeconds?: number }} [extra]
   *   fallback: browserul trimite fișierul pe ruta veche (procesare pe server)
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "DirectUploadError";
    this.status = status;
    this.code = code;
    this.fallback = Boolean(extra.fallback);
    this.retryAfterSeconds = extra.retryAfterSeconds || 0;
  }
}

export function directImageUploadEnabled(env = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.DIRECT_IMAGE_UPLOAD_ENABLED || "").trim().toLowerCase());
}

/* ---------------- chei ---------------- */

function assertUserId(userId) {
  const id = String(userId || "");
  if (!USER_ID_RE.test(id)) throw new DirectUploadError(401, "unauthenticated", "Autentifică-te din nou.");
  return id;
}

export function purposeConfig(purpose) {
  const config = Object.prototype.hasOwnProperty.call(DIRECT_UPLOAD_PURPOSES, purpose)
    ? DIRECT_UPLOAD_PURPOSES[purpose]
    : null;
  if (!config) throw new DirectUploadError(400, "invalid_purpose", "Tip de încărcare necunoscut.");
  return config;
}

/** Cheile se construiesc DOAR pe server, din utilizatorul autentificat. */
export function directUploadKeys({ purpose, userId, uploadId }) {
  const config = purposeConfig(purpose);
  const uid = assertUserId(userId);
  const id = String(uploadId || "").toLowerCase();
  if (!UUID_RE.test(id)) throw new DirectUploadError(400, "invalid_upload_id", "Încărcare necunoscută.");
  return {
    stagingKey: `${DIRECT_STAGING_PREFIX}/${purpose}/${uid}/${id}.jpg`,
    finalKey: `${config.finalFolder}/${uid}/${id}.jpg`,
  };
}

function assertRole(purpose, role) {
  const config = purposeConfig(purpose);
  if (!config.roles.includes(String(role || ""))) {
    throw new DirectUploadError(403, "forbidden", "Nu ai acces la acest tip de încărcare.");
  }
}

/* ---------------- limită pe utilizator (în memorie, per instanță) ---------------- */

export function createUserRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    take(userId) {
      const t = now();
      const recent = (hits.get(userId) || []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(userId, recent);
        const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (t - recent[0])) / 1000));
        return { ok: false, retryAfterSeconds };
      }
      recent.push(t);
      hits.set(userId, recent);
      if (hits.size > 5000) {
        for (const [key, list] of hits) if (!list.some((at) => t - at < windowMs)) hits.delete(key);
      }
      return { ok: true };
    },
  };
}

function envInt(env, name, fallback) {
  const value = Number.parseInt(env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ---------------- R2 (injectabil în teste) ---------------- */

let presignClient = null;

/*
 * Client separat pentru semnare: fără suma de control implicită a SDK-ului
 * (x-amz-checksum-crc32 calculată pe corp GOL ar face PUT-ul din browser să
 * eșueze). Semnăm explicit content-type + content-length.
 */
function defaultPresignClient(env = process.env) {
  if (!presignClient) {
    presignClient = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return presignClient;
}

export function defaultDirectUploadDeps(env = process.env) {
  return {
    bucket: env.R2_BUCKET_NAME,
    send: (command, options) => r2Client.send(command, options),
    presign: (command, expiresIn) =>
      getSignedUrl(defaultPresignClient(env), command, {
        expiresIn,
        signableHeaders: new Set(["content-type", "content-length"]),
      }),
    publicUrl: buildPublicUrl,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
  };
}

function isNotFound(error) {
  const status = error?.$metadata?.httpStatusCode;
  return status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.Code === "NoSuchKey";
}

async function headOrNull(deps, key) {
  try {
    return await deps.send(new HeadObjectCommand({ Bucket: deps.bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function deleteQuietly(deps, key) {
  try {
    await deps.send(new DeleteObjectCommand({ Bucket: deps.bucket, Key: key }));
  } catch (error) {
    // regula de ciclu de viață R2 o va șterge oricum
    console.warn("[DIRECT UPLOAD] ștergerea cheii temporare a eșuat", { key, error: error?.name || error?.message });
  }
}

async function readBody(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  if (Buffer.isBuffer(body)) return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/* ---------------- verificarea conținutului ---------------- */

/**
 * Fotografia trebuie să fie EXACT ce produce optimizarea din browser: JPEG
 * real (după octeți, nu după tipul declarat), max 2400 px, fără EXIF /
 * orientare, decodabil complet. Altfel:
 *  - nu e imagine / e deteriorat -> 415 (definitiv);
 *  - e imagine, dar are nevoie de procesare (EXIF, > 2400 px, CMYK...) ->
 *    422 cu fallback: browserul o trimite pe ruta veche.
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function verifyDirectImage(buffer) {
  const invalid = () =>
    new DirectUploadError(415, "invalid_image", "Fișierul nu este o fotografie validă. Alege altă fotografie.");
  const needsProcessing = (reason) =>
    Object.assign(
      new DirectUploadError(422, "direct_upload_needs_processing", "Fotografia trebuie procesată pe server.", {
        fallback: true,
      }),
      { reason }
    );

  if (!Buffer.isBuffer(buffer) || buffer.length < DIRECT_IMAGE_MIN_BYTES) throw invalid();
  if (detectRealFileKind(buffer)?.kind !== "jpeg") {
    // altă imagine reală (PNG/HEIC...) -> server; orice altceva -> refuz
    if (detectRealFileKind(buffer)?.mime?.startsWith("image/")) throw needsProcessing("format");
    throw invalid();
  }

  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    throw invalid();
  }
  if (meta?.format !== "jpeg" || !(meta.width > 0) || !(meta.height > 0)) throw invalid();
  if (Math.max(meta.width, meta.height) > DIRECT_IMAGE_MAX_EDGE) throw needsProcessing("dimensions");
  if (meta.exif || (meta.orientation && meta.orientation !== 1)) throw needsProcessing("exif");
  if (meta.space && !["srgb", "b-w"].includes(meta.space)) throw needsProcessing("colorspace");

  // integritate: decodare COMPLETĂ a fluxului, la 1/8 (shrink-on-load JPEG) -> câțiva MB, câteva ms
  try {
    await sharp(buffer, {
      failOn: "truncated",
      limitInputPixels: DIRECT_IMAGE_MAX_EDGE * DIRECT_IMAGE_MAX_EDGE,
    })
      .resize(64, 64, { fit: "inside" })
      .raw()
      .toBuffer();
  } catch {
    throw invalid();
  }

  return { width: meta.width, height: meta.height };
}

/* ---------------- 1. intenția de upload ---------------- */

/**
 * @param {{ userId: string, role: string, purpose: string, contentType: string, size: number }} input
 * @returns {Promise<{ uploadId: string, uploadUrl: string, method: "PUT", headers: object, expiresAt: string, maxBytes: number }>}
 */
export async function createDirectUploadIntent(
  { userId, role, purpose, contentType, size },
  { deps = defaultDirectUploadDeps(), limiter = null } = {}
) {
  assertRole(purpose, role);
  const uid = assertUserId(userId);

  if (String(contentType || "").toLowerCase() !== "image/jpeg") {
    throw new DirectUploadError(415, "direct_upload_needs_processing", "Fotografia trebuie procesată pe server.", {
      fallback: true,
    });
  }
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < DIRECT_IMAGE_MIN_BYTES) {
    throw new DirectUploadError(400, "invalid_size", "Fișierul este gol sau nu a putut fi citit.");
  }
  if (bytes > DIRECT_IMAGE_MAX_BYTES) {
    throw new DirectUploadError(413, "direct_upload_needs_processing", "Fotografia trebuie procesată pe server.", {
      fallback: true,
    });
  }

  const quota = limiter?.take(uid);
  if (quota && !quota.ok) {
    throw new DirectUploadError(
      429,
      "too_many_uploads",
      "Ai încărcat foarte multe fotografii într-un timp scurt. Încearcă din nou peste câteva minute.",
      { retryAfterSeconds: quota.retryAfterSeconds }
    );
  }

  const uploadId = deps.newId();
  const { stagingKey } = directUploadKeys({ purpose, userId: uid, uploadId });
  const command = new PutObjectCommand({
    Bucket: deps.bucket,
    Key: stagingKey,
    ContentType: "image/jpeg",
    ContentLength: bytes,
  });
  const uploadUrl = await deps.presign(command, DIRECT_UPLOAD_URL_TTL_SECONDS);

  return {
    uploadId,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    expiresAt: new Date(deps.now() + DIRECT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    maxBytes: DIRECT_IMAGE_MAX_BYTES,
  };
}

/* ---------------- 2. confirmarea ---------------- */

/**
 * @param {{ userId: string, role: string, purpose: string, uploadId: string }} input
 * @returns {Promise<{ url: string, key: string, size: number, mimeType: "image/jpeg", width?: number, height?: number }>}
 */
export async function completeDirectUpload({ userId, role, purpose, uploadId }, { deps = defaultDirectUploadDeps() } = {}) {
  assertRole(purpose, role);
  // cheile vin din utilizatorul AUTENTIFICAT: nimeni nu poate confirma încărcarea altcuiva
  const { stagingKey, finalKey } = directUploadKeys({ purpose, userId, uploadId });

  // deja confirmată (repetare după o eroare de rețea): același URL, fără dubluri
  const existing = await headOrNull(deps, finalKey);
  if (existing) {
    await deleteQuietly(deps, stagingKey);
    return {
      url: deps.publicUrl(finalKey),
      key: finalKey,
      size: Number(existing.ContentLength) || 0,
      mimeType: "image/jpeg",
    };
  }

  const head = await headOrNull(deps, stagingKey);
  if (!head) {
    throw new DirectUploadError(404, "upload_not_found", "Fotografia nu a ajuns la destinație. Încearcă din nou.");
  }

  const declared = Number(head.ContentLength);
  if (!Number.isFinite(declared) || declared < DIRECT_IMAGE_MIN_BYTES || declared > DIRECT_IMAGE_MAX_BYTES) {
    await deleteQuietly(deps, stagingKey);
    throw new DirectUploadError(413, "invalid_size", "Fotografia nu are o dimensiune acceptată.");
  }

  // citim cel mult MAX + 1 octeți, chiar dacă obiectul ar fi fost înlocuit între timp
  const object = await deps.send(
    new GetObjectCommand({ Bucket: deps.bucket, Key: stagingKey, Range: `bytes=0-${DIRECT_IMAGE_MAX_BYTES}` })
  );
  const buffer = await readBody(object.Body);
  if (buffer.length > DIRECT_IMAGE_MAX_BYTES) {
    await deleteQuietly(deps, stagingKey);
    throw new DirectUploadError(413, "invalid_size", "Fotografia nu are o dimensiune acceptată.");
  }

  let info;
  try {
    info = await verifyDirectImage(buffer);
  } catch (error) {
    await deleteQuietly(deps, stagingKey);
    throw error;
  }

  // scriem EXACT octeții verificați (nu o copie a cheii temporare, care ar putea fi rescrisă între timp)
  await deps.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: finalKey,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: CACHE_CONTROL,
    })
  );
  await deleteQuietly(deps, stagingKey);

  return {
    url: deps.publicUrl(finalKey),
    key: finalKey,
    size: buffer.length,
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}

/* ---------------- limite (configurabile) ---------------- */

export function createDirectUploadLimiter(env = process.env) {
  return createUserRateLimiter({
    max: envInt(env, "DIRECT_IMAGE_UPLOAD_MAX_PER_WINDOW", 150),
    windowMs: envInt(env, "DIRECT_IMAGE_UPLOAD_WINDOW_MINUTES", 10) * 60 * 1000,
  });
}
