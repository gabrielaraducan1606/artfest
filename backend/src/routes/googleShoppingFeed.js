import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

const BASE_URL = "https://artfest.ro";

function escapeXml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  return `${BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function availabilityToGoogle(value) {
  if (value === "SOLD_OUT") return "out of stock";
  if (value === "PREORDER") return "preorder";

  return "in stock";
}

router.get("/google-shopping-feed.xml", async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
        priceCents: {
          gt: 0,
        },
        images: {
          isEmpty: false,
        },
        service: {
          isActive: true,
          status: "ACTIVE",
          vendor: {
            isActive: true,
          },
        },
      },
      include: {
        service: {
          include: {
            vendor: true,
            profile: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 5000,
    });

    const items = products
      .map((p) => {
        const image = absoluteUrl(p.images?.[0]);

        const link = `${BASE_URL}/produs/${encodeURIComponent(p.id)}`;

        const storeName =
          p.service?.profile?.displayName ||
          p.service?.vendor?.displayName ||
          "Artfest";

        const productType = p.category || "handmade";

        const title = p.title || "Produs Artfest";

        const description =
          stripHtml(p.description) ||
          `${title} disponibil pe Artfest, marketplace cu produse handmade și personalizate create de artizani români.`;

        const price = `${(p.priceCents / 100).toFixed(2)} ${
          p.currency || "RON"
        }`;

        const availability = availabilityToGoogle(p.availability);

        return `    <item>
      <g:id>${escapeXml(p.id)}</g:id>

      <title>${escapeXml(title)}</title>

      <description>${escapeXml(description)}</description>

      <link>${escapeXml(link)}</link>

      <g:image_link>${escapeXml(image)}</g:image_link>

      <g:availability>${escapeXml(availability)}</g:availability>

      <g:price>${escapeXml(price)}</g:price>

      <g:condition>new</g:condition>

      <g:brand>${escapeXml(storeName)}</g:brand>

      <g:product_type>${escapeXml(productType)}</g:product_type>

      <g:mpn>${escapeXml(p.id)}</g:mpn>

      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Artfest Marketplace</title>
    <link>${BASE_URL}</link>
    <description>
      Produse handmade și personalizate create de artizani români.
    </description>

${items}

  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");

    res.status(200).send(xml);
  } catch (err) {
    next(err);
  }
});

export default router;