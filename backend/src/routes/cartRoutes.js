// ==============================
// File: server/routes/cart.js
// ==============================
import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

function normalizeCartData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, itemValue]) => [
        String(key || "").trim(),
        typeof itemValue === "string" ? itemValue.trim() : itemValue,
      ])
      .filter(([key, itemValue]) => {
        if (!key) return false;
        if (itemValue === undefined || itemValue === null) return false;

        if (typeof itemValue === "string" && itemValue.length === 0) {
          return false;
        }

        return true;
      })
  );
}

function buildConfigurationKey(
  selectedOptions = {},
  customAnswers = {}
) {
  const normalized = JSON.stringify({
    selectedOptions: normalizeCartData(selectedOptions),
    customAnswers: normalizeCartData(customAnswers),
  });

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
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
    if (!rules.categories.includes(product.category)) return false;
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
    const tags = Array.isArray(product.occasionTags)
      ? product.occasionTags
      : [];

    if (!rules.occasionTags.some((tag) => tags.includes(String(tag)))) {
      return false;
    }
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    const tags = Array.isArray(product.styleTags) ? product.styleTags : [];

    if (!rules.styleTags.some((tag) => tags.includes(String(tag)))) {
      return false;
    }
  }

  return true;
}

function getPromoPrice(priceCents, promo = null) {
  const originalPriceCents = Math.round(Number(priceCents || 0));

  if (!promo) {
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
      OR: [{ promoStartsAt: null }, { promoStartsAt: { lte: now } }],
      AND: [
        {
          OR: [{ promoEndsAt: null }, { promoEndsAt: { gte: now } }],
        },
      ],
    },
    select: {
      id: true,
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

function productIsPublicAvailable(p) {
  if (!p) {
    return false;
  }

  const availability = String(
    p.availability || ""
  ).toUpperCase();

  const readyQty =
    p.readyQty === null ||
    p.readyQty === undefined
      ? null
      : Number(p.readyQty);

  const hasStock =
    readyQty === null ||
    (
      Number.isFinite(readyQty) &&
      readyQty > 0
    );

  return (
    p.isActive === true &&
    p.isHidden !== true &&
    String(
      p.moderationStatus ||
        "PENDING"
    ).toUpperCase() ===
      "APPROVED" &&
    availability === "READY" &&
    hasStock
  );
}

function getStockLimit(p) {
  const availability = String(p?.availability || "READY").toUpperCase();

  if (availability !== "READY") return null;
  if (p.readyQty === null || p.readyQty === undefined) return null;

  const stock = Number(p.readyQty);
  return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

async function getCartForUser(userId) {
  const t0 = Date.now();

  const cartItems = await prisma.cartItem.findMany({
  where: { userId },
  select: {
    id: true,
    productId: true,
    qty: true,
    selectedOptions: true,
    customAnswers: true,
    configurationKey: true,
  },
  orderBy: { createdAt: "desc" },
});

  const t1 = Date.now();

  const ids = cartItems.map((x) => x.productId);

  if (!ids.length) {
    return {
      items: [],
      timing: { cartMs: t1 - t0, productsMs: 0, mapMs: 0 },
    };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      images: true,
      priceCents: true,
      category: true,
      currency: true,

      acceptsCustom: true,
      styleTags: true,
      occasionTags: true,

      isActive: true,
      isHidden: true,
      moderationStatus: true,
      availability: true,
      readyQty: true,

      service: {
        select: {
          vendorId: true,
          profile: {
            select: {
              displayName: true,
              slug: true,
            },
          },
          vendor: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  const t2 = Date.now();

  const byId = new Map(products.map((p) => [p.id, p]));
  const promoByProductId = await getActiveCollectionPromosForProducts(products);

  const mapped = cartItems.map((ci) => {
    const p = byId.get(ci.productId);

    if (!p) {
  return {
    cartItemId: ci.id,
    productId: ci.productId,
    qty: ci.qty,
    selectedOptions: ci.selectedOptions || {},
    customAnswers: ci.customAnswers || {},
    configurationKey: ci.configurationKey || "default",
    product: null,
  };
}

   const service = p.service;

const stockLimit =
  getStockLimit(p);

const cartQty = Number(
  ci.qty || 0
);

const productAvailable =
  productIsPublicAvailable(p);

const quantityAvailable =
  stockLimit === null ||
  cartQty <= stockLimit;

const isAvailable =
  productAvailable &&
  quantityAvailable;

const availabilityMessage =
  !productAvailable
    ? String(
        p.availability || ""
      ).toUpperCase() ===
      "SOLD_OUT"
      ? "Produsul este epuizat."
      : "Produsul nu mai este disponibil."
    : !quantityAvailable
    ? `Mai sunt disponibile doar ${stockLimit} ${
        stockLimit === 1
          ? "bucată"
          : "bucăți"
      }. Redu cantitatea pentru a continua.`
    : null;

const promo = getPromoPrice(
  p.priceCents,
  promoByProductId.get(p.id) ||
    null
);

    return {
  cartItemId: ci.id,
  productId: ci.productId,
  qty: ci.qty,

  selectedOptions: ci.selectedOptions || {},
  customAnswers: ci.customAnswers || {},
  configurationKey: ci.configurationKey || "default",

  product: {
        id: p.id,
        title: p.title,
        images: Array.isArray(p.images) ? p.images : [],

        price: dec(promo.finalPriceCents / 100),
        priceCents: promo.finalPriceCents,

        originalPrice: promo.hasDiscount
          ? dec(promo.originalPriceCents / 100)
          : null,
        originalPriceCents: promo.hasDiscount
          ? promo.originalPriceCents
          : null,

        hasDiscount: promo.hasDiscount,
        discountPercent: promo.discountPercent,
        promoLabel: promo.promoLabel || null,
        promoFundingSource: promo.promoFundingSource || null,
        promoCollectionId: promo.promoCollectionId || null,

        currency: p.currency || "RON",

        isActive: p.isActive,
        isHidden: !!p.isHidden,
        moderationStatus: p.moderationStatus || "PENDING",
        availability: p.availability
          ? String(p.availability).toUpperCase()
          : null,
      readyQty:
  p.readyQty ?? null,

stockLimit,

isAvailable,

quantityAvailable,

availabilityMessage,

        vendorId: service?.vendorId ?? null,
        storeName:
          service?.profile?.displayName ||
          service?.vendor?.displayName ||
          "Magazin",
        storeSlug: service?.profile?.slug || null,

        category: p.category || null,
      },
    };
  });

  const t3 = Date.now();

  return {
    items: mapped,
    timing: { cartMs: t1 - t0, productsMs: t2 - t1, mapMs: t3 - t2 },
  };
}

router.post("/cart/add", authRequired, async (req, res) => {
  const {
    productId,
    qty = 1,
    selectedOptions = {},
    customAnswers = {},
  } = req.body || {};

  if (!productId) {
    return res.status(400).json({
      error: "productId_required",
    });
  }

  const safeQty = clamp(
    parseInt(qty, 10) || 1,
    1,
    99
  );

  const safeSelectedOptions =
    normalizeCartData(selectedOptions);

  const safeCustomAnswers =
    normalizeCartData(customAnswers);

  const configurationKey =
    buildConfigurationKey(
      safeSelectedOptions,
      safeCustomAnswers
    );

  const prod = await prisma.product.findUnique({
    where: {
      id: productId,
    },
    select: {
      id: true,
      availability: true,
      readyQty: true,
      isActive: true,
      isHidden: true,
      moderationStatus: true,
      service: {
        select: {
          vendorId: true,
          vendor: {
            select: {
              userId: true,
            },
          },
        },
      },
    },
  });

  if (!prod) {
    return res.status(404).json({
      error: "product_not_found",
    });
  }

  if (
    prod.service?.vendor?.userId ===
    req.user.sub
  ) {
    return res.status(403).json({
      error: "cannot_add_own_product",
    });
  }

  if (!productIsPublicAvailable(prod)) {
    return res.status(409).json({
      error:
        String(
          prod.availability || ""
        ).toUpperCase() === "SOLD_OUT"
          ? "product_sold_out"
          : "product_unavailable",

      message:
        String(
          prod.availability || ""
        ).toUpperCase() === "SOLD_OUT"
          ? "Produsul este epuizat."
          : "Produsul nu mai este disponibil.",
    });
  }

  const existing =
    await prisma.cartItem.findUnique({
      where: {
        userId_productId_configurationKey: {
          userId: req.user.sub,
          productId,
          configurationKey,
        },
      },
      select: {
        qty: true,
      },
    });

  const currentConfigurationQty =
    Number(existing?.qty || 0);

  const nextConfigurationQty =
    currentConfigurationQty + safeQty;

  const productQtyResult =
    await prisma.cartItem.aggregate({
      where: {
        userId: req.user.sub,
        productId,
      },
      _sum: {
        qty: true,
      },
    });

  const currentProductQty = Number(
    productQtyResult?._sum?.qty || 0
  );

  const requestedProductQty =
    currentProductQty + safeQty;

  const stockLimit = getStockLimit(prod);

  if (
    stockLimit !== null &&
    requestedProductQty > stockLimit
  ) {
    const remainingQty = Math.max(
      0,
      stockLimit - currentProductQty
    );

    return res.status(409).json({
      error: "insufficient_stock",

      message:
        remainingQty > 0
          ? `Mai sunt disponibile doar ${remainingQty} ${
              remainingQty === 1
                ? "bucată"
                : "bucăți"
            }.`
          : `Ai deja în coș toate cele ${stockLimit} ${
              stockLimit === 1
                ? "bucată disponibilă"
                : "bucăți disponibile"
            }.`,

      stock: stockLimit,
      currentQty: currentProductQty,
      remainingQty,
    });
  }

  const item =
    await prisma.cartItem.upsert({
      where: {
        userId_productId_configurationKey: {
          userId: req.user.sub,
          productId,
          configurationKey,
        },
      },

      update: {
        qty: nextConfigurationQty,
        selectedOptions:
          safeSelectedOptions,
        customAnswers:
          safeCustomAnswers,
      },

      create: {
        userId: req.user.sub,
        productId,
        qty: safeQty,
        selectedOptions:
          safeSelectedOptions,
        customAnswers:
          safeCustomAnswers,
        configurationKey,
      },
    });

  return res.json({
    ok: true,
    item,
  });
});

router.post("/cart/update", authRequired, async (req, res) => {
  const {
    productId,
    configurationKey = "default",
    qty,
  } = req.body || {};

  if (!productId) {
    return res.status(400).json({
      error: "productId_required",
    });
  }

  const item =
    await prisma.cartItem.findUnique({
      where: {
        userId_productId_configurationKey: {
          userId: req.user.sub,
          productId,
          configurationKey,
        },
      },
      select: {
        productId: true,
        qty: true,
        product: {
          select: {
            availability: true,
            readyQty: true,
            isActive: true,
            isHidden: true,
            moderationStatus: true,
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
        },
      },
    });

  if (!item) {
    return res.status(404).json({
      error: "cart_item_not_found",
    });
  }

  if (
    item.product?.service?.vendor
      ?.userId === req.user.sub
  ) {
    return res.status(403).json({
      error:
        "cannot_update_own_product",
    });
  }

  if (
    !productIsPublicAvailable(
      item.product
    )
  ) {
    return res.status(409).json({
      error:
        String(
          item.product?.availability ||
            ""
        ).toUpperCase() ===
        "SOLD_OUT"
          ? "product_sold_out"
          : "product_unavailable",

      message:
        String(
          item.product?.availability ||
            ""
        ).toUpperCase() ===
        "SOLD_OUT"
          ? "Produsul este epuizat."
          : "Produsul nu mai este disponibil.",
    });
  }

  const safeQty = clamp(
    parseInt(qty, 10) || 1,
    1,
    99
  );

  const otherConfigurations =
    await prisma.cartItem.aggregate({
      where: {
        userId: req.user.sub,
        productId,
        configurationKey: {
          not: configurationKey,
        },
      },
      _sum: {
        qty: true,
      },
    });

  const otherConfigurationsQty =
    Number(
      otherConfigurations?._sum?.qty ||
        0
    );

  const requestedProductQty =
    otherConfigurationsQty + safeQty;

  const stockLimit =
    getStockLimit(item.product);

  if (
    stockLimit !== null &&
    requestedProductQty > stockLimit
  ) {
    return res.status(409).json({
      error: "insufficient_stock",
      message:
        `Poți avea maximum ${stockLimit} buc. ` +
        "în total pentru acest produs.",
      stock: stockLimit,
    });
  }

  const updated =
    await prisma.cartItem.update({
      where: {
        userId_productId_configurationKey: {
          userId: req.user.sub,
          productId,
          configurationKey,
        },
      },
      data: {
        qty: safeQty,
      },
    });

  return res.json({
    ok: true,
    item: updated,
  });
});

router.delete("/cart/remove", authRequired, async (req, res) => {
  const {
    productId,
    configurationKey = "default",
  } = req.body || {};

  if (!productId) {
    return res.status(400).json({
      error: "productId_required",
    });
  }

  await prisma.cartItem
    .delete({
      where: {
        userId_productId_configurationKey: {
          userId: req.user.sub,
          productId,
          configurationKey,
        },
      },
    })
    .catch(() => null);

  return res.json({
    ok: true,
  });
});

router.post("/cart/remove-batch", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.productIds) ? req.body.productIds : [];

  if (!arr.length) {
    return res.json({ ok: true });
  }

  await prisma.cartItem.deleteMany({
    where: {
      userId: req.user.sub,
      productId: { in: arr },
    },
  });

  res.json({ ok: true });
});

router.post("/cart/clear", authRequired, async (req, res) => {
  await prisma.cartItem.deleteMany({
    where: { userId: req.user.sub },
  });

  res.json({ ok: true });
});

router.post("/cart/merge", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!arr.length) {
    return res.json({
      ok: true,
      merged: 0,
      skipped: 0,
      items: [],
    });
  }

  const userId = req.user.sub;

  const productIds = [
    ...new Set(
      arr
        .map((item) => String(item?.productId || "").trim())
        .filter(Boolean)
    ),
  ];

  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
    select: {
      id: true,
      availability: true,
      readyQty: true,
      isActive: true,
      isHidden: true,
      moderationStatus: true,
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

  const productsById = new Map(
    products.map((product) => [product.id, product])
  );

  let merged = 0;
  let skipped = 0;

  for (const rawItem of arr) {
    const productId = String(rawItem?.productId || "").trim();

    if (!productId) {
      skipped++;
      continue;
    }

    const product = productsById.get(productId);

    if (!product) {
      skipped++;
      continue;
    }

    if (product.service?.vendor?.userId === userId) {
      skipped++;
      continue;
    }

    if (!productIsPublicAvailable(product)) {
      skipped++;
      continue;
    }

    const qty = clamp(
      Number.parseInt(rawItem?.qty, 10) || 1,
      1,
      99
    );

    const selectedOptions = normalizeCartData(
      rawItem?.selectedOptions
    );

    const customAnswers = normalizeCartData(
      rawItem?.customAnswers
    );

    const configurationKey =
      String(rawItem?.configurationKey || "").trim() ||
      buildConfigurationKey(
        selectedOptions,
        customAnswers
      );

    const existing = await prisma.cartItem.findUnique({
      where: {
        userId_productId_configurationKey: {
          userId,
          productId,
          configurationKey,
        },
      },
      select: {
        qty: true,
      },
    });

    const currentConfigurationQty =
      Number(existing?.qty || 0);

    const allProductItems =
      await prisma.cartItem.aggregate({
        where: {
          userId,
          productId,
        },
        _sum: {
          qty: true,
        },
      });

    const currentProductQty =
      Number(allProductItems?._sum?.qty || 0);

    const stockLimit = getStockLimit(product);

    if (
      stockLimit !== null &&
      currentProductQty + qty > stockLimit
    ) {
      skipped++;
      continue;
    }

    await prisma.cartItem.upsert({
      where: {
        userId_productId_configurationKey: {
          userId,
          productId,
          configurationKey,
        },
      },
      update: {
        qty: Math.min(
          99,
          currentConfigurationQty + qty
        ),
        selectedOptions,
        customAnswers,
      },
      create: {
        userId,
        productId,
        qty,
        selectedOptions,
        customAnswers,
        configurationKey,
      },
    });

    merged++;
  }

  const { items } = await getCartForUser(userId);

  return res.json({
    ok: true,
    merged,
    skipped,
    items,
  });
});

router.get("/cart/count", authRequired, async (req, res) => {
  const count = await prisma.cartItem.count({
    where: {
      userId: req.user.sub,
    },
  });

  res.json({
    count,
  });
});

router.get("/cart", authRequired, async (req, res) => {
  const userId = req.user.sub;

  const { items, timing } = await getCartForUser(userId);

  res.setHeader(
    "Server-Timing",
    `cart;dur=${timing.cartMs},products;dur=${timing.productsMs},map;dur=${timing.mapMs}`
  );

  res.json({ items });
});

export default router;