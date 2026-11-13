// src/lib/productImages/productImageQueue.js
//
// Coada de fotografii a unui produs - COMUNĂ pentru toate formularele.
// Fără React (testată în Node): starea se citește cu getSnapshot() și se
// urmărește cu subscribe(); hook-ul React e în useProductImageQueue.js.
//
// Fiecare fotografie are propriul status:
//   queued     - în așteptare (procesare sau loc liber la upload)
//   processing - se pregătește în browser (micșorare / conversie)
//   uploading  - se încarcă (progress 0..1 sau null dacă nu se poate măsura)
//   done       - încărcată: are URL definitiv de pe server
//   error      - a eșuat: mesaj în română + „Reîncearcă” (fișierul e păstrat)
//
// Reguli:
//  - o singură fotografie se procesează odată (memorie pe telefon), maximum
//    `uploadConcurrency` (2) se încarcă simultan; serverul are oricum coadă;
//  - eșecul uneia NU oprește celelalte;
//  - erorile trecătoare (rețea, timp, 429/5xx) se reîncearcă automat de
//    `maxAutoRetries` ori, cu pauză; apoi rămân „error” cu retry manual;
//  - la retry se refolosește fișierul deja pregătit (fără reconversie);
//  - duplicatele accidentale (același nume + mărime + dată) sunt refuzate;
//  - limita de fotografii include și cele existente / cu eroare;
//  - urls() întoarce DOAR URL-urile definitive, în ordinea afișată - niciodată
//    previzualizări blob:.

import {
  MAX_PRODUCT_PHOTOS,
  ProductImageUploadError,
  checkProductImageFile,
  checkUploadSize,
  fileFingerprint,
  isPersistentImageUrl,
  isRetryableUploadError,
  readFileHead,
  retryDelayMs,
} from "./productImageRules.js";

const PENDING = new Set(["queued", "processing", "uploading"]);

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ProductImageUploadError({ kind: "aborted" }));
      },
      { once: true }
    );
  });
}

function defaultCreatePreview(file) {
  try {
    return typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(file) : "";
  } catch {
    return "";
  }
}

