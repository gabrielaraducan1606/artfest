// server/routes/publicProductRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { CATEGORIES_DETAILED } from "../constants/categories.js";
import { smartSearchFromQueryBackend } from "../constants/smartSrc.js";
import { uploadSearchImage } from "../middleware/imageSearchUpload.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";

const router = Router();

/* -----------------------------------------
   Utils
------------------------------------------*/

// doar câmpurile de care are nevoie front-ul pentru textul de TVA
function mapPublicBilling(billing) {
  if (!billing) return null;
  return {
    tvaActive: billing.tvaActive,
    vatRate: billing.vatRate,
    vatStatus: billing.vatStatus,
  };
}

function buildOrderBy(sort) {
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

// select minimalist pentru produsele folosite în listă
const baseProductSelect = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  currency: true,
  images: true,
  isActive: true,
  isHidden: true,
  category: true,
  color: true,
  colorVariants: true,

  availability: true,
  leadTimeDays: true,
  readyQty: true,
  nextShipDate: true,
  acceptsCustom: true,

  materialMain: true,
  technique: true,
  styleTags: true,
  occasionTags: true,
  dimensions: true,
  careInstructions: true,
  specialNotes: true,

  service: {
    select: {
      id: true,
      profile: { select: { displayName: true, slug: true } },
      vendor: {
        select: {
          displayName: true,
          billing: {
            select: { tvaActive: true, vatRate: true, vatStatus: true },
          },
        },
      },
    },
  },
};

/**
 * Atașează averageRating + reviewsCount (din productRatingStats) la produsele din listă.
 * - Dacă modelul/tabela nu există încă în Prisma, NU crăpăm => punem 0.
 */
async function attachRatingStatsToProducts(productsRaw) {
  const list = Array.isArray(productsRaw) ? productsRaw : [];
  const ids = list.map((p) => p?.id).filter(Boolean);
  if (!ids.length) return list;

  // ✅ fallback safe dacă modelul nu există
  if (!prisma.productRatingStats) {
    return list.map((p) => ({ ...p, averageRating: 0, reviewsCount: 0 }));
  }

  const statsRows = await prisma.productRatingStats.findMany({
    where: { productId: { in: ids } },
    select: {
      productId: true,
      avg: true,
      c1: true,
      c2: true,
      c3: true,
      c4: true,
      c5: true,
    },
  });

  const statsMap = new Map(
    statsRows.map((s) => {
      const count =
        (s.c1 || 0) + (s.c2 || 0) + (s.c3 || 0) + (s.c4 || 0) + (s.c5 || 0);
      const avg = Number(s.avg || 0);
      return [String(s.productId), { averageRating: avg, reviewsCount: count }];
    })
  );

  return list.map((p) => {
    const st = statsMap.get(String(p.id));
    return {
      ...p,
      averageRating: st?.averageRating ?? 0,
      reviewsCount: st?.reviewsCount ?? 0,
    };
  });
}

// Helper pentru maparea produsului spre front (inclusiv storeName + storeSlug)
function mapPublicProduct(p) {
  const storeName =
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Magazin";

  const storeSlug = p?.service?.profile?.slug || null;

  const serviceSafe = p.service
    ? {
        ...p.service,
        vendor: p.service.vendor
          ? {
              ...p.service.vendor,
              billing: mapPublicBilling(p.service.vendor.billing),
            }
          : null,
      }
    : null;

  const unitPrice = p.priceCents != null ? p.priceCents / 100 : 0;

  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    images: Array.isArray(p.images) ? p.images : [],
    priceCents: p.priceCents ?? 0,
    price: unitPrice,
    currency: p.currency || "RON",
    isActive: p.isActive,
    isHidden: !!p.isHidden,
    category: p.category || null,
    color: p.color || null,
    colorVariants: Array.isArray(p.colorVariants) ? p.colorVariants : [],

    availability:
      typeof p.availability === "string" ? p.availability.toUpperCase() : null,
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

    service: serviceSafe,
    storeName,
    storeSlug,

    // rating agregat pentru liste
    averageRating: typeof p.averageRating === "number" ? p.averageRating : 0,
    reviewsCount: typeof p.reviewsCount === "number" ? p.reviewsCount : 0,
  };
}

