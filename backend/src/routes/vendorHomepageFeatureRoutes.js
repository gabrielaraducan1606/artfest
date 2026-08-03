// backend/src/routes/vendorHomepageFeatureRoutes.js

import {
  Router,
} from "express";

import {
  prisma,
} from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

const router =
  Router();

const ALLOWED_VENDOR_DISCOUNTS =
  new Set([
    0,
    5,
    10,
    15,
    20,
  ]);

/*
 * Toate rutele:
 *
 * - necesită autentificare;
 * - necesită rol VENDOR;
 * - verifică tokenVersion.
 */
router.use(
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR")
);

/* =========================================================
   INCLUDE-URI PRISMA
========================================================= */

const vendorFeatureInclude = {
  product: {
    select: {
      id: true,
      title: true,
      slug: true,
      images: true,
      priceCents: true,
      currency: true,
      orderMode: true,
      availability: true,
      serviceId: true,
    },
  },

  service: {
    select: {
      id: true,
      title: true,
      description: true,
      city: true,
      mediaUrls: true,

      profile: {
        select: {
          displayName: true,
          slug: true,
          logoUrl: true,
          coverUrl: true,
          city: true,
        },
      },
    },
  },
};

/* =========================================================
   HELPERS
========================================================= */

/**
 * Obține vendorId pentru utilizatorul autentificat.
 *
 * Încercăm:
 * 1. req.user.vendorId;
 * 2. vendor după userId.
 */
async function getVendorIdForUser(
  req
) {
  if (
    req.user?.vendorId
  ) {
    return req.user.vendorId;
  }

  const userId =
    req.user?.id ||
    req.user?.sub;

  if (!userId) {
    console.warn(
      "[vendor-homepage-features] missing userId",
      JSON.stringify(
        req.user
      )
    );

    return null;
  }

  const vendor =
    await prisma.vendor.findUnique({
      where: {
        userId,
      },

      select: {
        id: true,
      },
    });

  return vendor?.id || null;
}

function normalizeVendorDiscount(
  value
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(
      numeric
    )
  ) {
    return null;
  }

  const rounded =
    Math.round(
      numeric
    );

  if (
    !ALLOWED_VENDOR_DISCOUNTS.has(
      rounded
    )
  ) {
    return null;
  }

  return rounded;
}

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
    50,
    Math.max(
      0,
      Math.round(
        numeric
      )
    )
  );
}

