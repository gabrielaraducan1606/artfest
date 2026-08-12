// backend/src/services/productPromotionPrice.js

import {
  prisma,
} from "../db.js";

/* =========================================================
   CONSTANTE
========================================================= */

export const PROMOTION_SOURCES = {
  PRODUCT_OF_DAY:
    "PRODUCT_OF_DAY",

  ARTISAN_OF_WEEK:
    "ARTISAN_OF_WEEK",

  COLLECTION:
    "COLLECTION",
};

/*
 * Dacă două promoții au același procent:
 *
 * 1. Produsul zilei
 * 2. Artizanul săptămânii
 * 3. Colecție
 */
const PROMOTION_PRIORITY = {
  [PROMOTION_SOURCES.PRODUCT_OF_DAY]:
    3,

  [PROMOTION_SOURCES.ARTISAN_OF_WEEK]:
    2,

  [PROMOTION_SOURCES.COLLECTION]:
    1,
};

/* =========================================================
   HELPERS GENERALI
========================================================= */

function clampPercent(
  value
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        numeric
      )
    )
  );
}

function normalizeMoneyCents(
  value
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      numeric
    )
  );
}

function normalizeDate(
  value
) {
  if (!value) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function getProductServiceId(
  product
) {
  return (
    product?.serviceId ||
    product?.service?.id ||
    null
  );
}

function isQuoteOnly(
  product
) {
  return (
    String(
      product?.orderMode ||
        ""
    ).toUpperCase() ===
    "QUOTE_ONLY"
  );
}

/* =========================================================
   COLECȚII
========================================================= */

export function isCollectionPromotionActive(
  collection,
  now = new Date()
) {
  if (
    !collection?.promoEnabled
  ) {
    return false;
  }

  const percent =
    clampPercent(
      collection.promoPercent
    );

  if (
    percent <= 0
  ) {
    return false;
  }

  const startsAt =
    normalizeDate(
      collection.promoStartsAt
    );

  const endsAt =
    normalizeDate(
      collection.promoEndsAt
    );

  if (
    startsAt &&
    startsAt > now
  ) {
    return false;
  }

  if (
    endsAt &&
    endsAt <= now
  ) {
    return false;
  }

  return true;
}

export function productMatchesCollectionRules(
  product,
  rules = {}
) {
  if (!product) {
    return false;
  }

  if (
    Array.isArray(
      rules.categories
    ) &&
    rules.categories.length
  ) {
    const categories =
      rules.categories
        .map((value) =>
          String(
            value || ""
          ).trim()
        )
        .filter(Boolean);

    if (
      categories.length &&
      !categories.includes(
        product.category
      )
    ) {
      return false;
    }
  }

  if (
    rules.acceptsCustom ===
      true &&
    product.acceptsCustom !==
      true
  ) {
    return false;
  }

  const minPriceCents =
    Number(
      rules.minPriceCents
    );

  const maxPriceCents =
    Number(
      rules.maxPriceCents
    );

  const productPriceCents =
    normalizeMoneyCents(
      product.priceCents
    );

  if (
    Number.isFinite(
      minPriceCents
    ) &&
    productPriceCents <
      minPriceCents
  ) {
    return false;
  }

  if (
    Number.isFinite(
      maxPriceCents
    ) &&
    productPriceCents >
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
    const productTags =
      Array.isArray(
        product.occasionTags
      )
        ? product.occasionTags.map(
            String
          )
        : [];

    const matches =
      rules.occasionTags.some(
        (tag) =>
          productTags.includes(
            String(tag)
          )
      );

    if (!matches) {
      return false;
    }
  }

  if (
    Array.isArray(
      rules.styleTags
    ) &&
    rules.styleTags.length
  ) {
    const productTags =
      Array.isArray(
        product.styleTags
      )
        ? product.styleTags.map(
            String
          )
        : [];

    const matches =
      rules.styleTags.some(
        (tag) =>
          productTags.includes(
            String(tag)
          )
      );

    if (!matches) {
      return false;
    }
  }

  return true;
}

function collectionToPromotion(
  collection
) {
  if (!collection) {
    return null;
  }

  const totalDiscountPercent =
    clampPercent(
      collection.promoPercent
    );

  if (
    totalDiscountPercent <=
    0
  ) {
    return null;
  }

  return {
    active:
      true,

    source:
      PROMOTION_SOURCES.COLLECTION,

    label:
      collection.promoLabel ||
      collection.title ||
      "Promoție Artfest",

    totalDiscountPercent,

    /*
     * Pentru colecții tratăm momentan
     * întreaga reducere ca reducere de
     * platformă.
     */
    platformDiscountPercent:
      totalDiscountPercent,

    vendorDiscountPercent:
      0,

    startsAt:
      collection.promoStartsAt ||
      null,

    endsAt:
      collection.promoEndsAt ||
      null,

    collectionId:
      collection.id ||
      null,

    collectionSlug:
      collection.slug ||
      null,

    homepageFeatureId:
      null,

    fundingSource:
      collection.promoFundingSource ||
      "PLATFORM_COMMISSION",
  };
}

export async function getActiveCollectionPromotionsForProducts(
  products = [],
  {
    db = prisma,
    now = new Date(),
  } = {}
) {
  const result =
    new Map();

  if (
    !Array.isArray(
      products
    ) ||
    !products.length
  ) {
    return result;
  }

  const collections =
    await db.collection.findMany({
      where: {
        isActive:
          true,

        promoEnabled:
          true,

        OR: [
          {
            promoStartsAt:
              null,
          },

          {
            promoStartsAt: {
              lte:
                now,
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
                  gt:
                    now,
                },
              },
            ],
          },
        ],
      },

      select: {
        id:
          true,

        title:
          true,

        slug:
          true,

        rules:
          true,

        promoEnabled:
          true,

        promoPercent:
          true,

        promoLabel:
          true,

        promoFundingSource:
          true,

        promoStartsAt:
          true,

        promoEndsAt:
          true,
      },
    });

  const activeCollections =
    collections.filter(
      (collection) =>
        isCollectionPromotionActive(
          collection,
          now
        )
    );

  for (
    const product of
    products
  ) {
    const matchingCollections =
      activeCollections.filter(
        (collection) =>
          productMatchesCollectionRules(
            product,
            collection.rules ||
              {}
          )
      );

    if (
      !matchingCollections.length
    ) {
      continue;
    }

    /*
     * Dacă produsul intră în mai multe colecții,
     * păstrăm colecția cu reducerea cea mai mare.
     */
    matchingCollections.sort(
      (a, b) =>
        clampPercent(
          b.promoPercent
        ) -
        clampPercent(
          a.promoPercent
        )
    );

    const promotion =
      collectionToPromotion(
        matchingCollections[0]
      );

    if (promotion) {
      result.set(
        product.id,
        promotion
      );
    }
  }

  return result;
}

