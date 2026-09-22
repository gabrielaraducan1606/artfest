// frontend/src/utils/seo/structuredData.js
//
// Builder-e PURE (fără fetch/DOM/import.meta) pentru JSON-LD comun
// colecțiilor și categoriilor, importabile din funcțiile Vercel (api/) și
// din bundle-ul Vite (src/).
//
// Regulă: niciodată date inventate. Un ItemList fără produse reale sau un
// BreadcrumbList fără nume/URL valide NU se emite (întoarce null).

export const SITE_ORIGIN = "https://www.artfest.ro";

// Câte produse intră în ItemList (prima pagină a listei).
export const MAX_ITEMLIST_ITEMS = 24;

/**
 * BreadcrumbList. `crumbs` = [{ name, url }] în ordine (Acasă -> ... ->
 * pagina curentă). Intrările fără nume sau fără URL http(s) sunt omise;
 * mai puțin de 2 intrări valide => null (un breadcrumb cu un singur pas
 * nu e util).
 */
export function buildBreadcrumbList(crumbs) {
  const valid = (Array.isArray(crumbs) ? crumbs : []).filter(
    (c) =>
      c &&
      typeof c.name === "string" &&
      c.name.trim() &&
      typeof c.url === "string" &&
      /^https?:\/\/\S+$/i.test(c.url)
  );

  if (valid.length < 2) return null;

  return {
    "@type": "BreadcrumbList",
    itemListElement: valid.map((c, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: c.name.trim(),
      item: c.url,
    })),
  };
}

/**
 * ItemList din produse REALE (id + titlu). Fără produse valide => null.
 * `numberOfItems` = câte produse sunt efectiv listate (pagina curentă), nu
 * totalul din colecție/categorie. `startPosition` = poziția primului produs
 * din pagină în lista completă ((page-1) * pageSize + 1), ca pozițiile să
 * continue între pagini.
 */
export function buildProductItemList(
  items,
  { max = MAX_ITEMLIST_ITEMS, startPosition = 1 } = {}
) {
  const products = (Array.isArray(items) ? items : [])
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        p.id.trim() &&
        typeof p.title === "string" &&
        p.title.trim()
    )
    .slice(0, max);

  if (!products.length) return null;

  return {
    "@type": "ItemList",
    numberOfItems: products.length,
    itemListElement: products.map((p, index) => ({
      "@type": "ListItem",
      position: startPosition + index,
      url: `${SITE_ORIGIN}/produs/${encodeURIComponent(p.id)}`,
      name: p.title.trim(),
    })),
  };
}

/**
 * ItemList de linkuri către pagini (ex. colecțiile din /colectii).
 * `entries` = [{ url, name }]; fără intrări valide => null.
 */
export function buildLinkItemList(entries, { max = 60 } = {}) {
  const valid = (Array.isArray(entries) ? entries : [])
    .filter(
      (e) =>
        e &&
        typeof e.name === "string" &&
        e.name.trim() &&
        typeof e.url === "string" &&
        /^https?:\/\/\S+$/i.test(e.url)
    )
    .slice(0, max);

  if (!valid.length) return null;

  return {
    "@type": "ItemList",
    numberOfItems: valid.length,
    itemListElement: valid.map((e, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: e.url,
      name: e.name.trim(),
    })),
  };
}