// mic “stemmer” tolerant pt. text liber
function expandTokenForSearch(t) {
  const token = String(t || "").toLowerCase();
  const out = new Set();

  if (token.length >= 3) out.add(token);

  if (token.length >= 6) {
    out.add(token.slice(0, -1));
    out.add(token.slice(0, -2));
    out.add(token.slice(0, -3));
  } else if (token.length >= 4) {
    out.add(token.slice(0, -1));
    out.add(token.slice(0, -2));
  }

  return Array.from(out).filter((s) => s.length >= 3);
}

const normalizeSimple = (s = "") =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildTextWhereFromTokens = (tokensRaw) => {
  if (!tokensRaw || !tokensRaw.length) return null;

  const expanded = tokensRaw.flatMap((t) =>
    expandTokenForSearch(normalizeSimple(t))
  );
  const tokens = Array.from(new Set(expanded));
  if (!tokens.length) return null;

  const makeFieldCond = (field) => ({
    OR: tokens.map((t) => ({ [field]: { contains: t, mode: "insensitive" } })),
  });

  const or = [
    makeFieldCond("title"),
    makeFieldCond("description"),
    makeFieldCond("category"),
    makeFieldCond("color"),
    makeFieldCond("materialMain"),
    makeFieldCond("technique"),
    makeFieldCond("dimensions"),
    makeFieldCond("careInstructions"),
    makeFieldCond("specialNotes"),
  ];

  if (tokens.length === 1) {
    const token = tokens[0];
    or.push({ styleTags: { has: token } });
    or.push({ occasionTags: { has: token } });
  }

  return { OR: or };
};

/* -----------------------------------------
   SEARCH BY IMAGE (similaritate vizuală)
------------------------------------------*/
router.post(
  "/products/search-by-image",
  uploadSearchImage,
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          error: "IMAGE_REQUIRED",
          message:
            "Te rugăm să încarci o imagine pentru a căuta produse similare.",
        });
      }

      const emb = await imageToEmbedding(file.buffer);
      const pgVec = toPgVectorLiteral(emb);

      const k = 100;
      const rows = await prisma.$queryRawUnsafe(
        `
        SELECT product_id, (embedding <=> CAST($1 AS vector)) AS score
        FROM product_image_embeddings
        ORDER BY embedding <=> CAST($1 AS vector)
        LIMIT $2
      `,
        pgVec,
        k
      );

      const ids = rows.map((r) => String(r.product_id));

      return res.json({
        ids,
        count: ids.length,
        message: ids.length
          ? "Rezultatele sunt ordonate după similaritate vizuală."
          : "Nu am găsit produse similare pentru imaginea trimisă.",
      });
    } catch (e) {
      console.error("ERROR /api/public/products/search-by-image", e);
      return res.status(500).json({
        error: "IMAGE_SEARCH_ERROR",
        message: "A apărut o eroare la căutarea după imagine.",
      });
    }
  }
);

