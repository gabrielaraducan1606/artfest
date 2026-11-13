// src/lib/productImages/heic/heicTiling.js
//
// Logică PURĂ (fără browser, testată în Node) pentru conversia HEIC/HEIF în
// browser (heicTileWorker.js):
//  - planul de tile-uri: fotografiile de telefon (iPhone, Samsung) sunt salvate
//    ca GRILĂ de tile-uri mici (de obicei 512x512). Fiecare tile se decodează
//    separat și se desenează DIRECT micșorat în imaginea finală (max 2400 px),
//    deci telefonul nu ține niciodată în memorie toată fotografia de 48-50 MP;
//  - bugetul de memorie pe dispozitiv: imaginile NE-grilă (un singur cadru
//    HEVC) se decodează întregi - doar dacă încap în bugetul dispozitivului;
//  - Display P3 -> sRGB (culorile iPhone corecte în orice browser).

export const HEIC_TARGET_MAX_EDGE = 2400;
export const HEIC_MAX_SAFE_PIXELS = 200_000_000; // plafon absolut (fișiere absurde / corupte)
const MB = 1024 * 1024;

/** Dimensiunea finală (latura lungă max `maxEdge`, proporții păstrate, fără mărire). */
export function heicOutputSize(width, height, maxEdge = HEIC_TARGET_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/**
 * Planul de desenare: pentru fiecare tile, zona sursă (tile-urile de la margine
 * pot depăși imaginea - grilă decupată) și zona destinație în imaginea finală.
 * Coordonatele destinație vin din granițe cumulative rotunjite: tile-urile
 * alăturate se ating exact (fără goluri sau suprapuneri).
 */
export function heicTilePlan({ imageWidth, imageHeight, tileWidth, tileHeight, columns, rows, outWidth, outHeight }) {
  const sx = outWidth / imageWidth;
  const sy = outHeight / imageHeight;
  const plan = [];
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < columns; tx += 1) {
      const x0 = tx * tileWidth;
      const y0 = ty * tileHeight;
      if (x0 >= imageWidth || y0 >= imageHeight) continue;
      const x1 = Math.min(imageWidth, x0 + tileWidth);
      const y1 = Math.min(imageHeight, y0 + tileHeight);
      const dx = Math.round(x0 * sx);
      const dy = Math.round(y0 * sy);
      plan.push({
        tx,
        ty,
        sw: x1 - x0,
        sh: y1 - y0,
        dx,
        dy,
        dw: Math.max(1, Math.round(x1 * sx) - dx),
        dh: Math.max(1, Math.round(y1 * sy) - dy),
      });
    }
  }
  return plan;
}

/** Memoria ocupată de decodarea unei imagini NE-grilă (RGBA + YUV + copii), estimată prudent. */
export function fullFrameDecodeBytes(width, height) {
  return Math.round(width * height * 10); // ~4 RGBA + ~1,5 YUV + copie RGBA + rezervă
}

/**
 * Bugetul de memorie al dispozitivului pentru o decodare NE-grilă.
 * navigator.deviceMemory (Chrome/Edge, valori rotunjite 0.25-8 GB) sau,
 * fără el, o estimare prudentă după tipul dispozitivului.
 */
export function deviceDecodeBudgetBytes({ deviceMemoryGB = null, mobile = false } = {}) {
  // pe telefon, un tab închis de sistem pierde fotografiile nesalvate: plafon prudent 256 MB
  // (grilele - fotografiile obișnuite de telefon - nu depind de el: un tile odată)
  const cap = mobile ? 256 * MB : 480 * MB;
  if (Number(deviceMemoryGB) > 0) {
    // ~1/16 din memoria raportată, între 96 MB și plafonul dispozitivului
    return Math.max(96 * MB, Math.min(cap, Math.round((Number(deviceMemoryGB) * 1024 * MB) / 16)));
  }
  return mobile ? 160 * MB : 480 * MB;
}

/**
 * Se poate converti în browser fără risc pentru telefon?
 * @returns {{ ok: true, mode: "tiles"|"full" } | { ok: false, reason: "too_large_for_device"|"invalid" }}
 */
export function heicDecodePlan({ width, height, columns, rows, tileWidth, tileHeight, budgetBytes }) {
  const pixels = Number(width) * Number(height);
  if (!(pixels > 0) || pixels > HEIC_MAX_SAFE_PIXELS) return { ok: false, reason: "invalid" };

  const tiled = Number(columns) * Number(rows) > 1;
  if (tiled) {
    // memoria = un singur tile decodat odată (+ imaginea finală de max 2400 px)
    const tileBytes = fullFrameDecodeBytes(tileWidth, tileHeight);
    return tileBytes <= budgetBytes ? { ok: true, mode: "tiles" } : { ok: false, reason: "too_large_for_device" };
  }
  return fullFrameDecodeBytes(width, height) <= budgetBytes
    ? { ok: true, mode: "full" }
    : { ok: false, reason: "too_large_for_device" };
}

/* ---------------- culori: Display P3 -> sRGB ---------------- */

const NCLX_PRIMARIES_DISPLAY_P3 = 12; // SMPTE EG 432-1 (Display P3)

/** Profilul de culoare al fotografiei e Display P3? (nclx sau ICC) */
export function isDisplayP3Profile({ nclxPrimaries = null, iccBytes = null } = {}) {
  if (Number(nclxPrimaries) === NCLX_PRIMARIES_DISPLAY_P3) return true;
  if (iccBytes && iccBytes.length) {
    let text = "";
    const n = Math.min(iccBytes.length, 4096);
    for (let i = 0; i < n; i += 1) {
      const c = iccBytes[i];
      if (c >= 32 && c < 127) text += String.fromCharCode(c);
    }
    return /Display P3|P3 D65|DCI-P3 D65/i.test(text);
  }
  return false;
}

let lut = null;
function luts() {
  if (lut) return lut;
  const toLinear = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  const SIZE = 4096;
  const toGamma = new Uint8ClampedArray(SIZE + 1);
  for (let i = 0; i <= SIZE; i += 1) {
    const l = i / SIZE;
    const g = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    toGamma[i] = Math.round(g * 255);
  }
  lut = { toLinear, toGamma, SIZE };
  return lut;
}

/**
 * Display P3 -> sRGB, pe loc, pe date RGBA (aceeași funcție de transfer;
 * matricea de primare D65). Culorile din afara sRGB sunt limitate (clip).
 * Se aplică pe imaginea FINALĂ (max 2400 px) - ~4 MP, rapid.
 */
export function convertDisplayP3ToSrgbInPlace(data) {
  const { toLinear, toGamma, SIZE } = luts();
  for (let i = 0; i < data.length; i += 4) {
    const r = toLinear[data[i]];
    const g = toLinear[data[i + 1]];
    const b = toLinear[data[i + 2]];
    const R = 1.2249401 * r - 0.2249404 * g;
    const G = -0.0420569 * r + 1.0420571 * g;
    const B = -0.0196376 * r - 0.0786361 * g + 1.0982735 * b;
    data[i] = toGamma[Math.round(Math.min(1, Math.max(0, R)) * SIZE)];
    data[i + 1] = toGamma[Math.round(Math.min(1, Math.max(0, G)) * SIZE)];
    data[i + 2] = toGamma[Math.round(Math.min(1, Math.max(0, B)) * SIZE)];
  }
  return data;
}
