// src/lib/productImages/directImageUpload.js
//
// Upload DIRECT în Cloudflare R2 (URL semnat) pentru fotografiile deja
// optimizate în browser - fișierul nu mai trece prin serverul Render:
//   1. POST /api/upload/direct/intent   -> URL PUT semnat (10 min);
//   2. PUT direct în R2 (progres real);
//   3. POST /api/upload/direct/complete -> serverul verifică fișierul
//      (proprietar, tip real, dimensiuni, integritate) și întoarce URL-ul definitiv.
//
// Activare: VITE_DIRECT_IMAGE_UPLOAD=1 (frontend) ȘI DIRECT_IMAGE_UPLOAD_ENABLED=1
// (backend). Oricare oprit -> ruta veche POST /api/upload/products.
//
// Revenire controlată pe ruta veche (DirectUploadFallback), FĂRĂ dubluri:
//  - noul sistem e oprit pe server (404 direct_upload_disabled);
//  - PUT-ul spre R2 eșuează (CORS, rețea, semnătură) - nu s-a creat niciun
//    fișier definitiv, deci ruta veche creează singura copie;
//  - serverul cere procesare (EXIF, > 2400 px): a șters deja cheia temporară.
// După un PUT reușit, o eroare la confirmare NU trimite fișierul pe ruta
// veche: reîncercarea confirmă ACEEAȘI încărcare (idempotent, același URL).

import { buildUploadUrl } from "../uploadFile.js";
import { ProductImageUploadError, isPersistentImageUrl, uploadErrorMessage } from "./productImageRules.js";

export const DIRECT_INTENT_ENDPOINT = "/api/upload/direct/intent";
export const DIRECT_COMPLETE_ENDPOINT = "/api/upload/direct/complete";
export const DIRECT_PUT_STALL_TIMEOUT_MS = 60_000;
export const DIRECT_REQUEST_TIMEOUT_MS = 60_000;

// endpoint-ul vechi -> scopul uploadului direct (aceeași autorizare și același folder final)
export const DIRECT_PURPOSE_BY_ENDPOINT = Object.freeze({
  "/api/upload/products": "product",
  "/api/admin/artfest-fair/inventory/photos": "fair-reception",
});

/** Comutatorul din frontend (Vercel): VITE_DIRECT_IMAGE_UPLOAD=1. */
export function isDirectImageUploadEnabled(env = import.meta.env) {
  return ["1", "true", "yes", "on"].includes(String(env?.VITE_DIRECT_IMAGE_UPLOAD || "").trim().toLowerCase());
}

/* ---------- fișierele produse de optimizarea din browser (JPEG curat, max 2400 px) ---------- */

const browserEncoded = new WeakSet();

export function markBrowserEncoded(file) {
  if (file && typeof file === "object") browserEncoded.add(file);
  return file;
}

export function isBrowserEncoded(file) {
  return Boolean(file && typeof file === "object" && browserEncoded.has(file));
}

/** Semnal intern: fișierul merge pe ruta veche (procesare pe server). */
export class DirectUploadFallback extends Error {
  constructor(reason) {
    super(`direct upload fallback: ${reason}`);
    this.name = "DirectUploadFallback";
    this.directFallback = true;
    this.reason = reason;
  }
}

// încărcările trimise în R2 dar neconfirmate încă (reluare fără dubluri)
const pendingUploads = new WeakMap();