/* -----------------------------------------
   LISTĂ PRODUSE + SEARCH
------------------------------------------*/
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

    let qRaw = req.query.q;
    if (Array.isArray(qRaw)) qRaw = qRaw[0];
    qRaw = (qRaw || "").toString().trim();

    const categoryParam = (req.query.category || req.query.categorie || "").trim();
    const rawServiceType = (req.query.serviceType || req.query.type || "").trim();
    const serviceType = rawServiceType || "products";
    const city = (req.query.city || "").trim();
    const sort = (req.query.sort || "new").trim();

    const minPrice = parseInt(req.query.minPrice || req.query.min || "", 10);
    const maxPrice = parseInt(req.query.maxPrice || req.query.max || "", 10);

    const colorParam = (req.query.color || "").trim();
    const materialParam = (req.query.materialMain || req.query.material || "").trim();
    const techniqueParam = (req.query.technique || "").trim();
    const styleTagParam = (req.query.styleTag || req.query.style || "").trim();
    const occasionTagParamRaw = (req.query.occasionTag || req.query.occasion || "").trim();

    const availabilityParam = (req.query.availability || "").trim().toUpperCase();
    const acceptsCustomRaw = (req.query.acceptsCustom || "").trim();
    const acceptsCustomParam =
      acceptsCustomRaw === "1" || acceptsCustomRaw.toLowerCase() === "true";
    const leadTimeMaxParam = parseInt(req.query.leadTimeMax || "", 10);

    const smart = smartSearchFromQueryBackend(qRaw);

    const effectiveCategory = categoryParam || "";

    const inferredColors = Array.isArray(smart.inferredColors)
      ? smart.inferredColors
      : smart.inferredColor
      ? [smart.inferredColor]
      : [];

    const effectiveColors = colorParam ? [colorParam] : inferredColors;
    const effectiveOccasionTag = occasionTagParamRaw || "";

    const baseWhere = {
      isActive: true,
      isHidden: false,
      service: {
        is: {
          type: { is: { code: serviceType } },
          ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
          isActive: true,
          status: "ACTIVE",
          // ✅ FIX: vendor e relație => folosim `is`
          vendor: { is: { isActive: true } },
        },
      },
    };

    const applyPriceFilter = (whereObj) => {
      if (!Number.isNaN(minPrice) || !Number.isNaN(maxPrice)) {
        whereObj.priceCents = {};
        if (!Number.isNaN(minPrice)) whereObj.priceCents.gte = minPrice * 100;
        if (!Number.isNaN(maxPrice)) whereObj.priceCents.lte = maxPrice * 100;
      }
    };

    const applyExtraFilters = (whereObj) => {
      if (materialParam)
        whereObj.materialMain = { equals: materialParam, mode: "insensitive" };
      if (techniqueParam)
        whereObj.technique = { equals: techniqueParam, mode: "insensitive" };
      if (styleTagParam) whereObj.styleTags = { has: styleTagParam };
      if (effectiveOccasionTag) whereObj.occasionTags = { has: effectiveOccasionTag };
      if (availabilityParam) whereObj.availability = availabilityParam;
      if (!Number.isNaN(leadTimeMaxParam)) whereObj.leadTimeDays = { lte: leadTimeMaxParam };
      if (acceptsCustomParam) whereObj.acceptsCustom = true;
    };

    /* ========= 1) Caz special: ids ========= */
    if (idsList.length > 0) {
      const whereIds = { ...baseWhere, id: { in: idsList } };

      if (effectiveCategory) {
        whereIds.category = { equals: effectiveCategory, mode: "insensitive" };
      }

      if (effectiveColors && effectiveColors.length === 1) {
        whereIds.color = { equals: effectiveColors[0], mode: "insensitive" };
      } else if (effectiveColors && effectiveColors.length > 1) {
        whereIds.color = { in: effectiveColors };
      }

      applyExtraFilters(whereIds);
      applyPriceFilter(whereIds);

      const filtered = await prisma.product.findMany({
        where: whereIds,
        select: baseProductSelect,
      });

      const pos = new Map(idsList.map((id, i) => [id, i]));
      const ordered = filtered.sort(
        (a, b) => (pos.get(a.id) ?? 999999) - (pos.get(b.id) ?? 999999)
      );

      const total = ordered.length;

      const orderedWithStats = await attachRatingStatsToProducts(ordered);
      const items = orderedWithStats.slice(skip, skip + limit).map(mapPublicProduct);

      return res.json({
        total,
        items,
        page,
        limit,
        smart,
        appliedFilters: {
          category: effectiveCategory || null,
          color: effectiveColors?.length ? effectiveColors[0] : null,
          material: materialParam || null,
          technique: techniqueParam || null,
          styleTag: styleTagParam || null,
          occasionTag: effectiveOccasionTag || null,
          availability: availabilityParam || null,
          acceptsCustom: acceptsCustomParam || false,
          leadTimeMax: Number.isNaN(leadTimeMaxParam) ? null : leadTimeMaxParam,
          priceMin: !Number.isNaN(minPrice) ? minPrice : null,
          priceMax: !Number.isNaN(maxPrice) ? maxPrice : null,
        },
      });
    }

    /* ========= 2) Caz general ========= */
    const whereMain = { ...baseWhere };

    if (effectiveCategory) {
      whereMain.category = { equals: effectiveCategory, mode: "insensitive" };
    }

    if (effectiveColors && effectiveColors.length === 1) {
      whereMain.color = { equals: effectiveColors[0], mode: "insensitive" };
    } else if (effectiveColors && effectiveColors.length > 1) {
      whereMain.color = { in: effectiveColors };
    }

    applyExtraFilters(whereMain);
    applyPriceFilter(whereMain);

    if (qRaw) {
      let baseTokens =
        (smart.mustTextTokens?.length
          ? smart.mustTextTokens
          : smart.looseTextTokens?.length
          ? smart.looseTextTokens
          : qRaw.split(/\s+/).filter(Boolean)
        ).map((t) => t.toLowerCase());

      // dacă a rămas doar token de culoare, nu mai forțăm text-search
      const onlyColorToken =
        Array.isArray(smart.inferredColors) &&
        smart.inferredColors.length > 0 &&
        baseTokens.length === 1;

      if (!onlyColorToken && baseTokens.length) {
        const textWhere = buildTextWhereFromTokens(baseTokens);
        if (textWhere) whereMain.AND = (whereMain.AND || []).concat(textWhere);
      }
    }

    const [totalMain, itemsRawMain] = await Promise.all([
      prisma.product.count({ where: whereMain }),
      prisma.product.findMany({
        where: whereMain,
        skip,
        take: limit,
        orderBy: buildOrderBy(sort),
        select: baseProductSelect,
      }),
    ]);

    if (totalMain > 0 || !qRaw) {
      const itemsWithStats = await attachRatingStatsToProducts(itemsRawMain);

      return res.json({
        total: totalMain,
        items: itemsWithStats.map(mapPublicProduct),
        page,
        limit,
        smart,
        appliedFilters: {
          category: effectiveCategory || null,
          color: effectiveColors?.length ? effectiveColors[0] : null,
          material: materialParam || null,
          technique: techniqueParam || null,
          styleTag: styleTagParam || null,
          occasionTag: effectiveOccasionTag || null,
          availability: availabilityParam || null,
          acceptsCustom: acceptsCustomParam || false,
          leadTimeMax: Number.isNaN(leadTimeMaxParam) ? null : leadTimeMaxParam,
          priceMin: !Number.isNaN(minPrice) ? minPrice : null,
          priceMax: !Number.isNaN(maxPrice) ? maxPrice : null,
        },
      });
    }

    /* ========= 3) Fallback generic ========= */
    const whereFallback = { ...baseWhere };
    applyPriceFilter(whereFallback);

    const [totalFallback, itemsFallback] = await Promise.all([
      prisma.product.count({ where: whereFallback }),
      prisma.product.findMany({
        where: whereFallback,
        skip,
        take: limit,
        orderBy: buildOrderBy(sort),
        select: baseProductSelect,
      }),
    ]);

    const fallbackWithStats = await attachRatingStatsToProducts(itemsFallback);

    return res.json({
      total: totalFallback,
      items: fallbackWithStats.map(mapPublicProduct),
      page,
      limit,
      smart,
      appliedFilters: {
        category: null,
        color: null,
        material: null,
        technique: null,
        styleTag: null,
        occasionTag: null,
        availability: null,
        acceptsCustom: false,
        leadTimeMax: null,
        priceMin: !Number.isNaN(minPrice) ? minPrice : null,
        priceMax: !Number.isNaN(maxPrice) ? maxPrice : null,
        fallback: "generic_after_zero_results",
      },
    });
  } catch (e) {
    console.error("ERROR /api/public/products", e);
    next(e);
  }
});
/* -----------------------------------------
   RECOMANDĂRI / POPULARE / NOUTĂȚI
   GET /api/public/products/recommended
------------------------------------------*/
router.get("/products/recommended", async (_req, res, next) => {
  try {
    const baseWhere = {
      isActive: true,
      isHidden: false,
      service: {
        is: {
          isActive: true,
          status: "ACTIVE",
          // ✅ FIX: vendor relație
          vendor: { is: { isActive: true } },
          type: { is: { code: "products" } },
        },
      },
    };

    // 1) Latest
    const latestRaw = await prisma.product.findMany({
      where: baseWhere,
      take: 12,
      orderBy: { createdAt: "desc" },
      select: baseProductSelect,
    });

    const latestWithStats = await attachRatingStatsToProducts(latestRaw);
    const latest = latestWithStats.map(mapPublicProduct);

    // 2) Popular (visitor last 30 days)
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
    const pos = new Map(popularIds.map((id, i) => [String(id), i]));

    const popularRaw = popularIds.length
      ? await prisma.product.findMany({
          where: { ...baseWhere, id: { in: popularIds.map(String) } },
          select: baseProductSelect,
        })
      : [];

    const popularWithStats = await attachRatingStatsToProducts(popularRaw);

    const popular = popularWithStats
      .map(mapPublicProduct)
      .sort((a, b) => (pos.get(a.id) ?? 9999) - (pos.get(b.id) ?? 9999));

    // 3) Recommended (Favorite count desc)
    const recommendedRaw = await prisma.product.findMany({
      where: baseWhere,
      take: 12,
      orderBy: [{ Favorite: { _count: "desc" } }, { createdAt: "desc" }],
      select: baseProductSelect,
    });

    const recommendedWithStats = await attachRatingStatsToProducts(recommendedRaw);
    const recommended = recommendedWithStats.map(mapPublicProduct);

    res.json({ latest, popular, recommended });
  } catch (e) {
    next(e);
  }
});
/* -----------------------------------------
   AUTOCOMPLETE / SUGESTII
------------------------------------------*/
router.get("/products/suggest", async (req, res, next) => {
  try {
    let qRaw = req.query.q;
    if (Array.isArray(qRaw)) qRaw = qRaw[0];
    const q = (qRaw || "").toString().trim();

    if (!q) {
      return res.json({
        products: [],
        categories: [],
        smart: {
          original: "",
          normalized: "",
          tokens: [],
          inferredCategory: null,
          inferredColor: null,
          inferredColors: [],
          inferredOccasionTag: null,
          inferredMaterial: null,
          inferredTechnique: null,
          inferredStyleTags: [],
          mustTextTokens: [],
          looseTextTokens: [],
        },
      });
    }

    const smart = smartSearchFromQueryBackend(q);

    const baseTokens =
      (smart.mustTextTokens?.length
        ? smart.mustTextTokens
        : smart.looseTextTokens?.length
        ? smart.looseTextTokens
        : q.split(/\s+/).filter(Boolean)
      ).map((t) => normalizeSimple(t));

    const mainToken = baseTokens[0] || normalizeSimple(q);

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,
        title: { contains: mainToken, mode: "insensitive" },
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        images: true,
        priceCents: true,
        currency: true,
        category: true,
        color: true,
      },
    });

    const qNorm = normalizeSimple(q);

    const categories = CATEGORIES_DETAILED
      .filter((c) => {
        const labelNorm = normalizeSimple(c.label || "");
        const keyNorm = normalizeSimple(c.key || "");
        return labelNorm.includes(qNorm) || keyNorm.includes(qNorm);
      })
      .slice(0, 6)
      .map((c) => ({ key: c.key, label: c.label, group: c.group || null }));

    return res.json({ products, categories, smart });
  } catch (e) {
    console.error("ERROR /api/public/products/suggest", e);
    next(e);
  }
});

