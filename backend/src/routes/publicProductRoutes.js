// server/routes/publicProductRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { CATEGORIES_DETAILED } from "../constants/categories.js";
import { smartSearchFromQueryBackend } from "../constants/smartSrc.js";
import { uploadSearchImage } from "../middleware/imageSearchUpload.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";

const router = Router();

/* -----------------------------------------
   Micro cache in-memory pentru browsing public
------------------------------------------*/

const LIST_CACHE_TTL_MS = 60_000;
const LIST_CACHE_TTL_DEFAULT_FIRST_PAGE_MS = 180_000;
const SUGGEST_CACHE_TTL_MS = 60_000;

const PUBLIC_LIST_CACHE = new Map();
const SUGGEST_CACHE = new Map();

function getCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  if (map.size > 500) {
    const firstKey = map.keys().next().value;
    if (firstKey) map.delete(firstKey);
  }
}

function buildListCacheKey(req) {
  const qp = new URLSearchParams();

  const keys = [
    "page",
    "limit",
    "ids",
    "q",
    "category",
    "categorie",
    "serviceType",
    "type",
    "city",
    "sort",
    "minPrice",
    "min",
    "maxPrice",
    "max",
    "color",
    "materialMain",
    "material",
    "technique",
    "styleTag",
    "style",
    "occasionTag",
    "occasion",
    "availability",
    "acceptsCustom",
    "leadTimeMax",
  ];

  for (const key of keys) {
    const val = req.query[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      qp.set(key, String(val).trim());
    }
  }

  return qp.toString();
}

/* -----------------------------------------
   Utils
------------------------------------------*/

function mapPublicBilling(billing) {
  if (!billing) return null;
  return {
    tvaActive: billing.tvaActive,
    vatRate: billing.vatRate,
    vatStatus: billing.vatStatus,
  };
}

function getPromotionRank(planCode) {
  switch (String(planCode || "basic").toLowerCase()) {
    case "premium":
      return 3;
    case "pro":
      return 2;
    default:
      return 1;
  }
}

