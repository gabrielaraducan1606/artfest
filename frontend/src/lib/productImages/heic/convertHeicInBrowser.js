// src/lib/productImages/heic/convertHeicInBrowser.js
//
// HEIC/HEIF -> JPEG în browser, pentru o SINGURĂ fotografie, într-un Web
// Worker (heicTileWorker.js) oprit imediat după - memoria WebAssembly se
// eliberează; interfața nu se blochează. Folosit de prepareProductImage.js
// când browserul nu decodează HEIC nativ (Chrome / Edge / Firefox).
//
// Erori (HeicBrowserError.code):
//   unsupported            - browserul nu are Worker / OffscreenCanvas / WebAssembly
//   too_large_for_device   - imagine NE-grilă prea mare pentru memoria telefonului
//   heic_corrupt           - fișier deteriorat / necunoscut
//   heic_decode_failed     - decodare eșuată
//   timeout                - a durat prea mult (dispozitiv foarte lent)

import { HEIC_TARGET_MAX_EDGE, deviceDecodeBudgetBytes } from "./heicTiling.js";

export const HEIC_BROWSER_TIMEOUT_MS = 120_000;
export const HEIC_JPEG_QUALITY = 0.9;

export class HeicBrowserError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "HeicBrowserError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** Are browserul tot ce trebuie pentru conversia locală? */
export function heicBrowserSupport(env = globalThis) {
  return (
    typeof env.Worker === "function" &&
    typeof env.OffscreenCanvas === "function" &&
    typeof env.WebAssembly === "object" &&
    typeof env.createImageBitmap === "function"
  );
}

/** Telefon / tabletă (buget de memorie mai mic). */
export function isMobileDevice(nav = globalThis.navigator) {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === "boolean") return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(String(nav.userAgent || ""));
}

function defaultCreateWorker() {
  return new Worker(new URL("./heicTileWorker.js", import.meta.url), { type: "module" });
}

/**
 * @param {File} file
 * @param {{ onProgress?: (done: number, total: number) => void, maxEdge?: number, quality?: number,
 *           timeoutMs?: number, createWorker?: () => Worker, budgetBytes?: number }} [options]
 * @returns {Promise<{ file: File, width: number, height: number, sourceWidth: number,
 *                     sourceHeight: number, mode: "tiles"|"full", displayP3: boolean }>}
 */
export async function convertHeicInBrowser(file, options = {}) {
  const {
    onProgress,
    maxEdge = HEIC_TARGET_MAX_EDGE,
    quality = HEIC_JPEG_QUALITY,
    timeoutMs = HEIC_BROWSER_TIMEOUT_MS,
    createWorker = defaultCreateWorker,
    budgetBytes = deviceDecodeBudgetBytes({
      deviceMemoryGB: globalThis.navigator?.deviceMemory ?? null,
      mobile: isMobileDevice(),
    }),
  } = options;

  if (!options.createWorker && !heicBrowserSupport()) throw new HeicBrowserError("unsupported");

  const buffer = await file.arrayBuffer();
  let worker;
  try {
    worker = createWorker();
  } catch {
    throw new HeicBrowserError("unsupported");
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HeicBrowserError("timeout")), timeoutMs);
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "progress") {
          onProgress?.(message.done, message.total);
          return;
        }
        if (message.type !== "done") return;
        clearTimeout(timer);
        if (message.ok) resolve(message);
        else {
          reject(
            new HeicBrowserError(message.code || "heic_decode_failed", {
              sourceWidth: message.sourceWidth || null,
              sourceHeight: message.sourceHeight || null,
            })
          );
        }
      };
      // modul worker / WASM care nu se pot încărca = browser nesuportat
      worker.onerror = (event) => {
        clearTimeout(timer);
        event?.preventDefault?.();
        reject(new HeicBrowserError("unsupported"));
      };
      worker.postMessage({ buffer, maxEdge, quality, budgetBytes }, [buffer]);
    });

    const name = `${String(file.name || "").replace(/\.[^.]+$/, "").trim() || "fotografie"}.jpg`;
    const jpeg = typeof File === "function" ? new File([result.blob], name, { type: "image/jpeg" }) : result.blob;
    return {
      file: jpeg,
      width: result.width,
      height: result.height,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      mode: result.mode,
      displayP3: Boolean(result.displayP3),
    };
  } finally {
    // memoria WebAssembly a worker-ului se eliberează aici
    worker.terminate();
  }
}
