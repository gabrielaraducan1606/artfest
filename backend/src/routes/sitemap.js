import express from "express";
import { prisma } from "../db.js";
import { CATEGORIES_DETAILED } from "../constants/categories.js";

const router = express.Router();

const BASE_URL = "https://artfest.ro";

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
      { loc: "/termenii-si-conditiile" },
      { loc: "/confidentialitate" },
      { loc: "/politica-cookie" },
      { loc: "/politica-de-retur" },
      { loc: "/preferinte-cookie" },
    ];

    const categoryUrls = CATEGORIES_DETAILED
      .filter((c) => c.key !== "alte")
      .map((c) => {
        const slug = categoryKeyToSlug(c.key);

        return {
          loc: `/categorii/${slug}`,
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