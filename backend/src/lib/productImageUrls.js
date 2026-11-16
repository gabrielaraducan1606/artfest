// backend/src/lib/productImageUrls.js
//
// Ce URL-uri de imagine poate salva un VÂNZĂTOR pe un produs
// (POST /api/vendors/store/:slug/products, PUT /api/vendors/products/:id):
//
//   1. URL-urile pe care produsul le are DEJA (fotografiile existente rămân
//      valabile oricum ar fi fost adăugate: import, Admin, versiuni vechi);
//   2. fișierele încărcate de ACELAȘI utilizator în R2:
//        <R2_PUBLIC_BASE_URL>/products/<userId>/...
//      (ruta veche POST /api/upload/products și uploadul direct scriu aici);
//   3. URL-urile folosite deja pe alt produs al ACELUIAȘI vânzător.
//
// Orice alt URL (extern, al altui utilizator, alt folder) e refuzat, ca un
// vânzător să nu poată folosi fotografia altuia sau o adresă arbitrară.
//
// Comutator de urgență: PRODUCT_IMAGE_URL_CHECK=log -> doar înregistrează în
// log ce ar fi refuzat, fără să blocheze salvarea.

import { buildPublicUrl } from "../services/r2Storage.js";

const MAX_URL_LENGTH = 1000;

export function productImageUrlCheckMode(env = process.env) {
  return String(env.PRODUCT_IMAGE_URL_CHECK || "").trim().toLowerCase() === "log" ? "log" : "enforce";
}

/** Fișier încărcat de `userId` în folderul de produse (fără căi relative / parametri). */
export function isOwnUploadedProductImageUrl(url, userId, { publicUrl = buildPublicUrl } = {}) {
  if (typeof url !== "string" || !userId || url.length > MAX_URL_LENGTH) return false;
  const prefix = publicUrl(`products/${userId}/`);
  if (!prefix || !url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  return rest.length > 0 && !rest.includes("..") && !/[?#\s\\]/.test(rest);
}

/**
 * @param {{ images: string[], userId: string, vendorId?: string|null, existingImages?: string[],
 *           db?: object, publicUrl?: Function }} input
 * @returns {Promise<{ ok: true } | { ok: false, rejected: string[] }>}
 */
export async function checkVendorProductImageUrls({
  images,
  userId,
  vendorId = null,
  existingImages = [],
  db = null,
  publicUrl = buildPublicUrl,
}) {
  const list = Array.isArray(images) ? images : [];
  const existing = new Set(Array.isArray(existingImages) ? existingImages : []);

  let unknown = list.filter((url) => !existing.has(url) && !isOwnUploadedProductImageUrl(url, userId, { publicUrl }));
  if (!unknown.length) return { ok: true };

  // folosite deja de același vânzător (ex. aceeași fotografie pe două produse)
  if (vendorId && db?.product?.findMany) {
    const rows = await db.product.findMany({
      where: { service: { vendorId }, images: { hasSome: unknown } },
      select: { images: true },
      take: 50,
    });
    const known = new Set(rows.flatMap((row) => row.images || []));
    unknown = unknown.filter((url) => !known.has(url));
  }

  return unknown.length ? { ok: false, rejected: unknown } : { ok: true };
}

export const INVALID_PRODUCT_IMAGES_RESPONSE = Object.freeze({
  error: "invalid_product_images",
  message:
    "Unele fotografii nu au fost încărcate din contul tău Artfest. Încarcă-le din nou din formularul produsului.",
});

/**
 * Pentru rute: true = poate salva; false = răspunsul 400 a fost deja trimis.
 * În modul "log" nu blochează niciodată.
 */
export async function enforceVendorProductImageUrls(res, input, { env = process.env, logger = console } = {}) {
  let result;
  try {
    result = await checkVendorProductImageUrls(input);
  } catch (error) {
    // verificarea însăși a eșuat (ex. baza de date): în modul "log" salvarea continuă
    logger.error?.("[PRODUCT IMAGES] verificarea URL-urilor a eșuat", { userId: input.userId, error: error?.message });
    if (productImageUrlCheckMode(env) === "log") return true;
    res.status(503).json({
      error: "image_check_unavailable",
      message: "Nu am putut verifica fotografiile acum. Încearcă din nou peste câteva secunde.",
    });
    return false;
  }
  if (result.ok) return true;

  logger.warn?.("[PRODUCT IMAGES] URL-uri neacceptate", {
    mod: productImageUrlCheckMode(env),
    userId: input.userId,
    vendorId: input.vendorId || null,
    numar: result.rejected.length,
    // doar originea, nu URL-ul complet
    origini: [...new Set(result.rejected.map((url) => {
      try {
        return new URL(url).origin;
      } catch {
        return "invalid";
      }
    }))],
  });

  if (productImageUrlCheckMode(env) === "log") return true;
  res.status(400).json(INVALID_PRODUCT_IMAGES_RESPONSE);
  return false;
}