function sortPromotedFirst(rows) {
  return [...rows].sort((a, b) => {
    const planA =
      a?.service?.vendor?.subscriptions?.[0]?.plan?.code || "basic";

    const planB =
      b?.service?.vendor?.subscriptions?.[0]?.plan?.code || "basic";

    const rankDiff = getPromotionRank(planB) - getPromotionRank(planA);
    if (rankDiff !== 0) return rankDiff;

    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function buildOrderBy(sort) {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "popular":
      return [{ popularityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

// select ultra-light pentru grid / listă publică
const baseProductSelect = {
  id: true,
  title: true,
  priceCents: true,
  currency: true,
  images: true,

  isActive: true,
  isHidden: true,
  moderationStatus: true,

  category: true,
  color: true,

  orderMode: true,
availability: true,
leadTimeDays: true,
readyQty: true,
nextShipDate: true,
acceptsCustom: true,
  optionsSchema: true,
  customSchema: true,
  quoteSchema: true,
materialMain: true,
technique: true,
styleTags: true,
occasionTags: true,
  createdAt: true,

  service: {
    select: {
      id: true,
      profile: {
        select: {
          displayName: true,
slug: true,
logoUrl: true,
        },
      },
      vendor: {
  select: {
    id: true,
userId: true,
displayName: true,
logoUrl: true,

    subscriptions: {
      where: {
        status: {
          in: ["active", "canceled_at_period_end"],
        },
        endAt: {
          gte: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 1,
      select: {
        status: true,
        endAt: true,
        plan: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    },
  },
},
    },
  },
  _count: {
  select: {
    Favorite: true,
  },
},
};

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

  const expanded = tokensRaw.flatMap((t) => expandTokenForSearch(normalizeSimple(t)));
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
  ];

  if (tokens.length === 1) {
    const token = tokens[0];
    or.push({ styleTags: { has: token } });
    or.push({ occasionTags: { has: token } });
  }

  return { OR: or };
};

function shortText(s, max = 140) {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

function getViewerId(req) {
  return (
    req.user?.sub ||
    req.user?.id ||
    req.auth?.userId ||
    req.session?.user?.id ||
    null
  );
}
function mapPublicProduct(
  p,
  promoCollection = null,
  viewerState = null
) {
  const storeName =
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Magazin";

  const storeSlug =
    p?.service?.profile?.slug || null;

  const storeLogo =
    p?.service?.profile?.logoUrl ||
    p?.service?.vendor?.logoUrl ||
    null;

  const promo = getPromoPrice(
    p.priceCents,
    promoCollection
  );

  const unitPrice =
    promo.finalPriceCents != null
      ? promo.finalPriceCents / 100
      : 0;

  const sellerPlan =
    p?.service?.vendor
      ?.subscriptions?.[0]
      ?.plan?.code || "basic";

  const promotionRank =
    getPromotionRank(sellerPlan);

  const orderMode = String(
    p.orderMode || "DIRECT"
  ).toUpperCase();

  const availability = String(
    p.availability || ""
  ).toUpperCase();

  const readyQty =
    p.readyQty === null ||
    p.readyQty === undefined
      ? null
      : Number(p.readyQty);

  const hasReadyStock =
    readyQty === null ||
    (
      Number.isFinite(readyQty) &&
      readyQty > 0
    );

  const canBuyDirect =
    orderMode === "DIRECT" &&
    availability === "READY" &&
    hasReadyStock;

  const isAvailable =
    orderMode === "DIRECT"
      ? canBuyDirect
      : availability !== "SOLD_OUT";

  const availabilityMessage =
    !isAvailable
      ? readyQty !== null &&
        readyQty <= 0
        ? "Produsul este epuizat."
        : "Produsul nu este disponibil momentan."
      : null;

  return {
    id: p.id,
    title: p.title,

    images:
      Array.isArray(p.images)
        ? p.images
        : [],

    priceCents:
      promo.finalPriceCents ?? 0,

    price: unitPrice,

    originalPriceCents:
      promo.hasDiscount
        ? promo.originalPriceCents
        : null,

    originalPrice:
      promo.hasDiscount
        ? promo.originalPriceCents / 100
        : null,

    hasDiscount:
      promo.hasDiscount,

    discountPercent:
      promo.discountPercent,

    promoLabel:
      promo.promoLabel,

    promoFundingSource:
      promo.promoFundingSource,

    promoCollectionId:
      promo.promoCollectionId,

    currency:
      p.currency || "RON",

    isActive:
      p.isActive,

    isHidden:
      !!p.isHidden,

    moderationStatus:
      p.moderationStatus || "PENDING",

    category:
      p.category || null,

    color:
      p.color || null,

    createdAt:
      p.createdAt,

    favoriteCount:
      p?._count?.Favorite || 0,

    viewerFavorited:
      !!viewerState?.favorited,

    orderMode,
    availability,

    leadTimeDays:
      p.leadTimeDays ?? null,

    readyQty:
      p.readyQty ?? null,

    nextShipDate:
      p.nextShipDate ?? null,

    acceptsCustom:
      !!p.acceptsCustom,
    optionsSchema:
      Array.isArray(p.optionsSchema)
        ? p.optionsSchema
        : [],

    customSchema:
      Array.isArray(p.customSchema)
        ? p.customSchema
        : [],

    quoteSchema:
      Array.isArray(p.quoteSchema)
        ? p.quoteSchema
        : [],
    canBuyDirect,
    isAvailable,
    availabilityMessage,

    service:
      p.service
        ? {
            id: p.service.id,

            profile:
              p.service.profile
                ? {
                    displayName:
                      p.service.profile
                        .displayName,

                    slug:
                      p.service.profile
                        .slug,

                    logoUrl:
                      p.service.profile
                        .logoUrl,
                  }
                : null,

            vendor:
              p.service.vendor
                ? {
                    id:
                      p.service.vendor.id,

                    userId:
                      p.service.vendor
                        .userId,

                    displayName:
                      p.service.vendor
                        .displayName,

                    logoUrl:
                      p.service.vendor
                        .logoUrl,
                  }
                : null,
          }
        : null,

    storeName,
    storeSlug,
    storeLogo,
    sellerPlan,
    promotionRank,

    isPromoted:
      sellerPlan === "premium" ||
      sellerPlan === "pro",
  };
}

 function isCollectionPromoActive(collection, now = new Date()) {
  if (!collection?.promoEnabled) return false;

  const percent = Number(collection.promoPercent || 0);
  if (!Number.isFinite(percent) || percent <= 0) return false;

  if (collection.promoStartsAt && new Date(collection.promoStartsAt) > now) {
    return false;
  }

  if (collection.promoEndsAt && new Date(collection.promoEndsAt) < now) {
    return false;
  }

  return true;
}

function productMatchesCollectionRules(product, rules = {}) {
  if (!product) return false;

  if (Array.isArray(rules.categories) && rules.categories.length) {
    const categories = rules.categories
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    if (categories.length && !categories.includes(product.category)) {
      return false;
    }
  }

  if (rules.acceptsCustom === true && product.acceptsCustom !== true) {
    return false;
  }

  const minPriceCents = Number(rules.minPriceCents);
  const maxPriceCents = Number(rules.maxPriceCents);

  if (Number.isFinite(minPriceCents) && product.priceCents < minPriceCents) {
    return false;
  }

  if (Number.isFinite(maxPriceCents) && product.priceCents > maxPriceCents) {
    return false;
  }

  if (Array.isArray(rules.occasionTags) && rules.occasionTags.length) {
    const productTags = Array.isArray(product.occasionTags)
      ? product.occasionTags
      : [];

    const hasAny = rules.occasionTags.some((tag) =>
      productTags.includes(String(tag))
    );

    if (!hasAny) return false;
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    const productTags = Array.isArray(product.styleTags)
      ? product.styleTags
      : [];

    const hasAny = rules.styleTags.some((tag) =>
      productTags.includes(String(tag))
    );

    if (!hasAny) return false;
  }

  return true;
}

function getPromoPrice(priceCents, promo = null) {
  const originalPriceCents = Math.round(Number(priceCents || 0));

  if (!promo || !isCollectionPromoActive(promo)) {
    return {
      originalPriceCents,
      finalPriceCents: originalPriceCents,
      hasDiscount: false,
      discountPercent: 0,
      promoLabel: null,
      promoFundingSource: null,
      promoCollectionId: null,
    };
  }

  const discountPercent = Number(promo.promoPercent || 0);

  const finalPriceCents = Math.max(
    0,
    Math.round(originalPriceCents * (1 - discountPercent / 100))
  );

  return {
    originalPriceCents,
    finalPriceCents,
    hasDiscount: true,
    discountPercent,
    promoLabel: promo.promoLabel || "Promoție Artfest",
    promoFundingSource: promo.promoFundingSource || "PLATFORM_COMMISSION",
    promoCollectionId: promo.id || null,
  };
}

async function getActiveCollectionPromosForProducts(products = []) {
  if (!products.length) return new Map();

  const now = new Date();

  const collections = await prisma.collection.findMany({
    where: {
      isActive: true,
      promoEnabled: true,
      OR: [
        { promoStartsAt: null },
        { promoStartsAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { promoEndsAt: null },
            { promoEndsAt: { gte: now } },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      slug: true,
      rules: true,
      promoEnabled: true,
      promoPercent: true,
      promoLabel: true,
      promoFundingSource: true,
      promoStartsAt: true,
      promoEndsAt: true,
    },
  });

  const activePromos = collections.filter((c) =>
    isCollectionPromoActive(c, now)
  );

  const promoByProductId = new Map();

  for (const product of products) {
    const matchingPromos = activePromos.filter((collection) =>
      productMatchesCollectionRules(product, collection.rules || {})
    );

    if (!matchingPromos.length) continue;

    matchingPromos.sort(
      (a, b) => Number(b.promoPercent || 0) - Number(a.promoPercent || 0)
    );

    promoByProductId.set(product.id, matchingPromos[0]);
  }

  return promoByProductId;
}
/* -----------------------------------------
   SEARCH BY IMAGE (similaritate vizuală)
------------------------------------------*/
router.post("/products/search-by-image", uploadSearchImage, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        error: "IMAGE_REQUIRED",
        message: "Te rugăm să încarci o imagine pentru a căuta produse similare.",
      });
    }

    const emb = await imageToEmbedding(file.buffer);

    let allZero = true;
    for (let i = 0; i < emb.length; i++) {
      if (emb[i] !== 0) {
        allZero = false;
        break;
      }
    }

    if (allZero) {
      return res.status(500).json({
        error: "EMBEDDING_FAILED",
        message: "Nu am putut calcula embedding pentru imagine.",
      });
    }

    const pgVec = toPgVectorLiteral(emb);
    const k = 100;

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT "productId", MIN(embedding <=> CAST($1 AS vector)) AS score
      FROM public.product_image_embeddings
      GROUP BY "productId"
      ORDER BY score ASC
      LIMIT $2
      `,
      pgVec,
      k
    );

    const ids = (rows || []).map((r) => String(r.productId));

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
});

/* -----------------------------------------
   LISTĂ PRODUSE + SEARCH
------------------------------------------*/
router.get("/products", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || "12", 10)));
    const skip = (page - 1) * limit;
    const takePlus = limit + 1;

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

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

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
      moderationStatus: "APPROVED",
      service: {
        is: {
          type: { is: { code: serviceType } },
          ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
          isActive: true,
          status: "ACTIVE",
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
      if (materialParam) {
        whereObj.materialMain = { equals: materialParam, mode: "insensitive" };
      }

      if (techniqueParam) {
        whereObj.technique = { equals: techniqueParam, mode: "insensitive" };
      }

      if (styleTagParam) whereObj.styleTags = { has: styleTagParam };
      if (effectiveOccasionTag) whereObj.occasionTags = { has: effectiveOccasionTag };

      if (availabilityParam) {
        if (availabilityParam === "READY") {
          whereObj.AND = [
            ...(whereObj.AND || []),
            {
              availability: "READY",
              OR: [{ readyQty: null }, { readyQty: { gt: 0 } }],
            },
          ];
        } else if (availabilityParam === "SOLD_OUT") {
          whereObj.OR = [
            { availability: "SOLD_OUT" },
            {
              AND: [
                { availability: "READY" },
                { readyQty: { lte: 0 } },
              ],
            },
          ];
        } else {
          whereObj.availability = availabilityParam;
        }
      }

      if (!Number.isNaN(leadTimeMaxParam)) {
        whereObj.leadTimeDays = { lte: leadTimeMaxParam };
      }

      if (acceptsCustomParam) whereObj.acceptsCustom = true;
    };

   const finalizePaged = async (rows) => {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const promoByProductId = await getActiveCollectionPromosForProducts(slice);

  return {
    items: slice.map((product) =>
      mapPublicProduct(product, promoByProductId.get(product.id) || null)
    ),
    hasMore,
  };
};

    const buildAppliedFilters = () => ({
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
    });

    if (idsList.length > 0) {
      const whereIds = { ...baseWhere, id: { in: idsList } };

      if (effectiveCategory) {
        whereIds.category = { equals: effectiveCategory, mode: "insensitive" };
      }

      if (effectiveColors.length === 1) {
        whereIds.color = { equals: effectiveColors[0], mode: "insensitive" };
      } else if (effectiveColors.length > 1) {
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
      const pageSlice = ordered.slice(skip, skip + takePlus);
      const { items, hasMore } = await finalizePaged(pageSlice);

      return res.json({
        total,
        items,
        page,
        limit,
        hasMore,
        smart,
        appliedFilters: buildAppliedFilters(),
      });
    }

    const whereMain = { ...baseWhere };

    if (effectiveCategory) {
      whereMain.category = { equals: effectiveCategory, mode: "insensitive" };
    }

    if (effectiveColors.length === 1) {
      whereMain.color = { equals: effectiveColors[0], mode: "insensitive" };
    } else if (effectiveColors.length > 1) {
      whereMain.color = { in: effectiveColors };
    }

    applyExtraFilters(whereMain);
    applyPriceFilter(whereMain);

    if (qRaw) {
      const baseTokens =
        (smart.mustTextTokens?.length
          ? smart.mustTextTokens
          : smart.looseTextTokens?.length
          ? smart.looseTextTokens
          : qRaw.split(/\s+/).filter(Boolean)
        ).map((t) => t.toLowerCase());

      const onlyColorToken =
        Array.isArray(smart.inferredColors) &&
        smart.inferredColors.length > 0 &&
        baseTokens.length === 1;

      if (!onlyColorToken && baseTokens.length) {
        const textWhere = buildTextWhereFromTokens(baseTokens);
        if (textWhere) whereMain.AND = (whereMain.AND || []).concat(textWhere);
      }
    }

   const rowsMainRaw = await prisma.product.findMany({
  where: whereMain,
  skip,
  take: takePlus,
  orderBy: buildOrderBy(sort),
  select: baseProductSelect,
});

const rowsMain = sortPromotedFirst(rowsMainRaw);

    if (rowsMain.length > 0 || !qRaw) {
      const { items, hasMore } = await finalizePaged(rowsMain);

      return res.json({
        total: null,
        items,
        page,
        limit,
        hasMore,
        smart,
        appliedFilters: buildAppliedFilters(),
      });
    }

    const whereFallback = { ...baseWhere };
    applyPriceFilter(whereFallback);

  const rowsFallbackRaw = await prisma.product.findMany({
  where: whereFallback,
  skip,
  take: takePlus,
  orderBy: buildOrderBy(sort),
  select: baseProductSelect,
});

const rowsFallback = sortPromotedFirst(rowsFallbackRaw);

    const { items, hasMore } = await finalizePaged(rowsFallback);

    return res.json({
      total: null,
      items,
      page,
      limit,
      hasMore,
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
------------------------------------------*/
router.get("/products/recommended", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
res.set("Pragma", "no-cache");
res.set("Expires", "0");

    const baseWhere = {
      isActive: true,
      isHidden: false,
      moderationStatus: "APPROVED",
      service: {
        is: {
          isActive: true,
          status: "ACTIVE",
          vendor: { is: { isActive: true } },
          type: { is: { code: "products" } },
        },
      },
    };

    async function mapWithPromos(rows) {
      const sorted = sortPromotedFirst(rows);
      const promoByProductId = await getActiveCollectionPromosForProducts(sorted);

      return sorted.map((product) =>
        mapPublicProduct(product, promoByProductId.get(product.id) || null)
      );
    }

    const latestRaw = await prisma.product.findMany({
      where: baseWhere,
      take: 12,
      orderBy: { createdAt: "desc" },
      select: baseProductSelect,
    });

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

    const popularRaw = popularIds.length
      ? await prisma.product.findMany({
          where: { ...baseWhere, id: { in: popularIds.map(String) } },
          select: baseProductSelect,
        })
      : [];

    const recommendedRaw = await prisma.product.findMany({
      where: baseWhere,
      take: 12,
      orderBy: [{ Favorite: { _count: "desc" } }, { createdAt: "desc" }],
      select: baseProductSelect,
    });

    const [latest, popular, recommended] = await Promise.all([
      mapWithPromos(latestRaw),
      mapWithPromos(popularRaw),
      mapWithPromos(recommendedRaw),
    ]);

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
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
res.set("Pragma", "no-cache");
res.set("Expires", "0");

    let qRaw = req.query.q;
    if (Array.isArray(qRaw)) qRaw = qRaw[0];
    const q = (qRaw || "").toString().trim();

    const cacheKey = q.toLowerCase();
    const cached = getCache(SUGGEST_CACHE, cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!q) {
      const emptyPayload = {
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
      };
      setCache(SUGGEST_CACHE, cacheKey, emptyPayload, SUGGEST_CACHE_TTL_MS);
      return res.json(emptyPayload);
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
  moderationStatus: "APPROVED",
  title: { contains: mainToken, mode: "insensitive" },
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
            type: { is: { code: "products" } },
          },
        },
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

    const categories = CATEGORIES_DETAILED.filter((c) => {
      const labelNorm = normalizeSimple(c.label || "");
      const keyNorm = normalizeSimple(c.key || "");
      return labelNorm.includes(qNorm) || keyNorm.includes(qNorm);
    })
      .slice(0, 6)
      .map((c) => ({ key: c.key, label: c.label, group: c.group || null }));

    const payload = { products, categories, smart };
    setCache(SUGGEST_CACHE, cacheKey, payload, SUGGEST_CACHE_TTL_MS);

    return res.json(payload);
  } catch (e) {
    console.error("ERROR /api/public/products/suggest", e);
    next(e);
  }
});

function buildCollectionWhereFromRules(rules = {}, excludedIds = []) {
  const where = {
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  service: {
    is: {
      isActive: true,
      status: "ACTIVE",
      vendor: { is: { isActive: true } },
      type: { is: { code: "products" } },
    },
  },
  ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
};

  if (Array.isArray(rules.categories) && rules.categories.length) {
    where.category = {
      in: rules.categories.map((x) => String(x || "").trim()).filter(Boolean),
    };
  }

  if (rules.acceptsCustom === true) {
    where.acceptsCustom = true;
  }

  const minPriceCents = Number(rules.minPriceCents);
  const maxPriceCents = Number(rules.maxPriceCents);

  if (Number.isFinite(minPriceCents) || Number.isFinite(maxPriceCents)) {
    where.priceCents = {};
    if (Number.isFinite(minPriceCents)) where.priceCents.gte = minPriceCents;
    if (Number.isFinite(maxPriceCents)) where.priceCents.lte = maxPriceCents;
  }

  if (Array.isArray(rules.occasionTags) && rules.occasionTags.length) {
    where.occasionTags = {
      hasSome: rules.occasionTags.map(String),
    };
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    where.styleTags = {
      hasSome: rules.styleTags.map(String),
    };
  }

  return where;
}
router.get("/collections/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.query.limit || "24", 10))
    );
    const skip = (page - 1) * limit;

    if (!slug) {
      return res.status(400).json({ error: "invalid_slug" });
    }

    const collection = await prisma.collection.findUnique({
      where: { slug },
      include: {
        items: {
          include: {
            product: {
              select: baseProductSelect,
            },
          },
          orderBy: [
            { pinned: "desc" },
            { position: "asc" },
            { createdAt: "desc" },
          ],
        },
      },
    });

    if (!collection || !collection.isActive) {
      return res.status(404).json({ error: "collection_not_found" });
    }

    const excludedIds = collection.items
      .filter((item) => item.excluded)
      .map((item) => item.productId);

    const pinnedProducts =
      page === 1
        ? collection.items
            .filter((item) => item.pinned && !item.excluded && item.product)
            .map((item) => item.product)
            .filter(isPublicProduct)
        : [];

    const pinnedIds = pinnedProducts.map((p) => p.id);

    const autoProductsRaw = await prisma.product.findMany({
      where: buildCollectionWhereFromRules(collection.rules || {}, [
        ...excludedIds,
        ...pinnedIds,
      ]),
      select: baseProductSelect,
      orderBy: buildOrderBy(collection.sort || "new"),
      skip,
      take: limit + 1,
    });

    const autoProducts = sortPromotedFirst(autoProductsRaw);

    const merged = [...pinnedProducts, ...autoProducts];
    const uniqueProducts = uniqueById(merged);

    const hasMore = autoProductsRaw.length > limit;
    const sliced = uniqueProducts.slice(0, limit);

    const promoCollection = isCollectionPromoActive(collection)
      ? collection
      : null;

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
res.set("Pragma", "no-cache");
res.set("Expires", "0");

    return res.json({
      collection: {
        id: collection.id,
        slug: collection.slug,
        title: collection.title,
        subtitle: collection.subtitle || "",
        description: collection.description || "",
        seoTitle: collection.seoTitle || collection.title,
        seoDescription: collection.seoDescription || collection.subtitle || "",
        heroImage: collection.heroImage || "",

        promoEnabled: !!collection.promoEnabled,
        promoPercent: collection.promoPercent || null,
        promoLabel: collection.promoLabel || "",
        promoFundingSource:
          collection.promoFundingSource || "PLATFORM_COMMISSION",
        promoStartsAt: collection.promoStartsAt || null,
        promoEndsAt: collection.promoEndsAt || null,
      },
      items: sliced.map((product) =>
        mapPublicProduct(product, promoCollection)
      ),
      page,
      limit,
      hasMore,
    });
  } catch (e) {
    console.error("GET /api/public/collections/:slug error:", e);
    next(e);
  }
});

function isPublicProduct(p) {
  return (
    p?.isActive &&
    !p?.isHidden &&
    p?.moderationStatus === "APPROVED" &&
    p?.service?.profile &&
    p?.service?.vendor
  );
}

function uniqueById(products = []) {
  const map = new Map();

  for (const product of products) {
    if (product?.id) map.set(product.id, product);
  }

  return Array.from(map.values());
}

router.get("/products/feed", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit || "8", 10)));
    const skip = (page - 1) * limit;
    const takePlus = limit + 1;

    const viewerId = getViewerId(req);

    const rows = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
            type: { is: { code: "products" } },
          },
        },
      },
      skip,
      take: takePlus,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: baseProductSelect,
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const promoByProductId = await getActiveCollectionPromosForProducts(slice);

    let favoriteIds = new Set();

    if (viewerId && slice.length) {
      const ids = slice.map((p) => p.id);

      const favorites = await prisma.favorite.findMany({
        where: {
          userId: viewerId,
          productId: { in: ids },
        },
        select: { productId: true },
      });

      favoriteIds = new Set(favorites.map((x) => x.productId));
    }

    const items = slice.map((product) =>
      mapPublicProduct(product, promoByProductId.get(product.id) || null, {
        favorited: favoriteIds.has(product.id),
      })
    );

    res.json({
      items,
      page,
      limit,
      hasMore,
    });
  } catch (e) {
    console.error("ERROR /api/public/products/feed", e);
    next(e);
  }
});

router.post("/products/:id/favorite", async (req, res, next) => {
  try {
    const userId = getViewerId(req);
    const productId = String(req.params.id || "").trim();

    if (!userId) {
      return res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "Trebuie să fii autentificat pentru a salva produsul la favorite.",
      });
    }

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
      },
      select: {
  id: true,
  service: {
    select: {
      vendor: {
        select: {
          userId: true,
        },
      },
    },
  },
},
    });

    if (!product) {
      return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
    }

    const ownerUserId = product?.service?.vendor?.userId;

if (ownerUserId && ownerUserId === userId) {
  return res.status(403).json({
    error: "CANNOT_FAVORITE_OWN_PRODUCT",
    message: "Nu poți adăuga propriul produs la favorite.",
  });
}

    const existing = await prisma.favorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    let favorited = false;

    if (existing) {
      await prisma.favorite.delete({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });
    } else {
      await prisma.favorite.create({
        data: {
          userId,
          productId,
        },
      });

      favorited = true;
    }

    const favoriteCount = await prisma.favorite.count({
      where: { productId },
    });

  if (favorited) {
  await prisma.product.update({
    where: { id: productId },
    data: {
      popularityScore: {
        increment: 3,
      },
    },
  });
}

    res.json({
      ok: true,
      favorited,
      favoriteCount,
    });
  } catch (e) {
    console.error("ERROR /api/public/products/:id/favorite", e);
    next(e);
  }
});

/* -----------------------------------------
   DETALII PRODUS
------------------------------------------*/
router.get(
  "/products/:id",
  async (req, res, next) => {
    try {
      const id = String(
        req.params.id || ""
      ).trim();

      if (!id) {
        return res.status(400).json({
          error: "invalid_id",
        });
      }

      const p =
        await prisma.product.findFirst({
          where: {
            id,
            isActive: true,
            isHidden: false,
            moderationStatus:
              "APPROVED",

            service: {
              is: {
                isActive: true,
                status: "ACTIVE",

                vendor: {
                  is: {
                    isActive: true,
                  },
                },

                type: {
                  is: {
                    code: "products",
                  },
                },
              },
            },
          },

        select: {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  currency: true,
  images: true,
  category: true,
  color: true,
  colorVariants: true,

  orderMode: true,
  availability: true,
  leadTimeDays: true,
  readyQty: true,
  nextShipDate: true,
  acceptsCustom: true,

  optionsSchema: true,
  customSchema: true,
  quoteSchema: true,

  materialMain: true,
  technique: true,
  styleTags: true,
  occasionTags: true,
  dimensions: true,
  careInstructions: true,
  specialNotes: true,

            materialMain: true,
            technique: true,
            styleTags: true,
            occasionTags: true,
            dimensions: true,
            careInstructions: true,
            specialNotes: true,

            createdAt: true,
            updatedAt: true,

            ProductRatingStats: {
              select: {
                avg: true,
                c1: true,
                c2: true,
                c3: true,
                c4: true,
                c5: true,
              },
            },

            service: {
              select: {
                id: true,
                isActive: true,
                status: true,

                profile: {
                  select: {
                    displayName: true,
                    slug: true,
                    logoUrl: true,
                    city: true,
                  },
                },

                vendor: {
                  select: {
                    id: true,
                    userId: true,
                    displayName: true,
                    logoUrl: true,
                    city: true,
                    isActive: true,

                    billing: {
                      select: {
                        tvaActive: true,
                        vatRate: true,
                        vatStatus: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

      if (!p) {
        return res.status(404).json({
          error: "not_found",
        });
      }

      const ratingStats =
        p.ProductRatingStats;

      const reviewCount =
        (ratingStats?.c1 || 0) +
        (ratingStats?.c2 || 0) +
        (ratingStats?.c3 || 0) +
        (ratingStats?.c4 || 0) +
        (ratingStats?.c5 || 0);

      const averageRating =
        ratingStats
          ? Number(ratingStats.avg)
          : 0;

      const storeName =
        p?.service?.profile
          ?.displayName ||
        p?.service?.vendor
          ?.displayName ||
        "Magazin";

      const storeSlug =
        p?.service?.profile?.slug ||
        null;

      const promoByProductId =
        await getActiveCollectionPromosForProducts(
          [p]
        );

      const promoCollection =
        promoByProductId.get(p.id) ||
        null;

      const promo = getPromoPrice(
        p.priceCents,
        promoCollection
      );

      const unitPrice =
        promo.finalPriceCents != null
          ? promo.finalPriceCents /
            100
          : 0;

      const orderMode = String(
        p.orderMode || "DIRECT"
      ).toUpperCase();

      const availability = String(
        p.availability || ""
      ).toUpperCase();

      const readyQty =
        p.readyQty === null ||
        p.readyQty === undefined
          ? null
          : Number(p.readyQty);

      const hasReadyStock =
        readyQty === null ||
        (
          Number.isFinite(
            readyQty
          ) &&
          readyQty > 0
        );

      const canBuyDirect =
        orderMode === "DIRECT" &&
        availability === "READY" &&
        hasReadyStock;

      const isAvailable =
        orderMode === "DIRECT"
          ? canBuyDirect
          : availability !==
            "SOLD_OUT";

      const availabilityMessage =
        !isAvailable
          ? readyQty !== null &&
            readyQty <= 0
            ? "Produsul este epuizat."
            : "Produsul nu este disponibil momentan."
          : null;

      const {
        ProductRatingStats,
        ...safeProduct
      } = p;

      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );

      res.set(
        "Pragma",
        "no-cache"
      );

      res.set(
        "Expires",
        "0"
      );

      return res.json({
        ...safeProduct,

        storeName,
        storeSlug,

        averageRating,
        avgRating:
          averageRating,

        reviewCount,

        service: {
          ...safeProduct.service,

          vendor:
            safeProduct.service
              ?.vendor
              ? {
                  ...safeProduct
                    .service.vendor,

                  billing:
                    mapPublicBilling(
                      safeProduct
                        .service
                        .vendor
                        .billing
                    ),
                }
              : null,
        },

        price:
          unitPrice,

        priceCents:
          promo.finalPriceCents,

        originalPriceCents:
          promo.hasDiscount
            ? promo.originalPriceCents
            : null,

        originalPrice:
          promo.hasDiscount
            ? promo.originalPriceCents /
              100
            : null,

        hasDiscount:
          promo.hasDiscount,

        discountPercent:
          promo.discountPercent,

        orderMode,
        availability,
        canBuyDirect,
        isAvailable,
        availabilityMessage,

        colorVariants:
          Array.isArray(
            safeProduct.colorVariants
          )
            ? safeProduct.colorVariants
            : [],

        styleTags:
          Array.isArray(
            safeProduct.styleTags
          )
            ? safeProduct.styleTags
            : [],

        occasionTags:
          Array.isArray(
            safeProduct.occasionTags
          )
            ? safeProduct.occasionTags
            : [],
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/store/:slug/initial", async (req, res, next) => {
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

    const svc = profile.service;
    const vendor = svc.vendor;
    const isActive = svc.status === "ACTIVE" && svc.isActive && vendor.isActive;

    const shop = {
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
        shortText(profile.about || vendor.about || "", 160),
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

    const productsRaw = await prisma.product.findMany({
      where: {
        serviceId: profile.serviceId,
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: baseProductSelect,
    });

    const promoByProductId = await getActiveCollectionPromosForProducts(productsRaw);

    const products = productsRaw.map((p) =>
      mapPublicProduct(p, promoByProductId.get(p.id) || null)
    );

    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.json({ shop, products });
  } catch (e) {
    next(e);
  }
});

/* -----------------------------------------
   STORE PROFILE + PRODUCTS + REVIEWS
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
      shortText(profile.about || vendor.about || "", 160),
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

router.get(
  "/store/:slug/products",
  async (req, res) => {
    try {
      const slug = String(
        req.params.slug || ""
      )
        .trim()
        .toLowerCase();

      if (!slug) {
        return res.status(400).json({
          error: "invalid_slug",
        });
      }

      const take = Math.min(
        12,
        Math.max(
          1,
          parseInt(
            String(
              req.query.take || "12"
            ),
            10
          )
        )
      );

      const profile =
        await prisma.serviceProfile.findUnique(
          {
            where: {
              slug,
            },

            include: {
              service: {
                include: {
                  type: true,
                  vendor: true,
                },
              },
            },
          }
        );

      if (
        !profile ||
        profile?.service?.type
          ?.code !== "products"
      ) {
        return res.status(404).json({
          error:
            "store_not_found",
        });
      }

      const items =
        await prisma.product.findMany({
          where: {
            serviceId:
              profile.serviceId,

            isActive: true,
            isHidden: false,

            moderationStatus:
              "APPROVED",
          },

          orderBy: {
            createdAt: "desc",
          },

          take,

          select:
            baseProductSelect,
        });

      const promoByProductId =
        await getActiveCollectionPromosForProducts(
          items
        );

      const products = items.map(
        (product) =>
          mapPublicProduct(
            product,
            promoByProductId.get(
              product.id
            ) || null
          )
      );

      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );

      res.set(
        "Pragma",
        "no-cache"
      );

      res.set(
        "Expires",
        "0"
      );

      return res.json(
        products
      );
    } catch (error) {
      console.error(
        "GET /api/public/store/:slug/products error:",
        error
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

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
      reply: r.reply ? { id: r.reply.id, text: r.reply.text, createdAt: r.reply.createdAt } : null,
    }));

    res.json({ total, items, stats });
  } catch (e) {
    console.error("ERROR /api/public/store/:slug/reviews", e);
    next(e);
  }
});

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