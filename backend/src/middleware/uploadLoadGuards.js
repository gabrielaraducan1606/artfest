// backend/src/middleware/uploadLoadGuards.js
//
// Protecții împotriva epuizării memoriei / discului la upload-uri mari
// (/api/upload/products, /api/upload/support, atașamentele din Mesaje):
//
//  - createByteBudget: buget de octeți pe instanță, rezervat din
//    Content-Length ÎNAINTE ca multer să citească fișierele (fără
//    Content-Length se rezervă maximul cererii). Peste plafonul unei
//    cereri -> 413; peste buget -> 503 + Retry-After. Pentru disc, bugetul
//    efectiv e și limitat de spațiul liber real (fs.statfs), nu presupus.
//  - createProcessingLimiter: câte procesări (citire + decodare sharp)
//    rulează simultan; restul așteaptă la rând (cu termen), peste coadă ->
//    503. O procesare peste termen e anulată (AbortSignal până la R2), iar
//    locul se eliberează doar după oprirea ei efectivă.
//  - tempDiskStorage: motor multer care scrie pe disc și ține evidența
//    fișierelor fiecărei cereri - la anularea transferului (multer nu mai
//    apelează callback-ul) le închide și le șterge; plus curățare
//    periodică a fișierelor rămase după o oprire bruscă, doar cu numele
//    generate aici.
//
// Vârf RSS măsurat local pentru UN fișier de 100 MP (uploadToR2, policy
// image): JPEG ~75 MB, WebP ~58 MB, PNG ~131 MB, TIFF ~129 MB; GIF ~511 MB
// (plafonat separat în r2Storage.pixelLimitForHeader).

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const MB = 1024 * 1024;

export const UPLOAD_BUSY_MESSAGE =
  "Serverul procesează acum multe fișiere. Încearcă din nou peste câteva secunde.";

export class UploadBusyError extends Error {
  constructor(message = UPLOAD_BUSY_MESSAGE) {
    super(message);
    this.name = "UploadBusyError";
    this.code = "server_busy";
    this.status = 503;
    this.retryAfterSeconds = 5;
  }
}

/**
 * 503 temporar + Retry-After. `message` / `reason` opționale (ex. protecția de
 * memorie), ca vânzătorul să vadă cauza reală; implicit mesajul de coadă plină.
 */
export function sendUploadBusy(res, retryAfterSeconds = 5, { message = UPLOAD_BUSY_MESSAGE, reason = "queue" } = {}) {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return res.status(503).json({ error: "server_busy", reason, message });
}

export function envMegabytes(name, fallbackMb) {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallbackMb) * MB;
}

export function envInteger(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

/**
 * Spațiul liber real dintr-un folder (octeți), citit cel mult o dată pe
 * secundă. null = necunoscut (statfs indisponibil) -> doar bugetul fix.
 */
export function createFreeSpaceProbe({ dir, statfs = fs.statfsSync, cacheMs = 1000, now = Date.now } = {}) {
  let cachedAt = -Infinity;
  let cached = null;

  return function freeBytes() {
    if (now() - cachedAt < cacheMs) return cached;
    cachedAt = now();

    try {
      const target = fs.existsSync(dir) ? dir : path.dirname(dir);
      const s = statfs(target);
      cached = Number(s.bavail) * Number(s.bsize);
    } catch {
      cached = null;
    }

    return cached;
  };
}

/**
 * @param {{ name: string, budgetBytes: number, freeBytes?: () => number|null,
 *           freeMarginBytes?: number, logger?: Console }} options
 */
export function createByteBudget({ name, budgetBytes, freeBytes = null, freeMarginBytes = 0, logger = console }) {
  let reserved = 0;
  let lastLogAt = 0;

  function logBusy(reason, details) {
    const at = Date.now();

    if (at - lastLogAt > 60 * 1000) {
      lastLogAt = at;
      logger.warn(`[UPLOAD] ${name}: ${reason}, cerere amânată (503)`, details);
    }
  }

  function guard({ maxRequestBytes }) {
    return function uploadByteBudget(req, res, next) {
      const declared = Number(req.headers["content-length"]);
      // fără Content-Length (chunked) rezervăm maximul permis cererii
      const bytes = Number.isFinite(declared) && declared >= 0 ? declared : maxRequestBytes;

      if (bytes > maxRequestBytes) {
        res.setHeader("Connection", "close");
        return res.status(413).json({
          error: "request_too_large",
          message: `Fișierele trimise depășesc ${Math.round(maxRequestBytes / MB)} MB într-o singură cerere. Trimite-le pe rând.`,
        });
      }

      if (reserved > 0 && reserved + bytes > budgetBytes) {
        logBusy("buget ocupat", {
          reservedMb: Math.round(reserved / MB),
          requestMb: Math.round(bytes / MB),
          budgetMb: Math.round(budgetBytes / MB),
        });
        res.setHeader("Connection", "close");
        return sendUploadBusy(res, 5, { reason: "disk" });
      }

      // spațiul real: ce e rezervat încă nu e neapărat scris, deci îl
      // considerăm ocupat (estimare prudentă)
      const free = freeBytes ? freeBytes() : null;

      if (free !== null && free - freeMarginBytes < reserved + bytes) {
        logBusy("spațiu liber insuficient pe disc", {
          freeMb: Math.round(free / MB),
          reservedMb: Math.round(reserved / MB),
          requestMb: Math.round(bytes / MB),
          marginMb: Math.round(freeMarginBytes / MB),
        });
        res.setHeader("Connection", "close");
        return sendUploadBusy(res, 5, { reason: "disk" });
      }

      reserved += bytes;

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        reserved -= bytes;
      };

      res.once("finish", release);
      res.once("close", release);

      return next();
    };
  }

  return { guard, reserved: () => reserved };
}

