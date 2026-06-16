import express from "express";
import { prisma } from "../db.js";
import { CATEGORIES_DETAILED } from "../constants/categories.js";

const router = express.Router();

const BASE_URL = "https://artfest.ro";

const IMPORTANT_SLUGS = new Set([
  "invitatii-nunta",
  "invitatii-botez",
  "aranjamente-florale-naturale",
  "aranjamente-florale-artificiale",
  "aranjamente-flori-plusate",
  "aranjamente-ceara",
  "aranjamente-sapun",
  "flori-plusate",
  "flori-ceara",
  "flori-sapun",
  "lumanari-decor",
  "lumanari-parfumate",
  "lumanari-biserica",
  "cadouri-botez",
  "tavita-mot",
  "halate-personalizate",
  "prosoape-personalizate",
]);

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function categoryKeyToSlug(key) {
  return key.split("_").slice(1).join("_");
}

function formatDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function renderUrl(u, today) {
  return `  <url>
    <loc>${escapeXml(BASE_URL + u.loc)}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`;
}

router.get("/sitemap.xml", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const staticUrls = [
      { loc: "/", priority: "1.0" },
      { loc: "/produse", priority: "0.9" },
      { loc: "/magazine", priority: "0.9" },
      { loc: "/categorii", priority: "0.9" },
      { loc: "/termenii-si-conditiile", priority: "0.4" },
      { loc: "/confidentialitate", priority: "0.4" },
      { loc: "/politica-cookie", priority: "0.3" },
      { loc: "/politica-de-retur", priority: "0.3" },
      { loc: "/preferinte-cookie", priority: "0.3" },
    ];

    const categoryUrls = CATEGORIES_DETAILED
      .filter((c) => c.key !== "alte")
      .map((c) => {
        const slug = categoryKeyToSlug(c.key);

        return {
          loc: `/categorii/${slug}`,
          priority: IMPORTANT_SLUGS.has(slug) ? "0.9" : "0.8",
        };
      });

    const collections = await prisma.collection.findMany({
      where: {
        isActive: true,
      },
      select: {
        slug: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const collectionUrls = collections
      .filter((c) => c.slug)
      .map((c) => ({
        loc: `/colectii/${c.slug}`,
        priority: "0.85",
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
      priority: "0.75",
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
        priority: "0.8",
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
${urls.map((u) => renderUrl(u, today)).join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(xml);
  } catch (e) {
    console.error("GET /sitemap.xml error:", e);
    res.status(500).type("text/plain").send("sitemap_error");
  }
});

export default router;