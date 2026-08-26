// backend/src/routes/vendorProductManagementRoutes.js

/*
 * Rute REST "vendor-safe" pentru gestionarea produselor unui
 * vendor, separate de fluxul conversațional AI. În acest moment
 * conține doar căutarea de produse (folosită de Vendor Assistant
 * pentru a găsi un produs după nume) - fost vendorProductSearchRoutes.js,
 * redenumit ca parte a refactorului de organizare a rutelor.
 * Rezervat ca loc firesc pentru eventuale endpoint-uri REST
 * generice de administrare produs (UPDATE_PRODUCT non-conversațional
 * etc.), dacă vor fi necesare - NU există încă vreunul.
 *
 * IMPORTANT: acest fișier trebuie montat ÎNAINTE de
 * vendorProductRoutes (vezi server.js) - GET /products/:id de
 * acolo ar "înghiți" /products/search dacă ar fi înregistrat
 * primul (Express potrivește rutele în ordinea înregistrării,
 * iar :id se potrivește cu orice segment).
 */

import { Router } from "express";

import { authRequired } from "../api/auth.js";
import { prisma } from "../db.js";

import { resolveVendorByUserId } from "../services/costProfitService.js";

const router = Router();

const MAX_RESULTS = 5;

/* ======================================================
   GET /api/vendor/products/search?q=...

   Căutare "vendor-safe": întoarce DOAR produsele
   vendorului autentificat, niciodată ale altcuiva.
   Folosit de Vendor Assistant pentru a găsi un produs
   după nume, pornind de la o conversație liberă.
====================================================== */

router.get(
  "/products/search",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendorByUserId(
        req.user.sub
      );

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const q = String(req.query.q || "")
        .trim()
        .slice(0, 160);

      if (!q) {
        return res.json({ items: [] });
      }

      const products = await prisma.product.findMany({
        where: {
          service: {
            vendorId: vendor.id,
          },

          title: {
            contains: q,
            mode: "insensitive",
          },
        },

        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,

          costing: {
            select: {
              status: true,
            },
          },
        },

        orderBy: {
          title: "asc",
        },

        take: MAX_RESULTS,
      });

      const items = products.map((product) => ({
        productId: product.id,
        title: product.title,

        image:
          Array.isArray(product.images) &&
          product.images.length
            ? product.images[0]
            : null,

        priceCents: product.priceCents,
        hasCosting: Boolean(product.costing),
        costingStatus: product.costing?.status || null,
      }));

      return res.json({ items });
    } catch (err) {
      console.error(
        "GET /api/vendor/products/search error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

export default router;
