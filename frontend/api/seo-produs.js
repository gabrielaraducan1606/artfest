// frontend/api/seo-produs.js
//
// Funcție serverless Vercel (Node runtime) - intercepteaza /produs/:id
// (vezi rewrite-ul din vercel.json) și servește shell-ul static al SPA
// (index.html) cu title/description/canonical/OG/JSON-LD Product deja
// injectate în <head>, ÎNAINTE ca vreun JS să ruleze. <body> rămâne
// neschimbat (tot <div id="root"></div>) - React randează exact ca azi,
// deci zero risc de hydration mismatch (nici măcar hidratare reală nu se
// folosește - vezi main.jsx, e createRoot, nu hydrateRoot).
//
// Sursa de date e EXACT endpoint-ul public folosit deja de SPA
// (GET /api/public/products/:id, ProductDetails.jsx) - nicio interogare
// Prisma nouă/duplicată.
//
// Se aplică IDENTIC tuturor request-urilor pe această rută, indiferent
// de User-Agent (fără bot cloaking) - un utilizator obișnuit primește
// exact aceleași date publice, doar injectate mai devreme.

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

function truncate(text, max) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 3).trim()}...` : clean;
}

// Oglindește exact schemaAvailability din ProductDetails.jsx (care
// folosește availabilityToSchemaOrg din backend/src/constants/
// productMerchantAttributes.js, aceeași mapare ca g:availability din feed):
// ca JSON-LD-ul injectat server-side să nu contrazică niciodată ce randează
// React după ce se încarcă. MADE_TO_ORDER se poate comanda acum -> InStock.
function schemaAvailabilityFor(availability) {
  switch (availability) {
    case "READY":
      return "https://schema.org/InStock";
    case "MADE_TO_ORDER":
      return "https://schema.org/InStock";
    case "PREORDER":
      return "https://schema.org/PreOrder";
    case "SOLD_OUT":
      return "https://schema.org/OutOfStock";
    default:
      return "https://schema.org/InStock";
  }
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
  const id = String(req.query?.id || "").trim();

  let shellHtml;
  try {
    shellHtml = await fetchShellHtml();
  } catch (e) {
    // Shell-ul static e pe același deployment - o eroare aici e extrem
    // de improbabilă. Chiar și așa, nu lăsăm utilizatorul fără pagină.
    console.error("[seo-produs] shell fetch failed:", e);
    res.status(500).send("seo_shell_unavailable");
    return;
  }

  if (!id) {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  let apiRes;
  try {
    apiRes = await fetch(
      `${BACKEND_ORIGIN}/api/public/products/${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(4000) }
    );
  } catch {
    // Backend indisponibil/timeout - fail-open: shell neschimbat, fără
    // cache (ca să reîncercăm curat la următorul request).
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  if (apiRes.status === 404) {
    // Semnal explicit "nu există / nu e public" de la endpoint-ul
    // public (moderationStatus/isActive/isHidden etc.) - respectăm
    // exact acest răspuns: 404 real + noindex, fără Product JSON-LD
    // fals. SPA-ul funcționează identic (React montează peste orice
    // status code, vezi nota din raport).
    const html = injectHead(shellHtml, {
      title: "Produs indisponibil | Artfest",
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

  let product;
  try {
    product = await apiRes.json();
  } catch {
    sendShellUnchanged(res, shellHtml, "no-store");
    return;
  }

  const storeName =
    product?.service?.profile?.displayName ||
    product?.service?.vendor?.displayName ||
    "Artfest";

  // Aceeași formulă ca seoTitle/seoDescription din ProductDetails.jsx +
  // titleTemplate ("%s • Artfest") aplicat de SeoProvider client-side -
  // ca titlul din HTML brut să fie identic cu cel pe care React îl
  // setează după ce se încarcă, nu doar "asemănător".
  const rawTitle = product?.title
    ? `${product.title} | ${storeName}`
    : "Produs handmade";
  const title = `${rawTitle} • Artfest`;

  const description = product?.description
    ? truncate(product.description, 155)
    : `Descoperă ${
        product?.title || "acest produs handmade"
      } realizat de ${storeName}. Vezi detalii, preț și opțiuni de personalizare pe Artfest.`;

  const canonical = `${SITE_ORIGIN}/produs/${encodeURIComponent(id)}`;
  const image = resolveImageUrl(
    Array.isArray(product?.images) ? product.images[0] : null
  );

  const hasPrice = Number(product?.priceCents) > 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": canonical,
    name: product?.title || "",
    description: product?.description || "",
    ...(image ? { image: [image] } : {}),
    sku: product?.id,
    brand: { "@type": "Brand", name: storeName },
    ...(hasPrice
      ? {
          offers: {
            "@type": "Offer",
            url: canonical,
            priceCurrency: product?.currency || "RON",
            price: (Number(product.priceCents) / 100).toFixed(2),
            availability: schemaAvailabilityFor(product?.availability),
            itemCondition: "https://schema.org/NewCondition",
          },
        }
      : {}),
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
    // CDN Vercel: 5 min cache, până la 10 min stale-while-revalidate.
    // Preț/stoc pot fi la câteva minute vechime pentru boți/crawlere -
    // acceptabil; utilizatorii reali oricum văd datele live prin JS
    // (fetch-ul din ProductDetails.jsx nu e afectat de acest cache).
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(200).send(html);
}
