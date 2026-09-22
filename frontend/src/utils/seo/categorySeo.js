// frontend/src/utils/seo/categorySeo.js
//
// Sursă UNICĂ pentru SEO-ul paginilor /categorii/:slug: folosită și de
// funcția Vercel /api/seo-categorie (HTML brut pentru boți) și de
// Products.jsx (același conținut după ce React montează - SeoProvider
// elimină JSON-LD-ul injectat server-side la mount, deci pagina trebuie
// să-l re-emită identic).
//
// Modul PUR (fără fetch/DOM/import.meta). Primește obiectul categoriei
// (din frontend/src/constants/seoCategories.js) ca argument - nu îl
// importă, ca să rămână independent de bundling.

import {
  SITE_ORIGIN,
  buildBreadcrumbList,
  buildProductItemList,
} from "./structuredData.js";
import { withPage, withPageInTitle } from "./pagination.js";

// Produse pe o pagină de categorie = LIMIT-ul din Products.jsx (care
// importă această constantă) și limit-ul cerut de funcția serverless la
// GET /api/public/product-cards: ?page=N înseamnă aceeași felie în HTML-ul
// brut și în browser.
export const CATEGORY_PAGE_SIZE = 8;

export const CATEGORIES_INDEX_URL = `${SITE_ORIGIN}/categorii`;

/**
 * Canonical: pagina 1 fără query, pagina N>1 cu ?page=N (propriu, NU spre
 * pagina 1).
 */
export function categoryCanonicalUrl(slug, page = 1) {
  return withPage(
    `${SITE_ORIGIN}/categorii/${encodeURIComponent(String(slug || ""))}`,
    page
  );
}

// Aceeași formulă ca <SEO title=...> din Products.jsx; template-ul
// "%s • Artfest" e aplicat de SeoProvider (browser) / funcția serverless.
// Pagina N>1 primește sufixul "- Pagina N".
export function categorySeoTitle(category, page = 1) {
  return withPageInTitle(`${category?.title || ""} | Produse`.trim(), page);
}

export function categorySeoDescription(category) {
  return String(category?.description || "").trim();
}

/**
 * Pașii breadcrumb-ului vizibil și ai BreadcrumbList:
 * Acasă > Categorii > [categoria]. `to` = link intern real, `url` = URL
 * absolut pentru JSON-LD.
 */
export function categoryBreadcrumbs(category) {
  const name = String(category?.h1 || category?.label || "").trim();

  return [
    { name: "Acasă", to: "/", url: `${SITE_ORIGIN}/` },
    { name: "Categorii", to: "/categorii", url: CATEGORIES_INDEX_URL },
    ...(name && category?.slug
      ? [
          {
            name,
            to: `/categorii/${encodeURIComponent(category.slug)}`,
            url: categoryCanonicalUrl(category.slug),
          },
        ]
      : []),
  ];
}

function faqPage(category) {
  const faq = (Array.isArray(category?.faq) ? category.faq : []).filter(
    (item) =>
      item &&
      typeof item.q === "string" &&
      item.q.trim() &&
      typeof item.a === "string" &&
      item.a.trim()
  );

  if (!faq.length) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/**
 * Structured data pentru o pagină de categorie, ca array de noduri:
 *  - CollectionPage (+ ItemList în mainEntity, doar cu produse reale);
 *  - BreadcrumbList Acasă > Categorii > categorie;
 *  - FAQPage din FAQ-ul vizibil pe pagină (dacă există).
 *
 * `items` = produsele PAGINII curente (id + titlu). Fără produse => fără
 * ItemList; pozițiile continuă între pagini. FAQPage doar pe pagina 1 (FAQ-ul
 * e același pe toate paginile - nu îl repetăm ca markup).
 */
export function buildCategoryStructuredData({
  category,
  items = [],
  page = 1,
} = {}) {
  if (!category?.slug) return [];

  const url = categoryCanonicalUrl(category.slug, page);
  const itemList = buildProductItemList(items, {
    max: CATEGORY_PAGE_SIZE,
    startPosition: (page - 1) * CATEGORY_PAGE_SIZE + 1,
  });
  const breadcrumb = buildBreadcrumbList(categoryBreadcrumbs(category));
  const faq = page > 1 ? null : faqPage(category);

  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: withPageInTitle(
        category.h1 || category.title || category.label || "",
        page
      ),
      description: categorySeoDescription(category),
      isPartOf: { "@type": "WebSite", name: "Artfest", url: SITE_ORIGIN },
      ...(itemList ? { mainEntity: itemList } : {}),
    },
    ...(breadcrumb
      ? [{ "@context": "https://schema.org", ...breadcrumb }]
      : []),
    ...(faq ? [faq] : []),
  ];
}
