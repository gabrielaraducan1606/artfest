// server/routes/public.store.js
import { Router } from "express";
import { prisma } from "../db.js";
import {
  CATEGORIES,
  CATEGORY_SET,
  CATEGORIES_DETAILED,
} from "../constants/categories.js";
import {
  normalizeCityName,
  hasRomanianDiacritics,
} from "../utils/cityUtils.js";

const router = Router();

/* Utils */
function buildOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "popular":
      return [{ createdAt: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
}

/**
 * ATENȚIE:
 * Am scos complet rutele:
 *   - GET /store/:slug
 *   - GET /store/:slug/products
 *   - GET /store/:slug/reviews
 *   - GET /store/:slug/reviews/average
 *
 * Acum ele există DOAR în `public.products.js`,
 * astfel încât recenziile de profil magazin să funcționeze corect.
 */

/* PRODUSE PUBLIC: listare/filtre/paginare: /api/public/products */
router.get("/products", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.query.limit || "24", 10))
    );
    const skip = (page - 1) * limit;

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
    const serviceType = (req.query.serviceType || req.query.type || "").trim();
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

    const activeService = {
      is: {
        isActive: true,
        status: "ACTIVE",
        vendor: { is: { isActive: true } },
      },
    };
    const activeWhere = { isActive: true, service: activeService };

    // A) când avem ids
    if (idsList.length > 0) {
      const where = {
        ...activeWhere,
        id: { in: idsList },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
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
        ...(category
          ? { category: { equals: category, mode: "insensitive" } }
          : {}),
        service: {
          ...activeWhere.service,
          ...(city
            ? {
                is: {
                  ...activeService.is,
                  city: { contains: city, mode: "insensitive" },
                },
              }
            : {}),
          ...(serviceType
            ? {
                is: {
                  ...activeService.is,
                  type: { is: { code: serviceType } },
                },
              }
            : {}),
        },
      };

      if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
        where.priceCents = {};
        if (!Number.isNaN(minPrice))
          where.priceCents.gte = minPrice * 100;
        if (!Number.isNaN(maxPrice))
          where.priceCents.lte = maxPrice * 100;
      }

      const filtered = await prisma.product.findMany({
        where,
        include: {
          service: { include: { type: true, vendor: true, profile: true } },
          reviews: true,
          Favorite: true,
        },
      });

      const pos = new Map(
        idsList.map((id, i) => [id, i])
      );
      const ordered = filtered.sort(
        (a, b) =>
          (pos.get(a.id) ?? 999999) - (pos.get(b.id) ?? 999999)
      );

      const total = ordered.length;
      const items = ordered
        .slice(skip, skip + limit)
        .map((p) => ({
          ...p,
          storeName:
            p?.service?.profile?.displayName ||
            p?.service?.vendor?.displayName ||
            "Magazin",
          category: p.category || null,
        }));

      return res.json({ total, items, page, limit });
    }

    // B) caz general
    const where = {
      ...activeWhere,
      ...(category
        ? { category: { equals: category, mode: "insensitive" } }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
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
      service: {
        is: {
          ...activeService.is,
          ...(city
            ? { city: { contains: city, mode: "insensitive" } }
            : {}),
          ...(serviceType
            ? { type: { is: { code: serviceType } } }
            : {}),
        },
      },
    };

    if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
      where.priceCents = {};
      if (!Number.isNaN(minPrice))
        where.priceCents.gte = minPrice * 100;
      if (!Number.isNaN(maxPrice))
        where.priceCents.lte = maxPrice * 100;
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

/* DETALII PRODUS public: /api/public/products/:id */
router.get("/products/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: { type: true, vendor: true, profile: true },
        },
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
            (p.reviews.reduce(
              (s, r) => s + (r.rating || 0),
              0
            ) / p.reviews.length) *
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
    });
  } catch (e) {
    next(e);
  }
});

