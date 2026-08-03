/// backend/src/routes/adminHomepageFeatureRoutes.js

import express from "express";

import {
  prisma,
} from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  notifyVendorOnHomepageFeatureCreated,
} from "../services/notifications.js";

const router =
  express.Router();

const MIN_SCHEDULE_AHEAD_MS =
  24 * 60 * 60 * 1000;

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

const ALLOWED_DISCOUNTS = new Set([
  0,
  5,
  10,
  15,
  20,
]);

router.use(
  authRequired,
  enforceTokenVersion,
  requireRole("ADMIN")
);

/* =========================================================
   INCLUDE-URI
========================================================= */

const featureInclude = {
  product: {
    include: {
      service: {
        include: {
          profile: true,

          vendor: {
            select: {
              id: true,
              displayName: true,
              logoUrl: true,
              coverUrl: true,
              city: true,
              email: true,
              userId: true,
            },
          },
        },
      },
    },
  },

  service: {
    include: {
      profile: true,

      vendor: {
        select: {
          id: true,
          displayName: true,
          logoUrl: true,
          coverUrl: true,
          city: true,
          email: true,
          userId: true,
        },
      },

      _count: {
        select: {
          products: {
            where: {
              isActive: true,
              isHidden: false,
              moderationStatus:
                "APPROVED",
            },
          },
        },
      },
    },
  },

  vendor: {
    select: {
      id: true,
      displayName: true,
      logoUrl: true,
      coverUrl: true,
      city: true,
      email: true,
      userId: true,
    },
  },
};

/* =========================================================
   HELPERS
========================================================= */

function clampTake(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric)
  ) {
    return DEFAULT_TAKE;
  }

  return Math.min(
    MAX_TAKE,
    Math.max(
      1,
      Math.round(numeric)
    )
  );
}

function normalizeDiscount(value) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric)
  ) {
    return 0;
  }

  const rounded =
    Math.round(numeric);

  if (
    !ALLOWED_DISCOUNTS.has(
      rounded
    )
  ) {
    return null;
  }

  return rounded;
}

function parseDateInput(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return null;
  }

  const [
    year,
    month,
    day,
  ] = value
    .split("-")
    .map(Number);

  const date =
    new Date(
      year,
      month - 1,
      day,
      0,
      0,
      0,
      0
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  /*
   * Protecție suplimentară pentru date precum:
   * 2026-02-31, pe care JavaScript le-ar muta în martie.
   */
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getDayKey(date) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
}

function getWeekKey(date) {
  const d =
    new Date(
      Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      )
    );

  const dayNum =
    d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() +
      4 -
      dayNum
  );

  const yearStart =
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        0,
        1
      )
    );

  const weekNo =
    Math.ceil(
      (
        (
          d -
          yearStart
        ) /
          86400000 +
        1
      ) /
        7
    );

  return `${d.getUTCFullYear()}-W${String(
    weekNo
  ).padStart(
    2,
    "0"
  )}`;
}

function getDayRange(date) {
  const startsAt =
    new Date(date);

  startsAt.setHours(
    0,
    0,
    0,
    0
  );

  const endsAt =
    new Date(startsAt);

  endsAt.setDate(
    endsAt.getDate() + 1
  );

  return {
    startsAt,
    endsAt,
  };
}

function getWeekRange(date) {
  const startsAt =
    new Date(date);

  startsAt.setHours(
    0,
    0,
    0,
    0
  );

  const day =
    startsAt.getDay();

  const diffToMonday =
    day === 0
      ? -6
      : 1 - day;

  startsAt.setDate(
    startsAt.getDate() +
      diffToMonday
  );

  const endsAt =
    new Date(startsAt);

  endsAt.setDate(
    endsAt.getDate() + 7
  );

  return {
    startsAt,
    endsAt,
  };
}

