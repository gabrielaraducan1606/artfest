// backend/src/services/iccTaggedRaw.js
//
// Culorile fotografiilor HEIC: iPhone salvează în Display P3. Decodorul HEIC
// (libheif) întoarce pixeli RGBA FĂRĂ profil, iar sharp ar presupune sRGB ->
// culori spălăcite în Chrome / Firefox / Android.
//
// Soluție fără dependențe noi: pixelii devin un PNG necomprimat care poartă
// profilul ICC original (chunk iCCP); sharp îl citește ca orice imagine cu
// profil și convertește corect în sRGB la ieșire (formatul afișat identic în
// toate browserele). Pentru profile sRGB / lipsă nu se face nimic (zero cost).

import { deflateSync } from "node:zlib";
import sharp from "sharp";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// zlib.crc32 apare abia în Node 22.2; Render rulează Node 20
function crc32(buffers) {
  let crc = 0xffffffff;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuf, data]), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Profilul ICC e (aproape sigur) sRGB? - descrierea profilului conține „sRGB”. */
export function isSrgbProfile(icc) {
  if (!icc || !icc.length) return true; // fără profil = sRGB prin convenție
  const text = icc.toString("latin1").replace(/\0/g, "");
  return /sRGB/i.test(text) && !/Display P3|P3-|Rec\.?\s?2020|BT\.?2020|Adobe RGB/i.test(text);
}

/** Inserează iCCP imediat după IHDR (cerut de specificația PNG). */
export function injectIccIntoPng(png, icc) {
  const signatureAndIhdr = 8 + 4 + 4 + 13 + 4; // semnătură + IHDR (lungime, tip, date, CRC)
  if (png.toString("latin1", 12, 16) !== "IHDR") throw new Error("PNG fără IHDR");
  const data = Buffer.concat([Buffer.from("icc\0", "latin1"), Buffer.from([0]), deflateSync(icc)]);
  return Buffer.concat([png.subarray(0, signatureAndIhdr), pngChunk("iCCP", data), png.subarray(signatureAndIhdr)]);
}

/**
 * Intrarea pentru sharp: pixelii RGBA decodați, cu profilul original când nu
 * e sRGB (altfel { input: raw, options: { raw } }, ca înainte).
 * @returns {Promise<{ input: Buffer, options: object }>}
 */
export async function sharpInputForDecoded(decoded, icc) {
  const raw = { width: decoded.width, height: decoded.height, channels: decoded.channels || 4 };
  if (isSrgbProfile(icc)) return { input: decoded.data, options: { raw } };

  // PNG fără compresie: rapid, fără pierderi; doar transportă profilul
  const png = await sharp(decoded.data, { raw }).png({ compressionLevel: 0 }).toBuffer();
  return { input: injectIccIntoPng(png, icc), options: {} };
}