/* Recomandate / Popular / Noutăți */
router.get("/products/recommended", async (_req, res, next) => {
  try {
    const latestRaw = await prisma.product.findMany({
      where: {
        isActive: true,
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
          },
        },
      },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: {
        service: { include: { type: true, vendor: true, profile: true } },
      },
    });
    const latest = latestRaw.map((p) => ({
      ...p,
      storeName:
        p?.service?.profile?.displayName ||
        p?.service?.vendor?.displayName ||
        "Magazin",
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

    const popularIds = popularAgg
      .map((a) => a.productId)
      .filter(Boolean);
    const countMap = new Map(
      popularAgg.map((a) => [a.productId, a._count.productId])
    );

    const popularRaw = popularIds.length
      ? await prisma.product.findMany({
          where: {
            id: { in: popularIds },
            isActive: true,
            service: {
              is: {
                isActive: true,
                status: "ACTIVE",
                vendor: { is: { isActive: true } },
              },
            },
          },
          include: {
            service: { include: { type: true, vendor: true, profile: true } },
          },
        })
      : [];

    const pos = new Map(popularIds.map((id, i) => [id, i]));
    const popular = popularRaw
      .map((p) => ({
        ...p,
        storeName:
          p?.service?.profile?.displayName ||
          p?.service?.vendor?.displayName ||
          "Magazin",
        category: p.category || null,
        popularityCount: countMap.get(p.id) || 0,
      }))
      .sort(
        (a, b) => (pos.get(a.id) ?? 9999) - (pos.get(b.id) ?? 9999)
      );

    const recommendedRaw = await prisma.product.findMany({
      where: {
        isActive: true,
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
          },
        },
      },
      take: 12,
      orderBy: [
        { Favorite: { _count: "desc" } },
        { createdAt: "desc" },
      ],
      include: {
        service: { include: { type: true, vendor: true, profile: true } },
      },
    });
    const recommended = recommendedRaw.map((p) => ({
      ...p,
      storeName:
        p?.service?.profile?.displayName ||
        p?.service?.vendor?.displayName ||
        "Magazin",
      category: p.category || null,
    }));

    res.json({ latest, popular, recommended });
  } catch (e) {
    next(e);
  }
});

