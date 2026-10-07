// frontend/api/spa-404.js
//
// Funcție serverless Vercel - ultimul rewrite din vercel.json: primește
// DOAR URL-urile care nu corespund niciunei rute a aplicației (rutele
// cunoscute sunt rescrise static către /index.html înaintea acestui
// rewrite). Înainte, orice URL inexistent (ex. /cauta?q=...) primea
// shell-ul cu 200 + "index, follow" (soft 404 în Search Console).
//
// Servește ACELAȘI shell (index.html), deci comportamentul în browser nu
// se schimbă (React montează și ruta "*" face redirect la "/"), dar cu
// HTTP 404 real + noindex pentru crawlere.

import { injectHead } from "./_lib/htmlHead.js";

const SITE_ORIGIN = "https://www.artfest.ro";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");

  let shellHtml;
  try {
    const shellRes = await fetch(`${SITE_ORIGIN}/index.html`);
    if (!shellRes.ok) throw new Error(`shell_fetch_failed_${shellRes.status}`);
    shellHtml = await shellRes.text();
  } catch (e) {
    console.error("[spa-404] shell fetch failed:", e);
    res.setHeader("Cache-Control", "no-store");
    res
      .status(404)
      .send(
        '<!doctype html><html lang="ro"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><title>Pagina nu a fost găsită | Artfest</title></head><body><a href="/">Artfest</a></body></html>'
      );
    return;
  }

  const html = injectHead(shellHtml, {
    title: "Pagina nu a fost găsită | Artfest",
    robots: "noindex",
  });

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  res.status(404).send(html);
}
