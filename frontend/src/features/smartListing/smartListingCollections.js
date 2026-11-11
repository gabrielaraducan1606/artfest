// src/features/smartListing/smartListingCollections.js
//
// Secțiunea opțională „Colecții” din Smart Listing - fără sistem paralel:
//   lista     = GET  /api/vendor/collections            (doar colecțiile vânzătorului)
//   creare    = POST /api/vendor/collections            ({ title })
//   asociere  = POST /api/vendor/collections/attach-product (după crearea produsului)
// Serverul verifică proprietatea produsului și a colecțiilor.

export const COLLECTIONS_ENDPOINT = "/api/vendor/collections";
export const ATTACH_ENDPOINT = "/api/vendor/collections/attach-product";
export const MAX_SELECTED_COLLECTIONS = 20;

export function normalizeCollectionIds(ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const value = typeof id === "string" ? id.trim() : "";
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= MAX_SELECTED_COLLECTIONS) break;
  }
  return out;
}

export function toggleCollectionId(ids, id) {
  const current = normalizeCollectionIds(ids);
  if (current.includes(id)) return current.filter((x) => x !== id);
  return normalizeCollectionIds([...current, id]);
}

/** Din răspunsul GET: doar ce afișăm (endpointul întoarce deja doar colecțiile vânzătorului). */
export function mapCollections(response) {
  const list = Array.isArray(response?.collections) ? response.collections : [];
  return list
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({
      id: c.id,
      title: String(c.title || "Colecție"),
      productsCount: Number(c.productsCount || 0),
      // „toate produsele mele”: produsul intră automat, nu are sens bifat manual
      auto: Boolean(c.allOwnProducts),
      inactive: c.isActive === false || ["INACTIVE", "EXPIRED"].includes(String(c.status || "").toUpperCase()),
    }));
}

export function validateNewCollectionTitle(title) {
  const value = String(title || "").trim();
  if (value.length < 2) return "Numele colecției trebuie să aibă minimum 2 caractere.";
  if (value.length > 160) return "Numele colecției poate avea maximum 160 de caractere.";
  return "";
}

export async function createCollection({ api, title }) {
  const data = await api(COLLECTIONS_ENDPOINT, { method: "POST", body: { title: String(title).trim() } });
  return data?.collection || null;
}

export async function attachProductToCollections({ api, productId, collectionIds }) {
  const ids = normalizeCollectionIds(collectionIds);
  if (!productId || !ids.length) return null;
  return api(ATTACH_ENDPOINT, { method: "POST", body: { productId, collectionIds: ids } });
}

/**
 * Rândurile pentru ecranul de după salvare.
 * @param {Object|null} result răspunsul attach-product
 * @param {{ publicNow: boolean }} opts produsul e deja public?
 */
export function describeAttachResult(result, { publicNow = false } = {}) {
  if (!result) return [];
  const lines = [];
  const added = (result.added || []).length + (result.already || []).length;
  if (added) {
    lines.push(
      publicNow
        ? `Produsul a fost adăugat în ${added === 1 ? "colecția aleasă" : `${added} colecții`}.`
        : `Produsul a fost adăugat în ${added === 1 ? "colecția aleasă" : `${added} colecții`} și va apărea acolo după ce este publicat.`
    );
  }
  if ((result.full || []).length) {
    lines.push(`${result.full.length} colecție(i) au atins limita de produse; produsul nu a fost adăugat acolo.`);
  }
  if ((result.notFound || []).length) {
    lines.push(`${result.notFound.length} colecție(i) nu mai există; le poți alege din nou din pagina Colecții.`);
  }
  return lines;
}

export const ATTACH_FAILED_LINE =
  "Produsul a fost salvat, dar nu l-am putut adăuga în colecții. Îl poți adăuga din pagina Colecții.";