/* -----------------------------------------
   DETALII PRODUS
------------------------------------------*/
router.get("/products/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            type: true,
            vendor: { include: { billing: true } },
            profile: true,
          },
        },
        reviews: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, name: true },
            },
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
      p?.service?.profile?.displayName || p?.service?.vendor?.displayName || "Magazin";
    const storeSlug = p?.service?.profile?.slug || null;

    const serviceSafe = p.service
      ? {
          ...p.service,
          vendor: p.service.vendor
            ? { ...p.service.vendor, billing: mapPublicBilling(p.service.vendor.billing) }
            : null,
        }
      : null;

    const unitPrice = p.priceCents != null ? p.priceCents / 100 : 0;

    res.json({
      ...p,
      service: serviceSafe,
      storeName,
      storeSlug,
      averageRating: avg,
      category: p.category || null,
      color: p.color || null,
      colorVariants: Array.isArray(p.colorVariants) ? p.colorVariants : [],
      price: unitPrice,
      availability: p.availability ? String(p.availability).toUpperCase() : null,
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
   STORE PROFILE + PRODUCTS + REVIEWS (exact cum le aveai)
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
    id: svc.id,
    serviceId: svc.id,
    vendorId: vendor.id,
    userId: vendor.userId,
    slug: profile.slug,
    shopName: profile.displayName || vendor.displayName || "Magazin",
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
    items.map((p) => {
      const unitPrice = p.priceCents != null ? p.priceCents / 100 : 0;

      return {
        id: p.id,
        title: p.title,
        description: p.description || "",
        priceCents: p.priceCents ?? 0,
        price: unitPrice,
        images: Array.isArray(p.images) ? p.images : [],
        currency: p.currency || "RON",
        createdAt: p.createdAt,
        category: p.category || null,
        color: p.color || null,
        colorVariants: Array.isArray(p.colorVariants) ? p.colorVariants : [],
        availability: typeof p.availability === "string" ? p.availability.toUpperCase() : null,
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
      };
    })
  );
});