function defaultRevokePreview(url) {
  try {
    if (url && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
  } catch {
    /* noop */
  }
}

/**
 * @param {object} options
 * @param {(file: Blob, ctx: { onProgress: Function, signal: AbortSignal, item: object }) => Promise<{ url: string }>} options.upload
 * @param {(file: File, info: { kind: string }) => Promise<{ file: Blob }>} [options.prepare]
 */
export function createProductImageQueue({
  upload,
  prepare = async (file) => ({ file, processed: false }),
  readHead = readFileHead,
  createPreview = defaultCreatePreview,
  revokePreview = defaultRevokePreview,
  maxPhotos = MAX_PRODUCT_PHOTOS,
  uploadConcurrency = 2,
  maxAutoRetries = 2,
  sleep = defaultSleep,
  initialUrls = [],
} = {}) {
  if (typeof upload !== "function") throw new Error("createProductImageQueue: lipsește `upload`");

  let seq = 0;
  let items = [];
  const listeners = new Set();
  const internals = new Map(); // id -> { file, kind, prepared, controller }
  let snapshot = null;
  let destroyed = false;

  const nextId = () => `img-${Date.now().toString(36)}-${(seq += 1)}`;

  function existingItem(url) {
    return { id: nextId(), source: "existing", url, previewUrl: "", name: "", status: "done", progress: 1, error: "", fingerprint: "" };
  }

  function emit() {
    snapshot = null;
    listeners.forEach((fn) => fn());
  }

  function update(id, patch) {
    let changed = false;
    items = items.map((item) => {
      if (item.id !== id) return item;
      changed = true;
      return { ...item, ...patch };
    });
    if (changed) emit();
  }

  const find = (id) => items.find((item) => item.id === id);

  function getSnapshot() {
    if (!snapshot) {
      const pending = items.filter((item) => PENDING.has(item.status)).length;
      const failed = items.filter((item) => item.status === "error").length;
      snapshot = {
        items,
        pendingCount: pending,
        failedCount: failed,
        doneCount: items.filter((item) => item.status === "done").length,
        busy: pending > 0,
        canAddMore: items.length < maxPhotos,
        remaining: Math.max(0, maxPhotos - items.length),
        maxPhotos,
        // existente: păstrate EXACT (inclusiv formate vechi de URL); noi: doar URL-uri definitive
        urls: items
          .filter((item) => item.status === "done" && (item.source === "existing" ? typeof item.url === "string" : isPersistentImageUrl(item.url)))
          .map((item) => item.url),
      };
    }
    return snapshot;
  }

  /* ---------------- motorul cozii ---------------- */

  function pump() {
    if (destroyed) return;

    // uploaduri: cele pregătite, în ordinea listei
    let active = items.filter((item) => item.status === "uploading").length;
    for (const item of items) {
      if (active >= uploadConcurrency) break;
      const internal = internals.get(item.id);
      if (item.status === "queued" && internal?.prepared) {
        active += 1;
        runUpload(item.id);
      }
    }

    // procesare: una singură odată
    if (!items.some((item) => item.status === "processing")) {
      const next = items.find((item) => item.status === "queued" && !internals.get(item.id)?.prepared);
      if (next) runPrepare(next.id);
    }
  }

  async function runPrepare(id) {
    const internal = internals.get(id);
    if (!internal) return;
    update(id, { status: "processing", progress: null, error: "" });

    let prepared = internal.file;
    try {
      const result = await prepare(internal.file, { kind: internal.kind });
      if (result?.file) prepared = result.file;
    } catch {
      prepared = internal.file; // serverul procesează originalul
    }

    if (!internals.has(id) || destroyed) return; // eliminată între timp

    // limita serverului (40 MB) se aplică fișierului TRIMIS, după optimizare
    const sizeCheck = checkUploadSize(prepared, internal.file?.name);
    if (!sizeCheck.ok) {
      internal.fatal = true; // „Reîncearcă” nu ar schimba nimic: doar eliminare
      update(id, { status: "error", error: sizeCheck.message, progress: null, retryable: false });
      pump();
      return;
    }

    internal.prepared = prepared;
    update(id, { status: "queued" });
    pump();
  }

  async function runUpload(id) {
    const internal = internals.get(id);
    if (!internal) return;

    const controller = new AbortController();
    internal.controller = controller;
    update(id, { status: "uploading", progress: 0, error: "" });

    let attempt = 0;
    for (;;) {
      try {
        const result = await upload(internal.prepared, {
          signal: controller.signal,
          item: find(id),
          onProgress: (fraction) => {
            const value = Number(fraction);
            if (Number.isFinite(value)) update(id, { progress: Math.max(0, Math.min(1, value)) });
          },
        });

        if (!internals.has(id)) return;
        const url = result?.url || "";
        if (!url) throw new ProductImageUploadError({ kind: "invalid_response" });

        internal.controller = null;
        // fișierele nu mai sunt necesare: memoria se eliberează (previzualizarea rămâne)
        internal.file = null;
        internal.prepared = null;
        update(id, { status: "done", url, progress: 1, error: "" });
        break;
      } catch (error) {
        if (!internals.has(id) || controller.signal.aborted) return; // eliminată / oprită

        if (isRetryableUploadError(error) && attempt < maxAutoRetries) {
          attempt += 1;
          update(id, { progress: null, error: `${error.message} Reîncercare automată ${attempt}/${maxAutoRetries}…` });
          try {
            await sleep(retryDelayMs(attempt, error.retryAfterSeconds), controller.signal);
          } catch {
            return;
          }
          if (!internals.has(id)) return;
          update(id, { progress: 0, error: "" });
          continue;
        }

        internal.controller = null;
        update(id, {
          status: "error",
          progress: null,
          retryable: true,
          error: error?.message || "Nu am putut încărca fotografia. Încearcă din nou.",
        });
        break;
      }
    }

    pump();
  }

  /* ---------------- API public ---------------- */

  /**
   * Adaugă fișierele alese (input, drag & drop, cameră, lipire).
   * @returns {Promise<{ added: number, rejected: Array<{ name: string, message: string }> }>}
   */
  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    const rejected = [];
    let added = 0;
    let overLimit = 0;
    const seen = new Set(
      items.filter((item) => item.source === "local" && item.fingerprint).map((item) => item.fingerprint)
    );

    for (const file of files) {
      if (destroyed) break;
      const name = String(file.name || "fotografia");
      const fingerprint = fileFingerprint(file);

      if (seen.has(fingerprint)) {
        rejected.push({ name, message: `„${name}” este deja adăugată.` });
        continue;
      }

      if (items.length >= maxPhotos) {
        overLimit += 1;
        continue;
      }

      let head;
      try {
        head = await readHead(file);
      } catch {
        rejected.push({ name, message: `„${name}” nu a putut fi citită. Alege fotografia din nou.` });
        continue;
      }

      const check = checkProductImageFile(file, head);
      if (!check.ok) {
        rejected.push({ name, message: check.message });
        continue;
      }

      // limita se verifică din nou: citirea e asincronă
      if (items.length >= maxPhotos) {
        overLimit += 1;
        continue;
      }

      seen.add(fingerprint);
      const id = nextId();
      internals.set(id, { file, kind: check.kind, prepared: null, controller: null });
      items = [
        ...items,
        {
          id,
          source: "local",
          url: "",
          previewUrl: createPreview(file),
          name,
          kind: check.kind,
          status: "queued",
          progress: null,
          error: "",
          fingerprint,
        },
      ];
      added += 1;
      emit();
      pump();
    }

    if (overLimit) {
      rejected.push({
        name: "",
        message: `Un produs poate avea cel mult ${maxPhotos} fotografii. ${overLimit === 1 ? "O fotografie nu a fost adăugată" : `${overLimit} fotografii nu au fost adăugate`}.`,
      });
    }

    return { added, rejected };
  }

  /** Reîncearcă o fotografie cu eroare, fără reselectare (fișierul e păstrat). */
  function retry(id) {
    const item = find(id);
    const internal = internals.get(id);
    if (!item || item.status !== "error" || !internal?.file || internal.fatal) return false;
    update(id, { status: "queued", error: "", progress: null });
    pump();
    return true;
  }

  /** Reîncearcă toate fotografiile cu eroare. */
  function retryAll() {
    let count = 0;
    for (const item of items) if (item.status === "error" && retry(item.id)) count += 1;
    return count;
  }

  /** Elimină o fotografie (oprește upload-ul dacă rulează). */
  function remove(id) {
    const item = find(id);
    if (!item) return;
    const internal = internals.get(id);
    internal?.controller?.abort();
    internals.delete(id);
    if (item.previewUrl) revokePreview(item.previewUrl);
    items = items.filter((x) => x.id !== id);
    emit();
    pump();
  }

  function move(id, delta) {
    const from = items.findIndex((item) => item.id === id);
    const to = from + Number(delta);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    items = next;
    emit();
  }

  function moveTo(id, index) {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0) return;
    move(id, Math.max(0, Math.min(items.length - 1, index)) - from);
  }

  function makeMain(id) {
    moveTo(id, 0);
  }

  /**
   * Înlocuiește lista cu imaginile EXISTENTE (produs editat / ciornă). Oprește
   * tot ce rula. Imaginile existente se păstrează EXACT cum au venit - fără
   * filtrare, fără trim și fără tăiere la limită: urls() le întoarce identic,
   * deci editarea nu schimbă lista de fotografii fără o acțiune a vânzătorului
   * (nici măcar pentru valori vechi neobișnuite: gol, spații, blob:, data:).
   * Fotografiile NOI (încărcate acum) intră în urls() doar cu URL definitiv.
   */
  function reset(urls = []) {
    for (const [, internal] of internals) internal.controller?.abort();
    internals.clear();
    for (const item of items) if (item.previewUrl) revokePreview(item.previewUrl);
    items = (Array.isArray(urls) ? urls : []).filter((url) => typeof url === "string").map(existingItem);
    emit();
  }

  function destroy() {
    destroyed = true;
    for (const [, internal] of internals) internal.controller?.abort();
    internals.clear();
    for (const item of items) if (item.previewUrl) revokePreview(item.previewUrl);
    listeners.clear();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  reset(initialUrls);

  return { addFiles, retry, retryAll, remove, move, moveTo, makeMain, reset, destroy, subscribe, getSnapshot };
}
