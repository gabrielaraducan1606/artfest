// frontend/api/seo-categorie.js
//
// Același model ca seo-colectie.js / seo-produs.js / seo-magazin.js, pentru
// /categorii/:slug (vezi rewrite-ul din vercel.json). Servește shell-ul
// static al SPA (index.html) cu title/description/canonical/OG/JSON-LD
// (CollectionPage + ItemList + BreadcrumbList + FAQPage) deja injectate în
// <head>, ÎNAINTE ca vreun JS să ruleze. <body> rămâne neschimbat.
//
// Metadatele vin din constantele SEO ale frontend-ului
// (src/constants/seoCategories.js - aceleași pe care le folosește
// CategoryPage.jsx), deci nu depind de backend. Backend-ul (endpoint-ul
// public GET /api/public/product-cards, același ca Products.jsx) e folosit
// DOAR pentru ItemList; dacă nu răspunde, pagina primește aceleași
// metadate fără ItemList - nu inventăm produse.
//
// Se aplică IDENTIC tuturor request-urilor, indiferent de User-Agent.

import { injectHead } from "./_lib/htmlHead.js";
import { parsePage } from "../src/utils/seo/pagination.js";
import {
  CATEGORY_PAGE_SIZE,
  categoryCanonicalUrl,
  categorySeoDescription,
  categorySeoTitle,
  buildCategoryStructuredData,
} from "../src/utils/seo/categorySeo.js";

const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN || "https://artfest.onrender.com";
const SITE_ORIGIN = "https://www.artfest.ro";

async function fetchShellHtml() {
  const res = await fetch(`${SITE_ORIGIN}/index.html`);
  if (!res.ok) throw new Error(`shell_fetch_failed_${res.status}`);
  return res.text();
}

function sendShellUnchanged(res, shellHtml, cacheControl) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cacheControl);
  res.status(200).send(shellHtml);
}

// Import dinamic (literal, deci urmărit de bundler) ca o problemă de
// bundling a constantelor să nu dea 500 pe toate categoriile: fail-open
// pe shell neschimbat, ca la orice altă eroare.
async function loadCategoryBySlug(slug) {
  const mod = await import("../src/constants/seoCategories.js");
  const category = mod.getCategoryBySlug(slug);

  // getCategoryBySlug caută într-un obiect simplu: "constructor"/
  // "__proto__" nu sunt categorii reale (nu au `key` string).
  return category && typeof category.key === "string" ? category : null;
}

// Același endpoint, aceeași dimensiune de pagină și aceeași sortare ca
// Products.jsx (GET /api/public/product-cards, LIMIT=CATEGORY_PAGE_SIZE,
// sort=new implicit): ?page=N e aceeași felie în HTML-ul brut și în
// browser. `ok=false` = nu știm (eroare de rețea/backend) - diferit de o
// pagină goală.
async function fetchCategoryProducts(categoryKey, page) {
  try {
    const apiRes = await fetch(
      `${BACKEND_ORIGIN}/api/public/product-cards?category=${encodeURIComponent(
        categoryKey
      )}&page=${page}&limit=${CATEGORY_PAGE_SIZE}&sort=new`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!apiRes.ok) return { ok: false, items: [] };

    const data = await apiRes.json();
    return {
      ok: true,
      items: Array.isArray(data?.items) ? data.items : [],
    };
  } catch {
    return { ok: false, items: [] };
  }
}

export default async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();

  // ?page=N: invalid (0, negativ, NaN, zecimal, listă...) => pagina 1, cu
  // canonical curat (nu generăm niciodată ?page=0).
  const { page } = parsePage(req.query?.page);

  let shellHtml;
  try {
    shellHtml = await fetchShellHtml();
  } catch (e) {
    console.error("[seo-categorie] shell fetch failed:", e);
    res.status(500).send("seo_shell_unavailable");
    return;
  }

  if (!slug) {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  let category;
  try {
    category = await loadCategoryBySlug(slug);
  } catch (e) {
    console.error("[seo-categorie] category constants unavailable:", e);
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  if (!category) {
    // Slug fără pagină de categorie: 404 real + noindex, fără
    // CollectionPage/ItemList fals. (SPA-ul redirecționează oricum la
    // /produse după ce montează - CategoryPage.jsx.)
    const html = injectHead(shellHtml, {
      title: "Categorie indisponibilă | Artfest",
      robots: "noindex",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=120"
    );
    res.status(404).send(html);
    return;
  }

  const { ok, items } = await fetchCategoryProducts(category.key, page);

  // Pagină dincolo de ultima: API-ul răspunde 200 cu listă goală (ok=true).
  // Răspundem 404 REAL + noindex, fără canonical și fără CollectionPage/
  // ItemList/JSON-LD. Nu redirecționăm la ultima pagină și nu o transformăm
  // în page=1 (doar un ?page= invalid sintactic se normalizează la 1 - vezi
  // parsePage). O eroare de backend (ok=false) NU se tratează ca pagină
  // goală: servim metadatele paginii, fără ItemList. SPA-ul se montează
  // oricum peste 404 și afișează mesajul + linkul "Înapoi la prima pagină"
  // (Products.jsx).
  if (page > 1 && ok && items.length === 0) {
    const html = injectHead(shellHtml, {
      title: "Pagină indisponibilă | Artfest",
      robots: "noindex",
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=120"
    );
    res.status(404).send(html);
    return;
  }

  // Canonical determinist, din slug-ul real al categoriei: pagina 1 fără
  // query, pagina N>1 cu ?page=N (propriu, NU spre pagina 1).
  const canonical = categoryCanonicalUrl(category.slug, page);

  // Aceeași formulă ca <SEO title=...> din Products.jsx + titleTemplate
  // ("%s • Artfest") aplicat de SeoProvider; pagina N>1 => "- Pagina N".
  const title = `${categorySeoTitle(category, page)} • Artfest`;
  const description = categorySeoDescription(category);

  // ItemList doar cu produsele PAGINII cerute (poziții care continuă).
  const jsonLd = buildCategoryStructuredData({ category, items, page });

  const html = injectHead(shellHtml, {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    jsonLd: jsonLd.length ? jsonLd : undefined,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(200).send(html);
}