/* categorii */
router.get("/categories", (_req, res) => res.json(CATEGORIES));
router.get("/categories/detailed", (_req, res) =>
  res.json(CATEGORIES_DETAILED)
);
router.get("/products/categories/stats", async (_req, res, next) => {
  try {
    const byProd = await prisma.product.groupBy({
      by: ["category"],
      where: { isActive: true, category: { not: null } },
      _count: { category: true },
    });
    const out = byProd
      .filter((r) => r.category && CATEGORY_SET.has(r.category))
      .map((r) => ({
        category: r.category,
        count: r._count.category,
      }))
      .sort((a, b) => b.count - a.count);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

/* =========================================================
 *            MAGAZINE (/stores) – listă, sugestii, orașe
 * =======================================================*/

/**
 * Helper: sortare pentru stores
 */
function buildStoreOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "name_asc":
      return [{ displayName: "asc" }, { createdAt: "desc" }];
    case "name_desc":
      return [{ displayName: "desc" }, { createdAt: "desc" }];
    case "popular":
      return [{ createdAt: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
}

// helper mic: preferăm varianta cu diacritice dacă există
function pickBetterLabel(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  // dacă candidate are diacritice și existing nu → luăm candidate
  if (hasRomanianDiacritics(candidate) && !hasRomanianDiacritics(existing)) {
    return candidate;
  }

  // altfel păstrăm primul (să fie stabil)
  return existing;
}

/**
 * Helper comun: construiește city + citySlug pentru un profile,
 * folosind și CityDictionary dacă există intrare.
 */
function buildCityMetaFromProfile(profile, dictMap) {
  const service = profile.service;
  const vendor = service?.vendor;

  const rawCity =
    (profile.city || "").trim() ||
    (service?.city || "").trim() ||
    (vendor?.city || "").trim() ||
    "";

  const slugFromProfile =
    profile.citySlug ||
    service?.citySlug ||
    vendor?.citySlug ||
    (rawCity ? normalizeCityName(rawCity) : null);

  const citySlug = slugFromProfile || null;

  let cityLabel = null;
  if (citySlug) {
    const fromDict = (dictMap.get(citySlug) || "").trim();
    if (fromDict) {
      cityLabel = fromDict;
    }
  }
  if (!cityLabel) {
    cityLabel = rawCity || null;
  }

  return { city: cityLabel, citySlug };
}

/**
 * GET /api/public/stores
 * Lista de magazine cu filtre: q, city (slug), sort, paginare
 */
router.get("/stores", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.query.limit || "24", 10))
    );
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();
    const citySlugParam = (req.query.city || "").trim(); // 👈 slug
    const sort = (req.query.sort || "new").trim();

    const baseWhere = {
      service: {
        is: {
          isActive: true,
          status: "ACTIVE",
          vendor: { is: { isActive: true } },
        },
      },
    };

    const where = {
      ...baseWhere,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { about: { contains: q, mode: "insensitive" } },
              {
                shortDescription: {
                  contains: q,
                  mode: "insensitive",
                },
              },
              {
                service: {
                  is: {
                    vendor: {
                      is: {
                        displayName: {
                          contains: q,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
      ...(citySlugParam
        ? {
            OR: [
              { citySlug: citySlugParam },
              {
                service: {
                  is: {
                    citySlug: citySlugParam,
                    vendor: {
                      is: {
                        citySlug: citySlugParam,
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    // 🔹 încărcăm dicționarul cu etichete corectate de admin
    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(
      dictRows.map((r) => [r.slug, r.canonicalLabel])
    );

    const [total, profiles] = await Promise.all([
      prisma.serviceProfile.count({ where }),
      prisma.serviceProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildStoreOrderBy(sort),
        include: {
          service: {
            include: {
              vendor: true,
              products: {
                where: { isActive: true },
                select: { id: true },
              },
            },
          },
        },
      }),
    ]);

    const items = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;

      const storeName =
        p.displayName ||
        vendor?.displayName ||
        "Magazin";

      const logoUrl = p.logoUrl || vendor?.logoUrl || null;

      const { city, citySlug } = buildCityMetaFromProfile(p, dictMap);

      const productsCount = service?.products?.length || 0;

      return {
        id: service?.id,
        profileSlug: p.slug || null,
        storeName,
        displayName: storeName,
        city,
        citySlug,
        category: null,
        about: p.shortDescription || p.about || null,
        logoUrl,
        productsCount,
      };
    });

    res.json({ total, items, page, limit });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/stores/suggest
 * Folosit de autocomplete în pagina /magazine
 * returnează { stores: [...] }
 */
router.get("/stores/suggest", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.json({ stores: [] });
    }

    // 🔹 încărcăm dicționarul
    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(
      dictRows.map((r) => [r.slug, r.canonicalLabel])
    );

    const profiles = await prisma.serviceProfile.findMany({
      where: {
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
          },
        },
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { about: { contains: q, mode: "insensitive" } },
          {
            service: {
              is: {
                vendor: {
                  is: {
                    displayName: {
                      contains: q,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
          },
        ],
      },
      take: 10,
      orderBy: [{ displayName: "asc" }],
      include: {
        service: {
          include: { vendor: true },
        },
      },
    });

    const stores = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;

      const storeName =
        p.displayName ||
        vendor?.displayName ||
        "Magazin";

      const logoUrl = p.logoUrl || vendor?.logoUrl || null;

      const { city, citySlug } = buildCityMetaFromProfile(p, dictMap);

      return {
        id: service?.id,
        profileSlug: p.slug || null,
        storeName,
        displayName: storeName,
        city,
        citySlug,
        logoUrl,
      };
    });

    res.json({ stores });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/stores/cities
 * Lista de orașe în care avem magazine active:
 *  { cities: [ { slug, label }, ... ] }
 *  - slug = normalizat (bacau, cluj-napoca, ...)
 *  - label = varianta "frumoasă" (cu diacritice, dacă există)
 *           -> prioritate: CityDictionary.canonicalLabel
 */
router.get("/stores/cities", async (_req, res, next) => {
  try {
    // încărcăm dicționarul cu etichete corectate de admin
    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(
      dictRows.map((r) => [r.slug, r.canonicalLabel])
    );

    const profileCities = await prisma.serviceProfile.findMany({
      where: {
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
          },
        },
        OR: [{ city: { not: null } }, { citySlug: { not: null } }],
      },
      select: { city: true, citySlug: true },
    });

    const vendorCities = await prisma.vendor.findMany({
      where: {
        isActive: true,
        OR: [{ city: { not: null } }, { citySlug: { not: null } }],
      },
      select: { city: true, citySlug: true },
    });

    const all = [...profileCities, ...vendorCities];

    const map = new Map(); // slug -> label frumos

    for (const row of all) {
      const rawLabel = (row.city || "").trim();
      if (!rawLabel) continue;

      const slug =
        row.citySlug || normalizeCityName(rawLabel);

      if (!slug) continue;

      // 1) dacă avem ceva în dicționar → prioritar
      const fromDict = (dictMap.get(slug) || "").trim();

      if (fromDict) {
        map.set(slug, fromDict);
        continue;
      }

      // 2) altfel, construim label-ul din variantele brute
      const existing = map.get(slug) || null;
      const better = pickBetterLabel(existing, rawLabel);
      map.set(slug, better);
    }

    const cities = Array.from(map.entries())
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, "ro-RO", {
          sensitivity: "base",
        })
      );

    res.json({ cities });
  } catch (e) {
    next(e);
  }
});

export default router;
