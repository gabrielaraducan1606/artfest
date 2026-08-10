// ==============================
// File: server/routes/cart.js
// ==============================

import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  getPromotionPricingForProducts,
} from "../services/productPromotionPrice.js";
const router = Router();

const clamp = (n, min, max) =>
  Math.max(min, Math.min(max, n));

const dec = (n) =>
  Number.parseFloat(
    Number(n || 0).toFixed(2)
  );

/* =========================================================
   Helpers cart
========================================================= */

function normalizeCartData(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, itemValue]) => [
        String(key || "").trim(),
        typeof itemValue === "string"
          ? itemValue.trim()
          : itemValue,
      ])
      .filter(([key, itemValue]) => {
        if (!key) {
          return false;
        }

        if (
          itemValue === undefined ||
          itemValue === null
        ) {
          return false;
        }

        if (
          typeof itemValue === "string" &&
          itemValue.length === 0
        ) {
          return false;
        }

        return true;
      })
  );
}

function buildConfigurationKey(
  selectedOptions = {},
  customAnswers = {},
  repeatedGroupAnswers = {}
) {
  const normalized = JSON.stringify({
    selectedOptions:
      normalizeCartData(
        selectedOptions
      ),

    customAnswers:
      normalizeCartData(
        customAnswers
      ),

    repeatedGroupAnswers:
      normalizeCartData(
        repeatedGroupAnswers
      ),
  });

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}

/* =========================================================
   Promoții colecții
========================================================= */

function isCollectionPromoActive(
  collection,
  now = new Date()
) {
  if (!collection?.promoEnabled) {
    return false;
  }

  const percent = Number(
    collection.promoPercent || 0
  );

  if (
    !Number.isFinite(percent) ||
    percent <= 0
  ) {
    return false;
  }

  if (
    collection.promoStartsAt &&
    new Date(
      collection.promoStartsAt
    ) > now
  ) {
    return false;
  }

  if (
    collection.promoEndsAt &&
    new Date(
      collection.promoEndsAt
    ) < now
  ) {
    return false;
  }

  return true;
}

function productMatchesCollectionRules(
  product,
  rules = {}
) {
  if (!product) {
    return false;
  }

  if (
    Array.isArray(rules.categories) &&
    rules.categories.length
  ) {
    if (
      !rules.categories.includes(
        product.category
      )
    ) {
      return false;
    }
  }

  if (
    rules.acceptsCustom === true &&
    product.acceptsCustom !== true
  ) {
    return false;
  }

  const minPriceCents = Number(
    rules.minPriceCents
  );

  const maxPriceCents = Number(
    rules.maxPriceCents
  );

  if (
    Number.isFinite(minPriceCents) &&
    product.priceCents <
      minPriceCents
  ) {
    return false;
  }

  if (
    Number.isFinite(maxPriceCents) &&
    product.priceCents >
      maxPriceCents
  ) {
    return false;
  }

  if (
    Array.isArray(
      rules.occasionTags
    ) &&
    rules.occasionTags.length
  ) {
    const tags =
      Array.isArray(
        product.occasionTags
      )
        ? product.occasionTags
        : [];

    if (
      !rules.occasionTags.some(
        (tag) =>
          tags.includes(
            String(tag)
          )
      )
    ) {
      return false;
    }
  }

  if (
    Array.isArray(
      rules.styleTags
    ) &&
    rules.styleTags.length
  ) {
    const tags =
      Array.isArray(
        product.styleTags
      )
        ? product.styleTags
        : [];

    if (
      !rules.styleTags.some(
        (tag) =>
          tags.includes(
            String(tag)
          )
      )
    ) {
      return false;
    }
  }

  return true;
}

function getPromoPrice(
  priceCents,
  promo = null
) {
  const originalPriceCents =
    Math.round(
      Number(priceCents || 0)
    );

  if (!promo) {
    return {
      originalPriceCents,

      finalPriceCents:
        originalPriceCents,

      hasDiscount: false,

      discountPercent: 0,

      promoLabel: null,

      promoFundingSource: null,

      promoCollectionId: null,
    };
  }

  const discountPercent =
    Number(
      promo.promoPercent || 0
    );

  const finalPriceCents =
    Math.max(
      0,
      Math.round(
        originalPriceCents *
          (
            1 -
            discountPercent /
              100
          )
      )
    );

  return {
    originalPriceCents,

    finalPriceCents,

    hasDiscount: true,

    discountPercent,

    promoLabel:
      promo.promoLabel ||
      "Promoție Artfest",

    promoFundingSource:
      promo.promoFundingSource ||
      "PLATFORM_COMMISSION",

    promoCollectionId:
      promo.id || null,
  };
}