/**
 * @param {{ concurrency: number, maxQueue: number, maxWaitMs?: number,
 *           holdTimeoutMs?: number, logger?: Console }} options
 * @returns {Function & { stats: () => { active: number, queued: number, overdue: number } }}
 *   run(fn) - rulează fn când e loc, sau aruncă UploadBusyError
 */
export function createProcessingLimiter({
  concurrency,
  maxQueue,
  maxWaitMs = 60 * 1000,
  holdTimeoutMs = 2 * 60 * 1000,
  logger = console,
}) {
  const limit = Math.max(1, concurrency);
  let active = 0;
  let overdue = 0;
  const queue = [];

  function releaseSlot() {
    const next = queue.shift();

    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // locul e predat direct (active rămâne la fel)
    } else {
      active -= 1;
    }
  }

  async function run(fn) {
    if (active >= limit) {
      if (queue.length >= maxQueue) throw new UploadBusyError();

      await new Promise((resolve, reject) => {
        const entry = { resolve };
        entry.timer = setTimeout(() => {
          const index = queue.indexOf(entry);
          if (index >= 0) queue.splice(index, 1);
          reject(new UploadBusyError());
        }, maxWaitMs);
        queue.push(entry);
      });
    } else {
      active += 1;
    }

    /*
     * Peste termen operațiunea e ANULATĂ (semnalul ajunge la apelul R2),
     * iar locul se eliberează doar după ce ea s-a oprit efectiv - deci
     * concurența reală nu depășește niciodată limita.
     */
    const controller = new AbortController();
    let isOverdue = false;
    const holdTimer = setTimeout(() => {
      isOverdue = true;
      overdue += 1;
      logger.warn("[UPLOAD] procesare peste termen - anulată", { holdTimeoutMs });
      controller.abort(new UploadBusyError());
    }, holdTimeoutMs);

    try {
      return await fn(controller.signal);
    } catch (error) {
      // anularea noastră -> 503 (server ocupat), nu eroarea internă a SDK-ului
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(holdTimer);
      if (isOverdue) overdue -= 1;
      releaseSlot();
    }
  }

  run.stats = () => ({ active, queued: queue.length, overdue });

  return run;
}

/* ---------- fișiere temporare pe disc ---------- */

export const UPLOAD_TMP_DIR = path.join(os.tmpdir(), "artfest-uploads");

/* doar fișierele cu acest nume sunt ale noastre (nimic altceva nu se șterge) */
const TEMP_NAME_RE = /^\d+-[0-9a-f]{16}\.upload$/;
const TRACKED = Symbol("artfestTempUploads");
const STALE_TEMP_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 15 * 60 * 1000;
let lastSweepAt = -Infinity;

const newTempName = () => `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.upload`;