/* ---------- cereri ---------- */

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** POST JSON spre backend (cookie-ul de sesiune), cu termen și anulare. */
export async function postJson(endpoint, body, { signal, fetchImpl = globalThis.fetch, timeoutMs = DIRECT_REQUEST_TIMEOUT_MS } = {}) {
  if (signal?.aborted) throw new ProductImageUploadError({ kind: "aborted" });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildUploadUrl(endpoint), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = parseJson(await res.text().catch(() => ""));
    const retryAfter = Number.parseInt(res.headers?.get?.("Retry-After") || "", 10);
    return { status: res.status, ok: res.ok, data, retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 0 };
  } catch {
    if (signal?.aborted) throw new ProductImageUploadError({ kind: "aborted" });
    throw new ProductImageUploadError({ kind: controller.signal.aborted ? "timeout" : "network" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function httpError({ status, data, retryAfterSeconds }) {
  const code = data?.error || "";
  return new ProductImageUploadError({
    kind: "http",
    status,
    code,
    retryAfterSeconds,
    message: uploadErrorMessage({ kind: "http", status, code, serverMessage: data?.message }),
  });
}

/** PUT direct în R2 (XMLHttpRequest pentru progres). Orice eșec -> null (apelantul decide). */
export function putToStorage(file, { uploadUrl, headers = {}, signal, onProgress, XHR = globalThis.XMLHttpRequest, stallTimeoutMs = DIRECT_PUT_STALL_TIMEOUT_MS }) {
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
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          xhr.abort();
        } catch {
          /* noop */
        }
        finish(resolve, { ok: false, reason: "timeout" });
      }, stallTimeoutMs);
    };
    function onAbort() {
      try {
        xhr.abort();
      } catch {
        /* noop */
      }
      finish(reject, new ProductImageUploadError({ kind: "aborted" }));
    }
    signal?.addEventListener?.("abort", onAbort);

    xhr.open("PUT", uploadUrl);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        arm();
        if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
      };
    }
    xhr.onerror = () => finish(resolve, { ok: false, reason: "network" });
    xhr.onabort = () => {
      if (signal?.aborted) finish(reject, new ProductImageUploadError({ kind: "aborted" }));
      else finish(resolve, { ok: false, reason: "aborted" });
    };
    xhr.onload = () => {
      const status = Number(xhr.status) || 0;
      finish(resolve, status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `http_${status}` });
    };
    arm();
    xhr.send(file);
  });
}

async function confirmUpload(file, { purpose, uploadId, signal, post }) {
  const res = await post(DIRECT_COMPLETE_ENDPOINT, { purpose, uploadId }, { signal });
  if (res.ok) {
    const url = res.data?.url;
    if (!isPersistentImageUrl(url)) throw new ProductImageUploadError({ kind: "invalid_response", status: res.status });
    pendingUploads.delete(file);
    return { url, data: res.data, via: "direct" };
  }
  if (res.data?.fallback) {
    // serverul a șters cheia temporară: fișierul merge pe ruta veche
    pendingUploads.delete(file);
    throw new DirectUploadFallback(res.data?.error || "needs_processing");
  }
  if (res.status === 404 && res.data?.error === "upload_not_found") {
    pendingUploads.delete(file);
    return null; // nu a ajuns în R2 (sau a expirat): încărcare nouă
  }
  if (res.status === 404 && res.data?.error === "direct_upload_disabled") {
    pendingUploads.delete(file);
    throw new DirectUploadFallback("disabled");
  }
  throw httpError(res); // 5xx/503/429 -> reîncercare automată (aceeași încărcare)
}

/**
 * @param {Blob} file fișier produs de optimizarea din browser (isBrowserEncoded)
 * @param {{ purpose: string, signal?: AbortSignal, onProgress?: Function, post?: Function, put?: Function }} options
 * @returns {Promise<{ url: string, data: object, via: "direct" }>}
 * @throws {DirectUploadFallback | ProductImageUploadError}
 */
export async function uploadImageDirect(file, options = {}) {
  const { purpose, signal, onProgress, post = postJson, put = putToStorage } = options;
  if (!purpose) throw new DirectUploadFallback("no_purpose");

  // reluare: fișierul a ajuns deja în R2, doar confirmarea a eșuat
  const pending = pendingUploads.get(file);
  if (pending && pending.purpose === purpose) {
    const resumed = await confirmUpload(file, { purpose, uploadId: pending.uploadId, signal, post });
    if (resumed) return resumed;
  }

  const intent = await post(
    DIRECT_INTENT_ENDPOINT,
    { purpose, contentType: file.type || "image/jpeg", size: file.size },
    { signal }
  );
  if (!intent.ok) {
    if (intent.data?.fallback || intent.status === 404) throw new DirectUploadFallback(intent.data?.error || "intent");
    throw httpError(intent);
  }
  const { uploadId, uploadUrl, headers } = intent.data || {};
  if (!uploadId || !/^https:\/\//i.test(String(uploadUrl || ""))) throw new DirectUploadFallback("invalid_intent");

  onProgress?.(0);
  const sent = await put(file, { uploadUrl, headers, signal, onProgress });
  if (!sent?.ok) {
    // CORS / rețea / semnătură: nimic definitiv nu s-a creat -> ruta veche
    throw new DirectUploadFallback(`put_${sent?.reason || "failed"}`);
  }
  onProgress?.(1);

  pendingUploads.set(file, { purpose, uploadId });
  const confirmed = await confirmUpload(file, { purpose, uploadId, signal, post });
  if (!confirmed) throw new DirectUploadFallback("not_found_after_put");
  return confirmed;
}
