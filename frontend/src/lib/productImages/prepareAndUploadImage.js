// src/lib/productImages/prepareAndUploadImage.js
//
// Pașii cozii de fotografii de produs (productImageQueue.js) pentru UNA
// singură fotografie, pentru formularele care nu au coadă proprie:
// produsul manual din inventarul Târgului (vânzător) și fotografiile de la
// recepția Târgului (Admin).
//
//   1. tipul real după primii octeți + limita fotografiei alese (100 MB);
//   2. optimizare în browser (prepareProductImage): max 2400 px pe latura
//      lungă, JPEG 0,9, proporții + orientare EXIF păstrate, metadatele (GPS)
//      eliminate; HEIC/HEIF prin convertorul existent; fotografiile deja mici
//      pleacă neatinse;
//   3. limita serverului pe fișierul TRIMIS (40 MB);
//   4. upload cu reîncercări automate DOAR pentru erorile trecătoare
//      (rețea, timp, 429/5xx; la 503 se respectă Retry-After). 413/415/422
//      nu se repetă: aceeași fotografie ar primi același refuz.
//
// Întoarce URL-ul DEFINITIV de pe server (niciodată blob:/data:).

import { prepareProductImage } from "./prepareProductImage.js";
import {
  ProductImageUploadError,
  checkProductImageFile,
  checkUploadSize,
  isPermanentUploadError,
  readFileHead,
} from "./productImageRules.js";
import { uploadProductImageWithRetry } from "./uploadProductImage.js";

export const SINGLE_IMAGE_AUTO_RETRIES = 3;

/** Refuz în browser (format, fișier gol, prea mare): fără upload, fără „Reîncearcă”. */
function rejected(message) {
  const error = new ProductImageUploadError({ kind: "rejected", message });
  error.permanent = true;
  return error;
}

/** Are sens butonul „Reîncearcă” pentru această eroare (același fișier)? */
export function canRetryImageUpload(error) {
  if (!error) return false;
  if (error.permanent || error.kind === "rejected" || error.kind === "aborted") return false;
  return !isPermanentUploadError(error);
}

/**
 * Pașii 1-3: fișierul care pleacă efectiv la server.
 * @returns {Promise<File|Blob>}
 */
export async function prepareImageForUpload(file, options = {}) {
  const { prepare = prepareProductImage, readHead = readFileHead, onStage, onProgress } = options;

  const check = checkProductImageFile(file, await readHead(file).catch(() => new Uint8Array()));
  if (!check.ok) throw rejected(check.message);

  let prepared = file;
  try {
    const result = await prepare(file, { kind: check.kind, onStage, onProgress });
    if (result?.fatalMessage) throw rejected(result.fatalMessage);
    if (result?.file) prepared = result.file;
  } catch (error) {
    if (error?.permanent) throw error;
    prepared = file; // optimizarea a eșuat neprevăzut: serverul procesează originalul
  }

  const sizeCheck = checkUploadSize(prepared, file?.name);
  if (!sizeCheck.ok) throw rejected(sizeCheck.message);
  return prepared;
}

/**
 * @param {File} file
 * @param {{ endpoint?: string, fieldName?: string, signal?: AbortSignal,
 *           onStage?: (stage: "optimizing"|"uploading") => void, onProgress?: Function,
 *           maxAutoRetries?: number, prepare?: Function, readHead?: Function,
 *           upload?: Function, sleep?: Function }} [options]
 * @returns {Promise<string>} URL-ul definitiv
 */
export async function prepareAndUploadImage(file, options = {}) {
  const { onStage, maxAutoRetries = SINGLE_IMAGE_AUTO_RETRIES, prepare, readHead, ...uploadOptions } = options;
  const prepared = await prepareImageForUpload(file, { prepare, readHead, onStage });
  onStage?.("uploading");
  return uploadProductImageWithRetry(prepared, { ...uploadOptions, maxAutoRetries });
}
