// src/routes/publicStoreRoutes.js
import { Router } from "express";
import { prisma } from "../db.js"; 

const router = Router();

/**
 * ===========================
 * LISTĂ MAGAZINE
 * GET /api/public/stores
 * ===========================
 * - Vendor.isActive = true
 * - au minim un VendorService activ cu ServiceType.code = "products"
 * - filtre: q (nume/about), city
 * - sort: new | popular | name_asc | name_desc
 * - paginare: page, limit
 */
router.get("/stores", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "24"), 10)));
    const skip  = (page - 1) * limit;

    const q    = String(req.query.q ?? "").trim();
    const city = String(req.query.city ?? "").trim();
    const sort = String(req.query.sort ?? "new"); // new | popular | name_asc | name_desc

    const where = {
      isActive: true,
      services: {
        some: {
          isActive: true,
          status: "ACTIVE",
          // relație 1–1: folosește 'is' pentru a filtra pe ServiceType
          type: { is: { code: "products" } },
        },
      },
    };

    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { about:       { contains: q, mode: "insensitive" } },
      ];
    }
    if (city) where.city = { contains: city, mode: "insensitive" };

    let orderBy = { createdAt: "desc" }; // "new"
    if (sort === "name_asc")  orderBy = { displayName: "asc" };
    if (sort === "name_desc") orderBy = { displayName: "desc" };
    // "popular" o aplicăm după fetch (după productsCount)

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          services: {
            where: {
              isActive: true,
              status: "ACTIVE",
              type: { is: { code: "products" } },
            },
            include: {
              profile: true,
              type: true,
              _count: { select: { products: { where: { isActive: true } } } },
            },
          },
        },
      }),
    ]);

    // map la un view simplu de „magazin” (folosim primul serviciu 'products')
    const items = vendors.map((v) => {
      const svc   = v.services[0] || null;
      const prof  = svc?.profile;
      const count = svc?._count?.products ?? 0;

      const storeName = prof?.displayName || v.displayName || "Magazin"; // <- PRIORITATE PROFIL
      return {
        id: v.id,
        storeName,
        displayName: storeName, // compat pentru UI existent
        city: prof?.city || v.city || null,
        category: v.category || null,
        about: prof?.about || v.about || null,
        logoUrl: prof?.logoUrl || v.logoUrl || null,
        coverUrl: prof?.coverUrl || v.coverUrl || null,
        productsCount: count,
        profileSlug: prof?.slug || null,
        serviceId: svc?.id || null,
        createdAt: v.createdAt,
      };
    });

    const out = (sort === "popular")
      ? [...items].sort(
          (a, b) =>
            (b.productsCount - a.productsCount) ||
            (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        )
      : items;

    res.json({ items: out, total, page, limit });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Eroare la listarea magazinelor." });
  }
});

/**
 * ===========================
 * PROFIL MAGAZIN (după slug)
 * GET /api/public/store/:slug
 * ===========================
 */
router.get("/store/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: "invalid_slug" });

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: {
      service: {
        include: {
          type: true,
          vendor: true,
        },
      },
    },
  });

  if (!profile || profile?.service?.type?.code !== "products") {
    return res.status(404).json({ error: "store_not_found" });
  }

  const svc    = profile.service;
  const vendor = svc.vendor;
  const isActive = svc.status === "ACTIVE" && svc.isActive && vendor.isActive;

  const makeShort = (s = "", max = 160) => {
    const t = String(s || "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + "…";
  };

  const storeName = profile.displayName || vendor.displayName || "Magazin";

  const payload = {
    _id: svc.id,
    userId: vendor.userId,
    slug: profile.slug,
    shopName: storeName,               // <- prioritar din profil
    shortDescription: profile.tagline || makeShort(profile.about || vendor.about || "", 160),
    brandStory: profile.about || null,
    city: profile.city || vendor.city || "",
    country: "",
    address: profile.address || "",
    coverImageUrl: profile.coverUrl || "",
    profileImageUrl: profile.logoUrl || "",
    tags: [],
    publicEmail: profile.email || vendor.email || "",
    phone: profile.phone || vendor.phone || "",
    website: profile.website || "",
    status: isActive ? "active" : "inactive",
    onboardingStep: isActive ? 3 : 1,
    updatedAt: profile.updatedAt,
    delivery: Array.isArray(profile.delivery) ? profile.delivery : [],
  };

  return res.json(payload);
});

/**
 * ===========================
 * PRODUSELE UNUI MAGAZIN
 * GET /api/public/store/:slug/products
 * ===========================
 */
router.get("/store/:slug/products", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: "invalid_slug" });

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });
  if (!profile || profile?.service?.type?.code !== "products") {
    return res.status(404).json({ error: "store_not_found" });
  }

  const items = await prisma.product.findMany({
    where: { serviceId: profile.serviceId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const out = items.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: Number.isFinite(p.priceCents) ? p.priceCents / 100 : null,
    images: Array.isArray(p.images) ? p.images : [],
    currency: p.currency || "RON",
    createdAt: p.createdAt,
  }));

  res.json(out);
});

router.get("/store/:slug/reviews", async (_req, res) => res.json([]));
router.get("/store/:slug/reviews/average", async (_req, res) => res.json({ average: 0 }));

export default router;