/* =========================================================
   HOMEPAGE FEATURES
========================================================= */

function homepageFeatureToPromotion(
  feature
) {
  if (!feature) {
    return null;
  }

  const platformDiscountPercent =
    clampPercent(
      feature.platformDiscountPercent
    );

  /*
   * Reducerea vendorului contează numai dacă
   * vendorul a acceptat explicit.
   */
  const vendorDiscountPercent =
    feature.vendorDiscountStatus ===
    "ACCEPTED"
      ? clampPercent(
          feature.vendorDiscountPercent
        )
      : 0;

  const totalDiscountPercent =
    Math.min(
      100,
      platformDiscountPercent +
        vendorDiscountPercent
    );

  if (
    totalDiscountPercent <=
    0
  ) {
    return null;
  }

  const source =
    feature.type ===
    PROMOTION_SOURCES.PRODUCT_OF_DAY
      ? PROMOTION_SOURCES.PRODUCT_OF_DAY
      : PROMOTION_SOURCES.ARTISAN_OF_WEEK;

  const label =
    source ===
    PROMOTION_SOURCES.PRODUCT_OF_DAY
      ? "Produsul zilei"
      : "Artizanul săptămânii";

  return {
    active:
      true,

    source,
    label,

    totalDiscountPercent,
    platformDiscountPercent,
    vendorDiscountPercent,

    startsAt:
      feature.startsAt ||
      null,

    endsAt:
      feature.endsAt ||
      null,

    collectionId:
      null,

    collectionSlug:
      null,

    homepageFeatureId:
      feature.id,

    fundingSource:
      "HOMEPAGE_FEATURE",
  };
}

