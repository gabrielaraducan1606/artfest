// backend/src/routes/homepagePublicRoutes.js

import express from "express";

import {
  prisma,
} from "../db.js";

import {
  artisanFeatureInclude,
  ensureCurrentArtisanFeature,
  ensureCurrentProductFeature,
  getDayKey,
  getWeekKey,
  productFeatureInclude,
} from "../services/homepageFeatureScheduler.js";

const router =
  express.Router();

/* =========================================================
   HELPERS REDUCERI
========================================================= */

function clampDiscountPercent(
  value
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return 0;
  }

  return Math.min(
    50,
    Math.max(
      0,
      Math.round(
        numericValue
      )
    )
  );
}

function buildDiscountPayload(
  feature
) {
  const platformDiscountPercent =
    clampDiscountPercent(
      feature
        ?.platformDiscountPercent
    );

  const vendorDiscountPercent =
    clampDiscountPercent(
      feature
        ?.vendorDiscountPercent
    );

  const totalDiscountPercent =
    Math.min(
      50,
      platformDiscountPercent +
        vendorDiscountPercent
    );

  const now =
    new Date();

  const startsAt =
    feature?.startsAt
      ? new Date(
          feature.startsAt
        )
      : null;

  const endsAt =
    feature?.endsAt
      ? new Date(
          feature.endsAt
        )
      : null;

  const active =
    Boolean(
      startsAt &&
        endsAt &&
        startsAt <= now &&
        endsAt > now
    );

 return {
  platformDiscountPercent,
  vendorDiscountPercent,
  totalDiscountPercent,

  vendorDiscountStatus:
    feature
      ?.vendorDiscountStatus ||
    "PENDING",

  vendorDiscountRespondedAt:
    feature
      ?.vendorDiscountRespondedAt ||
    null,

  startsAt:
    feature?.startsAt ||
    null,

  endsAt:
    feature?.endsAt ||
    null,

  active,
};
}

function applyFeatureDiscountToProduct(
  product,
  feature
) {
  if (!product) {
    return null;
  }

  const discount =
    buildDiscountPayload(
      feature
    );

  const originalPriceCents =
    Math.max(
      0,
      Number(
        product.priceCents ||
          0
      )
    );

  /*
   * Produsele QUOTE_ONLY nu au un preț
   * final fix, deci nu aplicăm reducerea.
   */
  const eligible =
    product.orderMode !==
    "QUOTE_ONLY";

  const discountedPriceCents =
    eligible &&
    discount.active &&
    discount.totalDiscountPercent >
      0
      ? Math.max(
          0,
          Math.round(
            originalPriceCents *
              (
                100 -
                discount.totalDiscountPercent
              ) /
              100
          )
        )
      : originalPriceCents;

  return {
    ...product,

    originalPriceCents,
    discountedPriceCents,

    /*
     * Aliasuri utile pentru paginile care
     * vor folosi denumirea finalPriceCents.
     */
    finalPriceCents:
      discountedPriceCents,

    platformDiscountPercent:
      discount
        .platformDiscountPercent,

    vendorDiscountPercent:
      discount
        .vendorDiscountPercent,

    totalDiscountPercent:
      discount
        .totalDiscountPercent,

    hasActiveHomepageDiscount:
      eligible &&
      discount.active &&
      discount.totalDiscountPercent >
        0,

    discount: {
      ...discount,
      eligible,
    },
  };
}

function applyFeatureDiscountToArtisan(
  service,
  feature
) {
  if (!service) {
    return null;
  }

  return {
    ...service,

    products:
      Array.isArray(
        service.products
      )
        ? service.products.map(
            (product) =>
              applyFeatureDiscountToProduct(
                product,
                feature
              )
          )
        : service.products,

    discount:
      buildDiscountPayload(
        feature
      ),
  };
}

