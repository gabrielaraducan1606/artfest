// frontend/api/seo-magazin.js
//
// Analog cu seo-produs.js, pentru /magazin/:slug. Sursa de date e
// endpoint-ul public deja folosit de ProfilMagazin.jsx
// (GET /api/public/store/:slug/initial) - nicio interogare Prisma nouă.

import { injectHead } from "./_lib/htmlHead.js";

const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN || "https://artfest.onrender.com";
const SITE_ORIGIN = "https://www.artfest.ro";

function resolveImageUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
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

export default async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();

  let shellHtml;
  try {
    shellHtml = await fetchShellHtml();
  } catch (e) {
    console.error("[seo-magazin] shell fetch failed:", e);
    res.status(500).send("seo_shell_unavailable");
    return;
  }

  if (!slug) {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  let apiRes;
  try {
    apiRes = await fetch(
      `${BACKEND_ORIGIN}/api/public/store/${encodeURIComponent(
        slug
      )}/initial`,
      { signal: AbortSignal.timeout(4000) }
    );
  } catch {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  if (apiRes.status === 404) {
    // Semnal explicit "slug inexistent / nu e magazin de produse" de
    // la endpoint-ul public - 404 real + noindex, fără Organization
    // JSON-LD fals.
    const html = injectHead(shellHtml, {
      title: "Magazin indisponibil | Artfest",
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

  const shop = data?.shop;

  /*
   * /store/:slug/initial NU întoarce 404 pentru un magazin existent
   * dar încă inactiv (onboarding neterminat) - întoarce 200 cu
   * status:"inactive". Nu inventăm o regulă nouă de indexare pentru
   * acest caz ambiguu (nu există noindex nicăieri altundeva în cod):
   * servim shell-ul neschimbat, fără metadate/JSON-LD false, exact
   * ca la orice altă eroare. Dacă vreți explicit noindex și pentru
   * magazine inactive, e o decizie separată de discutat.
   */
  if (!shop || shop.status !== "active") {
    sendShellUnchanged(
      res,
      shellHtml,
      "public, s-maxage=60, stale-while-revalidate=120"
    );
    return;
  }

  const shopName = shop.shopName || "Magazin";
  const description =
    shop.shortDescription ||
    "Descoperă produse unicat create de artizani pe Artfest.";
  const canonical = `${SITE_ORIGIN}/magazin/${encodeURIComponent(slug)}`;
  const image = resolveImageUrl(shop.coverImageUrl || shop.profileImageUrl);

  // Aceeași formulă ca title={shopName} + titleTemplate ("%s • Artfest")
  // din ProfilMagazin.jsx / SeoProvider - identic cu ce randează React.
  const title = `${shopName} • Artfest`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: shopName,
    url: canonical,
    ...(image ? { logo: image } : {}),
  };

  const html = injectHead(shellHtml, {
    title,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    ogImage: image,
    jsonLd,
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(200).send(html);
}
