// src/lib/productImages/productImageRules.js
//
// Regulile COMUNE pentru fotografiile de produs (Smart Listing - adăugare și
// editare, ProductModal, asistentul de produs). Logică pură, fără browser:
// testată în productImages.test.js.
//
// Sursa limitelor = backend-ul (NU se schimbă aici):
//   POST /api/upload/products (uploadRoutes.js): 40 MB / fișier trimis, 100 MP,
//   o fotografie per cerere din frontend, conversie JPEG max 2400 px.
//   HEIC/HEIF: convertit pe server (services/heicDecoder.js).
//
// Validarea în browser e doar o primă barieră (mesaje rapide, fără upload
// inutil); serverul revalidează conținutul real (magic bytes + sharp).

export const PRODUCT_IMAGE_UPLOAD_ENDPOINT = "/api/upload/products";
export const MAX_PRODUCT_PHOTOS = 12;
// limita serverului per fișier TRIMIS (backend: services/uploadMemoryGuard.js, instanța de 512 MB)
export const MAX_PRODUCT_IMAGE_BYTES = 40 * 1024 * 1024;
// cât poate avea fotografia ALEASĂ: browserul o micșorează înainte de upload
export const MAX_PRODUCT_SOURCE_BYTES = 100 * 1024 * 1024;

// `accept` pentru <input type="file">: pe iPhone, Safari predă HEIC-ul așa cum
// e (îl convertim noi), iar pe Android/desktop apar toate formatele uzuale.
export const PRODUCT_IMAGE_ACCEPT =
  "image/*,.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif,.avif,.gif,.bmp,.tif,.tiff";

export const ACCEPTED_FORMATS_LABEL = "JPG, PNG, WEBP, HEIC/HEIF, AVIF, GIF, BMP sau TIFF";

/* ---------------- semnătura reală (primii octeți) ---------------- */

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function ascii(bytes, start, end) {
  let out = "";
  for (let i = start; i < Math.min(end, bytes.length); i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Tipul REAL al imaginii după primii octeți (aceleași semnături ca
 * backend/src/services/r2Storage.js detectRealFileKind) sau null.
 * @param {Uint8Array} bytes primii >= 16 octeți ai fișierului
 */
export function sniffImageKind(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) {
    return "tiff";
  }
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12).trim().toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "heic";
    if (AVIF_BRANDS.has(brand)) return "avif";
  }
  return null;
}

