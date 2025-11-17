// client/src/components/Seo/SeoProvider.jsx
import React, { useEffect, useMemo, useContext } from "react";
import { SEOContext, DEFAULTS } from "./seo-context";

/**
 * SEOProvider: furnizează defaults în context.
 */
export function SEOProvider({ defaults = {}, children }) {
  const value = useMemo(() => ({ ...DEFAULTS, ...defaults }), [defaults]);
  return <SEOContext.Provider value={value}>{children}</SEOContext.Provider>;
}

/* ===== Helpers (marcăm tot ce creăm cu data-seo="1") ===== */

const ALLOWED_AS = new Set([
  "script",
  "style",
  "font",
  "image",
  "fetch",
  "audio",
  "video",
  "track",
]);

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function toAbsoluteUrl(href) {
  try {
    if (!isBrowser()) return null;
    if (!href || typeof href !== "string") return null;
    const trimmed = href.trim();
    if (!trimmed) return null;
    if (/^(javascript:|about:blank)/i.test(trimmed)) return null;
    if (/^(data:|blob:)/i.test(trimmed)) return null;
    const u = new URL(trimmed, window.location.origin);
    return u.href;
  } catch {
    return null;
  }
}

function upsertMeta(attrName, attrValue, content) {
  if (!isBrowser()) return null;
  let el = document.head.querySelector(
    `meta[${attrName}="${attrValue}"][data-seo="1"]`
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attrName, attrValue);
    el.setAttribute("data-seo", "1");
    document.head.appendChild(el);
  }
  el.setAttribute("content", String(content ?? ""));
  return el;
}

/**
 * upsertLink:
 *  - pentru rel="preload": UN <link> separat per href (nu suprascriem unul global)
 *  - pentru restul (ex. canonical): păstrăm un singur element controlat de noi
 */
function upsertLink(rel, href, extra = {}) {
  if (!isBrowser()) return null;

  if (rel === "preload") {
    if (!href) return null;
    let el = document.head.querySelector(
      `link[rel="preload"][href="${href}"][data-seo="1"]`
    );
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "preload");
      el.setAttribute("href", href);
      el.setAttribute("data-seo", "1");
      document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === false) el.removeAttribute(k);
      else el.setAttribute(k, String(v));
    }
    return el;
  }

  // rel != preload -> unic
  let el = document.head.querySelector(`link[rel="${rel}"][data-seo="1"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute("data-seo", "1");
    document.head.appendChild(el);
  }
  if (href) el.setAttribute("href", href);
  for (const [k, v] of Object.entries(extra)) {
    if (v == null || v === false) el.removeAttribute(k);
    else el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * SEO props:
 * - title, description, url, image, canonical
 * - preloads: [{ href, as, type?, crossOrigin?, imagesrcset?, imagesizes?, useInDom? }]
 * - jsonLd: obiect sau array de obiecte JSON-LD
 */
export function SEO({
  title,
  description,
  url,
  image,
  canonical,
  preloads = [],
  jsonLd = [],
}) {
  // Hook-urile trebuie chemate necondiționat:
  const ctx = useContext(SEOContext) || DEFAULTS;

  useEffect(() => {
    if (!isBrowser()) return;

    const inserted = [];

    const pageTitle = title
      ? (ctx.titleTemplate || "%s").replace("%s", title)
      : ctx.defaultTitle || "Artfest";

    // <title>
    if (pageTitle) {
      document.title = pageTitle;
    }

    // canonical
    const canonicalHref = toAbsoluteUrl(canonical || url || ctx.baseUrl);
    if (canonicalHref) {
      inserted.push(upsertLink("canonical", canonicalHref));
    }

    // description
    const metaDescription = description ?? ctx.defaultDescription ?? "";
    if (metaDescription) {
      inserted.push(upsertMeta("name", "description", metaDescription));
    }

    // Open Graph
    inserted.push(upsertMeta("property", "og:type", "website"));
    inserted.push(
      upsertMeta("property", "og:site_name", ctx.siteName || "Artfest")
    );
    if (url) inserted.push(upsertMeta("property", "og:url", url));
    inserted.push(upsertMeta("property", "og:title", pageTitle));
    if (metaDescription)
      inserted.push(
        upsertMeta("property", "og:description", metaDescription)
      );

    const imgAbs = toAbsoluteUrl(image ?? ctx.defaultImage);
    if (imgAbs) {
      inserted.push(upsertMeta("property", "og:image", imgAbs));
    }

    // Twitter
    inserted.push(upsertMeta("name", "twitter:card", "summary_large_image"));
    if (ctx.twitterSite) {
      inserted.push(upsertMeta("name", "twitter:site", ctx.twitterSite));
    }
    inserted.push(upsertMeta("name", "twitter:title", pageTitle));
    if (metaDescription)
      inserted.push(
        upsertMeta("name", "twitter:description", metaDescription)
      );
    if (imgAbs) inserted.push(upsertMeta("name", "twitter:image", imgAbs));

    // JSON-LD
    const blocks = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
    blocks
      .filter((o) => o && typeof o === "object")
      .forEach((obj) => {
        try {
          const s = document.createElement("script");
          s.type = "application/ld+json";
          s.setAttribute("data-seo", "1");
          s.text = JSON.stringify(obj);
          document.head.appendChild(s);
          inserted.push(s);
        } catch {
          /* ignore */
        }
      });

    // PRELOADS (strict validate + auto-downgrade la prefetch când nu e clar că se folosește în DOM)
    (Array.isArray(preloads) ? preloads : []).forEach((p) => {
      const hrefAbs = toAbsoluteUrl(p?.href);
      const asVal = String(p?.as || "").trim().toLowerCase();

      if (!hrefAbs) return;               // href invalid -> ignoră
      if (!ALLOWED_AS.has(asVal)) return; // as invalid -> ignoră

      // Heuristică: nu preîncărca imaginile care NU sunt folosite în DOM (ex: og:image).
      // Dacă vrei să forțezi preîncărcarea unei imagini din DOM, trimite useInDom: true.
      if (asVal === "image" && !p?.useInDom) {
        // Downgrade la prefetch (fără warnings)
        inserted.push(upsertLink("prefetch", hrefAbs, { as: "image" }));
        return;
      }

      const extra = { as: asVal };
      if (p.type) extra.type = p.type;
      if (p.imagesrcset) extra.imagesrcset = p.imagesrcset;
      if (p.imagesizes) extra.imagesizes = p.imagesizes;

      // CORS pentru cross-origin (image/font/fetch)
      try {
        const origin = new URL(hrefAbs).origin;
        const sameOrigin = origin === window.location.origin;
        if ((asVal === "image" || asVal === "font" || asVal === "fetch") && !sameOrigin) {
          extra.crossorigin = p.crossOrigin || "anonymous";
        }
      } catch {
        /* ignore */
      }

      inserted.push(upsertLink("preload", hrefAbs, extra));
    });

    return () => {
      // ștergem DOAR ce am creat noi (data-seo="1")
      inserted.forEach((el) => {
        try {
          if (el && el.parentNode === document.head) {
            document.head.removeChild(el);
          }
        } catch {
          /* ignore */
        }
      });
    };
  }, [title, description, url, image, canonical, preloads, jsonLd, ctx]);

  return null;
}

/**
 * Adaptor de compatibilitate pentru vechiul HeadTags.jsx (dacă îl mai imporți undeva).
 */
export function HeadTagsAdapter(props) {
  return <SEO {...props} />;
}