async function getActiveCollectionPromosForProducts(
  products = []
) {
  if (!products.length) {
    return new Map();
  }

  const now = new Date();

  const collections =
    await prisma.collection.findMany({
      where: {
        isActive: true,
        promoEnabled: true,

        OR: [
          {
            promoStartsAt: null,
          },
          {
            promoStartsAt: {
              lte: now,
            },
          },
        ],

        AND: [
          {
            OR: [
              {
                promoEndsAt:
                  null,
              },
              {
                promoEndsAt: {
                  gte: now,
                },
              },
            ],
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

  const activePromos =
    collections.filter(
      (collection) =>
        isCollectionPromoActive(
          collection,
          now
        )
    );

  const promoByProductId =
    new Map();

  for (
    const product of
    products
  ) {
    const matchingPromos =
      activePromos.filter(
        (collection) =>
          productMatchesCollectionRules(
            product,
            collection.rules ||
              {}
          )
      );

    if (
      !matchingPromos.length
    ) {
      continue;
    }

    matchingPromos.sort(
      (a, b) =>
        Number(
          b.promoPercent ||
            0
        ) -
        Number(
          a.promoPercent ||
            0
        )
    );

    promoByProductId.set(
      product.id,
      matchingPromos[0]
    );
  }

  return promoByProductId;
}

/* =========================================================
   Disponibilitate produs
========================================================= */

function productIsPublicAvailable(
  p
) {
  if (!p) {
    return false;
  }

  const availability =
    String(
      p.availability || ""
    )
      .trim()
      .toUpperCase();

  const orderMode =
    String(
      p.orderMode ||
        "DIRECT"
    )
      .trim()
      .toUpperCase();

  /*
   * Produsul trebuie să fie:
   * - activ
   * - vizibil
   * - aprobat
   */
  if (
    p.isActive !== true ||
    p.isHidden === true ||
    String(
      p.moderationStatus ||
        "PENDING"
    )
      .trim()
      .toUpperCase() !==
      "APPROVED"
  ) {
    return false;
  }

  /*
   * Produsele cu cerere de ofertă
   * NU intră în coș.
   */
  if (
    orderMode ===
    "QUOTE_ONLY"
  ) {
    return false;
  }

  /*
   * Sold out = indisponibil.
   */
  if (
    availability ===
    "SOLD_OUT"
  ) {
    return false;
  }

  /*
   * Produsele realizate la comandă
   * și cele în precomandă
   * pot fi cumpărate.
   */
  if (
    availability ===
      "MADE_TO_ORDER" ||
    availability ===
      "PREORDER"
  ) {
    return true;
  }

  /*
   * Pentru READY verificăm stocul.
   *
   * readyQty = null înseamnă:
   * stocul nu este urmărit numeric.
   */
  if (
    availability ===
    "READY"
  ) {
    if (
      p.readyQty ===
        null ||
      p.readyQty ===
        undefined
    ) {
      return true;
    }

    const readyQty =
      Number(
        p.readyQty
      );

    return (
      Number.isFinite(
        readyQty
      ) &&
      readyQty > 0
    );
  }

  return false;
}

function getStockLimit(p) {
  const availability =
    String(
      p?.availability ||
        "READY"
    ).toUpperCase();

  /*
   * MADE_TO_ORDER și PREORDER
   * nu au limită de stoc aici.
   */
  if (
    availability !==
    "READY"
  ) {
    return null;
  }

  if (
    p.readyQty === null ||
    p.readyQty === undefined
  ) {
    return null;
  }

  const stock = Number(
    p.readyQty
  );

  return Number.isFinite(
    stock
  )
    ? Math.max(
        0,
        stock
      )
    : 0;
}

/* =========================================================
   Citire coș
========================================================= */

async function getCartForUser(
  userId
) {
  const t0 = Date.now();

  const cartItems =
  await prisma.cartItem.findMany({
    where: {
      userId,
    },

    select: {
      id: true,
      productId: true,
      qty: true,

      selectedOptions: true,
      customAnswers: true,
      repeatedGroupAnswers: true,
      configurationKey: true,
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  const t1 = Date.now();

  const ids =
    cartItems.map(
      (item) =>
        item.productId
    );

  if (!ids.length) {
    return {
      items: [],

      timing: {
        cartMs:
          t1 - t0,

        productsMs: 0,

        mapMs: 0,
      },
    };
  }

  const products =
    await prisma.product.findMany({
      where: {
        id: {
          in: ids,
        },
      },

      select: {
        id: true,
        title: true,
        images: true,

        priceCents: true,

        category: true,

        currency: true,

        orderMode: true,
serviceId: true,
        acceptsCustom: true,

        styleTags: true,

        occasionTags: true,

        isActive: true,

        isHidden: true,

        moderationStatus:
          true,

        availability: true,

        readyQty: true,

       service: {
  select: {
    id: true,
    vendorId: true,

    profile: {
              select: {
                displayName:
                  true,

                slug: true,
              },
            },

            vendor: {
              select: {
                displayName:
                  true,
              },
            },
          },
        },
      },
    });

  const t2 = Date.now();

  const byId =
    new Map(
      products.map(
        (product) => [
          product.id,
          product,
        ]
      )
    );

const pricingByProductId =
  await getPromotionPricingForProducts(
    products
  );

console.log(
  "[cart] promotion pricing:",
  products.map(
    (product) => ({
      productId:
        product.id,

      serviceId:
        product.serviceId ||
        product.service?.id ||
        null,

      orderMode:
        product.orderMode,

      originalPriceCents:
        product.priceCents,

      pricing:
        pricingByProductId.get(
          product.id
        ) ||
        null,
    })
  )
);

  const mapped =
    cartItems.map(
      (cartItem) => {
        const product =
          byId.get(
            cartItem.productId
          );

        if (!product) {
          return {
            cartItemId:
              cartItem.id,

            productId:
              cartItem.productId,

            qty:
              cartItem.qty,

           selectedOptions:
  cartItem.selectedOptions ||
  {},

customAnswers:
  cartItem.customAnswers ||
  {},

repeatedGroupAnswers:
  cartItem.repeatedGroupAnswers ||
  {},

configurationKey:
  cartItem.configurationKey ||
  "default",

            product: null,
          };
        }

        const service =
          product.service;

        const stockLimit =
          getStockLimit(
            product
          );

        const cartQty =
          Number(
            cartItem.qty ||
              0
          );

        const productAvailable =
          productIsPublicAvailable(
            product
          );

        const quantityAvailable =
          stockLimit === null ||
          cartQty <=
            stockLimit;

        const isAvailable =
          productAvailable &&
          quantityAvailable;

        const orderMode =
          String(
            product.orderMode ||
              "DIRECT"
          ).toUpperCase();

        const availability =
          String(
            product.availability ||
              ""
          ).toUpperCase();

        let availabilityMessage =
          null;

        if (
          orderMode ===
          "QUOTE_ONLY"
        ) {
          availabilityMessage =
            "Pentru acest produs trebuie să soliciți o ofertă.";
        } else if (
          !productAvailable
        ) {
          availabilityMessage =
            availability ===
            "SOLD_OUT"
              ? "Produsul este epuizat."
              : "Produsul nu mai este disponibil.";
        } else if (
          !quantityAvailable
        ) {
          availabilityMessage =
            `Mai sunt disponibile doar ${stockLimit} ${
              stockLimit === 1
                ? "bucată"
                : "bucăți"
            }. Redu cantitatea pentru a continua.`;
        }

        const pricing =
  pricingByProductId.get(
    product.id
  );
        return {
          cartItemId:
            cartItem.id,

          productId:
            cartItem.productId,

          qty:
            cartItem.qty,

         selectedOptions:
  cartItem.selectedOptions ||
  {},

customAnswers:
  cartItem.customAnswers ||
  {},

repeatedGroupAnswers:
  cartItem.repeatedGroupAnswers ||
  {},

configurationKey:
  cartItem.configurationKey ||
  "default",

          product: {
            id:
              product.id,

            title:
              product.title,

            images:
              Array.isArray(
                product.images
              )
                ? product.images
                : [],

            price:
  dec(
    (
      pricing?.finalPriceCents ??
      product.priceCents ??
      0
    ) / 100
  ),

priceCents:
  pricing?.finalPriceCents ??
  product.priceCents ??
  0,

finalPriceCents:
  pricing?.finalPriceCents ??
  product.priceCents ??
  0,

discountedPriceCents:
  pricing?.discountedPriceCents ??
  product.priceCents ??
  0,

originalPrice:
  pricing?.hasDiscount
    ? dec(
        (
          pricing.originalPriceCents ||
          0
        ) / 100
      )
    : null,

originalPriceCents:
  pricing?.hasDiscount
    ? pricing.originalPriceCents
    : null,

hasDiscount:
  Boolean(
    pricing?.hasDiscount
  ),

discountPercent:
  pricing?.discountPercent ||
  0,

totalDiscountPercent:
  pricing?.totalDiscountPercent ||
  0,

platformDiscountPercent:
  pricing?.platformDiscountPercent ||
  0,

vendorDiscountPercent:
  pricing?.vendorDiscountPercent ||
  0,

hasActiveHomepageDiscount:
  Boolean(
    pricing?.hasActiveHomepageDiscount
  ),

promoLabel:
  pricing?.promoLabel ||
  null,

promoFundingSource:
  pricing?.promoFundingSource ||
  null,

promoCollectionId:
  pricing?.promoCollectionId ||
  null,

discount:
  pricing?.discount || {
    active: false,
    source: null,
    totalDiscountPercent: 0,
  },

            currency:
              product.currency ||
              "RON",

            orderMode:
              product.orderMode ||
              "DIRECT",

            isActive:
              product.isActive,

            isHidden:
              !!product.isHidden,

            moderationStatus:
              product.moderationStatus ||
              "PENDING",

            availability:
              product.availability
                ? String(
                    product.availability
                  ).toUpperCase()
                : null,

            readyQty:
              product.readyQty ??
              null,

            stockLimit,

            isAvailable,

            quantityAvailable,

            availabilityMessage,

            vendorId:
              service?.vendorId ??
              null,

            storeName:
              service?.profile
                ?.displayName ||
              service?.vendor
                ?.displayName ||
              "Magazin",

            storeSlug:
              service?.profile
                ?.slug ||
              null,

            category:
              product.category ||
              null,
          },
        };
      }
    );

  const t3 = Date.now();

  return {
    items: mapped,

    timing: {
      cartMs:
        t1 - t0,

      productsMs:
        t2 - t1,

      mapMs:
        t3 - t2,
    },
  };
}

/* =========================================================
   ADD
========================================================= */

router.post(
  "/cart/add",
  authRequired,
  async (req, res) => {
    const {
      productId,
      qty = 1,

      selectedOptions = {},
      customAnswers = {},
      repeatedGroupAnswers = {},
    } =
      req.body || {};

    if (!productId) {
      return res
        .status(400)
        .json({
          error:
            "productId_required",
        });
    }

    const safeQty =
      clamp(
        parseInt(
          qty,
          10
        ) || 1,
        1,
        99
      );

    const safeSelectedOptions =
      normalizeCartData(
        selectedOptions
      );

    const safeCustomAnswers =
      normalizeCartData(
        customAnswers
      );

    const safeRepeatedGroupAnswers =
      normalizeCartData(
        repeatedGroupAnswers
      );

    const configurationKey =
      buildConfigurationKey(
        safeSelectedOptions,
        safeCustomAnswers,
        safeRepeatedGroupAnswers
      );

    const prod =
      await prisma.product.findUnique({
        where: {
          id: productId,
        },

        select: {
          id: true,

          orderMode: true,

          availability: true,

          readyQty: true,

          isActive: true,

          isHidden: true,

          moderationStatus:
            true,

          service: {
            select: {
              id: true,
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
      return res
        .status(404)
        .json({
          error:
            "product_not_found",
        });
    }

    if (
      prod.service?.vendor
        ?.userId ===
      req.user.sub
    ) {
      return res
        .status(403)
        .json({
          error:
            "cannot_add_own_product",
        });
    }

    /*
     * Produsele exclusiv CERERE OFERTĂ
     * nu intră în coș.
     */
    if (
      String(
        prod.orderMode ||
          ""
      ).toUpperCase() ===
      "QUOTE_ONLY"
    ) {
      return res
        .status(409)
        .json({
          error:
            "quote_only",

          message:
            "Pentru acest produs trebuie să soliciți o ofertă.",
        });
    }

    if (
      !productIsPublicAvailable(
        prod
      )
    ) {
      const availability =
        String(
          prod.availability ||
            ""
        ).toUpperCase();

      return res
        .status(409)
        .json({
          error:
            availability ===
            "SOLD_OUT"
              ? "product_sold_out"
              : "product_unavailable",

          message:
            availability ===
            "SOLD_OUT"
              ? "Produsul este epuizat."
              : "Produsul nu mai este disponibil.",
        });
    }

    const existing =
      await prisma.cartItem.findUnique({
        where: {
          userId_productId_configurationKey:
            {
              userId:
                req.user.sub,

              productId,

              configurationKey,
            },
        },

        select: {
          qty: true,
        },
      });

    const currentConfigurationQty =
      Number(
        existing?.qty ||
          0
      );

    const nextConfigurationQty =
      currentConfigurationQty +
      safeQty;

    const productQtyResult =
      await prisma.cartItem.aggregate({
        where: {
          userId:
            req.user.sub,

          productId,
        },

        _sum: {
          qty: true,
        },
      });

    const currentProductQty =
      Number(
        productQtyResult
          ?._sum?.qty ||
          0
      );

    const requestedProductQty =
      currentProductQty +
      safeQty;

    const stockLimit =
      getStockLimit(prod);

    if (
      stockLimit !== null &&
      requestedProductQty >
        stockLimit
    ) {
      const remainingQty =
        Math.max(
          0,
          stockLimit -
            currentProductQty
        );

      return res
        .status(409)
        .json({
          error:
            "insufficient_stock",

          message:
            remainingQty > 0
              ? `Mai sunt disponibile doar ${remainingQty} ${
                  remainingQty ===
                  1
                    ? "bucată"
                    : "bucăți"
                }.`
              : `Ai deja în coș toate cele ${stockLimit} ${
                  stockLimit ===
                  1
                    ? "bucată disponibilă"
                    : "bucăți disponibile"
                }.`,

          stock:
            stockLimit,

          currentQty:
            currentProductQty,

          remainingQty,
        });
    }

    const item =
      await prisma.cartItem.upsert({
        where: {
          userId_productId_configurationKey:
            {
              userId:
                req.user.sub,

              productId,

              configurationKey,
            },
        },

        update: {
          qty:
            nextConfigurationQty,

          selectedOptions:
            safeSelectedOptions,

          customAnswers:
            safeCustomAnswers,

          repeatedGroupAnswers:
            safeRepeatedGroupAnswers,
        },

        create: {
          userId:
            req.user.sub,

          productId,

          qty:
            safeQty,

          selectedOptions:
            safeSelectedOptions,

          customAnswers:
            safeCustomAnswers,

          repeatedGroupAnswers:
            safeRepeatedGroupAnswers,

          configurationKey,
        },
      });

    return res.json({
      ok: true,
      item,
    });
  }
);
/* =========================================================
   UPDATE
========================================================= */

router.post(
  "/cart/update",
  authRequired,
  async (req, res) => {
    const {
      productId,

      configurationKey =
        "default",

      qty,
    } =
      req.body || {};

    if (!productId) {
      return res
        .status(400)
        .json({
          error:
            "productId_required",
        });
    }

    const item =
      await prisma.cartItem.findUnique({
        where: {
          userId_productId_configurationKey:
            {
              userId:
                req.user.sub,

              productId,

              configurationKey,
            },
        },

        select: {
          productId:
            true,

          qty: true,

          product: {
            select: {
              orderMode:
                true,

              availability:
                true,

              readyQty: true,

              isActive: true,

              isHidden: true,

              moderationStatus:
                true,

              service: {
                select: {
                  vendor: {
                    select: {
                      userId:
                        true,
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!item) {
      return res
        .status(404)
        .json({
          error:
            "cart_item_not_found",
        });
    }

    if (
      item.product?.service
        ?.vendor?.userId ===
      req.user.sub
    ) {
      return res
        .status(403)
        .json({
          error:
            "cannot_update_own_product",
        });
    }

    if (
      String(
        item.product
          ?.orderMode ||
          ""
      ).toUpperCase() ===
      "QUOTE_ONLY"
    ) {
      return res
        .status(409)
        .json({
          error:
            "quote_only",

          message:
            "Pentru acest produs trebuie să soliciți o ofertă.",
        });
    }

    if (
      !productIsPublicAvailable(
        item.product
      )
    ) {
      const availability =
        String(
          item.product
            ?.availability ||
            ""
        ).toUpperCase();

      return res
        .status(409)
        .json({
          error:
            availability ===
            "SOLD_OUT"
              ? "product_sold_out"
              : "product_unavailable",

          message:
            availability ===
            "SOLD_OUT"
              ? "Produsul este epuizat."
              : "Produsul nu mai este disponibil.",
        });
    }

    const safeQty =
      clamp(
        parseInt(
          qty,
          10
        ) || 1,
        1,
        99
      );

    const otherConfigurations =
      await prisma.cartItem.aggregate({
        where: {
          userId:
            req.user.sub,

          productId,

          configurationKey: {
            not:
              configurationKey,
          },
        },

        _sum: {
          qty: true,
        },
      });

    const otherConfigurationsQty =
      Number(
        otherConfigurations
          ?._sum?.qty ||
          0
      );

    const requestedProductQty =
      otherConfigurationsQty +
      safeQty;

    const stockLimit =
      getStockLimit(
        item.product
      );

    if (
      stockLimit !== null &&
      requestedProductQty >
        stockLimit
    ) {
      return res
        .status(409)
        .json({
          error:
            "insufficient_stock",

          message:
            `Poți avea maximum ${stockLimit} buc. ` +
            "în total pentru acest produs.",

          stock:
            stockLimit,
        });
    }

    const updated =
      await prisma.cartItem.update({
        where: {
          userId_productId_configurationKey:
            {
              userId:
                req.user.sub,

              productId,

              configurationKey,
            },
        },

        data: {
          qty:
            safeQty,
        },
      });

    return res.json({
      ok: true,
      item: updated,
    });
  }
);

/* =========================================================
   REMOVE
========================================================= */

router.delete(
  "/cart/remove",
  authRequired,
  async (req, res) => {
    const {
      productId,

      configurationKey =
        "default",
    } =
      req.body || {};

    if (!productId) {
      return res
        .status(400)
        .json({
          error:
            "productId_required",
        });
    }

    await prisma.cartItem
      .delete({
        where: {
          userId_productId_configurationKey:
            {
              userId:
                req.user.sub,

              productId,

              configurationKey,
            },
        },
      })
      .catch(() => null);

    return res.json({
      ok: true,
    });
  }
);

/* =========================================================
   REMOVE BATCH
========================================================= */

router.post(
  "/cart/remove-batch",
  authRequired,
  async (req, res) => {
    const arr =
      Array.isArray(
        req.body?.productIds
      )
        ? req.body
            .productIds
        : [];

    if (!arr.length) {
      return res.json({
        ok: true,
      });
    }

    await prisma.cartItem.deleteMany({
      where: {
        userId:
          req.user.sub,

        productId: {
          in: arr,
        },
      },
    });

    return res.json({
      ok: true,
    });
  }
);

/* =========================================================
   CLEAR
========================================================= */

router.post(
  "/cart/clear",
  authRequired,
  async (req, res) => {
    await prisma.cartItem.deleteMany({
      where: {
        userId:
          req.user.sub,
      },
    });

    return res.json({
      ok: true,
    });
  }
);

/* =========================================================
   MERGE GUEST CART
========================================================= */
router.post(
  "/cart/merge",
  authRequired,
  async (req, res) => {
    const arr =
      Array.isArray(
        req.body?.items
      )
        ? req.body.items
        : [];

    if (!arr.length) {
      return res.json({
        ok: true,
        merged: 0,
        skipped: 0,
        items: [],
      });
    }

    const userId =
      req.user.sub;

    const productIds = [
      ...new Set(
        arr
          .map((item) =>
            String(
              item?.productId ||
                ""
            ).trim()
          )
          .filter(Boolean)
      ),
    ];

    const products =
      await prisma.product.findMany({
        where: {
          id: {
            in: productIds,
          },
        },

        select: {
          id: true,

          orderMode: true,

          availability: true,

          readyQty: true,

          isActive: true,

          isHidden: true,

          moderationStatus:
            true,

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

    const productsById =
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    let merged = 0;
    let skipped = 0;

    for (
      const rawItem of arr
    ) {
      const productId =
        String(
          rawItem
            ?.productId ||
            ""
        ).trim();

      if (!productId) {
        skipped++;
        continue;
      }

      const product =
        productsById.get(
          productId
        );

      if (!product) {
        skipped++;
        continue;
      }

      if (
        product.service
          ?.vendor?.userId ===
        userId
      ) {
        skipped++;
        continue;
      }

      if (
        String(
          product.orderMode ||
            ""
        ).toUpperCase() ===
        "QUOTE_ONLY"
      ) {
        skipped++;
        continue;
      }

      if (
        !productIsPublicAvailable(
          product
        )
      ) {
        skipped++;
        continue;
      }

      const qty =
        clamp(
          Number.parseInt(
            rawItem?.qty,
            10
          ) || 1,
          1,
          99
        );

      const selectedOptions =
        normalizeCartData(
          rawItem
            ?.selectedOptions
        );

      const customAnswers =
        normalizeCartData(
          rawItem
            ?.customAnswers
        );

      const repeatedGroupAnswers =
        normalizeCartData(
          rawItem
            ?.repeatedGroupAnswers
        );

      /*
       * IMPORTANT:
       *
       * Nu păstrăm configurationKey
       * generat în guestCart.
       *
       * Backend-ul își construiește
       * propria cheie SHA256 din
       * configurația completă.
       */
      const configurationKey =
        buildConfigurationKey(
          selectedOptions,
          customAnswers,
          repeatedGroupAnswers
        );

      const existing =
        await prisma.cartItem.findUnique({
          where: {
            userId_productId_configurationKey:
              {
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
        Number(
          existing?.qty ||
            0
        );

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
        Number(
          allProductItems
            ?._sum?.qty ||
            0
        );

      const stockLimit =
        getStockLimit(
          product
        );

      if (
        stockLimit !== null &&
        currentProductQty +
          qty >
          stockLimit
      ) {
        skipped++;
        continue;
      }

      await prisma.cartItem.upsert({
        where: {
          userId_productId_configurationKey:
            {
              userId,

              productId,

              configurationKey,
            },
        },

        update: {
          qty:
            Math.min(
              99,
              currentConfigurationQty +
                qty
            ),

          selectedOptions,

          customAnswers,

          repeatedGroupAnswers,
        },

        create: {
          userId,

          productId,

          qty,

          selectedOptions,

          customAnswers,

          repeatedGroupAnswers,

          configurationKey,
        },
      });

      merged++;
    }

    const {
      items,
    } =
      await getCartForUser(
        userId
      );

    return res.json({
      ok: true,

      merged,

      skipped,

      items,
    });
  }
);
/* =========================================================
   COUNT
========================================================= */

router.get(
  "/cart/count",
  authRequired,
  async (req, res) => {
    const count =
      await prisma.cartItem.count({
        where: {
          userId:
            req.user.sub,
        },
      });

    return res.json({
      count,
    });
  }
);

/* =========================================================
   GET CART
========================================================= */

router.get(
  "/cart",
  authRequired,
  async (req, res) => {
    const userId =
      req.user.sub;

    const {
      items,
      timing,
    } =
      await getCartForUser(
        userId
      );

    res.setHeader(
      "Server-Timing",
      `cart;dur=${timing.cartMs},products;dur=${timing.productsMs},map;dur=${timing.mapMs}`
    );

    return res.json({
      items,
    });
  }
);

export default router;