function validateAdvance({
  startsAt,
  force,
}) {
  if (force === true) {
    return null;
  }

  const minimumStart =
    Date.now() +
    MIN_SCHEDULE_AHEAD_MS;

  if (
    startsAt.getTime() <
    minimumStart
  ) {
    return {
      status: 400,

      body: {
        ok: false,

        code:
          "PROMOTION_MUST_BE_SCHEDULED_IN_ADVANCE",

        message:
          "Promovarea trebuie programată cu cel puțin 24 de ore înainte.",
      },
    };
  }

  return null;
}

function buildDuplicateMessage(type) {
  return type ===
    "PRODUCT_OF_DAY"
    ? "Există deja un Produs al zilei programat pentru data selectată."
    : "Există deja un Artizan al săptămânii programat pentru săptămâna selectată.";
}

function resetVendorResponseData() {
  return {
    vendorDiscountPercent:
      0,

    vendorDiscountStatus:
      "PENDING",

    vendorDiscountRespondedAt:
      null,

    vendorNotifiedAt:
      null,

    vendorEmailedAt:
      null,

    vendorEmailError:
      null,
  };
}

async function notifyVendorSafely({
  featureId,
  context,
}) {
  try {
    const notification =
      await notifyVendorOnHomepageFeatureCreated(
        featureId
      );

    /*
     * Dacă notificarea a fost creată acum,
     * marcăm momentul trimiterii.
     *
     * Dacă funcția returnează null, notificarea
     * poate exista deja datorită dedupeKey.
     */
    if (notification) {
      await prisma.homepageFeature.update({
        where: {
          id: featureId,
        },

        data: {
          vendorNotifiedAt:
            new Date(),
        },
      });
    }

    return notification;
  } catch (error) {
    console.error(
      `[admin-homepage-features] ${context} notification failed`,
      error
    );

    /*
     * O eroare de notificare nu trebuie
     * să anuleze promovarea salvată.
     */
    return null;
  }
}

async function findEligibleProduct(
  productId
) {
  if (
    !productId ||
    typeof productId !==
      "string"
  ) {
    return null;
  }

  return prisma.product.findFirst({
    where: {
      id:
        productId,

      isActive:
        true,

      isHidden:
        false,

      moderationStatus:
        "APPROVED",

      availability: {
        in: [
          "READY",
          "MADE_TO_ORDER",
          "PREORDER",
        ],
      },

      service: {
        isActive:
          true,

        status:
          "ACTIVE",

        vendor: {
          isActive:
            true,
        },
      },
    },

    include: {
      service: {
        select: {
          id:
            true,

          vendorId:
            true,
        },
      },
    },
  });
}

async function findEligibleService(
  serviceId
) {
  if (
    !serviceId ||
    typeof serviceId !==
      "string"
  ) {
    return null;
  }

  return prisma.vendorService.findFirst({
    where: {
      id:
        serviceId,

      isActive:
        true,

      status:
        "ACTIVE",

      vendor: {
        isActive:
          true,
      },

      products: {
        some: {
          isActive:
            true,

          isHidden:
            false,

          moderationStatus:
            "APPROVED",
        },
      },
    },

    select: {
      id:
        true,

      vendorId:
        true,
    },
  });
}

/* =========================================================
   LISTĂ PROMOVĂRI
========================================================= */

router.get(
  "/",
  async (req, res) => {
    try {
      const take =
        clampTake(
          req.query.take
        );

      const features =
        await prisma.homepageFeature.findMany({
          include:
            featureInclude,

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

          take,
        });

      return res.json({
        ok: true,
        features,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] list",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut încărca promovările homepage.",
      });
    }
  }
);

/* =========================================================
   CĂUTARE PRODUSE
========================================================= */

