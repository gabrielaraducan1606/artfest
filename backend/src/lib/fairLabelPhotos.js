// backend/src/lib/fairLabelPhotos.js
//
// Etichete Târg „Cu fotografie produs”: miniatura fotografiei principale DEJA asociate liniei de
// inventar (imageUrlSnapshot), doar pentru identificare vizuală. Nu se generează imagini, nu se
// modifică originalele: se descarcă fotografia publică, se micșorează în memorie (sharp) la o
// miniatură JPEG mică și se pune în HTML-ul etichetei ca data URI (o singură dată per fotografie,
// clasă CSS reutilizată de toate copiile).
//
// Protecții (Render, 512 MB):
//   - doar https și doar gazde permise (R2_PUBLIC_BASE_URL + LABEL_PHOTO_HOSTS) - fără SSRF;
//   - limită de octeți la descărcare (oprită pe parcurs), timeout per fotografie;
//   - sharp cu limitInputPixels (24 MP) și sequentialRead; miniatura max. 240 px;
//   - cel mult LABEL_PHOTO_MAX_DISTINCT fotografii distincte per PDF și buget total de octeți;
//   - concurență mică; cache LRU în memorie pe URL (miniaturi ~10 KB) => aceeași fotografie nu se
//     descarcă din nou la regenerare;
//   - orice eroare (404, timeout, format necunoscut) => eticheta normală, fără fotografie.

import sharp from "sharp";

export const LABEL_PHOTO_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024, // 8 MB pe fotografie
  totalBytes: 64 * 1024 * 1024, // 64 MB descărcați per PDF
  timeoutMs: 6000,
  maxDistinct: 60,
  concurrency: 3,
  thumbPx: 240, // ~13 mm la 450 dpi: suficient pentru o miniatură de 11 mm
  maxInputPixels: 24_000_000,
  cacheEntries: 200,
  cacheTtlMs: 6 * 60 * 60 * 1000,
});

const cache = new Map(); // url -> { dataUri, at }
export const photoStats = { downloads: 0, cacheHits: 0, failures: 0, bytes: 0 };

export function clearLabelPhotoCache() {
  cache.clear();
  for (const k of Object.keys(photoStats)) photoStats[k] = 0;
}

/** Gazdele de la care se pot descărca fotografii (fotografiile publice ale Artfest). */
export function allowedPhotoHosts(env = process.env) {
  const hosts = new Set();
  try {
    if (env.R2_PUBLIC_BASE_URL) hosts.add(new URL(env.R2_PUBLIC_BASE_URL).host.toLowerCase());
  } catch {
    /* URL invalid: ignorat */
  }
  for (const h of String(env.LABEL_PHOTO_HOSTS || "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

export function isAllowedPhotoUrl(value, hosts = allowedPhotoHosts()) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && hosts.has(u.host.toLowerCase());
  } catch {
    return false;
  }
}

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("photo_too_large");
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("photo_too_large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("photo_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Fotografia -> miniatură JPEG (data URI), proporțiile păstrate, fundal alb. null la orice eroare. */
export async function makeThumbnail(buffer, { thumbPx = LABEL_PHOTO_LIMITS.thumbPx, maxInputPixels = LABEL_PHOTO_LIMITS.maxInputPixels } = {}) {
  const out = await sharp(buffer, { limitInputPixels: maxInputPixels, sequentialRead: true, failOn: "error" })
    .rotate()
    .resize(thumbPx, thumbPx, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function fetchThumbnail(url, { fetchImpl, limits, budget }) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < limits.cacheTtlMs) {
    cache.delete(url); // LRU: mutat la capăt
    cache.set(url, hit);
    photoStats.cacheHits += 1;
    return hit.dataUri;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`photo_http_${res.status}`);
    const type = String(res.headers?.get?.("content-type") || "");
    if (type && !type.startsWith("image/")) throw new Error("photo_not_image");
    const remaining = budget.left;
    const buf = await readLimited(res, Math.min(limits.maxBytes, remaining));
    budget.left -= buf.length;
    photoStats.downloads += 1;
    photoStats.bytes += buf.length;
    const dataUri = await makeThumbnail(buf, limits);
    cache.set(url, { dataUri, at: Date.now() });
    while (cache.size > limits.cacheEntries) cache.delete(cache.keys().next().value);
    return dataUri;
  } catch {
    photoStats.failures += 1;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Miniaturile pentru liniile date: Map(url -> dataUri | null). Fiecare URL distinct se procesează
 * o singură dată; cele peste limită sau nepermise rămân fără fotografie (eticheta normală).
 */
export async function loadLabelThumbnails(items, { fetchImpl = globalThis.fetch, env = process.env, limits = LABEL_PHOTO_LIMITS } = {}) {
  const hosts = allowedPhotoHosts(env);
  const urls = [...new Set((items || []).map((i) => i?.imageUrlSnapshot).filter((u) => u && isAllowedPhotoUrl(u, hosts)))].slice(0, limits.maxDistinct);
  const result = new Map();
  const budget = { left: limits.totalBytes };
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      result.set(url, budget.left > 0 ? await fetchThumbnail(url, { fetchImpl, limits, budget }) : null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, urls.length) }, worker));
  return result;
}

/** Adaugă labelPhoto (data URI) pe liniile cu fotografie disponibilă; celelalte rămân neschimbate. */
export async function withLabelPhotos(items, options = {}) {
  const thumbs = await loadLabelThumbnails(items, options);
  return items.map((item) => {
    const photo = item?.imageUrlSnapshot ? thumbs.get(item.imageUrlSnapshot) : null;
    return photo ? { ...item, labelPhoto: photo } : item;
  });
}