// listă recenzii pentru profilul magazinului
router.get("/store/:slug/reviews", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "invalid_slug" });

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: { service: { include: { type: true, vendor: true } } },
    });

    if (!profile || profile?.service?.type?.code !== "products") {
      return res.status(404).json({ error: "store_not_found" });
    }

    const vendorId = profile.service.vendor.id;

    const sort = String(req.query.sort || "relevant").toLowerCase();
    const skip = Math.max(0, parseInt(String(req.query.skip || "0"), 10));
    const take = Math.min(50, Math.max(1, parseInt(String(req.query.take || "20"), 10)));

    const verifiedOnly = String(req.query.verified || "") === "1";
    const star = parseInt(String(req.query.star || "0"), 10);

    const whereBase = { vendorId, status: "APPROVED" };
    const whereList = { ...whereBase };

    if (verifiedOnly) whereList.verified = true;
    if (!Number.isNaN(star) && star >= 1 && star <= 5) whereList.rating = star;

    let orderBy = { createdAt: "desc" };
    switch (sort) {
      case "recent":
        orderBy = { createdAt: "desc" };
        break;
      case "rating_desc":
        orderBy = [{ rating: "desc" }, { createdAt: "desc" }];
        break;
      case "rating_asc":
        orderBy = [{ rating: "asc" }, { createdAt: "desc" }];
        break;
      case "relevant":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }

    const [total, rows, grouped] = await Promise.all([
      prisma.storeReview.count({ where: whereList }),
      prisma.storeReview.findMany({
        where: whereList,
        skip,
        take,
        orderBy,
        include: { user: true, reply: true, helpful: true },
      }),
      prisma.storeReview.groupBy({
        by: ["rating"],
        where: whereBase,
        _count: { rating: true },
      }),
    ]);

    const stats = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, avg: 0 };
    let sum = 0;
    let totalApproved = 0;

    for (const row of grouped) {
      const r = row.rating;
      const count = row._count.rating;
      if (r >= 1 && r <= 5) {
        stats["c" + r] = count;
        sum += r * count;
        totalApproved += count;
      }
    }
    if (totalApproved > 0) stats.avg = sum / totalApproved;

    const items = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      verified: r.verified,
      helpfulCount: r.helpful?.length || 0,
      userId: r.userId,
      userName: r.user?.firstName || r.user?.name || "Utilizator",
      userAvatar: r.user?.avatarUrl || null,
      reply: r.reply
        ? { id: r.reply.id, text: r.reply.text, createdAt: r.reply.createdAt }
        : null,
    }));

    res.json({ total, items, stats });
  } catch (e) {
    console.error("ERROR /api/public/store/:slug/reviews", e);
    next(e);
  }
});

// media rating-ului pe magazin
router.get("/store/:slug/reviews/average", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "invalid_slug" });

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: { service: { include: { type: true, vendor: true } } },
    });

    if (!profile || profile?.service?.type?.code !== "products") {
      return res.status(404).json({ error: "store_not_found" });
    }

    const vendorId = profile.service.vendor.id;

    const grouped = await prisma.storeReview.groupBy({
      by: ["rating"],
      where: { vendorId, status: "APPROVED" },
      _count: { rating: true },
    });

    let sum = 0;
    let total = 0;
    for (const row of grouped) {
      sum += row.rating * row._count.rating;
      total += row._count.rating;
    }

    const average = total > 0 ? sum / total : 0;
    res.json({ average, count: total });
  } catch (e) {
    console.error("ERROR /api/public/store/:slug/reviews/average", e);
    next(e);
  }
});

export default router;
