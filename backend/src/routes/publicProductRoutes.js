import { Router } from "express";
import { prisma } from "../db.js";
import {
  CATEGORIES,
  CATEGORY_SET,
  CATEGORIES_DETAILED,
} from "../constants/categories.js";

const router = Router();

/* -----------------------------------------
   Utils
------------------------------------------*/
function buildOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "popular":
      return [{ createdAt: "desc" }]; // compat
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
}

// Helper pentru maparea produsului spre front (inclusiv storeName)
// Helper pentru maparea produsului spre front (inclusiv storeName)
function mapPublicProduct(p) {
  const storeName =
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Magazin";

  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    images: Array.isArray(p.images) ? p.images : [],
    priceCents: p.priceCents ?? 0,
    currency: p.currency || "RON",
    isActive: p.isActive,
    isHidden: !!p.isHidden,
    category: p.category || null,
    color: p.color || null,

    // 🔹 modelul de disponibilitate (fără default „READY” aici)
    availability: typeof p.availability === "string"
      ? p.availability.toUpperCase()
      : null,
    leadTimeDays: p.leadTimeDays ?? null,
    readyQty: p.readyQty ?? null,
    nextShipDate: p.nextShipDate ?? null,
    acceptsCustom: !!p.acceptsCustom,

    // 🔹 detaliile structurate nou introduse
    materialMain: p.materialMain || null,
    technique: p.technique || null,
    styleTags: Array.isArray(p.styleTags) ? p.styleTags : [],
    occasionTags: Array.isArray(p.occasionTags) ? p.occasionTags : [],
    dimensions: p.dimensions || null,
    careInstructions: p.careInstructions || null,
    specialNotes: p.specialNotes || null,

    // relații folosite de front
    service: p.service,
    storeName,
  };
}

/* -----------------------------------------
   STORE PUBLIC: /store/:slug
------------------------------------------*/
// LISTĂ MAGAZINE: /api/public/stores
// filtre: q, city, sort, paginare
// sort: new | popular | name_asc | name_desc
router.get("/stores", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.query.limit || "24", 10))
    );
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();
    const city = (req.query.city || "").trim();
    const sort = (req.query.sort || "new").trim().toLowerCase();

    // doar servicii ACTIVE de tip "products", cu vendor activ
    const baseServiceWhere = {
      isActive: true,
      status: "ACTIVE",
      type: { is: { code: "products" } },
      vendor: { is: { isActive: true } },
    };

    const where = {
      service: { is: baseServiceWhere },
    };

    // q = căutăm în nume brand, tagline, about, nume vendor
    if (q) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { tagline: { contains: q, mode: "insensitive" } },
          { about: { contains: q, mode: "insensitive" } },
          {
            service: {
              is: {
                vendor: {
                  is: {
                    displayName: { contains: q, mode: "insensitive" },
                  },
                },
              },
            },
          },
        ],
      });
    }

    // city = city din profil / service / vendor
    if (city) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { city: { contains: city, mode: "insensitive" } },
          {
            service: {
              is: { city: { contains: city, mode: "insensitive" } },
            },
          },
          {
            service: {
              is: {
                vendor: {
                  is: { city: { contains: city, mode: "insensitive" } },
                },
              },
            },
          },
        ],
      });
    }

    // sortare
    let orderBy;
    switch (sort) {
      case "name_asc":
        orderBy = [{ displayName: "asc" }, { updatedAt: "desc" }];
        break;
      case "name_desc":
        orderBy = [{ displayName: "desc" }, { updatedAt: "desc" }];
        break;
      case "popular":
        orderBy = [{ updatedAt: "desc" }]; // momentan proxy pt. popular
        break;
      case "new":
      default:
        orderBy = [{ updatedAt: "desc" }];
    }

    const [total, profiles] = await Promise.all([
      prisma.serviceProfile.count({ where }),
      prisma.serviceProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          service: { include: { vendor: true } },
        },
      }),
    ]);

    const serviceIds = profiles.map((p) => p.serviceId);

    // număr produse active pe magazin
    let countsMap = new Map();
    if (serviceIds.length > 0) {
      const prodAgg = await prisma.product.groupBy({
        by: ["serviceId"],
        where: {
          serviceId: { in: serviceIds },
          isActive: true,
        },
        _count: { _all: true },
      });
      countsMap = new Map(
        prodAgg.map((r) => [r.serviceId, r._count._all])
      );
    }

    const makeShort = (s = "", max = 200) => {
      const t = String(s || "").trim();
      if (!t) return "";
      return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
    };

    const items = profiles.map((p) => {
      const svc = p.service;
      const vendor = svc.vendor;
      const storeName =
        p.displayName || vendor.displayName || "Magazin";

      const about =
        p.shortDescription ||
        p.tagline ||
        makeShort(p.about || vendor.about || "", 200);

      return {
        id: svc.id, // folosit în StoresPage key + fallback URL
        profileSlug: p.slug, // folosit pentru /magazin/:slug
        storeName,
        displayName: p.displayName,
        city: p.city || svc.city || vendor.city || "",
        category: null, // dacă vei avea categorii de magazin
        logoUrl: p.logoUrl || vendor.logoUrl || "",
        productsCount: countsMap.get(svc.id) || 0,
        about,
      };
    });

    res.json({ total, page, limit, items });
  } catch (e) {
    next(e);
  }
});

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

    // folosim întâi shortDescription din DB, apoi fallback-uri
    shortDescription:
      profile.shortDescription ||
      profile.tagline ||
      makeShort(profile.about || vendor.about || "", 160),

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
    where: { serviceId: profile.serviceId, isActive: true, isHidden: false },
    orderBy: { createdAt: "desc" },
  });

  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.json(
    items.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || "",
      priceCents: p.priceCents ?? 0,
      images: Array.isArray(p.images) ? p.images : [],
      currency: p.currency || "RON",
      createdAt: p.createdAt,
      category: p.category || null,
      color: p.color || null,

      // 🟣 exact ca în mapPublicProduct
      availability: typeof p.availability === "string"
        ? p.availability.toUpperCase()
        : null,
      leadTimeDays: p.leadTimeDays ?? null,
      readyQty: p.readyQty ?? null,
      nextShipDate: p.nextShipDate ?? null,
      acceptsCustom: !!p.acceptsCustom,

      materialMain: p.materialMain || null,
      technique: p.technique || null,
      styleTags: Array.isArray(p.styleTags) ? p.styleTags : [],
      occasionTags: Array.isArray(p.occasionTags) ? p.occasionTags : [],
      dimensions: p.dimensions || null,
      careInstructions: p.careInstructions || null,
      specialNotes: p.specialNotes || null,

      isHidden: !!p.isHidden,
      isActive: !!p.isActive,
    }))
  );
});

