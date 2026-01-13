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
      return [{ displayName: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "name_desc":
      return [{ displayName: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "popular":
      // (dacă ai un câmp/metrică de popularitate pe viitor, îl pui aici)
      return [{ createdAt: "desc" }, { id: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
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

/* ----------------------------
   CityDictionary cache (mem)
----------------------------- */
let _dictCache = { at: 0, map: new Map() };
const DICT_TTL_MS = 5 * 60 * 1000; // 5 min

async function getCityDictMapCached() {
  const now = Date.now();
  if (_dictCache.map.size && now - _dictCache.at < DICT_TTL_MS) {
    return _dictCache.map;
  }
  const dictRows = await prisma.cityDictionary.findMany({
    select: { slug: true, canonicalLabel: true },
  });
  const dictMap = new Map(dictRows.map((r) => [r.slug, r.canonicalLabel]));
  _dictCache = { at: now, map: dictMap };
  return dictMap;
}

/**
 * GET /api/public/stores
 * Optimizări:
 * - page=1: total (count)
 * - page>1: fără count, returnăm hasMore din take=limit+1
 * - productsCount din _count (nu mai încărcăm service.products)
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
          type: { is: { code: "products" } }, // ✅ dacă vrei doar magazine de produse
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

    const dictMap = await getCityDictMapCached();

    // take+1 pentru hasMore (și evităm count pe pagini > 1)
    const take = limit + 1;

    const [totalFirstPage, profilesRaw] = await Promise.all([
      page === 1 ? prisma.serviceProfile.count({ where }) : Promise.resolve(null),
      prisma.serviceProfile.findMany({
        where,
        skip,
        take,
        orderBy: buildStoreOrderBy(sort),
        include: {
          service: {
            include: {
              vendor: true,
              _count: {
                select: {
                  products: true, // numără toate produsele asociate service-ului
                },
              },
            },
          },
        },
      }),
    ]);

    const hasMore = profilesRaw.length > limit;
    const profiles = hasMore ? profilesRaw.slice(0, limit) : profilesRaw;

    const items = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;

      const storeName = p.displayName || vendor?.displayName || "Magazin";
      const logoUrl = p.logoUrl || vendor?.logoUrl || null;

      const { city, citySlug } = buildCityMetaFromProfile(p, dictMap);

      // productsCount fără încărcat produse
      const productsCount = service?._count?.products || 0;

      // about scurt pentru listă (payload mic)
      const aboutRaw = p.shortDescription || p.about || vendor?.about || null;
      const about =
        aboutRaw && String(aboutRaw).length > 180
          ? String(aboutRaw).slice(0, 179).trimEnd() + "…"
          : aboutRaw;

      return {
        id: service?.id, // service id (cum aveai)
        profileSlug: p.slug || null,
        storeName,
        displayName: storeName,
        city,
        citySlug,
        category: null,
        about,
        logoUrl,
        productsCount,
      };
    });

    // cache mic pe listă (feel instant)
    res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=30");

    res.json({
      total: page === 1 ? totalFirstPage ?? 0 : null,
      items,
      page,
      limit,
      hasMore,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/stores/suggest
 * Optimizări:
 * - select minimalist
 * - dict map cached
 */
router.get("/stores/suggest", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ stores: [] });

    const dictMap = await getCityDictMapCached();

    const profiles = await prisma.serviceProfile.findMany({
      where: {
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
            type: { is: { code: "products" } },
          },
        },
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
      },
      take: 10,
      orderBy: [{ displayName: "asc" }, { createdAt: "desc" }, { id: "desc" }],
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

    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
    res.json({ stores });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/stores/cities
 * Optimizări:
 * - dict cached
 * - cache HTTP mare (se schimbă rar)
 */
router.get("/stores/cities", async (_req, res, next) => {
  try {
    const dictMap = await getCityDictMapCached();

    const profileCities = await prisma.serviceProfile.findMany({
      where: {
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
            type: { is: { code: "products" } },
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

    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
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
