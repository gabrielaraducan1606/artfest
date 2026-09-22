// frontend/src/utils/seo/collectionSeo.js
//
// Sursă UNICĂ pentru SEO-ul paginilor /colectii/:slug și /colectii: folosită
// și de funcția Vercel /api/seo-colectie (HTML brut pentru boți) și de
// PublicCollections.jsx / CollectionsIndex.jsx (același conținut după ce
// React montează), ca canonical/title/description/JSON-LD din HTML-ul brut
// și din DOM-ul randat să fie IDENTICE (SeoProvider elimină JSON-LD-ul
// injectat server-side la mount - vezi SeoProvider.jsx - deci pagina
// trebuie să și-l re-emită cu exact aceleași date).
//
// Modul PUR (fără fetch, fără DOM, fără import.meta) - importabil atât
// din Node (api/), cât și din bundle-ul Vite (src/).

import {
  MAX_ITEMLIST_ITEMS,
  SITE_ORIGIN,
  buildBreadcrumbList,
  buildLinkItemList,
  buildProductItemList,
} from "./structuredData.js";
import { withPage, withPageInTitle } from "./pagination.js";

export { MAX_ITEMLIST_ITEMS, SITE_ORIGIN };

// Produse pe o pagină de colecție = limit-ul cerut la GET
// /api/public/collections/:slug (PublicCollections.jsx și funcția
// serverless folosesc aceeași valoare, deci ?page=N înseamnă aceeași
// felie în HTML-ul brut și în browser).
export const COLLECTION_PAGE_SIZE = MAX_ITEMLIST_ITEMS;

export const COLLECTION_FALLBACK_DESCRIPTION =
  "Descoperă produse handmade și cadouri personalizate pe Artfest.";

export const COLLECTIONS_INDEX_URL = `${SITE_ORIGIN}/colectii`;
export const COLLECTIONS_INDEX_TITLE = "Colecții handmade pentru fiecare ocazie";
export const COLLECTIONS_INDEX_DESCRIPTION =
  "Colecții Artfest de produse handmade și personalizate, alese pentru nunți, botezuri, cadouri și alte ocazii speciale.";

/**
 * Canonical determinist:
 *  - pagina 1: https://www.artfest.ro/colectii/:slug (fără query; aceeași
 *    formă ca <loc> din sitemap.xml, backend/src/routes/sitemap.js);
 *  - pagina N>1: https://www.artfest.ro/colectii/:slug?page=N (propriu,
 *    NU spre pagina 1).
 * Nu depinde de alte query params (?ref= etc.).
 */
export function collectionCanonicalUrl(slug, page = 1) {
  return withPage(
    `${SITE_ORIGIN}/colectii/${encodeURIComponent(String(slug || ""))}`,
    page
  );
}

// Titlul fără template - "%s • Artfest" e aplicat de SeoProvider în
// browser și replicat explicit în funcția serverless. Pagina N>1 primește
// sufixul "- Pagina N".
export function collectionSeoTitle(collection, page = 1) {
  return withPageInTitle(
    String(collection?.seoTitle || collection?.title || "").trim(),
    page
  );
}

export function collectionSeoDescription(collection) {
  return (
    String(
      collection?.seoDescription || collection?.subtitle || ""
    ).trim() || COLLECTION_FALLBACK_DESCRIPTION
  );
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value);
}

/**
 * Pașii breadcrumb-ului vizibil și ai BreadcrumbList:
 * Acasă > Colecții > [titlul colecției]. Același array alimentează
 * componenta <Breadcrumbs> și JSON-LD-ul, ca să nu se poată desincroniza.
 * `to` = calea internă (link real), `url` = URL absolut pentru JSON-LD.
 */
