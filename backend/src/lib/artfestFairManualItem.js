// backend/src/lib/artfestFairManualItem.js
//
// Produse MANUALE în inventarul Târgului Artfest: linii de inventar fără
// produs în catalogul online (productId = NULL). Nu se creează niciun
// Product; linia are propriile snapshot-uri (denumire, preț, fotografie)
// și primește un cod AF ca orice altă linie.
//
// Marcajul „manual” este variantKey = "manual:<32 hex>":
//   - liniile din magazin au variantKey = sha256 hex (64 caractere, fără „:”),
//     deci cele două nu se pot confunda;
//   - o linie al cărei produs a fost șters (productId devine NULL prin
//     ON DELETE SET NULL) NU devine manuală: variantKey-ul ei rămâne hash-ul;
//   - cheia derivă din (înscriere, clientRequestId) => o salvare repetată a
//     aceluiași formular găsește linia existentă în loc să creeze un duplicat.
// Fără coloană nouă, fără migrație.

import crypto from "node:crypto";

export const MANUAL_VARIANT_PREFIX = "manual:";
export const MANUAL_TITLE_MAX = 200;
// 1.000.000 lei / bucată: limită de siguranță împotriva greșelilor de tastare
export const MANUAL_PRICE_MAX_CENTS = 100_000_000;
const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const PRICE_RE = /^\d{1,7}(?:[.,]\d{1,2})?$/;

export function isManualFairItem(item) {
  return typeof item?.variantKey === "string" && item.variantKey.startsWith(MANUAL_VARIANT_PREFIX);
}

export function isValidClientRequestId(value) {
  return typeof value === "string" && CLIENT_REQUEST_ID_RE.test(value);
}

export function manualVariantKey(registrationId, clientRequestId) {
  const hash = crypto.createHash("sha256").update(`${registrationId}:${clientRequestId}`).digest("hex");
  return `${MANUAL_VARIANT_PREFIX}${hash.slice(0, 32)}`;
}

/*
 * Prețul unitar în lei („12”, „12,5”, „12.50”) -> bani întregi.
 * Fără float: partea zecimală se citește ca text.
 */
export function parsePriceRonToCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, "");
  if (!PRICE_RE.test(text)) return null;
  const [lei, bani = ""] = text.split(/[.,]/);
  const cents = Number(lei) * 100 + Number((bani + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MANUAL_PRICE_MAX_CENTS) return null;
  return cents;
}

export function cleanManualTitle(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MANUAL_TITLE_MAX) return null;
  return text;
}

function publicBase(env = process.env) {
  if (env.R2_PUBLIC_BASE_URL) return String(env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (env.R2_BUCKET_NAME && env.R2_ACCOUNT_ID) {
    return `https://${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  return null;
}

/*
 * Fotografia unui produs manual: DOAR un fișier încărcat de același
 * utilizator prin POST /api/upload/products (cheia R2 products/<userId>/…).
 * Orice alt URL (extern, al altui utilizator, alt folder) e respins.
 */
export function isAllowedManualImageUrl(url, userId, env = process.env) {
  const base = publicBase(env);
  if (!base || !userId || typeof url !== "string" || url.length > 1000) return false;
  const prefix = `${base}/products/${userId}/`;
  if (!url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  return rest.length > 0 && !rest.includes("..") && !/[?#\s]/.test(rest);
}