function buildProductPayload(
  feature
) {
  if (
    !feature?.product
  ) {
    return null;
  }

  return {
    ok:
      true,

    feature: {
      id:
        feature.id,

      type:
        feature.type,

      source:
        feature.source,

      startsAt:
        feature.startsAt,

      endsAt:
        feature.endsAt,

      ...buildDiscountPayload(
        feature
      ),
    },

    product:
      applyFeatureDiscountToProduct(
        feature.product,
        feature
      ),
  };
}

function buildArtisanPayload(
  feature
) {
  if (
    !feature?.service
  ) {
    return null;
  }

  return {
    ok:
      true,

    feature: {
      id:
        feature.id,

      type:
        feature.type,

      source:
        feature.source,

      startsAt:
        feature.startsAt,

      endsAt:
        feature.endsAt,

      ...buildDiscountPayload(
        feature
      ),
    },

    artisan:
      applyFeatureDiscountToArtisan(
        feature.service,
        feature
      ),
  };
}

/* =========================================================
   ÎNCĂRCARE PRODUSUL ZILEI
========================================================= */

async function findCurrentProductFeature() {
  const dateKey =
    getDayKey(
      new Date()
    );

  if (!dateKey) {
    return null;
  }

  return prisma.homepageFeature.findUnique({
    where: {
      type_dateKey: {
        type:
          "PRODUCT_OF_DAY",

        dateKey,
      },
    },

    include:
      productFeatureInclude,
  });
}

/* =========================================================
   ÎNCĂRCARE ARTIZANUL SĂPTĂMÂNII
========================================================= */

async function findCurrentArtisanFeature() {
  const dateKey =
    getWeekKey(
      new Date()
    );

  if (!dateKey) {
    return null;
  }

  return prisma.homepageFeature.findUnique({
    where: {
      type_dateKey: {
        type:
          "ARTISAN_OF_WEEK",

        dateKey,
      },
    },

    include:
      artisanFeatureInclude,
  });
}

/* =========================================================
   GET /api/homepage/product-of-the-day
========================================================= */

router.get(
  "/product-of-the-day",
  async (_req, res) => {
    try {
      /*
       * Homepage-ul citește mai întâi selecția
       * din calendarul HomepageFeature.
       */
      let feature =
        await findCurrentProductFeature();

      /*
       * Fallback de siguranță:
       * dacă schedulerul nu a generat perioada
       * curentă, o generează acum prin serviciul
       * comun, nu printr-o logică duplicată.
       */
      if (
        !feature?.product
      ) {
        await ensureCurrentProductFeature();

        feature =
          await findCurrentProductFeature();
      }

      const payload =
        buildProductPayload(
          feature
        );

      if (!payload) {
        return res.status(
          404
        ).json({
          ok:
            false,

          message:
            "Nu există niciun produs eligibil pentru Produsul zilei.",
        });
      }

      return res.json(
        payload
      );
    } catch (error) {
      console.error(
        "[homepage] product-of-the-day",
        error
      );

      return res.status(
        500
      ).json({
        ok:
          false,

        message:
          "Nu am putut încărca Produsul zilei.",
      });
    }
  }
);

/* =========================================================
   GET /api/homepage/artisan-of-the-week
========================================================= */

router.get(
  "/artisan-of-the-week",
  async (_req, res) => {
    try {
      let feature =
        await findCurrentArtisanFeature();

      if (
        !feature?.service
      ) {
        await ensureCurrentArtisanFeature();

        feature =
          await findCurrentArtisanFeature();
      }

      const payload =
        buildArtisanPayload(
          feature
        );

      if (!payload) {
        return res.status(
          404
        ).json({
          ok:
            false,

          message:
            "Nu există niciun artizan eligibil pentru Artizanul săptămânii.",
        });
      }

      return res.json(
        payload
      );
    } catch (error) {
      console.error(
        "[homepage] artisan-of-the-week",
        error
      );

      return res.status(
        500
      ).json({
        ok:
          false,

        message:
          "Nu am putut încărca Artizanul săptămânii.",
      });
    }
  }
);

export default router;