router.get("/store/:slug/reviews", async (_req, res) => res.json([]));
router.get("/store/:slug/reviews/average", async (_req, res) =>
  res.json({ average: 0 })
);

/* -----------------------------------------
   PRODUSE PUBLICE: listare/filtre/paginare
   GET /api/public/products
------------------------------------------*/
router.get("/products", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.query.limit || "24", 10))
    );
    const skip = (page - 1) * limit;

    // suport ids (similaritate imagine)
    const idsParam = String(req.query.ids || "").trim();
    const idsList = idsParam
      ? Array.from(
          new Set(
            idsParam
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        )
      : [];

    const q = (req.query.q || "").trim();
    const category = (req.query.category || req.query.categorie || "").trim();
    const rawServiceType =
      (req.query.serviceType || req.query.type || "").trim();
    const serviceType = rawServiceType || "products"; // implicit doar products
    const city = (req.query.city || "").trim();
    const sort = (req.query.sort || "new").trim();
    const minPrice = parseInt(
      req.query.minPrice || req.query.min || "",
      10
    );
    const maxPrice = parseInt(
      req.query.maxPrice || req.query.max || "",
      10
    );
    const color = (req.query.color || "").trim();

    // baza: produse active, neascunse, din servicii de tip "products"
    const baseServiceWhere = {
      ...(city
        ? { city: { contains: city, mode: "insensitive" } }
        : {}),
      type: { is: { code: serviceType } },
      isActive: true,
      status: "ACTIVE",
      vendor: { isActive: true },
    };

    const baseWhere = {
      isActive: true,
      isHidden: false,
      service: { is: baseServiceWhere },
    };

    // A) cu ids -> ordonare după listă
    if (idsList.length > 0) {
      const where = {
        ...baseWhere,
        id: { in: idsList },
        ...(category
          ? { category: { equals: category, mode: "insensitive" } }
          : {}),
        ...(color
          ? { color: { equals: color, mode: "insensitive" } }
          : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
                { color: { contains: q, mode: "insensitive" } },
                { materialMain: { contains: q, mode: "insensitive" } },
                { technique: { contains: q, mode: "insensitive" } },
                { dimensions: { contains: q, mode: "insensitive" } },
                {
                  careInstructions: {
                    contains: q,
                    mode: "insensitive",
                  },
                },
                { specialNotes: { contains: q, mode: "insensitive" } },
                { styleTags: { has: q } },
                { occasionTags: { has: q } },
                {
                  service: {
                    is: {
                      type: {
                        is: {
                          name: { contains: q, mode: "insensitive" },
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      };

      if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
        where.priceCents = {};
        if (!Number.isNaN(minPrice)) where.priceCents.gte = minPrice * 100;
        if (!Number.isNaN(maxPrice)) where.priceCents.lte = maxPrice * 100;
      }

      const filtered = await prisma.product.findMany({
        where,
        include: {
          service: { include: { type: true, vendor: true, profile: true } },
        },
      });

      const pos = new Map(idsList.map((id, i) => [id, i]));
      const ordered = filtered.sort(
        (a, b) => (pos.get(a.id) ?? 999999) - (pos.get(b.id) ?? 999999)
      );

      const total = ordered.length;
      const items = ordered.slice(skip, skip + limit).map(mapPublicProduct);

      return res.json({ total, items, page, limit });
    }

    // B) caz general
    const where = {
      ...baseWhere,
      ...(category
        ? { category: { equals: category, mode: "insensitive" } }
        : {}),
      ...(color
        ? { color: { equals: color, mode: "insensitive" } }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { color: { contains: q, mode: "insensitive" } },
              { materialMain: { contains: q, mode: "insensitive" } },
              { technique: { contains: q, mode: "insensitive" } },
              { dimensions: { contains: q, mode: "insensitive" } },
              {
                careInstructions: {
                  contains: q,
                  mode: "insensitive",
                },
              },
              { specialNotes: { contains: q, mode: "insensitive" } },
              { styleTags: { has: q } },
              { occasionTags: { has: q } },
              {
                service: {
                  is: {
                    type: {
                      is: {
                        name: { contains: q, mode: "insensitive" },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
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
        },
      }),
    ]);

    const items = itemsRaw.map(mapPublicProduct);

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
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!p || !p.isActive)
      return res.status(404).json({ error: "not_found" });
    if (
      !p.service?.isActive ||
      p.service?.status !== "ACTIVE" ||
      !p.service?.vendor?.isActive
    ) {
      return res.status(404).json({ error: "not_found" });
    }

    const avg =
      p.reviews.length === 0
        ? null
        : Math.round(
            (p.reviews.reduce((s, r) => s + (r.rating || 0), 0) /
              p.reviews.length) *
              10
          ) / 10;

    const storeName =
      p?.service?.profile?.displayName ||
      p?.service?.vendor?.displayName ||
      "Magazin";

    res.json({
      ...p,
      storeName,
      averageRating: avg,
      category: p.category || null,
      color: p.color || null,

      // câmpuri noi pentru pagina publică de produs
      availability: p.availability
        ? String(p.availability).toUpperCase()
        : null,
      leadTimeDays: p.leadTimeDays ?? null,
      readyQty: p.readyQty ?? null,
      nextShipDate: p.nextShipDate ?? null,
      acceptsCustom: !!p.acceptsCustom,

      materialMain: p.materialMain || null,
      technique: p.technique || null,
      styleTags: p.styleTags || [],
      occasionTags: p.occasionTags || [],
      dimensions: p.dimensions || null,
      careInstructions: p.careInstructions || null,
      specialNotes: p.specialNotes || null,
    });
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
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { isActive: true },
            type: { is: { code: "products" } },
          },
        },
      },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: {
        service: { include: { type: true, vendor: true, profile: true } },
      },
    });
    const latest = latestRaw.map(mapPublicProduct);

    res.json({ latest, popular: [], recommended: [] });
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

router.get("/categories/detailed", (_req, res) => {
  res.json(CATEGORIES_DETAILED);
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
  } catch (e) {
    next(e);
  }
});

export default router;
