import express from "express";
import { prisma } from "../db.js";
import {
  AVAILABILITY_NEEDS_DATE,
  availabilityToGoogle,
  buildMerchantPrice,
  buildProductMerchantAttributes,
  categoryShortLabel,
  priceBucketLabel,
  slugifyLabel,
} from "../constants/productMerchantAttributes.js";
import { getPromotionPricingForProducts } from "../services/productPromotionPrice.js";
import { pickPrimaryCollection } from "../services/collectionProducts.js";

/**
 * custom_label_0: slug-ul colecției principale (prima colecție activă în
 * care produsul e fixat sau ale cărei reguli le îndeplinește), altfel
 * slug-ul scurt al categoriei.
 */
export function productGroupLabel(product, activeCollections) {
  const collection = pickPrimaryCollection(product, activeCollections);
  return (collection && slugifyLabel(collection.slug)) || categoryShortLabel(product?.category);
}

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

  // Orice altă schemă (data:, blob:, ftp: ...) nu e o cale relativă:
  // o lăsăm neatinsă ca validarea de imagini să o respingă, în loc să
  // fabricăm un URL fals de tip https://www.artfest.ro/data:image/...
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;

  return `${BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

// Maparea availability (și disponibilitățile care cer g:availability_date)
// vin din helperul comun cu JSON-LD-ul din ProductDetails, ca feed-ul și
// pagina să spună același lucru. Doar PREORDER cere dată; MADE_TO_ORDER
// e "in stock" (se poate comanda acum, se execută după comandă) și
// leadTimeDays NU e convertit niciodată într-o dată Google.

// Returnează data ISO 8601 doar pentru PREORDER și doar dacă
// `nextShipDate` e o dată reală din DB - nu inventăm niciodată o dată de
// completare.
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
        // PREORDER fără o dată reală de disponibilitate nu poate fi
        // trimis complet către Google - îl excludem în loc să trimitem
        // availability_date inventat. MADE_TO_ORDER se poate comanda acum
        // (in stock), deci nu cere dată.
        OR: [
          { availability: { in: ["READY", "SOLD_OUT", "MADE_TO_ORDER"] } },
          {
            availability: "PREORDER",
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
        // regulile colecțiilor iau în calcul și categoriile suplimentare
        additionalCategories: {
          select: {
            category: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 5000,
    });

    // colecțiile ACTIVE, o singură dată, în ordine stabilă (custom_label_0)
    const activeCollections = await prisma.collection.findMany({
      where: {
        isActive: true,
      },
      include: {
        items: {
          select: {
            productId: true,
            pinned: true,
            excluded: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const eligible = products
      // Plasă de siguranță redundantă cu filtrul din `where`: dacă un
      // produs preorder ajunge totuși aici fără dată validă, nu îl
      // trimitem incomplet.
      .filter((p) => {
        if (!AVAILABILITY_NEEDS_DATE.has(p.availability)) return true;
        return Boolean(availabilityDateIso(p));
      })
      // Atributele derivate (imagini curate, color/material/categorie
      // umane) vin din helperul comun cu JSON-LD-ul din ProductDetails.
      .map((p) => ({
        p,
        attrs: buildProductMerchantAttributes(p, { resolveUrl: absoluteUrl }),
      }))
      // image_link e obligatoriu: un produs fără nicio imagine validă
      // (`images` non-gol, dar doar valori invalide) nu e acceptat de
      // Google, deci nu îl trimitem.
      .filter(({ attrs }) => Boolean(attrs.image));

    // Promoțiile PUBLICE active (colecție + homepage feature) - exact ce
    // calculează endpointul public /api/public/products/:id și deci ce vede
    // Googlebot pe landing page. Fără opțiuni: NU includem campanii
    // (atribuire prin query param) și NU includem coduri de reducere
    // (checkout) - nu sunt vizibile crawlerului. `db: prisma` explicit, ca
    // serviciul să folosească aceeași conexiune ca restul rutei.
    const pricingByProductId = await getPromotionPricingForProducts(
      eligible.map(({ p }) => p),
      { db: prisma }
    );

    const items = eligible
      .map(({ p, attrs }) => {
        const image = attrs.image;

        const link = `${BASE_URL}/produs/${encodeURIComponent(p.id)}`;

        const storeName =
          p.service?.profile?.displayName ||
          p.service?.vendor?.displayName ||
          "Artfest";

        // Eticheta umană a categoriei, niciodată slug-ul intern
        // (ex. "home_lumanari-parfumate"). Categorie necunoscută/lipsă
        // -> "handmade" (fallback-ul existent).
        const productType = attrs.productType || "handmade";

        // titlul optimizat pentru Shopping (Product.feedTitle, generat cu AI
        // din datele produsului) are prioritate; altfel titlul de pe site
        const title =
          String(p.feedTitle || "").trim() ||
          p.title ||
          "Produs Artfest";

        const description =
          stripHtml(p.description) ||
          `${title} disponibil pe Artfest, marketplace cu produse handmade și personalizate create de artizani români.`;

        // g:price = prețul normal (DB). sale_price + interval doar când
        // există o promoție publică activă (vezi buildMerchantPrice).
        const { price, salePrice, salePriceEffectiveDate } =
          buildMerchantPrice({
            priceCents: p.priceCents,
            currency: p.currency,
            pricing: pricingByProductId.get(p.id),
          });

        const availability = availabilityToGoogle(p.availability);
        const availabilityDate = availabilityDateIso(p);

        // custom labels pentru Performance Max: grup de produs + interval
        // de preț pe prețul NORMAL (nu sale_price - stabil la promoții).
        // TODO(minQuantity): produsele vândute cu cantitate minimă (ex.
        // mărturii) apar aici cu prețul PE BUCATĂ (priceCents), deși nu
        // se poate cumpăra o singură bucată. Trebuie un câmp
        // `minQuantity` pe Product, apoi g:price = preț × minQuantity
        // (+ g:multipack / cantitatea în titlu). Neimplementat încă.
        const groupLabel = productGroupLabel(p, activeCollections);
        const priceLabel = priceBucketLabel(p.priceCents);

        return `    <item>
      <g:id>${escapeXml(p.id)}</g:id>

      <title>${escapeXml(title)}</title>

      <description>${escapeXml(description)}</description>

      <link>${escapeXml(link)}</link>

      <g:image_link>${escapeXml(image)}</g:image_link>
