// backend/src/services/uploadMemoryGuard.js
//
// Protecția de memorie pentru fotografiile de PRODUS (POST /api/upload/products),
// gândită pentru instanța Render de 512 MB / 0,5 CPU.
//
// Înainte de decodare, costul fotografiei e ESTIMAT din header (format,
// dimensiuni, progresiv/întrețesut) - citit de pe disc, fără să încarce
// imaginea - și comparat cu memoria folosită în acel moment:
//   folosit + cost > prag  ->  503 + Retry-After (frontend-ul reîncearcă
//   automat), în loc să riscăm oprirea procesului (OOM) care ar doborî tot
//   backend-ul (checkout, comenzi).
//
// „Folosit” = memoria CONTAINERULUI (cgroup v2 / v1, containerMemory.js):
// include Chrome-ul pentru PDF-uri și orice alt proces - nu doar Node. Dacă
// cgroup-ul nu poate fi citit și confirmat (Windows, local, valori invalide),
// se folosește memoria procesului Node, ca înainte. Comutator fără cod:
// UPLOAD_MEMORY_SOURCE=process.
//
// Factorii (octeți / pixel) vin din măsurători reale cu sharp 0.34, 1 fir,
// vârf RSS peste nivelul de bază, cu fișierul inclus (2026-11-13), rotunjiți
// în sus cu ~20-40%:
//   JPEG normal 60-100 MP: ~45 MB constant (micșorare la citire)
//   JPEG progresiv 36 MP: ~140 MB (~3,9 B/px)       -> 4,5
//   PNG 100 MP plat: ~93 MB (~0,9 B/px)              -> 1,2
//   PNG întrețesut 25 MP: ~110 MB (~4,4 B/px)        -> 5
//   WEBP 54-100 MP: ~55-66 MB (~1 B/px)              -> 1,2
//   GIF 25 MP: ~152 MB (~6 B/px)                     -> 7
//   TIFF 100 MP: ~93 MB (~0,9 B/px)                  -> 1,5
//   AVIF 8 MP: ~141-159 MB (~18 B/px)                -> 20
//   HEIC (worker): ~9,2 B/px la 45 MP, totul inclus  -> 9,5 + 20 MB
// Peste toate: fișierul în memorie + 40 MB fix (codare JPEG, buffere sharp).

const MB = 1024 * 1024;

export const PRODUCT_IMAGE_MAX_BYTES = 40 * MB;
export const DEFAULT_UPLOAD_MEMORY_LIMIT_MB = 460; // 512 MB minus marjă (memorie nativă, RSS întârziat)
const FIXED_OVERHEAD_BYTES = 40 * MB;
const BASELINE_JPEG_MIN_BYTES = 60 * MB;

export function uploadMemoryLimitBytes(env = process.env) {
  const value = Number(env.UPLOAD_MEMORY_LIMIT_MB);
  if (Number.isFinite(value) && value === 0) return 0; // 0 = oprit explicit
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_UPLOAD_MEMORY_LIMIT_MB) * MB;
}

/* =========================================================
   Sursa memoriei: CONTAINERUL (cgroup, include Chrome) sau procesul Node
========================================================= */

/**
 * UPLOAD_MEMORY_SOURCE:
 *   "auto"    (implicit) - memoria containerului (cgroup v2 / v1) când poate
 *             fi citită și confirmată; altfel procesul Node (comportamentul vechi);
 *   "process" - DOAR procesul Node (comutatorul de dezactivare, fără cod).
 */
export function uploadMemorySource(env = process.env) {
  return String(env.UPLOAD_MEMORY_SOURCE || "").trim().toLowerCase() === "process" ? "process" : "auto";
}

/** Marja sub limita containerului: 10% (min. 48 MB) - memorie nativă, RSS raportat cu întârziere. */
export function containerMarginBytes(limitBytes) {
  return Math.max(48 * MB, Math.round(limitBytes * 0.1));
}

/**
 * Pragul efectiv:
 *  - UPLOAD_MEMORY_LIMIT_MB=0 -> protecție oprită;
 *  - limita containerului cunoscută -> limita - marja (512 MB -> ~460 MB);
 *    UPLOAD_MEMORY_LIMIT_MB setat explicit poate doar să o COBOARE;
 *  - altfel -> UPLOAD_MEMORY_LIMIT_MB sau 460 MB (ca înainte).
 */
