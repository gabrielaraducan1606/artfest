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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function categoryKeyToSlug(key) {
  return key.split("_").slice(1).join("_");
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
        lastmod: c.updatedAt
          ? new Date(c.updatedAt).toISOString().slice(0, 10)
          : today,
      }));

    const urls = [...staticUrls, ...categoryUrls, ...collectionUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(BASE_URL + u.loc)}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(xml);
  } catch (e) {
    console.error("GET /sitemap.xml error:", e);
    res.status(500).type("text/plain").send("sitemap_error");
  }
});

export default router;