${attrs.additionalImages
  .map(
    (url) =>
      `      <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>\n`
  )
  .join("")}
      <g:availability>${escapeXml(availability)}</g:availability>
${availabilityDate ? `\n      <g:availability_date>${escapeXml(availabilityDate)}</g:availability_date>\n` : ""}
      <g:price>${escapeXml(price)}</g:price>
${salePrice ? `\n      <g:sale_price>${escapeXml(salePrice)}</g:sale_price>\n` : ""}${salePrice && salePriceEffectiveDate ? `\n      <g:sale_price_effective_date>${escapeXml(salePriceEffectiveDate)}</g:sale_price_effective_date>\n` : ""}
      <g:condition>new</g:condition>

      <g:brand>${escapeXml(storeName)}</g:brand>

      <g:product_type>${escapeXml(productType)}</g:product_type>
${attrs.googleProductCategory ? `\n      <g:google_product_category>${attrs.googleProductCategory}</g:google_product_category>\n` : ""}${attrs.color ? `\n      <g:color>${escapeXml(attrs.color)}</g:color>\n` : ""}${attrs.material ? `\n      <g:material>${escapeXml(attrs.material)}</g:material>\n` : ""}
      <g:custom_label_0>${escapeXml(groupLabel)}</g:custom_label_0>
${priceLabel ? `      <g:custom_label_1>${escapeXml(priceLabel)}</g:custom_label_1>\n` : ""}      <g:mpn>${escapeXml(p.id)}</g:mpn>

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