/**
 * Șterge fișierele noastre mai vechi de maxAgeMs (rămase după o oprire
 * bruscă). Fișierele în lucru (mai noi) și cele cu alt nume rămân.
 */
export async function sweepStaleTempFiles({ dir = UPLOAD_TMP_DIR, maxAgeMs = STALE_TEMP_MS, now = Date.now() } = {}) {
  const names = await fsp.readdir(dir).catch(() => []);
  let removed = 0;

  await Promise.all(
    names
      .filter((name) => TEMP_NAME_RE.test(name))
      .map(async (name) => {
        const file = path.join(dir, name);
        const stat = await fsp.lstat(file).catch(() => null);

        if (stat?.isFile() && now - stat.mtimeMs > maxAgeMs) {
          await fsp.unlink(file).then(() => (removed += 1), () => {});
        }
      })
  );

  return removed;
}

function maybeSweep() {
  const at = Date.now();
  if (at - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = at;
  sweepStaleTempFiles().catch(() => {});
}

function unlinkQuietly(filePath) {
  return fsp.unlink(filePath).catch(() => {});
}

const CLAIMED = Symbol("artfestTempUploadsClaimed");

/**
 * Apelat de rută când multer îi predă fișierele: de aici înainte doar
 * ruta le șterge (în finally), după ce a terminat cu ele - închiderea
 * conexiunii de către client nu le mai șterge în timp ce sunt citite.
 */
export function claimTempFiles(req) {
  if (req) req[CLAIMED] = true;
}

/**
 * Închide și șterge fișierele temporare ale cererii (inclusiv cele pe
 * care multer nu le mai raportează după o anulare). Idempotent. Fișierele
 * deja preluate de rută sunt lăsate rutei (vezi claimTempFiles).
 */
export async function cleanupTrackedTempFiles(req) {
  if (req?.[CLAIMED]) return;
  const tracked = req?.[TRACKED] || [];

  await Promise.all(
    tracked.map(
      (entry) =>
        new Promise((resolve) => {
          const { stream } = entry;

          if (stream && !stream.closed) {
            // pe Windows un fișier deschis nu poate fi șters
            stream.once("close", () => unlinkQuietly(entry.path).then(resolve));
            stream.destroy();
          } else {
            unlinkQuietly(entry.path).then(resolve);
          }
        })
    )
  );
}

/** Motor de stocare multer: disc + evidența fișierelor pe cerere. */
class TrackedTempDiskStorage {
  _handleFile(req, file, cb) {
    fs.mkdir(UPLOAD_TMP_DIR, { recursive: true }, (mkdirError) => {
      if (mkdirError) return cb(mkdirError);

      maybeSweep();

      const filename = newTempName();
      const filePath = path.join(UPLOAD_TMP_DIR, filename);
      const out = fs.createWriteStream(filePath, { flags: "wx" });

      if (!req[TRACKED]) {
        req[TRACKED] = [];
        // după răspuns SAU la anulare - fișierele deja șterse sunt ignorate
        req.res?.once("close", () => {
          cleanupTrackedTempFiles(req);
        });
      }

      req[TRACKED].push({ path: filePath, stream: out });

      let finished = false;
      const done = (error, info) => {
        if (finished) return;
        finished = true;
        cb(error, info);
      };

      out.on("error", done);
      file.stream.on("error", (error) => {
        out.destroy();
        done(error);
      });
      out.on("finish", () =>
        done(null, { destination: UPLOAD_TMP_DIR, filename, path: filePath, size: out.bytesWritten })
      );

      file.stream.pipe(out);
    });
  }

  _removeFile(_req, file, cb) {
    fs.unlink(file.path, () => cb(null));
  }
}

export function tempDiskStorage() {
  return new TrackedTempDiskStorage();
}

/** Citește fișierul de pe disc doar pe durata lui fn (un fișier odată). */
export async function withBufferedFile(file, fn) {
  if (file?.buffer) return fn(file);

  const buffer = await fsp.readFile(file.path);

  return fn({ ...file, buffer, size: buffer.length });
}

export async function removeTempFiles(files) {
  const list = Array.isArray(files) ? files : Object.values(files || {}).flat();

  await Promise.all(list.map((file) => (file?.path ? unlinkQuietly(file.path) : null)));
}