export async function getActiveHomepagePromotionsForProducts(
  products = [],
  {
    db = prisma,
    now = new Date(),
  } = {}
) {
  const result =
    new Map();

  if (
    !Array.isArray(
      products
    ) ||
    !products.length
  ) {
    return result;
  }

  const productIds =
    Array.from(
      new Set(
        products
          .map(
            (product) =>
              product?.id
          )
          .filter(Boolean)
      )
    );

  const serviceIds =
    Array.from(
      new Set(
        products
          .map(
            getProductServiceId
          )
          .filter(Boolean)
      )
    );

  if (
    !productIds.length &&
    !serviceIds.length
  ) {
    return result;
  }

  const featureConditions =
    [];

  if (
    productIds.length
  ) {
    featureConditions.push({
      type:
        PROMOTION_SOURCES.PRODUCT_OF_DAY,

      productId: {
        in:
          productIds,
      },
    });
  }

  if (
    serviceIds.length
  ) {
    featureConditions.push({
      type:
        PROMOTION_SOURCES.ARTISAN_OF_WEEK,

      serviceId: {
        in:
          serviceIds,
      },
    });
  }

  const features =
    await db.homepageFeature.findMany({
      where: {
        startsAt: {
          lte:
            now,
        },

        endsAt: {
          gt:
            now,
        },

        OR:
          featureConditions,
      },

      select: {
        id:
          true,

        type:
          true,

        productId:
          true,

        serviceId:
          true,

        startsAt:
          true,

        endsAt:
          true,

        platformDiscountPercent:
          true,

        vendorDiscountPercent:
          true,

        vendorDiscountStatus:
          true,
      },
    });

    
  const productFeatureByProductId =
    new Map();

  const artisanFeatureByServiceId =
    new Map();

  for (
    const feature of
    features
  ) {
    if (
      feature.type ===
        PROMOTION_SOURCES.PRODUCT_OF_DAY &&
      feature.productId
    ) {
      productFeatureByProductId.set(
        feature.productId,
        feature
      );
    }

    if (
      feature.type ===
        PROMOTION_SOURCES.ARTISAN_OF_WEEK &&
      feature.serviceId
    ) {
      artisanFeatureByServiceId.set(
        feature.serviceId,
        feature
      );
    }
  }

  for (
    const product of
    products
  ) {
    const productFeature =
      productFeatureByProductId.get(
        product.id
      );

    const artisanFeature =
      artisanFeatureByServiceId.get(
        getProductServiceId(
          product
        )
      );

    const candidates =
      [
        homepageFeatureToPromotion(
          productFeature
        ),

        homepageFeatureToPromotion(
          artisanFeature
        ),
      ].filter(Boolean);

    const winner =
      chooseBestPromotion(
        candidates
      );

    if (winner) {
      result.set(
        product.id,
        winner
      );
    }
  }

  return result;
}

/* =========================================================
   ALEGEREA PROMOȚIEI
========================================================= */

