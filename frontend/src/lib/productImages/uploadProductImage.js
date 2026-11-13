// src/lib/productImages/uploadProductImage.js
//
// Upload-ul UNEI fotografii de produs: POST /api/upload/products (rută doar
// pentru vânzători / Admin, fișiere pe disc, conversie JPEG pe server).
// XMLHttpRequest (nu fetch) pentru progresul real al transferului.
//
// Termene (conexiuni lente pe telefon):
//  - în timpul trimiterii: eroare doar dacă NU mai avansează nimic 60 s;
//  - după ultimul octet: serverul poate aștepta la rând + procesa (HEIC,
//    fotografii mari) -> 3 minute pentru răspuns.
// Fiecare eșec devine ProductImageUploadError (kind/status/code + mesaj RO).

import { buildUploadUrl } from "../uploadFile.js";
import {
  PRODUCT_IMAGE_UPLOAD_ENDPOINT,
  ProductImageUploadError,
  isPersistentImageUrl,
  isRetryableUploadError,
  retryDelayMs,
  uploadErrorMessage,
} from "./productImageRules.js";

export const STALL_TIMEOUT_MS = 60_000;
export const RESPONSE_TIMEOUT_MS = 180_000;

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** URL-ul din răspunsul /api/upload/products (url | urls[0] | items[0].url). */
export function urlFromUploadResponse(data) {
  const url = data?.url || data?.urls?.[0] || data?.items?.[0]?.url || "";
  return isPersistentImageUrl(url) ? url : "";
}

/**
 * @param {Blob} file
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal, endpoint?: string,
 *           stallTimeoutMs?: number, responseTimeoutMs?: number, XHR?: typeof XMLHttpRequest }} [options]
 * @returns {Promise<{ url: string, data: object }>}
 */
export function uploadProductImage(file, options = {}) {
  const {
    onProgress,
    signal,
    endpoint = PRODUCT_IMAGE_UPLOAD_ENDPOINT,
    stallTimeoutMs = STALL_TIMEOUT_MS,
    responseTimeoutMs = RESPONSE_TIMEOUT_MS,
    XHR = globalThis.XMLHttpRequest,
  } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProductImageUploadError({ kind: "aborted" }));
      return;
    }

    const xhr = new XHR();
    let timer = null;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      fn(value);
    };

    const fail = (info) => finish(reject, new ProductImageUploadError(info));

    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          xhr.abort();
        } catch {
          /* noop */
        }
        fail({ kind: "timeout" });
      }, ms);
    };

    function onAbort() {
      try {
        xhr.abort();
      } catch {
        /* noop */
      }
      fail({ kind: "aborted" });
    }

    signal?.addEventListener?.("abort", onAbort);

    xhr.open("POST", buildUploadUrl(endpoint));
    xhr.withCredentials = true;
    xhr.responseType = "text";

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        arm(stallTimeoutMs);
        if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
      };
      xhr.upload.onload = () => {
        onProgress?.(1);
        arm(responseTimeoutMs);
      };
    }

    xhr.onerror = () => fail({ kind: "network" });
    xhr.onabort = () => fail({ kind: "aborted" });

    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      const status = Number(xhr.status) || 0;

      if (status >= 200 && status < 300) {
        const url = urlFromUploadResponse(data);
        if (!url) {
          fail({ kind: "invalid_response", status });
          return;
        }
        finish(resolve, { url, data });
        return;
      }

      const retryAfter = Number.parseInt(xhr.getResponseHeader?.("Retry-After") || "", 10);
      const code = data?.error || "";
      fail({
        kind: status === 0 ? "network" : "http",
        status,
        code,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 0,
        message: uploadErrorMessage({ kind: "http", status, code, serverMessage: data?.message }),
      });
    };

    const body = new FormData();
    body.append("file", file, file?.name || "fotografie.jpg");
    arm(stallTimeoutMs);
    xhr.send(body);
  });
}

/**
 * Upload cu reîncercări automate pentru erorile trecătoare (rețea, timp,
 * 429/5xx - cu Retry-After), pentru formularele fără coadă proprie
 * (ProductModal, asistentul de produs). Întoarce URL-ul definitiv sau aruncă
 * ProductImageUploadError cu mesaj în română.
 */
export async function uploadProductImageWithRetry(file, options = {}) {
  const {
    maxAutoRetries = 2,
    upload = uploadProductImage,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...rest
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await upload(file, rest);
      return result.url;
    } catch (error) {
      if (!isRetryableUploadError(error) || attempt >= maxAutoRetries || rest.signal?.aborted) throw error;
      await sleep(retryDelayMs(attempt + 1, error.retryAfterSeconds));
    }
  }
}