router.get(
  "/products",
  async (req, res) => {
    try {
      const q =
        String(
          req.query.q ||
            ""
        ).trim();

      const take =
        clampTake(
          req.query.take
        );

      const products =
        await prisma.product.findMany({
          where: {
            isActive:
              true,

            isHidden:
              false,

            moderationStatus:
              "APPROVED",

            availability: {
              in: [
                "READY",
                "MADE_TO_ORDER",
                "PREORDER",
              ],
            },

            service: {
              isActive:
                true,

              status:
                "ACTIVE",

              vendor: {
                isActive:
                  true,
              },
            },

            ...(q
              ? {
                  OR: [
                    {
                      title: {
                        contains:
                          q,

                        mode:
                          "insensitive",
                      },
                    },

                    {
                      category: {
                        contains:
                          q,

                        mode:
                          "insensitive",
                      },
                    },

                    {
                      service: {
                        title: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },
                    },

                    {
                      service: {
                        profile: {
                          displayName: {
                            contains:
                              q,

                            mode:
                              "insensitive",
                          },
                        },
                      },
                    },

                    {
                      service: {
                        vendor: {
                          displayName: {
                            contains:
                              q,

                            mode:
                              "insensitive",
                          },
                        },
                      },
                    },
                  ],
                }
              : {}),
          },

          include: {
            service: {
              include: {
                profile:
                  true,

                vendor: {
                  select: {
                    id:
                      true,

                    displayName:
                      true,

                    logoUrl:
                      true,

                    city:
                      true,
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt:
              "desc",
          },

          take,
        });

      return res.json({
        ok: true,
        products,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] products",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut căuta produsele.",
      });
    }
  }
);

/* =========================================================
   CĂUTARE ARTIZANI
========================================================= */

router.get(
  "/artisans",
  async (req, res) => {
    try {
      const q =
        String(
          req.query.q ||
            ""
        ).trim();

      const take =
        clampTake(
          req.query.take
        );

      const artisans =
        await prisma.vendorService.findMany({
          where: {
            isActive:
              true,

            status:
              "ACTIVE",

            vendor: {
              isActive:
                true,
            },

            products: {
              some: {
                isActive:
                  true,

                isHidden:
                  false,

                moderationStatus:
                  "APPROVED",
              },
            },

            ...(q
              ? {
                  OR: [
                    {
                      title: {
                        contains:
                          q,

                        mode:
                          "insensitive",
                      },
                    },

                    {
                      city: {
                        contains:
                          q,

                        mode:
                          "insensitive",
                      },
                    },

                    {
                      profile: {
                        displayName: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },
                    },

                    {
                      vendor: {
                        displayName: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },
                    },
                  ],
                }
              : {}),
          },

          include: {
            profile:
              true,

            vendor: {
              select: {
                id:
                  true,

                displayName:
                  true,

                logoUrl:
                  true,

                coverUrl:
                  true,

                city:
                  true,
              },
            },

            _count: {
              select: {
                products: {
                  where: {
                    isActive:
                      true,

                    isHidden:
                      false,

                    moderationStatus:
                      "APPROVED",
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt:
              "desc",
          },

          take,
        });

      return res.json({
        ok: true,
        artisans,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] artisans",
        error
      );

      return res.status(
        500
      ).json({
        ok: false,

        message:
          "Nu am putut căuta artizanii.",
      });
    }
  }
);

/* =========================================================
   PROGRAMARE PRODUSUL ZILEI
========================================================= */

router.post(
  "/product",
  async (req, res) => {
    try {
      const {
        date,
        productId,
        platformDiscountPercent,
        force = false,
      } = req.body || {};

      const parsedDate =
        parseDateInput(date);

      if (!parsedDate) {
        return res.status(400).json({
          ok: false,
          message:
            "Data promovării nu este validă.",
        });
      }

      const discount =
        normalizeDiscount(
          platformDiscountPercent
        );

      if (discount === null) {
        return res.status(400).json({
          ok: false,
          message:
            "Reducerea Artfest trebuie să fie 0%, 5%, 10%, 15% sau 20%.",
        });
      }

      const {
        startsAt,
        endsAt,
      } = getDayRange(parsedDate);

      const advanceError =
        validateAdvance({
          startsAt,
          force,
        });

      if (advanceError) {
        return res
          .status(advanceError.status)
          .json(advanceError.body);
      }

      const product =
        await findEligibleProduct(
          productId
        );

      if (!product) {
        return res.status(404).json({
          ok: false,
          message:
            "Produsul nu există sau nu este eligibil.",
        });
      }

      const dateKey =
        getDayKey(startsAt);

      const existingFeature =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "PRODUCT_OF_DAY",
              dateKey,
            },
          },

          select: {
            id: true,
            vendorId: true,
            productId: true,
            serviceId: true,
          },
        });

      const vendorChanged =
        Boolean(
          existingFeature &&
            existingFeature.vendorId !==
              product.service.vendorId
        );

      const productChanged =
        Boolean(
          existingFeature &&
            existingFeature.productId !==
              product.id
        );

      const serviceChanged =
        Boolean(
          existingFeature &&
            existingFeature.serviceId !==
              product.service.id
        );

      const shouldResetVendor =
        vendorChanged ||
        productChanged ||
        serviceChanged;

      const feature =
        existingFeature
          ? await prisma.homepageFeature.update({
              where: {
                id:
                  existingFeature.id,
              },

              data: {
                source:
                  "MANUAL",

                productId:
                  product.id,

                serviceId:
                  product.service.id,

                vendorId:
                  product.service.vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...(shouldResetVendor
                  ? resetVendorResponseData()
                  : {}),
              },

              include:
                featureInclude,
            })
          : await prisma.homepageFeature.create({
              data: {
                type:
                  "PRODUCT_OF_DAY",

                dateKey,

                source:
                  "MANUAL",

                productId:
                  product.id,

                serviceId:
                  product.service.id,

                vendorId:
                  product.service.vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...resetVendorResponseData(),
              },

              include:
                featureInclude,
            });

      /*
       * Notificăm vendorul numai dacă:
       * - promovarea este nouă;
       * - produsul s-a schimbat;
       * - magazinul/vendorul s-a schimbat.
       */
      if (
        !existingFeature ||
        shouldResetVendor
      ) {
        await notifyVendorSafely({
          featureId:
            feature.id,

          context:
            "product",
        });
      }

      return res
        .status(
          existingFeature
            ? 200
            : 201
        )
        .json({
          ok: true,
          feature,
        });
    } catch (error) {
      console.error(
        "[admin-homepage-features] create product",
        error
      );

      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "Există deja un Produs al zilei programat pentru data selectată.",
        });
      }

      return res.status(500).json({
        ok: false,
        message:
          "Nu am putut programa Produsul zilei.",
      });
    }
  }
);

