// backend/src/server/routes/metaCatalogFeed.js

import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

const FRONTEND_URL = (
  process.env.FRONTEND_URL ||
  process.env.APP_URL ||
  "https://artfest.ro"
).replace(/\/+$/, "");

/**
 * Escapare corectă pentru CSV.
 */
function csv(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value)
    .replace(/\r?\n|\r/g, " ")
    .trim();

  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeImageUrl(url) {
  if (!url) return "";

  const value = String(url).trim();

  if (!value) return "";

  if (
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${FRONTEND_URL}${value}`;
  }

  return `${FRONTEND_URL}/${value}`;
}

function metaAvailability(product) {
  /**
   * Meta acceptă valori precum:
   * in stock
   * out of stock
   * preorder
   * available for order
   */

  switch (product.availability) {
    case "SOLD_OUT":
      return "out of stock";

    case "PREORDER":
      return "preorder";

    case "MADE_TO_ORDER":
      return "available for order";

    case "READY":
    default:
      return "in stock";
  }
}

/**
 * GET /meta-product-feed.csv
 *
 * Feed public pentru Meta Commerce Manager.
 */
router.get("/meta-product-feed.csv", async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,

        moderationStatus: "APPROVED",

        /**
         * Pentru moment nu trimitem produse exclusiv
         * pe cerere de ofertă.
         *
         * Meta Catalog este mai potrivit pentru
         * produse cu preț clar.
         */
        orderMode: {
          not: "QUOTE_ONLY",
        },

        priceCents: {
          gt: 0,
        },

        service: {
          isActive: true,

          vendor: {
            isActive: true,
          },
        },
      },

      select: {
        id: true,
        title: true,
        description: true,

        priceCents: true,
        currency: true,

        images: true,

        availability: true,
        readyQty: true,

        category: true,

        materialMain: true,
        color: true,

        service: {
          select: {
            id: true,

            vendor: {
              select: {
                id: true,
                displayName: true,
              },
            },

            profile: {
              select: {
                slug: true,
                displayName: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    /**
     * Coloane compatibile Meta Catalog.
     */
    const header = [
      "id",
      "title",
      "description",
      "availability",
      "condition",
      "price",
      "link",
      "image_link",
      "brand",
      "product_type",
    ];

    const rows = [header.join(",")];

    for (const product of products) {
      const firstImage =
        Array.isArray(product.images) &&
        product.images.length > 0
          ? normalizeImageUrl(product.images[0])
          : "";

      /**
       * Meta are nevoie de imagine.
       * Dacă produsul nu are imagine, nu-l trimitem.
       */
      if (!firstImage) {
        continue;
      }

      const productUrl =
        `${FRONTEND_URL}/produs/${encodeURIComponent(
          product.id
        )}`;

      const currency =
        String(product.currency || "RON")
          .trim()
          .toUpperCase();

      const price =
        `${(
          Number(product.priceCents || 0) / 100
        ).toFixed(2)} ${currency}`;

      const brand =
        product.service?.profile?.displayName ||
        product.service?.vendor?.displayName ||
        "Artfest";

      const description =
        product.description ||
        product.title ||
        "Produs disponibil pe Artfest.";

      const productType =
        product.category ||
        "Handmade";

      const row = [
        product.id,
        product.title,
        description,
        metaAvailability(product),
        "new",
        price,
        productUrl,
        firstImage,
        brand,
        productType,
      ].map(csv);

      rows.push(row.join(","));
    }

    const output = rows.join("\n");

    res.setHeader(
      "Content-Type",
      "text/csv; charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      'inline; filename="artfest-meta-product-feed.csv"'
    );

    /**
     * Meta poate verifica periodic URL-ul.
     * 5 minute cache este suficient ca să nu lovim DB
     * inutil la fiecare request.
     */
    res.setHeader(
      "Cache-Control",
      "public, max-age=300"
    );

    return res.status(200).send(
      "\uFEFF" + output
    );
  } catch (error) {
    console.error(
      "[META CATALOG FEED] error:",
      error
    );

    return res.status(500).send(
      "Could not generate Meta product feed."
    );
  }
});

export default router;