export function chooseBestPromotion(
  promotions = []
) {
  const validPromotions =
    promotions.filter(
      (promotion) =>
        promotion?.active &&
        clampPercent(
          promotion.totalDiscountPercent
        ) > 0
    );

  if (
    !validPromotions.length
  ) {
    return null;
  }

  return [
    ...validPromotions,
  ].sort(
    (a, b) => {
      const percentageDifference =
        clampPercent(
          b.totalDiscountPercent
        ) -
        clampPercent(
          a.totalDiscountPercent
        );

      if (
        percentageDifference !==
        0
      ) {
        return percentageDifference;
      }

      return (
        (
          PROMOTION_PRIORITY[
            b.source
          ] || 0
        ) -
        (
          PROMOTION_PRIORITY[
            a.source
          ] || 0
        )
      );
    }
  )[0];
}

/* =========================================================
   CALCUL PREȚ
========================================================= */

export function calculateProductPromotionPricing(
  product,
  promotion = null
) {
  const originalPriceCents =
    normalizeMoneyCents(
      product?.priceCents
    );

  const eligible =
    Boolean(
      product &&
      !isQuoteOnly(
        product
      )
    );

  const totalDiscountPercent =
    eligible
      ? clampPercent(
          promotion
            ?.totalDiscountPercent
        )
      : 0;

  const hasDiscount =
    Boolean(
      eligible &&
      promotion?.active &&
      totalDiscountPercent >
        0
    );

  const finalPriceCents =
    hasDiscount
      ? Math.max(
          0,
          Math.round(
            originalPriceCents *
              (
                100 -
                totalDiscountPercent
              ) /
              100
          )
        )
      : originalPriceCents;

  const normalizedPromotion =
    hasDiscount
      ? {
          active:
            true,

          source:
            promotion.source,

          label:
            promotion.label ||
            "Promoție",

          platformDiscountPercent:
            clampPercent(
              promotion.platformDiscountPercent
            ),

          vendorDiscountPercent:
            clampPercent(
              promotion.vendorDiscountPercent
            ),

          totalDiscountPercent,

          startsAt:
            promotion.startsAt ||
            null,

          endsAt:
            promotion.endsAt ||
            null,

          collectionId:
            promotion.collectionId ||
            null,

          collectionSlug:
            promotion.collectionSlug ||
            null,

          homepageFeatureId:
            promotion.homepageFeatureId ||
            null,

          fundingSource:
            promotion.fundingSource ||
            null,

          eligible:
            true,
        }
      : {
          active:
            false,

          source:
            null,

          label:
            null,

          platformDiscountPercent:
            0,

          vendorDiscountPercent:
            0,

          totalDiscountPercent:
            0,

          startsAt:
            null,

          endsAt:
            null,

          collectionId:
            null,

          collectionSlug:
            null,

          homepageFeatureId:
            null,

          fundingSource:
            null,

          eligible,
        };

  return {
    originalPriceCents,
    finalPriceCents,

    /*
     * Alias folosit deja în frontend.
     */
    discountedPriceCents:
      finalPriceCents,

    originalPrice:
      originalPriceCents /
      100,

    finalPrice:
      finalPriceCents /
      100,

    price:
      finalPriceCents /
      100,

    priceCents:
      finalPriceCents,

    hasDiscount,

    /*
     * Pentru compatibilitatea cu vechiul
     * sistem de colecții.
     */
    discountPercent:
      totalDiscountPercent,

    promoLabel:
      normalizedPromotion.label,

    promoFundingSource:
      normalizedPromotion.fundingSource,

    promoCollectionId:
      normalizedPromotion.collectionId,

    /*
     * Pentru noul frontend.
     */
    totalDiscountPercent,

    platformDiscountPercent:
      normalizedPromotion
        .platformDiscountPercent,

    vendorDiscountPercent:
      normalizedPromotion
        .vendorDiscountPercent,

    hasActiveHomepageDiscount:
      hasDiscount &&
      (
        normalizedPromotion.source ===
          PROMOTION_SOURCES.PRODUCT_OF_DAY ||
        normalizedPromotion.source ===
          PROMOTION_SOURCES.ARTISAN_OF_WEEK
      ),

    discount:
      normalizedPromotion,
  };
}

