// src/lib/productImages/heic/heicTileWorker.js
//
// Web Worker: HEIC/HEIF -> JPEG (max 2400 px) ÎN BROWSER, pentru browserele
// care nu decodează HEIC nativ (Chrome, Edge, Firefox pe Android / Windows /
// macOS). Rulează o singură fotografie, apoi e oprit de apelant - memoria
// WebAssembly se eliberează odată cu worker-ul.
//
// libheif (libheif-js 1.23.5, LGPL-3.0, WebAssembly) e încărcat DOAR aici, doar
// când e nevoie. Decodarea e pe TILE-URI (grila din fișier): fiecare tile se
// decodează, se desenează direct micșorat în imaginea finală și se eliberează.
// Orientarea (irot/imir) și decuparea grilei sunt aplicate de libheif.
// Rezultatul (canvas -> JPEG) NU conține metadate: fără EXIF, fără GPS.
//
// Mesaj intrare: { buffer: ArrayBuffer, maxEdge, quality, budgetBytes }
// Mesaje ieșire: { type: "progress", done, total }
//                { type: "done", ok: true, blob, width, height, sourceWidth, sourceHeight, mode, displayP3 }
//                { type: "done", ok: false, code, message?, sourceWidth?, sourceHeight? }

// Biblioteca LGPL e livrată ca fișier SEPARAT, NEMODIFICAT (copie exactă din pachetul npm,
// fără re-împachetare / minificare de Vite) și încărcată la rulare: poate fi înlocuită cu
// altă versiune compatibilă fără recompilarea Artfest (LGPL-3.0, secțiunea 4(d)(1)).
// Licențe: /third-party-licenses/index.html
import libheifUrl from "libheif-js/libheif-wasm/libheif-bundle.mjs?url";
import {
  convertDisplayP3ToSrgbInPlace,
  heicDecodePlan,
  heicOutputSize,
  heicTilePlan,
  isDisplayP3Profile,
} from "./heicTiling.js";

const HEIF_COLORSPACE_RGB = 1;
const HEIF_CHROMA_INTERLEAVED_RGBA = 11;
const HEIF_CHANNEL_INTERLEAVED = 10;
const FOURCC_NCLX = 0x6e636c78; // "nclx"