/* =========================================================
   PROGRAMARE ARTIZANUL SĂPTĂMÂNII
========================================================= */

router.post(
  "/artisan",
  async (req, res) => {
    try {
      const {
        weekStartDate,
        serviceId,
        platformDiscountPercent,
        force = false,
      } = req.body || {};

      const parsedDate =
        parseDateInput(
          weekStartDate
        );

      if (!parsedDate) {
        return res.status(400).json({
          ok: false,
          message:
            "Data de început nu este validă.",
        });
      }

      const discount =
        normalizeDiscount(
          platformDiscountPercent
        );

      if (discount === null) {
        return res.status(400).json({
          ok: false,
          message:
            "Reducerea Artfest trebuie să fie 0%, 5%, 10%, 15% sau 20%.",
        });
      }

      const {
        startsAt,
        endsAt,
      } = getWeekRange(
        parsedDate
      );

      const advanceError =
        validateAdvance({
          startsAt,
          force,
        });

      if (advanceError) {
        return res
          .status(advanceError.status)
          .json(advanceError.body);
      }

      const service =
        await findEligibleService(
          serviceId
        );

      if (!service) {
        return res.status(404).json({
          ok: false,
          message:
            "Magazinul nu există sau nu este eligibil.",
        });
      }

      const dateKey =
        getWeekKey(startsAt);

      const existingFeature =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "ARTISAN_OF_WEEK",
              dateKey,
            },
          },

          select: {
            id: true,
            vendorId: true,
            serviceId: true,
          },
        });

      const vendorChanged =
        Boolean(
          existingFeature &&
            existingFeature.vendorId !==
              service.vendorId
        );

      const serviceChanged =
        Boolean(
          existingFeature &&
            existingFeature.serviceId !==
              service.id
        );

      const shouldResetVendor =
        vendorChanged ||
        serviceChanged;

      const feature =
        existingFeature
          ? await prisma.homepageFeature.update({
              where: {
                id:
                  existingFeature.id,
              },

              data: {
                source:
                  "MANUAL",

                productId:
                  null,

                serviceId:
                  service.id,

                vendorId:
                  service.vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...(shouldResetVendor
                  ? resetVendorResponseData()
                  : {}),
              },

              include:
                featureInclude,
            })
          : await prisma.homepageFeature.create({
              data: {
                type:
                  "ARTISAN_OF_WEEK",

                dateKey,

                source:
                  "MANUAL",

                productId:
                  null,

                serviceId:
                  service.id,

                vendorId:
                  service.vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...resetVendorResponseData(),
              },

              include:
                featureInclude,
            });

      /*
       * Notificăm vendorul numai dacă:
       * - promovarea este nouă;
       * - artizanul/magazinul s-a schimbat;
       * - vendorul s-a schimbat.
       */
      if (
        !existingFeature ||
        shouldResetVendor
      ) {
        await notifyVendorSafely({
          featureId:
            feature.id,

          context:
            "artisan",
        });
      }

      return res
        .status(
          existingFeature
            ? 200
            : 201
        )
        .json({
          ok: true,
          feature,
        });
    } catch (error) {
      console.error(
        "[admin-homepage-features] create artisan",
        error
      );

      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "Există deja un Artizan al săptămânii programat pentru săptămâna selectată.",
        });
      }

      return res.status(500).json({
        ok: false,
        message:
          "Nu am putut programa Artizanul săptămânii.",
      });
    }
  }
);

