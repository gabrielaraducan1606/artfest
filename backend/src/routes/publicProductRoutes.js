import { Router } from "express";
import { prisma } from "../db.js";
import { CATEGORIES, CATEGORY_SET } from "../constants/categories.js";

const router = Router();

/* -----------------------------------------
   Utils
------------------------------------------*/
function buildOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":  return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc": return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "popular":    return [{ createdAt: "desc" }]; // compat
    case "new":
    default:           return [{ createdAt: "desc" }];
  }
}

/* -----------------------------------------
   STORE PUBLIC: /store/:slug
------------------------------------------*/
router.get("/store/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: "invalid_slug" });

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });

  if (!profile || profile?.service?.type?.code !== "products") {
    return res.status(404).json({ error: "store_not_found" });
  }

  const svc = profile.service;
  const vendor = svc.vendor;
  const isActive = svc.status === "ACTIVE" && svc.isActive && vendor.isActive;

  const makeShort = (s = "", max = 160) => {
    const t = String(s || "").trim();
    if (!t) return "";
    return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
  };

  res.json({
    _id: svc.id,
    userId: vendor.userId,
    slug: profile.slug,
    shopName: profile.displayName || vendor.displayName || "Magazin",
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
  });
});

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

  res.json(
    items.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || "",
      price: Number.isFinite(p.priceCents) ? p.priceCents / 100 : null,
      images: Array.isArray(p.images) ? p.images : [],
      currency: p.currency || "RON",
      createdAt: p.createdAt,
      category: p.category || null,
    }))
  );
});

router.get("/store/:slug/reviews", async (_req, res) => res.json([]));
router.get("/store/:slug/reviews/average", async (_req, res) => res.json({ average: 0 }));

/* -----------------------------------------
   PRODUSE PUBLICE: listare/filtre/paginare
------------------------------------------*/
router.get("/products", async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || "24", 10)));
    const skip  = (page - 1) * limit;

    // ✨ NOU: suport "ids" (listă de UUID-uri separate prin virgulă)
    const idsParam = String(req.query.ids || "").trim();
    const idsList = idsParam
      ? Array.from(new Set(idsParam.split(",").map(s => s.trim()).filter(Boolean)))
      : [];

    // filtre comune
    const q            = (req.query.q || "").trim();
    const category     = (req.query.category || req.query.categorie || "").trim();
    const serviceType  = (req.query.serviceType || req.query.type || "").trim();
    const city         = (req.query.city || "").trim();
    const sort         = (req.query.sort || "new").trim();
    const minPrice     = parseInt(req.query.minPrice || req.query.min || "", 10);
    const maxPrice     = parseInt(req.query.maxPrice || req.query.max || "", 10);

    // doar produse active + servicii/vânzători activi
    const activeService = { is: { isActive: true, status: "ACTIVE", vendor: { is: { isActive: true } } } };
    const activeWhere = { isActive: true, service: activeService };

    // ============================
    //  A) Caz special: avem `ids`
    //  (aplicăm filtre, păstrăm ordinea din ids)
    // ============================
    if (idsList.length > 0) {
      const where = {
        ...activeWhere,
        id: { in: idsList },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { service: { is: { type: { is: { name: { contains: q, mode: "insensitive" } } } } } },
              ],
            }
          : {}),
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
        service: {
          ...activeWhere.service,
          ...(city ? { is: { ...activeService.is, city: { contains: city, mode: "insensitive" } } } : {}),
          ...(serviceType ? { is: { ...activeService.is, type: { is: { code: serviceType } } } } : {}),
        },
      };

      if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
        where.priceCents = {};
        if (!Number.isNaN(minPrice)) where.priceCents.gte = minPrice * 100;
        if (!Number.isNaN(maxPrice)) where.priceCents.lte = maxPrice * 100;
      }

      // toate potrivirile (apoi paginăm în ordinea din ids)
      const filtered = await prisma.product.findMany({
        where,
        include: {
          service: { include: { type: true, vendor: true, profile: true } },
          reviews: true,
          Favorite: true,
        },
      });

      // păstrăm ordinea din ids
      const pos = new Map(idsList.map((id, i) => [id, i]));
      const ordered = filtered.sort((a, b) => (pos.get(a.id) ?? 999999) - (pos.get(b.id) ?? 999999));

      const total = ordered.length;
      const items = ordered.slice(skip, skip + limit).map((p) => ({
        ...p,
        storeName:
          p?.service?.profile?.displayName ||
          p?.service?.vendor?.displayName ||
          "Magazin",
        category: p.category || null,
      }));

      return res.json({ total, items, page, limit });
    }

    // ========================================
    //  B) Caz general: filtre + sort existente
    // ========================================
    const where = {
      ...activeWhere,
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { service: { is: { type: { is: { name: { contains: q, mode: "insensitive" } } } } } },
            ],
          }
        : {}),
      service: {
        is: {
          ...activeService.is,
          ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
          ...(serviceType ? { type: { is: { code: serviceType } } } : {}),
        },
      },
    };

    if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
      where.priceCents = {};
      if (!Number.isNaN(minPrice)) where.priceCents.gte = minPrice * 100;
      if (!Number.isNaN(maxPrice)) where.priceCents.lte = maxPrice * 100;
    }

    const [total, itemsRaw] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildOrderBy(sort),
        include: {
          service: { include: { type: true, vendor: true, profile: true } },
          reviews: true,
          Favorite: true,
        },
      }),
    ]);

    const items = itemsRaw.map((p) => ({
      ...p,
      storeName:
        p?.service?.profile?.displayName ||
        p?.service?.vendor?.displayName ||
        "Magazin",
      category: p.category || null,
    }));

    res.json({ total, items, page, limit });
  } catch (e) {
    next(e);
  }
});

