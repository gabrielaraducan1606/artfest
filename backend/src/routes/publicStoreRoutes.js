// server/routes/public.store.js
import { Router } from "express";
import { prisma } from "../db.js";
import {
  CATEGORIES,
  CATEGORY_SET,
  CATEGORIES_DETAILED,
} from "../constants/categories.js";
import { normalizeCityName, hasRomanianDiacritics } from "../utils/cityUtils.js";

const router = Router();

/* =========================================================
 *            MAGAZINE (/stores) – listă, sugestii, orașe
 * =======================================================*/

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

function pickBetterLabel(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  if (hasRomanianDiacritics(candidate) && !hasRomanianDiacritics(existing)) {
    return candidate;
  }

  return existing;
}

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
    if (fromDict) cityLabel = fromDict;
  }
  if (!cityLabel) cityLabel = rawCity || null;

  return { city: cityLabel, citySlug };
}

/**
 * GET /api/public/stores
 */
router.get("/stores", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || "24", 10)));
    const skip = (page - 1) * limit;

    const q = (req.query.q || "").trim();
    const citySlugParam = (req.query.city || "").trim();
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
              { shortDescription: { contains: q, mode: "insensitive" } },
              {
                service: {
                  is: {
                    vendor: {
                      is: { displayName: { contains: q, mode: "insensitive" } },
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
                    vendor: { is: { citySlug: citySlugParam } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(dictRows.map((r) => [r.slug, r.canonicalLabel]));

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
              products: { where: { isActive: true }, select: { id: true } },
            },
          },
        },
      }),
    ]);

    const items = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;

      const storeName = p.displayName || vendor?.displayName || "Magazin";
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
 */
router.get("/stores/suggest", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ stores: [] });

    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(dictRows.map((r) => [r.slug, r.canonicalLabel]));

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
                  is: { displayName: { contains: q, mode: "insensitive" } },
                },
              },
            },
          },
        ],
      },
      take: 10,
      orderBy: [{ displayName: "asc" }],
      include: { service: { include: { vendor: true } } },
    });

    const stores = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;

      const storeName = p.displayName || vendor?.displayName || "Magazin";
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
 */
router.get("/stores/cities", async (_req, res, next) => {
  try {
    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(dictRows.map((r) => [r.slug, r.canonicalLabel]));

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
    const map = new Map();

    for (const row of all) {
      const rawLabel = (row.city || "").trim();
      if (!rawLabel) continue;

      const slug = row.citySlug || normalizeCityName(rawLabel);
      if (!slug) continue;

      const fromDict = (dictMap.get(slug) || "").trim();
      if (fromDict) {
        map.set(slug, fromDict);
        continue;
      }

      const existing = map.get(slug) || null;
      const better = pickBetterLabel(existing, rawLabel);
      map.set(slug, better);
    }

    const cities = Array.from(map.entries())
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, "ro-RO", { sensitivity: "base" })
      );

    res.json({ cities });
  } catch (e) {
    next(e);
  }
});

/* =========================
 * Categorii (public)
 * ========================= */
router.get("/categories", (_req, res) => res.json(CATEGORIES));
router.get("/categories/detailed", (_req, res) => res.json(CATEGORIES_DETAILED));

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
