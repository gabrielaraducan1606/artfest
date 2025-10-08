import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import { CATEGORIES, CATEGORY_SET } from "../constants/categories.js";

const router = Router();

// helper: verifică dacă slug-ul aparține vendorului curent și e de tip "products"
async function getOwnedProductsServiceBySlug(slug, userSub) {
  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: {
      service: { include: { type: true, vendor: true } },
    },
  });
  if (!profile) return { error: "store_not_found", status: 404 };

  const svc = profile.service;
  if (!svc || svc.type?.code !== "products") {
    return { error: "not_a_products_store", status: 404 };
  }
  if (!svc.vendor || svc.vendor.userId !== userSub) {
    return { error: "forbidden", status: 403 };
  }
  return { service: svc, profile };
}

// map produs pentru front (preț RON, nu cenți)
function mapProduct(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: Math.round(p.priceCents) / 100,
    images: Array.isArray(p.images) ? p.images : [],
    currency: p.currency || "RON",
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    category: p.category || null,
  };
}

/**
 * POST /api/vendor/store/:slug/products
 * body: { title, description?, price, images?[], currency?, category? }
 */
router.post(
  "/vendor/store/:slug/products",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const slug = String(req.params.slug || "").trim().toLowerCase();
      const { service, error, status } = await getOwnedProductsServiceBySlug(slug, req.user.sub);
      if (error) return res.status(status).json({ error });

      const {
        title,
        description = "",
        price,
        images = [],
        currency = "RON",
        category = null,
      } = req.body || {};

      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "invalid_title" });
      }

      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ error: "invalid_price" });
      }
      const priceCents = Math.round(priceNum * 100);

      const imgs = Array.isArray(images)
        ? images.slice(0, 12).map((s) => String(s))
        : [];

      // validare categorie (opțională)
      let cat = null;
      if (category != null && String(category).trim() !== "") {
        const c = String(category).trim();
        if (!CATEGORY_SET.has(c)) {
          return res.status(400).json({ error: "invalid_category" });
        }
        cat = c;
      }

      const created = await prisma.product.create({
        data: {
          serviceId: service.id,
          title: title.trim(),
          description: String(description || ""),
          priceCents,
          currency: String(currency || "RON"),
          images: imgs,
          isActive: true,
          category: cat,
        },
      });

      return res.status(201).json(mapProduct(created));
    } catch (e) {
      console.error("POST /vendor/store/:slug/products error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * PUT /api/vendor/products/:id
 * body: { title?, description?, price?, images?[], isActive?, category? }
 */
router.put(
  "/vendor/products/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const product = await prisma.product.findUnique({
        where: { id },
        include: { service: { include: { vendor: true, type: true } } },
      });
      if (!product) return res.status(404).json({ error: "not_found" });

      // securitate: produsul trebuie să aparțină vendorului curent
      if (product.service?.vendor?.userId !== req.user.sub) {
        return res.status(403).json({ error: "forbidden" });
      }
      if (product.service?.type?.code !== "products") {
        return res.status(400).json({ error: "not_a_products_store" });
      }

      const patch = {};
      if (typeof req.body.title === "string") {
        if (!req.body.title.trim())
          return res.status(400).json({ error: "invalid_title" });
        patch.title = req.body.title.trim();
      }
      if (typeof req.body.description === "string") {
        patch.description = req.body.description;
      }
      if (req.body.price !== undefined) {
        const priceNum = Number(req.body.price);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
          return res.status(400).json({ error: "invalid_price" });
        }
        patch.priceCents = Math.round(priceNum * 100);
      }
      if (Array.isArray(req.body.images)) {
        patch.images = req.body.images.slice(0, 12).map((s) => String(s));
      }
      if (typeof req.body.isActive === "boolean") {
        patch.isActive = req.body.isActive;
      }
      if (req.body.category !== undefined) {
        const v = req.body.category;
        if (v == null || String(v).trim() === "") {
          patch.category = null;
        } else {
          const c = String(v).trim();
          if (!CATEGORY_SET.has(c)) {
            return res.status(400).json({ error: "invalid_category" });
          }
          patch.category = c;
        }
      }

      const updated = await prisma.product.update({
        where: { id },
        data: patch,
      });
      return res.json(mapProduct(updated));
    } catch (e) {
      console.error("PUT /vendor/products/:id error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * DELETE /api/vendor/products/:id
 */
router.delete(
  "/vendor/products/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const product = await prisma.product.findUnique({
        where: { id },
        include: { service: { include: { vendor: true, type: true } } },
      });
      if (!product) return res.status(404).json({ error: "not_found" });

      if (product.service?.vendor?.userId !== req.user.sub) {
        return res.status(403).json({ error: "forbidden" });
      }
      if (product.service?.type?.code !== "products") {
        return res.status(400).json({ error: "not_a_products_store" });
      }

      await prisma.product.delete({ where: { id } });
      return res.json({ ok: true, deletedId: id });
    } catch (e) {
      console.error("DELETE /vendor/products/:id error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

export default router;
