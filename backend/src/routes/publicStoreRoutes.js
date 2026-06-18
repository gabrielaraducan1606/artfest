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
 * Helpers
 * =======================================================*/

function buildStoreOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "name_asc":
      return [{ displayName: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "name_desc":
      return [{ displayName: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "popular":
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

function publicSellerTypeFromBilling(billing) {
  const hasBusinessBillingData = !!(
    billing?.legalType ||
    billing?.companyName ||
    billing?.cui ||
    billing?.regCom ||
    billing?.vatStatus
  );

  const sellerType =
    billing?.sellerType ||
    (hasBusinessBillingData ? "verified_business" : null);

  if (sellerType === "independent_creator") {
    return {
      sellerType: "independent_creator",
      sellerTypeLabel: "Creator independent la început de drum",
    };
  }

  if (sellerType === "verified_business") {
    return {
      sellerType: "verified_business",
      sellerTypeLabel: "Business verificat",
    };
  }

  return {
    sellerType: null,
    sellerTypeLabel: null,
  };
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

function buildProductOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "popular":
      return [{ popularityScore: "desc" }, { createdAt: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
}

/* ----------------------------
   CityDictionary cache
----------------------------- */
let _dictCache = { at: 0, map: new Map() };
const DICT_TTL_MS = 5 * 60 * 1000;

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

/* =========================================================
 * Magazine publice
 * =======================================================*/

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
          type: { is: { code: "products" } },
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
                      is: {
                        displayName: { contains: q, mode: "insensitive" },
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
                    vendor: { is: { citySlug: citySlugParam } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const dictMap = await getCityDictMapCached();
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
              vendor: {
                include: {
                  billing: {
  select: {
    sellerType: true,
    legalType: true,
    companyName: true,
    cui: true,
    regCom: true,
    vatStatus: true,
  },
},
                },
              },
              _count: {
                select: {
                  products: true,
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
      const sellerTypeInfo = publicSellerTypeFromBilling(vendor?.billing);

      const storeName = p.displayName || vendor?.displayName || "Magazin";
      const logoUrl = p.logoUrl || vendor?.logoUrl || null;
      const { city, citySlug } = buildCityMetaFromProfile(p, dictMap);

      const productsCount = service?._count?.products || 0;

      const aboutRaw = p.shortDescription || p.about || vendor?.about || null;
      const about =
        aboutRaw && String(aboutRaw).length > 180
          ? String(aboutRaw).slice(0, 179).trimEnd() + "…"
          : aboutRaw;

      return {
        id: service?.id,
        profileSlug: p.slug || null,
        storeName,
        displayName: storeName,
        city,
        citySlug,
        category: null,
        about,
        logoUrl,
        productsCount,
        sellerType: sellerTypeInfo.sellerType,
        sellerTypeLabel: sellerTypeInfo.sellerTypeLabel,
      };
    });

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
                  is: {
                    displayName: { contains: q, mode: "insensitive" },
                  },
                },
              },
            },
          },
        ],
      },
      take: 10,
      orderBy: [{ displayName: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      include: {
        service: {
          include: {
            vendor: {
              include: {
                billing: {
  select: {
    sellerType: true,
    legalType: true,
    companyName: true,
    cui: true,
    regCom: true,
    vatStatus: true,
  },
},
              },
            },
          },
        },
      },
    });

    const stores = profiles.map((p) => {
      const service = p.service;
      const vendor = service?.vendor;
      const sellerTypeInfo = publicSellerTypeFromBilling(vendor?.billing);

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
        sellerType: sellerTypeInfo.sellerType,
        sellerTypeLabel: sellerTypeInfo.sellerTypeLabel,
      };
    });

    res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
    res.json({ stores });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/store/:slug
 * Profil public magazin
 */
router.get("/store/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "invalid_slug" });

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: {
        service: {
          include: {
            type: true,
            vendor: {
              include: {
               billing: {
  select: {
    sellerType: true,
    legalType: true,
    companyName: true,
    cui: true,
    regCom: true,
    vatStatus: true,
  },
},
              },
            },
          },
        },
      },
    });

    if (
      !profile ||
      !profile.service?.isActive ||
      profile.service?.status !== "ACTIVE" ||
      !profile.service?.vendor?.isActive ||
      profile.service?.type?.code !== "products"
    ) {
      return res.status(404).json({ error: "store_not_found" });
    }

    const service = profile.service;
    const vendor = service.vendor;
    const sellerTypeInfo = publicSellerTypeFromBilling(vendor.billing);

    res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=30");

    return res.json({
      serviceId: service.id,
      vendorId: vendor.id,
      userId: vendor.userId,

      slug: profile.slug,
      shopName: profile.displayName || vendor.displayName || "Magazin",
      displayName: profile.displayName || vendor.displayName || "Magazin",

      shortDescription: profile.shortDescription || "",
      tagline: profile.tagline || "",
      about: profile.about || vendor.about || "",

      city: profile.city || service.city || vendor.city || "",
      citySlug: profile.citySlug || service.citySlug || vendor.citySlug || null,
      country: "România",

      address: profile.address || vendor.address || "",
      publicEmail: profile.email || vendor.email || "",
      email: profile.email || vendor.email || "",
      phone: profile.phone || vendor.phone || "",
      website: profile.website || vendor.website || "",

      delivery: Array.isArray(profile.delivery) ? profile.delivery : [],

      logoUrl: profile.logoUrl || vendor.logoUrl || "",
      coverUrl: profile.coverUrl || vendor.coverUrl || "",
      profileImageUrl: profile.logoUrl || vendor.logoUrl || "",
      coverImageUrl: profile.coverUrl || vendor.coverUrl || "",

      leadTimes: service.attributes?.leadTimes || "",

      status: "active",
      sellerType: sellerTypeInfo.sellerType,
      sellerTypeLabel: sellerTypeInfo.sellerTypeLabel,

      updatedAt: profile.updatedAt,
      profile,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/store/:slug/initial
 * Profil + produse într-un singur request
 */
router.get("/store/:slug/initial", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();

    if (!slug) {
      return res.status(400).json({ error: "invalid_slug" });
    }

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: {
        service: {
          include: {
            type: true,
            vendor: {
              include: {
                billing: {
                  select: {
                    sellerType: true,
                    legalType: true,
                    companyName: true,
                    cui: true,
                    regCom: true,
                    vatStatus: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      !profile ||
      !profile.service?.isActive ||
      profile.service?.status !== "ACTIVE" ||
      !profile.service?.vendor?.isActive ||
      profile.service?.type?.code !== "products"
    ) {
      return res.status(404).json({
        error: "store_not_found",
      });
    }

    const service = profile.service;
    const vendor = service.vendor;

    const sellerTypeInfo = publicSellerTypeFromBilling(
      vendor.billing
    );

    const products = await prisma.product.findMany({
      where: {
        serviceId: profile.serviceId,
        isActive: true,
        isHidden: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 24,
    });

    res.set(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=300"
    );

    return res.json({
      shop: {
        serviceId: service.id,
        vendorId: vendor.id,
        userId: vendor.userId,

        slug: profile.slug,
        shopName:
          profile.displayName ||
          vendor.displayName ||
          "Magazin",

        displayName:
          profile.displayName ||
          vendor.displayName ||
          "Magazin",

        shortDescription:
          profile.shortDescription || "",

        tagline:
          profile.tagline || "",

        about:
          profile.about ||
          vendor.about ||
          "",

        city:
          profile.city ||
          service.city ||
          vendor.city ||
          "",

        citySlug:
          profile.citySlug ||
          service.citySlug ||
          vendor.citySlug ||
          null,

        country: "România",

        address:
          profile.address ||
          vendor.address ||
          "",

        publicEmail:
          profile.email ||
          vendor.email ||
          "",

        email:
          profile.email ||
          vendor.email ||
          "",

        phone:
          profile.phone ||
          vendor.phone ||
          "",

        website:
          profile.website ||
          vendor.website ||
          "",

        delivery: Array.isArray(profile.delivery)
          ? profile.delivery
          : [],

        logoUrl:
          profile.logoUrl ||
          vendor.logoUrl ||
          "",

        coverUrl:
          profile.coverUrl ||
          vendor.coverUrl ||
          "",

        profileImageUrl:
          profile.logoUrl ||
          vendor.logoUrl ||
          "",

        coverImageUrl:
          profile.coverUrl ||
          vendor.coverUrl ||
          "",

        leadTimes:
          service.attributes?.leadTimes || "",

        status: "active",

        sellerType:
          sellerTypeInfo.sellerType,

        sellerTypeLabel:
          sellerTypeInfo.sellerTypeLabel,

        updatedAt: profile.updatedAt,
      },

      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || "",
        price: Number.isFinite(p.priceCents)
          ? p.priceCents / 100
          : null,
        priceCents: p.priceCents,
        currency: p.currency || "RON",
        images: Array.isArray(p.images)
          ? p.images
          : [],
        category: p.category || null,
        isActive: p.isActive,
        isHidden: !!p.isHidden,

        availability:
          p.availability || "READY",

        leadTimeDays:
          p.leadTimeDays ?? null,

        readyQty:
          p.readyQty ?? 0,

        nextShipDate:
          p.nextShipDate || null,

        acceptsCustom:
          !!p.acceptsCustom,

        color: p.color || "",
        materialMain:
          p.materialMain || "",

        technique:
          p.technique || "",

        styleTags: Array.isArray(p.styleTags)
          ? p.styleTags
          : [],

        occasionTags: Array.isArray(p.occasionTags)
          ? p.occasionTags
          : [],

        dimensions:
          p.dimensions || "",

        careInstructions:
          p.careInstructions || "",

        specialNotes:
          p.specialNotes || "",

        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/store/:slug/products
 */
router.get("/store/:slug/products", async (req, res, next) => {
  try {
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

    if (
      !profile ||
      !profile.service?.isActive ||
      profile.service?.status !== "ACTIVE" ||
      !profile.service?.vendor?.isActive ||
      profile.service?.type?.code !== "products"
    ) {
      return res.status(404).json({ error: "store_not_found" });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || "24", 10)));
    const skip = (page - 1) * limit;
    const sort = String(req.query.sort || "new").trim();

    const where = {
      serviceId: profile.serviceId,
      isActive: true,
      isHidden: false,
    };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildProductOrderBy(sort),
      }),
    ]);

    res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=30");

    return res.json({
      total,
      page,
      limit,
      items: items.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description || "",
        price: Number.isFinite(p.priceCents) ? p.priceCents / 100 : null,
        priceCents: p.priceCents,
        currency: p.currency || "RON",
        images: Array.isArray(p.images) ? p.images : [],
        category: p.category || null,
        isActive: p.isActive,
        isHidden: !!p.isHidden,

        availability: p.availability || "READY",
        leadTimeDays: p.leadTimeDays ?? null,
        readyQty: p.readyQty ?? 0,
        nextShipDate: p.nextShipDate || null,
        acceptsCustom: !!p.acceptsCustom,

        color: p.color || "",
        materialMain: p.materialMain || "",
        technique: p.technique || "",
        styleTags: Array.isArray(p.styleTags) ? p.styleTags : [],
        occasionTags: Array.isArray(p.occasionTags) ? p.occasionTags : [],
        dimensions: p.dimensions || "",
        careInstructions: p.careInstructions || "",
        specialNotes: p.specialNotes || "",

        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/public/stores/cities
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

/* =========================================================
 * Categorii publice
 * =======================================================*/

router.get("/categories", (_req, res) => res.json(CATEGORIES));

router.get("/categories/detailed", (_req, res) => {
  res.json(CATEGORIES_DETAILED);
});

router.get("/products/categories/stats", async (_req, res, next) => {
  try {
    const byProd = await prisma.product.groupBy({
      by: ["category"],
      where: {
        isActive: true,
        isHidden: false,
        category: { not: null },
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
            type: { is: { code: "products" } },
          },
        },
      },
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