export function collectionBreadcrumbs(collection) {
  const name = String(collection?.title || "").trim();

  return [
    { name: "Acasă", to: "/", url: `${SITE_ORIGIN}/` },
    { name: "Colecții", to: "/colectii", url: COLLECTIONS_INDEX_URL },
    ...(name && collection?.slug
      ? [
          {
            name,
            to: `/colectii/${encodeURIComponent(collection.slug)}`,
            url: collectionCanonicalUrl(collection.slug),
          },
        ]
      : []),
  ];
}

/**
 * JSON-LD CollectionPage (+ ItemList în mainEntity).
 *
 * ItemList apare DOAR dacă există produse reale (id + titlu); nu emitem
 * niciodată o listă goală sau inventată. `numberOfItems` = câte produse
 * sunt efectiv listate (prima pagină), nu totalul colecției.
 *
 * @param {object} args
 * @param {object} args.collection  payload-ul `collection` din
 *   GET /api/public/collections/:slug
 * @param {Array}  args.items       payload-ul `items` (produse)
 * @param {(url:string)=>string|null} [args.resolveImage]
 * @param {number} [args.page]      pagina curentă (implicit 1); `items` =
 *   produsele ACELEI pagini - ItemList le listează doar pe ele, cu poziții
 *   care continuă între pagini.
 */
export function buildCollectionJsonLd({
  collection,
  items = [],
  resolveImage = (url) => url,
  page = 1,
} = {}) {
  if (!collection?.slug) return null;

  const url = collectionCanonicalUrl(collection.slug, page);
  const name =
    collectionSeoTitle(collection, page) || collection.title || "";
  const heroImage = resolveImage(collection.heroImage || "");
  const itemList = buildProductItemList(items, {
    max: COLLECTION_PAGE_SIZE,
    startPosition: (page - 1) * COLLECTION_PAGE_SIZE + 1,
  });

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": url,
    url,
    name,
    description: collectionSeoDescription(collection),
    ...(isHttpUrl(heroImage) ? { image: heroImage } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: "Artfest",
      url: SITE_ORIGIN,
    },
    ...(itemList ? { mainEntity: itemList } : {}),
  };
}

/**
 * Tot structured data-ul paginii unei colecții, ca array de noduri
 * JSON-LD: CollectionPage (+ ItemList) și BreadcrumbList. Sursă unică
 * pentru funcția serverless și pentru pagina React.
 */
export function buildCollectionStructuredData(args = {}) {
  const page = buildCollectionJsonLd(args);
  if (!page) return [];

  const breadcrumb = buildBreadcrumbList(
    collectionBreadcrumbs(args.collection)
  );

  return [
    page,
    ...(breadcrumb
      ? [{ "@context": "https://schema.org", ...breadcrumb }]
      : []),
  ];
}

/**
 * Structured data pentru pagina index /colectii: CollectionPage cu
 * ItemList al colecțiilor REALE (din GET /api/public/collections) +
 * BreadcrumbList Acasă > Colecții. Fără colecții => fără ItemList.
 *
 * @param {Array<{slug:string,title:string}>} collections
 */
export function buildCollectionsIndexStructuredData(collections = []) {
  const itemList = buildLinkItemList(
    (Array.isArray(collections) ? collections : [])
      .filter((c) => c?.slug && c?.title)
      .map((c) => ({
        name: c.title,
        url: collectionCanonicalUrl(c.slug),
      }))
  );

  const breadcrumb = buildBreadcrumbList([
    { name: "Acasă", url: `${SITE_ORIGIN}/` },
    { name: "Colecții", url: COLLECTIONS_INDEX_URL },
  ]);

  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": COLLECTIONS_INDEX_URL,
      url: COLLECTIONS_INDEX_URL,
      name: COLLECTIONS_INDEX_TITLE,
      description: COLLECTIONS_INDEX_DESCRIPTION,
      isPartOf: { "@type": "WebSite", name: "Artfest", url: SITE_ORIGIN },
      ...(itemList ? { mainEntity: itemList } : {}),
    },
    ...(breadcrumb
      ? [{ "@context": "https://schema.org", ...breadcrumb }]
      : []),
  ];
}
