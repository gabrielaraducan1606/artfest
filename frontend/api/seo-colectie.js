// frontend/api/seo-colectie.js
//
// Analog cu seo-produs.js / seo-magazin.js, pentru /colectii/:slug și
// pentru pagina index /colectii (vezi rewrite-urile din vercel.json).
// Servește shell-ul static al SPA (index.html) cu
// title/description/canonical/OG/JSON-LD deja injectate în <head>, ÎNAINTE
// ca vreun JS să ruleze. <body> rămâne neschimbat, deci React randează
// exact ca azi.
//
// Sursa de date: endpoint-urile publice deja folosite de SPA
// (GET /api/public/collections/:slug pentru o colecție,
// GET /api/public/collections?placement=all pentru index) - nicio
// interogare Prisma nouă/duplicată. Se aplică IDENTIC tuturor
// request-urilor, indiferent de User-Agent (fără bot cloaking).

import { injectHead } from "./_lib/htmlHead.js";
import { parsePage } from "../src/utils/seo/pagination.js";
import {
  COLLECTION_PAGE_SIZE,
  COLLECTIONS_INDEX_DESCRIPTION,
  COLLECTIONS_INDEX_TITLE,
  COLLECTIONS_INDEX_URL,
  buildCollectionStructuredData,
  buildCollectionsIndexStructuredData,
  collectionCanonicalUrl,
  collectionSeoDescription,
  collectionSeoTitle,
} from "../src/utils/seo/collectionSeo.js";

const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN || "https://artfest.onrender.com";
const SITE_ORIGIN = "https://www.artfest.ro";

function resolveImageUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  // data:/blob: nu sunt URL-uri publice utilizabile în og:image/JSON-LD
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${BACKEND_ORIGIN}${path}`;
}

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

// jsonLd vid nu se injectează (injectHead ar emite un <script> cu "[]")
function asJsonLd(nodes) {
  return Array.isArray(nodes) && nodes.length ? nodes : undefined;
}

/* ---------- pagina index /colectii ---------- */

async function handleIndex(res, shellHtml) {
  // Metadatele paginii index sunt statice; lista de colecții doar
  // îmbogățește JSON-LD (ItemList). Dacă backend-ul nu răspunde, servim
  // aceleași metadate fără ItemList - nu inventăm colecții.
  let collections = [];

  try {
    const apiRes = await fetch(
      `${BACKEND_ORIGIN}/api/public/collections?placement=all`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (apiRes.ok) {
      const data = await apiRes.json();
      collections = Array.isArray(data?.items) ? data.items : [];
    }
  } catch {
    collections = [];
  }

  const title = `${COLLECTIONS_INDEX_TITLE} • Artfest`;

  const html = injectHead(shellHtml, {
    title,
    description: COLLECTIONS_INDEX_DESCRIPTION,
    canonical: COLLECTIONS_INDEX_URL,
    ogTitle: title,
    ogDescription: COLLECTIONS_INDEX_DESCRIPTION,
    ogUrl: COLLECTIONS_INDEX_URL,
    jsonLd: asJsonLd(buildCollectionsIndexStructuredData(collections)),
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(200).send(html);
}

/* ---------- handler ---------- */

export default async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();

  // ?page=N: invalid (0, negativ, NaN, zecimal, listă...) => pagina 1, cu
  // canonical curat (nu generăm niciodată ?page=0).
  const { page } = parsePage(req.query?.page);

  let shellHtml;
  try {
    shellHtml = await fetchShellHtml();
  } catch (e) {
    console.error("[seo-colectie] shell fetch failed:", e);
    res.status(500).send("seo_shell_unavailable");
    return;
  }

  if (!slug) {
    // /colectii (fără slug) = pagina index
    await handleIndex(res, shellHtml);
    return;
  }

  let apiRes;
  try {
    apiRes = await fetch(
      `${BACKEND_ORIGIN}/api/public/collections/${encodeURIComponent(
        slug
      )}?page=${page}&limit=${COLLECTION_PAGE_SIZE}`,
      { signal: AbortSignal.timeout(4000) }
    );
  } catch {
    // Backend indisponibil/timeout - fail-open: shell neschimbat, fără cache.
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  if (apiRes.status === 404) {
    // Slug inexistent SAU colecție inactivă (endpoint-ul public întoarce 404
    // pentru ambele) - 404 real + noindex, fără CollectionPage/ItemList
    // fals.
    const html = injectHead(shellHtml, {
      title: "Colecție indisponibilă | Artfest",
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

  if (!apiRes.ok) {
    // Orice altă eroare (5xx etc.) - fail-open, fără cache.
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  let data;
  try {
    data = await apiRes.json();
  } catch {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  const collection = data?.collection;

  if (!collection?.slug || !collection?.title) {
    // Răspuns 200 fără colecție validă: nu inventăm metadate.
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  const items = Array.isArray(data?.items) ? data.items : [];

  // Pagină dincolo de ultima (ex. ?page=99 pe o colecție de 2 pagini):
  // API-ul întoarce 200 cu listă goală. Răspundem 404 REAL + noindex, fără
  // canonical și fără CollectionPage/ItemList/JSON-LD. Nu redirecționăm la
  // ultima pagină și nu o transformăm în page=1 (doar un ?page= invalid
  // sintactic se normalizează la 1 - vezi parsePage). SPA-ul se montează
  // oricum peste 404 și afișează mesajul + linkul "Înapoi la prima pagină"
  // (PublicCollections.jsx).
  if (page > 1 && items.length === 0) {
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

  // Canonical din slug-ul REAL al colecției (endpoint-ul caută
  // case-insensitive), nu din URL-ul cerut: /colectii/Nunta și
  // /colectii/nunta au același canonical. Pagina 1 => fără query; pagina
  // N>1 => ?page=N (propriu, NU spre pagina 1). Alte query params
  // (?ref= etc.) nu influențează canonical-ul.
  const canonical = collectionCanonicalUrl(collection.slug, page);

  // Aceeași formulă ca <SEO title=...> + titleTemplate ("%s • Artfest")
  // din PublicCollections.jsx / SeoProvider; pagina N>1 => "- Pagina N".
  const title = `${collectionSeoTitle(collection, page)} • Artfest`;
  const description = collectionSeoDescription(collection);
  const image = resolveImageUrl(collection.heroImage);

  // ItemList doar cu produsele PAGINII cerute, poziții care continuă între
  // pagini.
  const jsonLd = buildCollectionStructuredData({
    collection,
    items,
    page,
    resolveImage: resolveImageUrl,
  });

  const html = injectHead(shellHtml, {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    ogImage: image,
    jsonLd: asJsonLd(jsonLd),
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(200).send(html);
}