function buildFeaturePayload(
  feature
) {
  if (!feature) {
    return null;
  }

  const platformDiscountPercent =
    clampPercent(
      feature.platformDiscountPercent
    );

  const vendorDiscountPercent =
    clampPercent(
      feature.vendorDiscountPercent
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
    new Date(
      feature.startsAt
    );

  const endsAt =
    new Date(
      feature.endsAt
    );

  const isUpcoming =
    startsAt > now;

  const isActive =
    startsAt <= now &&
    endsAt > now;

  const isExpired =
    endsAt <= now;

  const canRespond =
    !isExpired;

  return {
    ...feature,

    platformDiscountPercent,
    vendorDiscountPercent,
    totalDiscountPercent,

    isUpcoming,
    isActive,
    isExpired,
    canRespond,

    responseRequired:
      feature.vendorDiscountStatus ===
      "PENDING",
  };
}

/* =========================================================
   GET /api/vendor/homepage-features
========================================================= */

/**
 * Returnează promovările vendorului autentificat.
 *
 * Query opțional:
 *
 * scope=all
 * scope=current
 * scope=upcoming
 * scope=pending
 * scope=expired
 */
router.get(
  "/",
  async (req, res) => {
    try {
      const vendorId =
        await getVendorIdForUser(
          req
        );

      if (!vendorId) {
        return res.status(
          403
        ).json({
          ok: false,
          error:
            "no_vendor_for_user",
        });
      }

      const scope =
        String(
          req.query.scope ||
            "all"
        ).trim();

      const now =
        new Date();

      const where = {
        vendorId,
      };

      if (
        scope ===
        "current"
      ) {
        where.startsAt = {
          lte: now,
        };

        where.endsAt = {
          gt: now,
        };
      } else if (
        scope ===
        "upcoming"
      ) {
        where.startsAt = {
          gt: now,
        };
      } else if (
        scope ===
        "pending"
      ) {
        where.endsAt = {
          gt: now,
        };

        where.vendorDiscountStatus =
          "PENDING";
      } else if (
        scope ===
        "expired"
      ) {
        where.endsAt = {
          lte: now,
        };
      }

      const features =
        await prisma.homepageFeature.findMany({
          where,

          include:
            vendorFeatureInclude,

          orderBy: [
            {
              startsAt:
                "asc",
            },

            {
              createdAt:
                "desc",
            },
          ],

          take:
            100,
        });

      return res.json({
        ok: true,

        features:
          features.map(
            buildFeaturePayload
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-homepage-features] list",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut încărca promovările tale.",
      });
    }
  }
);

/* =========================================================
   GET /api/vendor/homepage-features/:id
========================================================= */

/**
 * Returnează o singură promovare.
 *
 * Este folosită de modalul deschis din:
 *
 * - notificare;
 * - email;
 * - dashboard.
 */
router.get(
  "/:id",
  async (req, res) => {
    try {
      const vendorId =
        await getVendorIdForUser(
          req
        );

      if (!vendorId) {
        return res.status(
          403
        ).json({
          ok: false,
          error:
            "no_vendor_for_user",
        });
      }

      const feature =
        await prisma.homepageFeature.findFirst({
          where: {
            id:
              req.params.id,

            vendorId,
          },

          include:
            vendorFeatureInclude,
        });

      if (!feature) {
        return res.status(
          404
        ).json({
          ok: false,

          message:
            "Promovarea nu există sau nu îți aparține.",
        });
      }

      return res.json({
        ok: true,

        feature:
          buildFeaturePayload(
            feature
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-homepage-features] details",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut încărca promovarea.",
      });
    }
  }
);

/* =========================================================
   PATCH /api/vendor/homepage-features/:id/discount
========================================================= */

/**
 * Vendorul acceptă sau refuză reducerea suplimentară.
 *
 * Body:
 *
 * {
 *   "vendorDiscountPercent": 10
 * }
 *
 * Valori permise:
 *
 * 0, 5, 10, 15, 20
 *
 * 0%:
 * vendorDiscountStatus = DECLINED
 *
 * peste 0%:
 * vendorDiscountStatus = ACCEPTED
 */
router.patch(
  "/:id/discount",
  async (req, res) => {
    try {
      const vendorId =
        await getVendorIdForUser(
          req
        );

      if (!vendorId) {
        return res.status(
          403
        ).json({
          ok: false,
          error:
            "no_vendor_for_user",
        });
      }

      const vendorDiscountPercent =
        normalizeVendorDiscount(
          req.body
            ?.vendorDiscountPercent
        );

      if (
        vendorDiscountPercent ===
        null
      ) {
        return res.status(
          400
        ).json({
          ok: false,

          message:
            "Reducerea trebuie să fie 0%, 5%, 10%, 15% sau 20%.",
        });
      }

      const existing =
        await prisma.homepageFeature.findFirst({
          where: {
            id:
              req.params.id,

            vendorId,
          },

          select: {
            id: true,
            type: true,
            startsAt: true,
            endsAt: true,
            platformDiscountPercent:
              true,
            vendorDiscountPercent:
              true,
            vendorDiscountStatus:
              true,
          },
        });

      if (!existing) {
        return res.status(
          404
        ).json({
          ok: false,

          message:
            "Promovarea nu există sau nu îți aparține.",
        });
      }

      const now =
        new Date();

      if (
        new Date(
          existing.endsAt
        ) <= now
      ) {
        return res.status(
          409
        ).json({
          ok: false,

          code:
            "PROMOTION_EXPIRED",

          message:
            "Promovarea a expirat și reducerea nu mai poate fi modificată.",
        });
      }

      const platformDiscountPercent =
        clampPercent(
          existing.platformDiscountPercent
        );

      const totalDiscountPercent =
        platformDiscountPercent +
        vendorDiscountPercent;

      if (
        totalDiscountPercent >
        50
      ) {
        return res.status(
          400
        ).json({
          ok: false,

          code:
            "TOTAL_DISCOUNT_TOO_HIGH",

          message:
            "Reducerea totală nu poate depăși 50%.",
        });
      }

      const vendorDiscountStatus =
        vendorDiscountPercent > 0
          ? "ACCEPTED"
          : "DECLINED";

      const feature =
        await prisma.homepageFeature.update({
          where: {
            id:
              existing.id,
          },

          data: {
            vendorDiscountPercent,

            vendorDiscountStatus,

            vendorDiscountRespondedAt:
              new Date(),
          },

          include:
            vendorFeatureInclude,
        });

      return res.json({
        ok: true,

        message:
          vendorDiscountPercent >
          0
            ? "Reducerea suplimentară a fost salvată."
            : "Ai ales să nu oferi o reducere suplimentară.",

        feature:
          buildFeaturePayload(
            feature
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-homepage-features] update discount",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut salva reducerea.",
      });
    }
  }
);

/* =========================================================
   PATCH /api/vendor/homepage-features/:id/reopen
========================================================= */

/**
 * Permite vendorului să își schimbe alegerea
 * cât timp promovarea nu a expirat.
 *
 * Practic readuce statusul în PENDING și
 * procentul la 0.
 *
 * Poți să nu folosești această rută în frontend
 * dacă preferi ca vendorul să editeze direct
 * procentul prin ruta /discount.
 */
router.patch(
  "/:id/reopen",
  async (req, res) => {
    try {
      const vendorId =
        await getVendorIdForUser(
          req
        );

      if (!vendorId) {
        return res.status(
          403
        ).json({
          ok: false,
          error:
            "no_vendor_for_user",
        });
      }

      const existing =
        await prisma.homepageFeature.findFirst({
          where: {
            id:
              req.params.id,

            vendorId,
          },

          select: {
            id: true,
            endsAt: true,
          },
        });

      if (!existing) {
        return res.status(
          404
        ).json({
          ok: false,

          message:
            "Promovarea nu există sau nu îți aparține.",
        });
      }

      if (
        new Date(
          existing.endsAt
        ) <= new Date()
      ) {
        return res.status(
          409
        ).json({
          ok: false,

          message:
            "Promovarea a expirat.",
        });
      }

      const feature =
        await prisma.homepageFeature.update({
          where: {
            id:
              existing.id,
          },

          data: {
            vendorDiscountPercent:
              0,

            vendorDiscountStatus:
              "PENDING",

            vendorDiscountRespondedAt:
              null,
          },

          include:
            vendorFeatureInclude,
        });

      return res.json({
        ok: true,

        feature:
          buildFeaturePayload(
            feature
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-homepage-features] reopen",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut redeschide alegerea reducerii.",
      });
    }
  }
);

export default router;