/* -----------------------------------------
   DETALII PRODUS public
------------------------------------------*/
router.get("/products/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        service: { include: { type: true, vendor: true, profile: true } },
        reviews: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!p || !p.isActive) return res.status(404).json({ error: "not_found" });
    if (!p.service?.isActive || p.service?.status !== "ACTIVE" || !p.service?.vendor?.isActive) {
      return res.status(404).json({ error: "not_found" });
    }

    const avg =
      p.reviews.length === 0
        ? null
        : Math.round(
            (p.reviews.reduce((s, r) => s + (r.rating || 0), 0) / p.reviews.length) * 10
          ) / 10;

    const storeName =
      p?.service?.profile?.displayName ||
      p?.service?.vendor?.displayName ||
      "Magazin";

    res.json({ ...p, storeName, averageRating: avg, category: p.category || null });
  } catch (e) {
    next(e);
  }
});

/* -----------------------------------------
   RECOMANDĂRI / POPULARE / NOUTĂȚI
------------------------------------------*/
router.get("/products/recommended", async (_req, res, next) => {
  try {
    const latestRaw = await prisma.product.findMany({
      where: {
        isActive: true,
        service: { is: { isActive: true, status: "ACTIVE", vendor: { is: { isActive: true } } } },
      },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: { service: { include: { type: true, vendor: true, profile: true } } },
    });
    const latest = latestRaw.map((p) => ({
      ...p,
      storeName: p?.service?.profile?.displayName || p?.service?.vendor?.displayName || "Magazin",
      category: p.category || null,
    }));

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const popularAgg = await prisma.visitor.groupBy({
      by: ["productId"],
      where: { productId: { not: null }, createdAt: { gte: since } },
      _count: { productId: true },
      orderBy: { _count: { productId: "desc" } },
      take: 12,
    });

    const popularIds = popularAgg.map((a) => a.productId).filter(Boolean);
    const countMap = new Map(popularAgg.map(a => [a.productId, a._count.productId]));

    const popularRaw = popularIds.length
      ? await prisma.product.findMany({
          where: {
            id: { in: popularIds },
            isActive: true,
            service: { is: { isActive: true, status: "ACTIVE", vendor: { is: { isActive: true } } } },
          },
          include: { service: { include: { type: true, vendor: true, profile: true } } },
        })
      : [];

    const pos = new Map(popularIds.map((id, i) => [id, i]));
    const popular = popularRaw
      .map((p) => ({
        ...p,
        storeName: p?.service?.profile?.displayName || p?.service?.vendor?.displayName || "Magazin",
        category: p.category || null,
        popularityCount: countMap.get(p.id) || 0,
      }))
      .sort((a, b) => (pos.get(a.id) ?? 9999) - (pos.get(b.id) ?? 9999));

    const recommendedRaw = await prisma.product.findMany({
      where: {
        isActive: true,
        service: { is: { isActive: true, status: "ACTIVE", vendor: { is: { isActive: true } } } },
      },
      take: 12,
      orderBy: [{ Favorite: { _count: "desc" } }, { createdAt: "desc" }],
      include: { service: { include: { type: true, vendor: true, profile: true } } },
    });
    const recommended = recommendedRaw.map((p) => ({
      ...p,
      storeName: p?.service?.profile?.displayName || p?.service?.vendor?.displayName || "Magazin",
      category: p.category || null,
    }));

    res.json({ latest, popular, recommended });
  } catch (e) {
    next(e);
  }
});

/* -----------------------------------------
   Extra: categorii & stats
------------------------------------------*/
router.get("/categories", (_req, res) => {
  res.json(CATEGORIES);
});

router.get("/products/categories/stats", async (_req, res, next) => {
  try {
    const byProd = await prisma.product.groupBy({
      by: ["category"],
      where: { isActive: true, category: { not: null } },
      _count: { category: true },
    });
    const out = byProd
      .filter((r) => r.category && CATEGORY_SET.has(r.category))
      .map((r) => ({ category: r.category, count: r._count.category }))
      .sort((a, b) => b.count - a.count);
    res.json(out);
  } catch (e) { next(e); }
});

export default router;
