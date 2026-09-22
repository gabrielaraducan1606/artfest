import express from "express";
import { prisma } from "../db.js";
import { getCategoryPageSlugs } from "../constants/categorySlugs.js";
import { collectionsWithPublicProducts } from "../services/collectionProducts.js";

const router = express.Router();

const BASE_URL = "https://www.artfest.ro";

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function renderUrl(u) {
  const lastmod = u.lastmod
    ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>`
    : "";

  return `  <url>
    <loc>${escapeXml(BASE_URL + u.loc)}</loc>${lastmod}
  </url>`;
}

router.get("/sitemap.xml", async (req, res) => {
  try {
    const staticUrls = [
      { loc: "/" },
      { loc: "/produse" },
      { loc: "/magazine" },
      { loc: "/categorii" },
      { loc: "/colectii" },
      { loc: "/termenii-si-conditiile" },
      { loc: "/confidentialitate" },
      { loc: "/politica-cookie" },
      { loc: "/politica-de-retur" },
      { loc: "/preferinte-cookie" },
    ];

    // Slug-urile REALE ale paginilor /categorii/:slug (același algoritm ca
    // frontend/src/constants/seoCategories.js) - vezi categorySlugs.js.
    // Înainte: cheia categoriei fără prefix -> 52 din 125 de URL-uri nu
    // existau ca pagini (redirect la /produse), iar 52 de pagini reale
    // lipseau din sitemap.
    const categoryUrls = getCategoryPageSlugs().map((slug) => ({
      loc: `/categorii/${slug}`,
    }));

    // Colecții ACTIVE. `rules` și `items` se aduc doar ca să decidem, în lot,
    // dacă au produse publice (mai jos) - nu ies în sitemap.
    const activeCollections = await prisma.collection.findMany({
      where: {
        isActive: true,
      },
      select: {
        slug: true,
        updatedAt: true,
        rules: true,
        items: {
          select: { productId: true, pinned: true, excluded: true },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // O colecție intră în sitemap DOAR dacă are cel puțin un produs public
    // (aceeași definiție ca pagina colecției - services/collectionProducts.js).
    // Interogări în LOT: număr constant (max. 2) indiferent de câte
    // colecții sunt, nu una per colecție.
    const namedCollections = activeCollections.filter((c) => c.slug);
    const hasProducts = await collectionsWithPublicProducts(
      prisma,
      namedCollections
    );
    const collections = namedCollections.filter((_, index) => hasProducts[index]);

    const collectionUrls = collections
      .filter((c) => c.slug)
      .map((c) => ({
        loc: `/colectii/${c.slug}`,
        lastmod: formatDate(c.updatedAt),
      }));

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: {
              is: {
                isActive: true,
              },
            },
          },
        },
      },
      select: {
        id: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 50000,
    });

    const productUrls = products.map((p) => ({
      loc: `/produs/${p.id}`,
      lastmod: formatDate(p.updatedAt),
    }));

    const stores = await prisma.serviceProfile.findMany({
      where: {
        slug: {
          not: null,
        },
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            type: {
              is: {
                code: "products",
              },
            },
            vendor: {
              is: {
                isActive: true,
              },
            },
          },
        },
      },
      select: {
        slug: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 50000,
    });

    const storeUrls = stores
      .filter((s) => s.slug)
      .map((s) => ({
        loc: `/magazin/${s.slug}`,
        lastmod: formatDate(s.updatedAt),
      }));

    const urls = [
      ...staticUrls,
      ...categoryUrls,
      ...collectionUrls,
      ...productUrls,
      ...storeUrls,
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => renderUrl(u)).join("\n")}
</urlset>`;

    res.setHeader(
      "Content-Type",
      "application/xml; charset=utf-8"
    );

    res.status(200).send(xml);
  } catch (e) {
    console.error(
      "GET /sitemap.xml error:",
      e
    );

    res
      .status(500)
      .type("text/plain")
      .send("sitemap_error");
  }
});

export default router;