/* =========================================================
   EDITARE PROGRAMARE
========================================================= */

router.patch(
  "/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const existing =
        await prisma.homepageFeature.findUnique({
          where: {
            id,
          },
        });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message:
            "Promovarea nu există.",
        });
      }

      const discount =
        normalizeDiscount(
          req.body
            ?.platformDiscountPercent
        );

      if (discount === null) {
        return res.status(400).json({
          ok: false,
          message:
            "Reducerea Artfest trebuie să fie 0%, 5%, 10%, 15% sau 20%.",
        });
      }

      /* =====================================================
         EDITARE PRODUSUL ZILEI
      ===================================================== */

      if (
        existing.type ===
        "PRODUCT_OF_DAY"
      ) {
        const parsedDate =
          parseDateInput(
            req.body?.date
          );

        if (!parsedDate) {
          return res.status(400).json({
            ok: false,
            message:
              "Data promovării nu este validă.",
          });
        }

        const {
          startsAt,
          endsAt,
        } = getDayRange(
          parsedDate
        );

        const advanceError =
          validateAdvance({
            startsAt,
            force:
              req.body
                ?.force ===
              true,
          });

        if (advanceError) {
          return res
            .status(
              advanceError.status
            )
            .json(
              advanceError.body
            );
        }

        const product =
          await findEligibleProduct(
            req.body?.productId
          );

        if (!product) {
          return res.status(404).json({
            ok: false,
            message:
              "Produsul nu există sau nu este eligibil.",
          });
        }

        const dateKey =
          getDayKey(
            startsAt
          );

        const conflict =
          await prisma.homepageFeature.findFirst({
            where: {
              type:
                "PRODUCT_OF_DAY",

              dateKey,

              id: {
                not:
                  id,
              },
            },

            select: {
              id:
                true,
            },
          });

        if (conflict) {
          return res.status(409).json({
            ok: false,
            message:
              buildDuplicateMessage(
                "PRODUCT_OF_DAY"
              ),
          });
        }

        const vendorChanged =
          existing.vendorId !==
          product.service.vendorId;

        const productChanged =
          existing.productId !==
          product.id;

        const serviceChanged =
          existing.serviceId !==
          product.service.id;

        const shouldResetVendor =
          vendorChanged ||
          productChanged ||
          serviceChanged;

        const feature =
          await prisma.homepageFeature.update({
            where: {
              id,
            },

            data: {
              dateKey,

              source:
                "MANUAL",

              productId:
                product.id,

              serviceId:
                product.service.id,

              vendorId:
                product.service.vendorId,

              startsAt,
              endsAt,

              platformDiscountPercent:
                discount,

              /*
               * Dacă ai schimbat produsul sau vendorul,
               * răspunsul vechiului vendor nu mai este valabil.
               */
              ...(shouldResetVendor
                ? resetVendorResponseData()
                : {}),
            },

            include:
              featureInclude,
          });

        if (
          shouldResetVendor
        ) {
          await notifyVendorSafely({
            featureId:
              feature.id,

            context:
              "product update",
          });
        }

        return res.json({
          ok: true,
          feature,
        });
      }

      /* =====================================================
         EDITARE ARTIZANUL SĂPTĂMÂNII
      ===================================================== */

      if (
        existing.type !==
        "ARTISAN_OF_WEEK"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Tipul promovării nu este valid.",
        });
      }

      const parsedDate =
        parseDateInput(
          req.body
            ?.weekStartDate
        );

      if (!parsedDate) {
        return res.status(400).json({
          ok: false,
          message:
            "Data de început nu este validă.",
        });
      }

      const {
        startsAt,
        endsAt,
      } = getWeekRange(
        parsedDate
      );

      const advanceError =
        validateAdvance({
          startsAt,
          force:
            req.body
              ?.force ===
            true,
        });

      if (advanceError) {
        return res
          .status(
            advanceError.status
          )
          .json(
            advanceError.body
          );
      }

      const service =
        await findEligibleService(
          req.body?.serviceId
        );

      if (!service) {
        return res.status(404).json({
          ok: false,
          message:
            "Magazinul nu există sau nu este eligibil.",
        });
      }

      const dateKey =
        getWeekKey(
          startsAt
        );

      const conflict =
        await prisma.homepageFeature.findFirst({
          where: {
            type:
              "ARTISAN_OF_WEEK",

            dateKey,

            id: {
              not:
                id,
            },
          },

          select: {
            id:
              true,
          },
        });

      if (conflict) {
        return res.status(409).json({
          ok: false,
          message:
            buildDuplicateMessage(
              "ARTISAN_OF_WEEK"
            ),
        });
      }

      const vendorChanged =
        existing.vendorId !==
        service.vendorId;

      const serviceChanged =
        existing.serviceId !==
        service.id;

      const shouldResetVendor =
        vendorChanged ||
        serviceChanged;

      const feature =
        await prisma.homepageFeature.update({
          where: {
            id,
          },

          data: {
            dateKey,

            source:
              "MANUAL",

            productId:
              null,

            serviceId:
              service.id,

            vendorId:
              service.vendorId,

            startsAt,
            endsAt,

            platformDiscountPercent:
              discount,

            /*
             * Păstrăm reducerea vendorului dacă ai
             * schimbat doar data sau procentul Artfest.
             */
            ...(shouldResetVendor
              ? resetVendorResponseData()
              : {}),
          },

          include:
            featureInclude,
        });

      if (
        shouldResetVendor
      ) {
        await notifyVendorSafely({
          featureId:
            feature.id,

          context:
            "artisan update",
        });
      }

      return res.json({
        ok: true,
        feature,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] update",
        error
      );

      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          ok: false,
          message:
            "Există deja o promovare pentru perioada selectată.",
        });
      }

      return res.status(500).json({
        ok: false,
        message:
          "Nu am putut actualiza promovarea.",
      });
    }
  }
);

/* =========================================================
   ȘTERGERE PROGRAMARE
========================================================= */

router.delete(
  "/:id",
  async (req, res) => {
    try {
      const id =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          message:
            "ID-ul promovării nu este valid.",
        });
      }

      const existing =
        await prisma.homepageFeature.findUnique({
          where: {
            id,
          },

          select: {
            id:
              true,
          },
        });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message:
            "Promovarea nu există.",
        });
      }

      await prisma.homepageFeature.delete({
        where: {
          id,
        },
      });

      return res.json({
        ok: true,
        deleted: true,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] delete",
        error
      );

      return res.status(500).json({
        ok: false,
        message:
          "Nu am putut șterge promovarea.",
      });
    }
  }
);

export default router;