export function effectiveMemoryLimitBytes({ env = process.env, containerLimitBytes = null } = {}) {
  const configured = uploadMemoryLimitBytes(env);
  if (!configured) return 0;
  if (!(containerLimitBytes > 0)) return configured;

  const cap = containerLimitBytes - containerMarginBytes(containerLimitBytes);
  const explicit = Number(env.UPLOAD_MEMORY_LIMIT_MB) > 0;
  return explicit ? Math.min(configured, cap) : cap;
}

let containerReader = null; // injectabil în teste
let cached = { at: -Infinity, value: null };
const CACHE_MS = 1000;
let lastDiagnosticKey = "";

/** Teste: injectează cititorul memoriei containerului (null = cel real). */
export function __setContainerMemoryReaderForTests(reader) {
  containerReader = reader;
  cached = { at: -Infinity, value: null };
  lastDiagnosticKey = "";
}

async function defaultContainerReader() {
  const { readContainerMemory } = await import("./containerMemory.js");
  return readContainerMemory();
}

function readContainerCached(now = Date.now()) {
  if (now - cached.at < CACHE_MS && cached.value) return cached.value;
  return null;
}

/**
 * Starea memoriei ACUM, pentru decizie: { usedBytes, limitBytes, source, detail }.
 * Fără excepții: orice problemă la citirea cgroup -> procesul Node.
 */
export async function currentUploadMemoryState({
  env = process.env,
  rss = () => process.memoryUsage().rss,
  logger = console,
  now = Date.now(),
} = {}) {
  const rssBytes = rss();
  let container = { ok: false, reason: "disabled" };

  if (uploadMemorySource(env) === "auto") {
    container = readContainerCached(now);
    if (!container) {
      try {
        container = await (containerReader || defaultContainerReader)({ processRssBytes: rssBytes });
      } catch {
        container = { ok: false, reason: "read_error" };
      }
      if (!container || typeof container !== "object") container = { ok: false, reason: "read_error" };
      cached = { at: now, value: container };
    }
  }

  const useContainer = container.ok === true && Number.isFinite(container.workingSetBytes);
  const state = useContainer
    ? {
        usedBytes: Math.max(rssBytes, container.workingSetBytes),
        limitBytes: effectiveMemoryLimitBytes({ env, containerLimitBytes: container.limitBytes }),
        source: `cgroup-${container.version}`,
        detail: {
          rssMB: Math.round(rssBytes / MB),
          containerMB: Math.round(container.workingSetBytes / MB),
          containerLimitMB: container.limitBytes ? Math.round(container.limitBytes / MB) : null,
        },
      }
    : {
        usedBytes: rssBytes,
        limitBytes: effectiveMemoryLimitBytes({ env }),
        source: "process",
        detail: { rssMB: Math.round(rssBytes / MB), reason: container.reason || "unknown" },
      };

  // diagnostic: o singură dată la pornire și la fiecare schimbare de sursă / limită
  const key = `${state.source}|${state.detail.containerLimitMB ?? ""}|${state.detail.reason ?? ""}|${Math.round(state.limitBytes / MB)}`;
  if (key !== lastDiagnosticKey) {
    lastDiagnosticKey = key;
    logger.info?.("[UPLOAD] protecție memorie", {
      sursa: state.source,
      pragMB: Math.round(state.limitBytes / MB),
      ...(state.source === "process" ? { motiv: state.detail.reason } : { limitaContainerMB: state.detail.containerLimitMB }),
    });
  }

  return state;
}

/**
 * Costul estimat al procesării (octeți), din header-ul sharp.metadata().
 * @param {{ header?: object|null, fileBytes: number }} input
 */
export function estimateImageProcessingBytes({ header, fileBytes }) {
  const bytes = Math.max(0, Number(fileBytes) || 0);
  const width = Number(header?.width) || 0;
  const height = Number(header?.height) || 0;
  const pixels = width * height;

  // nedecodabil (ex. BMP urcat ca atare) sau header necunoscut: doar copii ale fișierului
  if (!header?.format || !pixels) return bytes * 2 + FIXED_OVERHEAD_BYTES;

  let decode;
  switch (header.format) {
    case "jpeg":
      decode = header.isProgressive ? pixels * 4.5 : Math.max(BASELINE_JPEG_MIN_BYTES, pixels * 0.5);
      break;
    case "png":
      decode = pixels * (header.isProgressive ? 5 : 1.2);
      break;
    case "webp":
      decode = pixels * 1.2;
      break;
    case "gif":
      decode = pixels * 7;
      break;
    case "tiff":
      decode = pixels * 1.5;
      break;
    case "heif":
      if (header.compression === "hevc") {
        // HEIC (worker): 9,2 B/px măsurat la 45 MP INCLUSIV codarea JPEG -> fără overhead fix dublat
        return Math.round(bytes + 20 * MB + pixels * 9.5);
      }
      decode = pixels * 20; // AVIF
      break;
    default:
      decode = pixels * 4;
  }

  return Math.round(bytes + FIXED_OVERHEAD_BYTES + decode);
}

