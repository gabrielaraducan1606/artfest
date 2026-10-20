// src/pages/Vendor/CatalogProduse/VendorCollections/collectionPicker.js
//
// Logica PURĂ a selectorului de produse din editorul de colecții (fără
// React): parametrii căutării pe server, filtrele active, selecția
// multiplă și limita colecției. Testată în collectionPicker.test.js.

export const PICKER_PAGE_SIZE = 24;

export const SOURCE_OPTIONS = [
  { value: "own", label: "Din magazinul meu", hint: "Doar produsele tale" },
  { value: "marketplace", label: "Din tot Artfest", hint: "Inclusiv produsele altor creatori" },
];

// valorile ProductAvailability acceptate de backend (buildCollectionProductSearchWhere)
export const AVAILABILITY_OPTIONS = [
  { value: "", label: "Orice disponibilitate" },
  { value: "READY", label: "Gata de livrare" },
  { value: "MADE_TO_ORDER", label: "Realizat la comandă" },
  { value: "PREORDER", label: "Precomandă" },
];

export const EMPTY_FILTERS = Object.freeze({
  q: "",
  store: "",
  category: "",
  occasion: "",
  availability: "",
  minPrice: "",
  maxPrice: "",
  personalizable: false,
});

function clean(value) {
  return String(value ?? "").trim();
}

function validPrice(value) {
  const text = clean(value).replace(",", ".");
  if (!text) return "";
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : "";
}

/**
 * Filtrele trimise la server (aceleași pentru căutare și „selectează toate”),
 * fără câmpuri goale.
 */
export function serverFilters(scope, filters = EMPTY_FILTERS) {
  const out = { scope: scope === "own" ? "own" : "marketplace" };

  for (const key of ["q", "store", "category", "occasion", "availability"]) {
    // filtrul de magazin nu are sens pentru „Magazinul meu”
    if (key === "store" && out.scope === "own") continue;
    const value = clean(filters[key]);
    if (value) out[key] = value;
  }

  const minPrice = validPrice(filters.minPrice);
  const maxPrice = validPrice(filters.maxPrice);
  if (minPrice) out.minPrice = minPrice;
  if (maxPrice) out.maxPrice = maxPrice;

  if (filters.personalizable === true) out.personalizable = "1";

  return out;
}

/** Query-ul pentru GET /api/vendor/collections/:id/product-search */
export function buildSearchParams(scope, filters, page = 1, limit = PICKER_PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [key, value] of Object.entries(serverFilters(scope, filters))) {
    params.set(key, value);
  }
  return params;
}

/** Câte filtre (în afară de textul căutării și sursă) sunt active - pentru badge. */
export function activeFilterCount(filters = EMPTY_FILTERS) {
  const f = serverFilters("marketplace", filters);
  return ["store", "category", "occasion", "availability", "minPrice", "maxPrice", "personalizable"].filter(
    (key) => key in f
  ).length;
}

/**
 * Un rezultat se poate bifa doar dacă nu e deja în colecție și nu e inclus
 * automat (produs propriu + „Include automat toate produsele mele”).
 */
export function isSelectable(product, { allOwnActive = false } = {}) {
  if (!product) return false;
  if (product.inCollection) return false;
  if (product.isOwn && allOwnActive) return false;
  return true;
}

/** Câte produse mai încap în colecție. */
export function remainingCapacity(collectionCount, maxProducts) {
  return Math.max(0, Number(maxProducts || 0) - Number(collectionCount || 0));
}

/**
 * Bifează / debifează un produs, fără să depășească limita colecției.
 * Întoarce { selected: Set, blocked: boolean }.
 */
export function toggleSelection(selected, productId, remaining) {
  const next = new Set(selected);

  if (next.has(productId)) {
    next.delete(productId);
    return { selected: next, blocked: false };
  }

  if (next.size >= remaining) {
    return { selected, blocked: true };
  }

  next.add(productId);
  return { selected: next, blocked: false };
}

/**
 * „Selectează toate de pe pagină”: adaugă rezultatele bifabile vizibile,
 * până la limita colecției. Întoarce și câte nu au mai încăput.
 */
export function selectVisible(selected, products, remaining, options = {}) {
  const next = new Set(selected);
  let skipped = 0;

  for (const product of products || []) {
    if (!isSelectable(product, options) || next.has(product.id)) continue;
    if (next.size >= remaining) {
      skipped += 1;
      continue;
    }
    next.add(product.id);
  }

  return { selected: next, skipped };
}

/** Mesajul pentru răspunsul de limită de la server (collection_product_limit). */
export function limitMessage(data) {
  if (!data || data.error !== "collection_product_limit") return "";
  if (data.message) return data.message;
  return `Colecția poate avea maximum ${data.maxProducts} produse. Mai poți adăuga ${data.remaining}.`;
}

/**
 * Lipește pagina următoare de rezultate fără duplicate (paginarea pe server e
 * pe offset - un produs publicat între timp poate împinge rezultatele).
 */
export function mergeResults(current = [], next = []) {
  const seen = new Set(current.map((p) => p.id));
  return [...current, ...next.filter((p) => p && !seen.has(p.id) && seen.add(p.id))];
}
