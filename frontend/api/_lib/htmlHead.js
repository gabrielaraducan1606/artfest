// frontend/api/_lib/htmlHead.js
//
// Helper comun pentru injectarea de meta tag-uri SEO în shell-ul static
// (index.html) din funcțiile Vercel /api/seo-produs și /api/seo-magazin.
// Fișierele cu prefix "_" din /api nu devin endpoint-uri Vercel - doar
// module importabile de alte funcții.

const TITLE_RE = /<title>[\s\S]*?<\/title>/i;
const HEAD_CLOSE_RE = /<\/head>/i;
const ROBOTS_META_RE = /<meta\s+name="robots"[^>]*>/i;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScriptTag(value) {
  // Previne închiderea prematură a <script> dacă JSON-ul conține "</".
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Injectează title/description/canonical/OG/robots/JSON-LD în <head>-ul
 * unui HTML deja existent (shell-ul static al SPA-ului), fără să atingă
 * <body>. Tag-urile create au data-seo="1" (aceeași convenție folosită
 * de SeoProvider.jsx client-side) astfel încât, odată ce React montează,
 * <SEO> le găsește și le actualizează in-place în loc să le dubleze.
 * JSON-LD primește un marker separat (data-seo-ssr-jsonld) pe care
 * SeoProvider îl elimină explicit la mount (vezi SeoProvider.jsx).
 */
export function injectHead(html, seo = {}) {
  const {
    title,
    description,
    canonical,
    ogTitle,
    ogDescription,
    ogUrl,
    ogImage,
    jsonLd,
    robots,
  } = seo;

  let out = html;

  if (title) {
    out = out.replace(TITLE_RE, `<title>${escapeHtml(title)}</title>`);
  }

  const tags = [];

  if (robots) {
    /*
     * index.html are deja un <meta name="robots" content="index,
     * follow"> static. Pentru cazul 404 (produs/magazin inexistent)
     * ÎNLOCUIM acel tag cu noindex, nu adăugăm unul suplimentar -
     * evităm două <meta name="robots"> conflictuale în același <head>
     * (chiar dacă Google spune că le combină pe cea mai restrictivă,
     * mai clar e să existe un singur tag, fără ambiguitate).
     */
    const robotsTag = `<meta name="robots" content="${escapeHtml(
      robots
    )}" data-seo="1" />`;
    if (ROBOTS_META_RE.test(out)) {
      out = out.replace(ROBOTS_META_RE, robotsTag);
    } else {
      tags.push(robotsTag);
    }
  }
  if (description) {
    tags.push(
      `<meta name="description" content="${escapeHtml(
        description
      )}" data-seo="1" />`
    );
  }
  if (canonical) {
    tags.push(
      `<link rel="canonical" href="${escapeHtml(canonical)}" data-seo="1" />`
    );
  }
  tags.push(`<meta property="og:type" content="website" data-seo="1" />`);
  if (ogTitle) {
    tags.push(
      `<meta property="og:title" content="${escapeHtml(
        ogTitle
      )}" data-seo="1" />`
    );
  }
  if (ogDescription) {
    tags.push(
      `<meta property="og:description" content="${escapeHtml(
        ogDescription
      )}" data-seo="1" />`
    );
  }
  if (ogUrl) {
    tags.push(
      `<meta property="og:url" content="${escapeHtml(ogUrl)}" data-seo="1" />`
    );
  }
  if (ogImage) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(
        ogImage
      )}" data-seo="1" />`
    );
  }
  if (jsonLd) {
    tags.push(
      `<script type="application/ld+json" data-seo-ssr-jsonld="1">${escapeJsonForScriptTag(
        jsonLd
      )}</script>`
    );
  }

  if (tags.length) {
    out = out.replace(HEAD_CLOSE_RE, `${tags.join("\n    ")}\n  </head>`);
  }

  return out;
}
