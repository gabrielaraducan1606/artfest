import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

const BASE_URL = "https://www.artfest.ro";

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

// Disponibilitățile care necesită o dată reală de disponibilitate
// (g:availability_date), conform cerințelor Google Merchant Center
// pentru preorder/backorder.
const AVAILABILITY_NEEDS_DATE = new Set(["PREORDER", "MADE_TO_ORDER"]);

function availabilityToGoogle(value) {
  if (value === "SOLD_OUT") return "out of stock";
  if (value === "PREORDER") return "preorder";
  if (value === "MADE_TO_ORDER") return "backorder";

  return "in stock";
}

// Returnează data ISO 8601 doar dacă produsul chiar are nevoie de ea
// (preorder/backorder) și `nextShipDate` e o dată reală din DB - nu
// inventăm niciodată o dată de completare.
function availabilityDateIso(product) {
  if (!AVAILABILITY_NEEDS_DATE.has(product.availability)) return null;
  if (!product.nextShipDate) return null;

  const date = new Date(product.nextShipDate);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
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
        // QUOTE_ONLY nu are un preț real de cumpărare - excludere
        // explicită, ca să nu depindem de efectul secundar că
        // priceCents e 0 pentru aceste produse.
        orderMode: {
          not: "QUOTE_ONLY",
        },
        images: {
          isEmpty: false,
        },
        // preorder/backorder fără o dată reală de disponibilitate nu
        // pot fi trimise complet către Google - le excludem temporar
        // din feed în loc să le mapăm artificial ca "in stock" sau să
        // trimitem availability_date inventat.
        OR: [
          { availability: { in: ["READY", "SOLD_OUT"] } },
          {
            availability: { in: ["PREORDER", "MADE_TO_ORDER"] },
            nextShipDate: { not: null },
          },
        ],
        service: {
          isActive: true,
          status: "ACTIVE",
          vendor: {
            isActive: true,
          },
          // aceeași definiție de "produs public" ca endpointul public
          // /api/public/products/:id - un serviciu care nu e de tip
          // "products" nu are pagină publică de produs.
          type: {
            code: "products",
          },
        },
      },
      include: {
        service: {
          include: {
            vendor: true,
            profile: true,
            type: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 5000,
    });

    const items = products
      // Plasă de siguranță redundantă cu filtrul din `where`: dacă un
      // produs preorder/backorder ajunge totuși aici fără dată validă,
      // nu îl trimitem incomplet.
      .filter((p) => {
        if (!AVAILABILITY_NEEDS_DATE.has(p.availability)) return true;
        return Boolean(availabilityDateIso(p));
      })
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
        const availabilityDate = availabilityDateIso(p);

        return `    <item>
      <g:id>${escapeXml(p.id)}</g:id>

      <title>${escapeXml(title)}</title>

      <description>${escapeXml(description)}</description>

      <link>${escapeXml(link)}</link>

      <g:image_link>${escapeXml(image)}</g:image_link>

      <g:availability>${escapeXml(availability)}</g:availability>
${availabilityDate ? `\n      <g:availability_date>${escapeXml(availabilityDate)}</g:availability_date>\n` : ""}
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