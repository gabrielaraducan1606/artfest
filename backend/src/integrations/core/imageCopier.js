// backend/src/integrations/core/imageCopier.js
//
// Copierea imaginilor unui produs importat în Cloudflare R2, prin serviciul
// media existent (services/r2Storage.uploadToR2: conversie JPEG, aceeași
// structură de chei ca uploadul din editor). Produsul Artfest folosește doar
// URL-urile R2 - nu încărcăm imagini direct de pe magazinul extern.
//
// Siguranță la descărcare (URL-uri venite din magazinul extern, SSRF):
//   - doar https, port implicit, fără date de autentificare în URL;
//   - gazde locale / IP-uri private, rezervate sau multicast respinse - atât
//     în URL, cât și ca rezultat al rezolvării DNS;
//   - DNS rebinding: adresele se verifică în funcția `lookup` a conexiunii
//     (https.request), adică exact adresa la care se conectează socket-ul -
//     nu există o a doua rezolvare între verificare și conectare;
//   - redirecționările se urmăresc manual (maximum MAX_REDIRECTS), fiecare
//     destinație trece prin aceleași verificări (https, gazdă, DNS);
//   - doar Content-Type image/*, maximum MAX_IMAGE_BYTES (verificat și în
//     timpul citirii, nu doar din Content-Length), timeout.

import dns from "node:dns";
import https from "node:https";
import net from "node:net";

import { IntegrationError } from "./errors.js";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
/*
 * WordPress micșorează implicit originalele la 2560 px (~4,4 MP); 40 MP
 * acoperă și imaginile 8K / camerele uzuale. Vârf RSS măsurat local la
 * 40 MP: JPEG ~50 MB, WebP ~51 MB, PNG ~91 MB (la 100 MP: 75 / 58 / 131
 * MB). Formatele decodate integral au plafoane proprii (r2Storage).
 */
export const IMPORT_IMAGE_MAX_PIXELS = 40_000_000;
const TIMEOUT_MS = 15_000;

/** IP privat / rezervat / local / multicast (IPv4 și IPv6, inclusiv IPv4 mapat). */
export function isPrivateAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "").toLowerCase();
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (ip.startsWith("::ffff:")) return true;
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip) || ip.startsWith("64:ff9b:") || ip.startsWith("2001:db8");
  }
  return false;
}

function isLocalHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
}

export function assertSafeImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new IntegrationError("image_url_invalid", "Adresa imaginii nu este validă.");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new IntegrationError("image_url_not_allowed", "Sunt acceptate doar imagini prin https://.");
  }
  if (isLocalHostname(url.hostname) || isPrivateAddress(url.hostname)) {
    throw new IntegrationError("image_url_not_allowed", "Adresa imaginii nu este permisă.");
  }
  return url;
}

/**
 * `lookup` pentru https.request: rezolvă numele și refuză conexiunea dacă
 * ORICARE adresă e privată (un răspuns DNS amestecat nu e acceptat).
 * Socket-ul se conectează doar la adresele verificate aici.
 */
export function createSafeLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    resolve(hostname, { ...opts, all: true }, (error, addresses) => {
      if (error) return cb(error);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
      if (!list.length || list.some((entry) => isPrivateAddress(entry.address))) {
        const blocked = new Error("image_host_resolves_to_private_address");
        blocked.code = "IMAGE_PRIVATE_ADDRESS";
        return cb(blocked);
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Un singur GET https, fără redirecționări automate, cu adresele validate
 * la conectare. @returns {{ status, headers, buffer }}
 */
export function safeHttpsGet(url, { lookup = createSafeLookup(), request = https.request, maxBytes = MAX_IMAGE_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", lookup, timeout: timeoutMs, headers: { accept: "image/*" } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, headers: res.headers, buffer: null });
        return;
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        reject(new IntegrationError("image_too_large", "Imaginea este prea mare."));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new IntegrationError("image_too_large", "Imaginea este prea mare."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new IntegrationError("image_download_timeout", "Imaginea nu a răspuns la timp.", { retryable: true })));
    req.on("error", (error) => {
      if (error?.code === "IMAGE_PRIVATE_ADDRESS") reject(new IntegrationError("image_url_not_allowed", "Adresa imaginii nu este permisă."));
      else if (error instanceof IntegrationError) reject(error);
      else reject(new IntegrationError("image_download_failed", "Imaginea nu a putut fi descărcată.", { retryable: true }));
    });
    req.end();
  });
}

/** Descărcare cu redirecționări verificate pas cu pas. */
export async function downloadImage(raw, { httpGet = safeHttpsGet } = {}) {
  let url = assertSafeImageUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await httpGet(url);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.location;
      if (!location || hop === MAX_REDIRECTS) {
        throw new IntegrationError("image_too_many_redirects", "Imaginea are prea multe redirecționări.");
      }
      url = assertSafeImageUrl(new URL(location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IntegrationError("image_download_failed", "Imaginea nu a putut fi descărcată.", { retryable: response.status >= 500 });
    }
    const type = String(response.headers?.["content-type"] || "").toLowerCase();
    if (!type.startsWith("image/")) throw new IntegrationError("image_not_an_image", "Fișierul nu este o imagine.");
    return { buffer: response.buffer, mime: type.split(";")[0].trim(), url };
  }
  throw new IntegrationError("image_too_many_redirects", "Imaginea are prea multe redirecționări.");
}

/**
 * @param {Object} options
 * @param {string[]} options.urls          imaginile externe, în ordine
 * @param {string} options.ownerUserId     utilizatorul vânzătorului (cheia R2: products/<userId>/…)
 * @param {Function} [options.upload]      uploadToR2 (injectat în teste)
 * @param {Function} [options.httpGet]     safeHttpsGet (injectat în teste)
 * @returns {{ urls: string[], failed: { url: string, code: string }[] }}
 */
export async function copyImagesToR2({ urls, ownerUserId, upload, httpGet }) {
  const uploader = upload || (await import("../../services/r2Storage.js")).uploadToR2;
  const copied = [];
  const failed = [];

  for (const [index, raw] of (urls || []).entries()) {
    try {
      const { buffer, mime, url } = await downloadImage(raw, httpGet ? { httpGet } : {});
      const name = decodeURIComponent(url.pathname.split("/").pop() || `imagine-${index + 1}.jpg`);
      const result = await uploader({
        file: { buffer, mimetype: mime, originalname: name, size: buffer.length },
        folder: "products",
        userId: ownerUserId,
        index,
        // doar imagini verificate după conținut; limita de pixeli e citită din
        // header înainte de decodare (vezi IMPORT_IMAGE_MAX_PIXELS)
        policy: "image",
        maxPixels: IMPORT_IMAGE_MAX_PIXELS,
      });
      copied.push(result.url);
    } catch (error) {
      failed.push({ url: String(raw), code: error?.code || "image_copy_failed" });
    }
  }

  return { urls: copied, failed };
}