export async function getPromotionPricingForProducts(
  products = [],
  {
    db = prisma,
    now = new Date(),
  } = {}
) {
  const pricingByProductId =
    new Map();

  if (
    !Array.isArray(products) ||
    !products.length
  ) {
    return pricingByProductId;
  }

  const [
    collectionPromotions,
    homepagePromotions,
  ] = await Promise.all([
    getActiveCollectionPromotionsForProducts(
      products,
      {
        db,
        now,
      }
    ),

    getActiveHomepagePromotionsForProducts(
      products,
      {
        db,
        now,
      }
    ),
  ]);

  for (const product of products) {
    const collectionPromotion =
      collectionPromotions.get(
        product.id
      ) || null;

    const homepagePromotion =
      homepagePromotions.get(
        product.id
      ) || null;

    /*
     * Nu cumulăm promoțiile.
     * Alegem promoția cu procentul cel mai mare.
     */
    const winningPromotion =
      chooseBestPromotion([
        collectionPromotion,
        homepagePromotion,
      ]);

    const pricing =
      calculateProductPromotionPricing(
        product,
        winningPromotion
      );

    pricingByProductId.set(
      product.id,
      pricing
    );
  }

  return pricingByProductId;
}
/* =========================================================
   REZOLVARE PENTRU UN SINGUR PRODUS
========================================================= */

export async function getPromotionPricingForProduct(
  product,
  options = {}
) {
  if (!product?.id) {
    return calculateProductPromotionPricing(
      product,
      null
    );
  }

  const pricingMap =
    await getPromotionPricingForProducts(
      [product],
      options
    );

  return (
    pricingMap.get(
      product.id
    ) ||
    calculateProductPromotionPricing(
      product,
      null
    )
  );
}

/* =========================================================
   APLICARE PE OBIECTUL PRODUS
========================================================= */

export function applyPromotionPricingToProduct(
  product,
  pricing
) {
  if (!product) {
    return null;
  }

  const safePricing =
    pricing ||
    calculateProductPromotionPricing(
      product,
      null
    );

  return {
    ...product,

    originalPriceCents:
      safePricing
        .originalPriceCents,

    finalPriceCents:
      safePricing
        .finalPriceCents,

    discountedPriceCents:
      safePricing
        .discountedPriceCents,

    /*
     * Păstrăm priceCents ca preț final pentru
     * compatibilitatea cu frontendul actual.
     */
    priceCents:
      safePricing
        .finalPriceCents,

    originalPrice:
      safePricing
        .originalPrice,

    price:
      safePricing
        .finalPrice,

    hasDiscount:
      safePricing
        .hasDiscount,

    discountPercent:
      safePricing
        .discountPercent,

    totalDiscountPercent:
      safePricing
        .totalDiscountPercent,

    platformDiscountPercent:
      safePricing
        .platformDiscountPercent,

    vendorDiscountPercent:
      safePricing
        .vendorDiscountPercent,

    hasActiveHomepageDiscount:
      safePricing
        .hasActiveHomepageDiscount,

    promoLabel:
      safePricing
        .promoLabel,

    promoFundingSource:
      safePricing
        .promoFundingSource,

    promoCollectionId:
      safePricing
        .promoCollectionId,

    discount:
      safePricing
        .discount,
  };
}

/* =========================================================
   HELPER COMPLET PENTRU LISTE
========================================================= */

export async function applyPromotionsToProducts(
  products = [],
  options = {}
) {
  if (
    !Array.isArray(
      products
    ) ||
    !products.length
  ) {
    return [];
  }

  const pricingMap =
    await getPromotionPricingForProducts(
      products,
      options
    );

  return products.map(
    (product) =>
      applyPromotionPricingToProduct(
        product,
        pricingMap.get(
          product.id
        )
      )
  );
}