function fail(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function checkError(lib, errPtr, code) {
  const value = lib.HEAP32[errPtr >> 2];
  if (value !== 0) throw fail(code, { heifError: value, heifSubError: lib.HEAP32[(errPtr >> 2) + 1] });
}

function readColorProfile(lib, handlePtr, errPtr) {
  const out = { nclxPrimaries: null, iccBytes: null };
  try {
    const type = lib._heif_image_handle_get_color_profile_type(handlePtr) >>> 0;
    if (type === FOURCC_NCLX) {
      const pp = lib._malloc(4);
      lib._heif_image_handle_get_nclx_color_profile(errPtr, handlePtr, pp);
      if (lib.HEAP32[errPtr >> 2] === 0) {
        const nclx = lib.HEAPU32[pp >> 2];
        // struct: uint8 version; (aliniere) enum color_primaries la offset 4
        out.nclxPrimaries = lib.HEAP32[(nclx + 4) >> 2];
        lib._heif_nclx_color_profile_free(nclx);
      }
      lib._free(pp);
    } else if (type) {
      const size = lib._heif_image_handle_get_raw_color_profile_size(handlePtr);
      if (size > 0 && size < 4 * 1024 * 1024) {
        const buf = lib._malloc(size);
        lib._heif_image_handle_get_raw_color_profile(errPtr, handlePtr, buf);
        if (lib.HEAP32[errPtr >> 2] === 0) out.iccBytes = lib.HEAPU8.slice(buf, buf + size);
        lib._free(buf);
      }
    }
  } catch {
    /* fără profil: sRGB */
  }
  return out;
}

/** RGBA dintr-o imagine libheif decodată (stride poate fi > lățime*4). */
function rgbaFromImage(lib, imgPtr, strideP) {
  const width = lib._heif_image_get_width(imgPtr, HEIF_CHANNEL_INTERLEAVED);
  const height = lib._heif_image_get_height(imgPtr, HEIF_CHANNEL_INTERLEAVED);
  const plane = lib._heif_image_get_plane_readonly(imgPtr, HEIF_CHANNEL_INTERLEAVED, strideP);
  const stride = lib.HEAP32[strideP >> 2];
  if (!plane || !(width > 0) || !(height > 0)) throw fail("heic_decode_failed");
  const row = width * 4;
  const pixels = new Uint8ClampedArray(row * height);
  if (stride === row) pixels.set(lib.HEAPU8.subarray(plane, plane + row * height));
  else for (let y = 0; y < height; y += 1) pixels.set(lib.HEAPU8.subarray(plane + y * stride, plane + y * stride + row), y * row);
  return { width, height, pixels };
}

async function convert({ buffer, maxEdge, quality, budgetBytes }) {
  let libheifFactory;
  try {
    libheifFactory = (await import(/* @vite-ignore */ libheifUrl)).default;
  } catch {
    throw fail("unsupported"); // biblioteca nu s-a putut încărca -> pregătirea trimite la server
  }
  const lib = await libheifFactory();
  const ctx = lib.heif_context_alloc();
  const errPtr = lib._malloc(16);
  const tilingPtr = lib._malloc(128);
  const outImgPP = lib._malloc(4);
  const strideP = lib._malloc(4);
  let handle = null;

  try {
    const readError = lib.heif_context_read_from_memory(ctx, new Uint8Array(buffer));
    const readOk = readError?.code?.value === 0 || readError?.message === "Success";
    if (!readOk) throw fail("heic_corrupt");
    buffer = null; // copia din WASM rămâne; originalul JS poate fi eliberat

    handle = lib.heif_js_context_get_primary_image_handle(ctx);
    const handlePtr = handle?.$$?.ptr;
    if (!handlePtr) throw fail("heic_corrupt");

    // tiling-ul imaginii TRANSFORMATE (rotire / oglindire / decupare aplicate)
    lib.HEAPU8.fill(0, tilingPtr, tilingPtr + 128);
    lib.HEAP32[tilingPtr >> 2] = 1;
    lib._heif_image_handle_get_image_tiling(errPtr, handlePtr, 1, tilingPtr);
    checkError(lib, errPtr, "heic_corrupt");
    const u = (i) => lib.HEAPU32[(tilingPtr >> 2) + i];
    const tiling = { columns: u(1), rows: u(2), tileWidth: u(3), tileHeight: u(4), width: u(5), height: u(6) };

    const decodePlan = heicDecodePlan({ ...tiling, budgetBytes });
    if (!decodePlan.ok) throw fail(decodePlan.reason, { sourceWidth: tiling.width, sourceHeight: tiling.height });

    const profile = readColorProfile(lib, handlePtr, errPtr);
    const displayP3 = isDisplayP3Profile(profile);
    const out = heicOutputSize(tiling.width, tiling.height, maxEdge);

    const canvas = new OffscreenCanvas(out.width, out.height);
    const g = canvas.getContext("2d", { alpha: false });
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, out.width, out.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";

    const plan = heicTilePlan({
      imageWidth: tiling.width,
      imageHeight: tiling.height,
      tileWidth: tiling.tileWidth,
      tileHeight: tiling.tileHeight,
      columns: tiling.columns,
      rows: tiling.rows,
      outWidth: out.width,
      outHeight: out.height,
    });

    let done = 0;
    for (const step of plan) {
      lib._heif_image_handle_decode_image_tile(errPtr, handlePtr, outImgPP, HEIF_COLORSPACE_RGB, HEIF_CHROMA_INTERLEAVED_RGBA, 0, step.tx, step.ty);
      checkError(lib, errPtr, "heic_decode_failed");
      const imgPtr = lib.HEAPU32[outImgPP >> 2];
      let tile;
      try {
        tile = rgbaFromImage(lib, imgPtr, strideP);
      } finally {
        lib._heif_image_release(imgPtr);
      }
      const bitmap = await createImageBitmap(new ImageData(tile.pixels, tile.width, tile.height));
      tile = null;
      g.drawImage(bitmap, 0, 0, Math.min(step.sw, bitmap.width), Math.min(step.sh, bitmap.height), step.dx, step.dy, step.dw, step.dh);
      bitmap.close();
      done += 1;
      self.postMessage({ type: "progress", done, total: plan.length });
    }

    if (displayP3) {
      const imageData = g.getImageData(0, 0, out.width, out.height);
      convertDisplayP3ToSrgbInPlace(imageData.data);
      g.putImageData(imageData, 0, 0);
    }

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return {
      ok: true,
      blob,
      width: out.width,
      height: out.height,
      sourceWidth: tiling.width,
      sourceHeight: tiling.height,
      mode: decodePlan.mode,
      displayP3,
    };
  } finally {
    try {
      if (handle) lib.heif_image_handle_release(handle);
    } catch {
      /* worker-ul se oprește oricum */
    }
    try {
      lib.heif_context_free(ctx);
    } catch {
      /* idem */
    }
    lib._free(errPtr);
    lib._free(tilingPtr);
    lib._free(outImgPP);
    lib._free(strideP);
  }
}

self.onmessage = async (event) => {
  try {
    const result = await convert(event.data || {});
    self.postMessage({ type: "done", ...result });
  } catch (error) {
    self.postMessage({
      type: "done",
      ok: false,
      code: error?.code || "heic_decode_failed",
      message: String(error?.message || ""),
      sourceWidth: error?.sourceWidth || null,
      sourceHeight: error?.sourceHeight || null,
    });
  }
};