/* =========================================================
   Refuzuri DEFINITIVE (422), înaintea verificării memoriei (503)
========================================================= */

/** Fotografia nu poate fi procesată niciodată pe această instanță - reîncercarea nu ajută. */
export class UploadImageRejectedError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "UploadImageRejectedError";
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Verificări din header care NU depind de încărcarea serverului. Trebuie
 * făcute ÎNAINTE de verificarea memoriei: altfel o fotografie imposibilă
 * (ex. HEIC Samsung de 50 MP) primea 503 „serverul e ocupat”, era
 * reîncercată degeaba și vânzătorul vedea un mesaj fals.
 *
 * @param {{ header: object|null, costBytes: number, productMaxPixels: number,
 *           heicMaxPixels: number, pixelLimit: (header, max) => number, limitBytes: number }} input
 * @throws {UploadImageRejectedError}
 */
export function assertImageProcessable({ header, costBytes, productMaxPixels, heicMaxPixels, pixelLimit, limitBytes }) {
  const width = Number(header?.width) || 0;
  const height = Number(header?.height) || 0;
  const pixels = width * height;

  if (pixels) {
    const isHeic = header.format === "heif" && header.compression === "hevc";
    const max = isHeic ? Math.min(heicMaxPixels, productMaxPixels) : pixelLimit(header, productMaxPixels);
    if (pixels > max) {
      throw new UploadImageRejectedError("image_too_many_pixels", {
        maxPixels: max,
        pixels,
        format: isHeic ? "heic" : header.format,
      });
    }
  }

  // nu încape nici cu serverul gol (praguri mai mici setate din env) -> definitiv
  if (limitBytes && costBytes > limitBytes * 0.6) {
    throw new UploadImageRejectedError("image_too_heavy", { costBytes, limitBytes });
  }
}

export class UploadMemoryBusyError extends Error {
  constructor({ rssBytes, costBytes, limitBytes }) {
    super("Serverul are momentan prea puțină memorie liberă pentru această fotografie. Reîncercăm automat în câteva secunde.");
    this.name = "UploadMemoryBusyError";
    this.code = "server_busy";
    this.status = 503;
    this.retryAfterSeconds = 10;
    this.rssBytes = rssBytes;
    this.costBytes = costBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Verifică dacă procesarea încape în memorie ACUM. Aruncă UploadMemoryBusyError
 * (503) dacă nu. Limita se citește la fiecare apel (env), 0 = protecție oprită.
 */
export function assertUploadMemoryAvailable(
  costBytes,
  { rss = () => process.memoryUsage().rss, limitBytes = uploadMemoryLimitBytes(), logger = console, source = "process", detail = null } = {}
) {
  if (!limitBytes) return;
  const rssBytes = rss();
  if (rssBytes + costBytes <= limitBytes) return;

  // doar cifre (MB) și sursa - fără căi, utilizatori sau nume de fișiere
  logger.warn?.("[UPLOAD] memorie insuficientă acum - 503 (reîncercare)", {
    sursa: source,
    folositMB: Math.round(rssBytes / MB),
    costMB: Math.round(costBytes / MB),
    pragMB: Math.round(limitBytes / MB),
    ...(detail || {}),
  });
  throw new UploadMemoryBusyError({ rssBytes, costBytes, limitBytes });
}

/**
 * Verificarea folosită de POST /api/upload/products: memoria CONTAINERULUI
 * (inclusiv Chrome) când poate fi confirmată, altfel procesul Node.
 * Aruncă UploadMemoryBusyError (503 + Retry-After) dacă fotografia nu încape acum.
 */
export async function ensureUploadMemory(costBytes, options = {}) {
  const state = await currentUploadMemoryState(options);
  // refuzurile DEFINITIVE (422) înaintea celor temporare (503)
  options.precheck?.(state);
  assertUploadMemoryAvailable(costBytes, {
    rss: () => state.usedBytes,
    limitBytes: state.limitBytes,
    logger: options.logger || console,
    source: state.source,
    detail: state.detail,
  });
  return state;
}