/** Citește primii octeți ai unui File/Blob (browser). */
export async function readFileHead(file, length = 32) {
  const blob = file?.slice ? file.slice(0, length) : null;
  if (!blob) return new Uint8Array();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/* ---------------- validare ---------------- */

function displayName(file) {
  return String(file?.name || "").trim() || "fotografia";
}

export function formatBytes(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "";
  return mb >= 1 ? `${mb.toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
}

/**
 * @param {{ name?: string, size?: number }} file
 * @param {Uint8Array} head primii octeți (readFileHead)
 * @returns {{ ok: true, kind: string } | { ok: false, message: string }}
 */
export function checkProductImageFile(file, head) {
  const name = displayName(file);
  const size = Number(file?.size);

  if (!(size > 0)) {
    return { ok: false, message: `„${name}” este gol sau nu a putut fi citit. Alege fotografia din nou.` };
  }
  if (size > MAX_PRODUCT_SOURCE_BYTES) {
    return {
      ok: false,
      message: `„${name}” are ${formatBytes(size)} - maximum ${formatBytes(MAX_PRODUCT_SOURCE_BYTES)} per fotografie aleasă.`,
    };
  }

  const kind = sniffImageKind(head);
  if (!kind) {
    return {
      ok: false,
      message: `„${name}” nu este o fotografie validă (conținutul nu corespunde unei imagini). Acceptăm ${ACCEPTED_FORMATS_LABEL}.`,
    };
  }

  return { ok: true, kind };
}

/**
 * Fișierul care pleacă efectiv la server (după optimizarea din browser)
 * respectă limita serverului? Altfel: mesaj clar, fără upload inutil.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkUploadSize(prepared, originalName = "") {
  const size = Number(prepared?.size) || 0;
  if (size <= MAX_PRODUCT_IMAGE_BYTES) return { ok: true };
  const name = String(originalName || prepared?.name || "").trim() || "fotografia";
  return {
    ok: false,
    message: `„${name}” are ${formatBytes(size)} și nu a putut fi micșorată automat sub ${formatBytes(MAX_PRODUCT_IMAGE_BYTES)}. Salvează-o ca JPG (sau fă o captură de ecran) și încearc-o din nou.`,
  };
}

/** Amprenta folosită contra duplicatelor accidentale (același fișier ales de două ori). */
export function fileFingerprint(file) {
  return `${String(file?.name || "")}|${Number(file?.size) || 0}|${Number(file?.lastModified) || 0}`;
}

/* ---------------- erori de upload ---------------- */

export class ProductImageUploadError extends Error {
  /**
   * @param {{ kind: "http"|"network"|"timeout"|"aborted"|"invalid_response", status?: number, code?: string, message?: string, retryAfterSeconds?: number }} info
   */
  constructor(info = {}) {
    super(info.message || uploadErrorMessage(info));
    this.name = "ProductImageUploadError";
    this.kind = info.kind || "http";
    this.status = Number(info.status) || 0;
    this.code = info.code || "";
    this.retryAfterSeconds = Number(info.retryAfterSeconds) || 0;
  }
}

/** Mesaj în română pentru o eroare de upload (serverul are prioritate când trimite mesaj propriu). */
export function uploadErrorMessage({ kind, status, code, serverMessage } = {}) {
  if (kind === "aborted") return "Încărcarea a fost oprită.";
  if (kind === "timeout") return "Încărcarea durează prea mult (conexiune lentă). Încearcă din nou.";
  if (kind === "network") return "Conexiunea s-a întrerupt. Verifică internetul și încearcă din nou.";
  if (kind === "invalid_response") return "Serverul nu a confirmat fotografia. Încearcă din nou.";

  if (serverMessage) return serverMessage;
  if (code === "heic_unsupported") {
    return "Nu am putut converti fotografia HEIC. Trimite-o ca JPG (pe iPhone: Setări > Cameră > Formate > Cel mai compatibil).";
  }
  switch (Number(status)) {
    case 401:
    case 403:
      return "Sesiunea a expirat. Autentifică-te din nou, apoi reîncearcă.";
    case 413:
      return `Fotografia este prea mare pentru server (maximum ${formatBytes(MAX_PRODUCT_IMAGE_BYTES)} după optimizare).`;
    case 415:
      return `Formatul nu este acceptat. Folosește ${ACCEPTED_FORMATS_LABEL}.`;
    case 422:
      return "Fotografia are o rezoluție prea mare. Încearcă o variantă mai mică.";
    case 429:
    case 503:
      return "Serverul este ocupat momentan. Reîncercăm automat; dacă nu merge, apasă „Reîncearcă”.";
    default:
      return "Nu am putut încărca fotografia. Încearcă din nou.";
  }
}

/** Erorile trecătoare se reîncearcă automat (cu pauză); celelalte cer acțiunea vânzătorului. */
export function isRetryableUploadError(error) {
  if (!error) return false;
  if (error.kind === "network" || error.kind === "timeout") return true;
  return [408, 429, 500, 502, 503, 504].includes(Number(error.status));
}

/**
 * Refuz DEFINITIV al serverului pentru ACEST fișier (format, mărime, rezoluție):
 * reîncercarea cu același fișier dă același rezultat.
 */
export function isPermanentUploadError(error) {
  return error?.kind === "http" && [413, 415, 422].includes(Number(error.status));
}

/** Pauza înainte de reîncercarea automată: Retry-After de la server sau 1,5 s / 4 s / 8 s. */
export function retryDelayMs(attempt, retryAfterSeconds = 0) {
  if (retryAfterSeconds > 0) return Math.min(30_000, retryAfterSeconds * 1000);
  return [1500, 4000, 8000][Math.min(Math.max(attempt - 1, 0), 2)];
}

/** URL definitiv (nu blob:/data: de previzualizare). */
export function isPersistentImageUrl(value) {
  const text = String(value || "").trim();
  if (!text || /^(blob|data):/i.test(text)) return false;
  return /^https?:\/\//i.test(text) || text.startsWith("/");
}
