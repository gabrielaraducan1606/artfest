// src/pages/Vendor/Produse/hooks/customizationQuantity.js
//
// Verificarea cantității pentru produsele personalizate cu mai multe
// fotografii (clientul a încărcat N fotografii, dar a ales mai puține bucăți).
//
// Ordinea:
//   1. fotografii <= cantitate -> nimic de verificat (fără AI);
//   2. reguli simple pe textul produsului (colaj/album -> un produs;
//      magneți/printuri -> câte unul per fotografie);
//   3. doar dacă rămâne ambiguu: AI-ul de pe server (doar textul produsului,
//      niciodată fotografiile), cu timeout scurt;
//   4. AI indisponibil / neclar -> întrebăm clientul.
// Nu schimbăm nimic singuri: clientul alege, prețul îl calculează coșul.

import { toPhotoList } from "./customizationUpload.js";

export const QUANTITY_AI_ENDPOINT = "/api/public/customization-quantity";
export const QUANTITY_AI_TIMEOUT_MS = 4000;

const IMAGE_FIELD_TYPES = ["image", "photo", "file"];

export function normalizeQuantityText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Câte fotografii are câmpul cu cele mai multe fotografii. Câmpurile
 * diferite NU se adună (ex. „fotografie copertă” + „fotografii interior”
 * pot fi același produs).
 */
export function countCustomizationPhotos(customSchema, customAnswers) {
  const fields = Array.isArray(customSchema) ? customSchema : [];
  let max = 0;

  for (const field of fields) {
    const type = String(field?.type || "").toLowerCase();
    if (!IMAGE_FIELD_TYPES.includes(type) || !field?.key) continue;
    max = Math.max(max, toPhotoList(customAnswers?.[field.key]).length);
  }

  return max;
}

/* Un produs care folosește mai multe fotografii împreună. */
const SINGLE_PRODUCT_PATTERNS = [
  /\bcolaj/,
  /\bcollage/,
  /\bmozaic/,
  /\balbum/,
  /\bfotocart/,
  /\bcart(e|i) foto/,
  /\bphoto ?book/,
  /\bcalendar/,
  /\bscrapbook/,
  /\bmai multe (poze|fotografii|imagini)\b/,
  /\b(pana la|maxim|max\.?) \d+ (de )?(poze|fotografii|imagini)\b/,
  /\b(tablou|poster|panou|rama|cutie|caiet|jurnal)\b[^.]{0,40}\b\d+ (de )?(poze|fotografii|imagini)\b/,
];

/* O bucată pentru fiecare fotografie. */
const PER_PHOTO_PATTERNS = [
  /\bmagnet/,
  /\bpolaroid/,
  /\bdevelopa/,
  /\bprint(uri)? foto/,
  /\bfotografii printate\b/,
  /\binsign/,
  /\bper (fotografie|poza|imagine)\b/,
  /\bpentru fiecare (fotografie|poza|imagine)\b/,
  /\bo (fotografie|poza) (pe|per) (bucata|produs)\b/,
];

/**
 * @returns {"single_product"|"per_photo"|"ambiguous"}
 */
export function classifyQuantityLocally({ title, description, category, customSchema } = {}) {
  const fieldText = (Array.isArray(customSchema) ? customSchema : [])
    .map((field) => `${field?.label || ""} ${field?.description || ""} ${field?.placeholder || ""}`)
    .join(" ");

  const text = normalizeQuantityText(`${title || ""} . ${category || ""} . ${fieldText} . ${description || ""}`);

  const single = SINGLE_PRODUCT_PATTERNS.some((re) => re.test(text));
  const perPhoto = PER_PHOTO_PATTERNS.some((re) => re.test(text));

  if (single && !perPhoto) return "single_product";
  if (perPhoto && !single) return "per_photo";
  return "ambiguous";
}

/**
 * Ce face pagina înainte de „Adaugă în coș”.
 * @returns {"proceed"|"ask"|"need_ai"}
 */
export function decideQuantityCheck({ photoCount, qty, localKind, aiKind } = {}) {
  if (!(photoCount > 1) || photoCount <= (Number(qty) || 1)) return "proceed";
  if (localKind === "single_product") return "proceed";
  if (localKind === "per_photo") return "ask";
  if (aiKind === undefined) return "need_ai";
  return aiKind === "single_product" ? "proceed" : "ask";
}

/*
 * Clasificarea AI de pe server. Nu trimite nimic despre client: doar id-ul
 * produsului în URL. Orice problemă (timeout, 429, rețea) -> "unclear".
 */
export async function fetchQuantityKind(productId, { timeoutMs = QUANTITY_AI_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!productId || typeof fetchImpl !== "function") return "unclear";

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetchImpl(`${QUANTITY_AI_ENDPOINT}/${encodeURIComponent(productId)}`, {
      method: "POST",
      credentials: "omit",
      signal: controller?.signal,
    });
    if (!res?.ok) return "unclear";
    const body = await res.json();
    return ["per_photo", "single_product"].includes(body?.kind) ? body.kind : "unclear";
  } catch {
    return "unclear";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* „1 produs”, „20 de produse” (forma românească de după 19). */
export function productsLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return "1 produs";
  const rest = n % 100;
  return rest === 0 || rest >= 20 ? `${n} de produse` : `${n} produse`;
}

export function photosLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return "1 fotografie";
  const rest = n % 100;
  return rest === 0 || rest >= 20 ? `${n} de fotografii` : `${n} fotografii`;
}
