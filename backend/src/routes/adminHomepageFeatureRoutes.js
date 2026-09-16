// backend/src/routes/adminHomepageFeatureRoutes.js

import express from "express";
import { toFile } from "openai/uploads";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  generateHomepageSchedule,
  notifyVendorAboutFeatureCreated,
  getDayRange,
  getWeekRange,
  getDayKey,
  getWeekKey,
} from "../services/homepageFeatureScheduler.js";

import { openai } from "../lib/openai.js";

import {
  uploadToR2,
} from "../services/r2Storage.js";

import {
  composeProductOfDayImage,
  buildProductOfDayBackgroundPrompt,
} from "../services/productOfDayTemplate.js";

import {
  calculateProductPromotionPricing,
} from "../services/productPromotionPrice.js";

const router = express.Router();

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
   INCLUDE PRISMA
========================================================= */

const vendorSelectForFeature = {
  id: true,
  displayName: true,
  logoUrl: true,
  coverUrl: true,
  city: true,
  email: true,
  userId: true,

  user: {
    select: {
      email: true,
      firstName: true,
      lastName: true,
      name: true,
    },
  },
};

const featureInclude = {
  product: {
    include: {
      service: {
        include: {
          profile: true,

          vendor: {
            select:
              vendorSelectForFeature,
          },
        },
      },
    },
  },

  service: {
    include: {
      profile: true,

      vendor: {
        select:
          vendorSelectForFeature,
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
    select:
      vendorSelectForFeature,
  },
};
/* =========================================================
   HELPERS
========================================================= */

function clampTake(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
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
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const rounded = Math.round(numeric);

  if (!ALLOWED_DISCOUNTS.has(rounded)) {
    return null;
  }

  return rounded;
}

function parseDateInput(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const [year, month, day] =
    value.split("-").map(Number);

  const date = new Date(
    year,
    month - 1,
    day,
    0,
    0,
    0,
    0
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/*
 * Audit promoții 2026-09-15: getDayKey/getWeekKey/getDayRange/
 * getWeekRange erau duplicate identice ale celor din
 * homepageFeatureScheduler.js (aceeași greșeală de timezone -
 * oră locală server, nu Europe/Bucharest explicit). Importate
 * acum din sursa unică centralizată (lib/bucharestDate.js, prin
 * homepageFeatureScheduler.js) - nicio schimbare de semnătură
 * pentru codul de mai jos.
 */

function formatRomanianDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year}, ${hours}:${minutes}`;
}

/*
 * Descarcă poza originală a produsului și o pregătește pentru
 * OpenAI images.edit (are nevoie de un File, nu de un URL brut).
 * Variantă locală a helperului din aiRoutes.js, ca ruta homepage-
 * features să nu depindă de acel fișier (izolare cerută explicit).
 */
async function fetchImageAsOpenAIFile(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(
      "Nu am putut descărca imaginea produsului."
    );
  }

  const contentType =
    response.headers.get("content-type") ||
    "image/png";

  if (!contentType.startsWith("image/")) {
    throw new Error(
      "Imaginea produsului nu este validă."
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return toFile(buffer, "product-of-day-source.png", {
    type: contentType,
  });
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
  return type === "PRODUCT_OF_DAY"
    ? "Există deja un Produs al zilei programat pentru data selectată."
    : "Există deja un Artizan al săptămânii programat pentru săptămâna selectată.";
}

function resetVendorResponseData() {
  return {
    vendorDiscountPercent: 0,
    vendorDiscountStatus: "PENDING",
    vendorDiscountRespondedAt: null,
    vendorNotifiedAt: null,
    vendorEmailedAt: null,
    vendorEmailError: null,
  };
}

async function findEligibleProduct(
  productId
) {
  if (
    !productId ||
    typeof productId !== "string"
  ) {
    return null;
  }

  return prisma.product.findFirst({
    where: {
      id: productId,

      isActive: true,
      isHidden: false,

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
        isActive: true,
        status: "ACTIVE",

        vendor: {
          isActive: true,
        },
      },
    },

    include: {
      service: {
        select: {
          id: true,
          vendorId: true,
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
    typeof serviceId !== "string"
  ) {
    return null;
  }

  return prisma.vendorService.findFirst({
    where: {
      id: serviceId,

      isActive: true,
      status: "ACTIVE",

      vendor: {
        isActive: true,
      },

      products: {
        some: {
          isActive: true,
          isHidden: false,

          moderationStatus:
            "APPROVED",
        },
      },
    },

    select: {
      id: true,
      vendorId: true,
    },
  });
}

/*
 * Audit promoții 2026-09-15: sendVendorNotificationSafely era
 * duplicatul local (notificare in-app idempotentă + email vendor,
 * fără să blocheze generarea feature-ului) al logicii mutate acum
 * în notifyVendorAboutFeatureCreated (homepageFeatureScheduler.js),
 * unde e apelată automat la creare. Ruta de mai jos (retrimitere
 * manuală invitație) refolosește aceeași funcție unică.
 */
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
              startsAt: "asc",
            },
            {
              createdAt: "desc",
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

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut încărca promovările homepage.",
      });
    }
  }
);

/* =========================================================
   GENERARE AUTOMATĂ CALENDAR
========================================================= */

/**
 * POST /api/admin/homepage-features/generate
 *
 * Body opțional:
 *
 * {
 *   productDays: 14,
 *   artisanWeeks: 4,
 *   platformDiscountPercent: 5
 * }
 *
 * Completează numai perioadele lipsă.
 * Nu trimite notificări automat.
 */
router.post(
  "/generate",
  async (req, res) => {
    try {
      const productDays = Math.min(
        90,
        Math.max(
          1,
          Math.round(
            Number(
              req.body?.productDays ||
                14
            )
          )
        )
      );

      const artisanWeeks = Math.min(
        26,
        Math.max(
          1,
          Math.round(
            Number(
              req.body?.artisanWeeks ||
                4
            )
          )
        )
      );

      const rawDiscount =
        req.body
          ?.platformDiscountPercent;

      let platformDiscountPercent;

      if (
        rawDiscount !== undefined &&
        rawDiscount !== null &&
        rawDiscount !== ""
      ) {
        platformDiscountPercent =
          normalizeDiscount(
            rawDiscount
          );

        if (
          platformDiscountPercent ===
          null
        ) {
          return res.status(400).json({
            ok: false,

            message:
              "Reducerea Artfest trebuie să fie 0%, 5%, 10%, 15% sau 20%.",
          });
        }
      }

      const result =
        await generateHomepageSchedule({
          startDate:
            new Date(),

          productDays,
          artisanWeeks,

          ...(platformDiscountPercent !==
          undefined
            ? {
                platformDiscountPercent,
              }
            : {}),
        });

      return res.status(201).json({
        ok: true,

        message:
          "Calendarul de promovări a fost completat.",

        ...result,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] generate",
        error
      );

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut genera calendarul de promovări.",
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
      const q = String(
        req.query.q || ""
      ).trim();

      const take =
        clampTake(
          req.query.take
        );

      const products =
        await prisma.product.findMany({
          where: {
            isActive: true,
            isHidden: false,

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
              isActive: true,
              status: "ACTIVE",

              vendor: {
                isActive: true,
              },
            },

            ...(q
              ? {
                  OR: [
                    {
                      title: {
                        contains: q,
                        mode: "insensitive",
                      },
                    },

                    {
                      category: {
                        contains: q,
                        mode: "insensitive",
                      },
                    },

                    {
                      service: {
                        title: {
                          contains: q,
                          mode: "insensitive",
                        },
                      },
                    },

                    {
                      service: {
                        profile: {
                          displayName: {
                            contains: q,
                            mode: "insensitive",
                          },
                        },
                      },
                    },

                    {
                      service: {
                        vendor: {
                          displayName: {
                            contains: q,
                            mode: "insensitive",
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
                profile: true,

                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                    logoUrl: true,
                    city: true,
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt: "desc",
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

      return res.status(500).json({
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
      const q = String(
        req.query.q || ""
      ).trim();

      const take =
        clampTake(
          req.query.take
        );

      const artisans =
        await prisma.vendorService.findMany({
          where: {
            isActive: true,
            status: "ACTIVE",

            vendor: {
              isActive: true,
            },

            products: {
              some: {
                isActive: true,
                isHidden: false,

                moderationStatus:
                  "APPROVED",
              },
            },

            ...(q
              ? {
                  OR: [
                    {
                      title: {
                        contains: q,
                        mode: "insensitive",
                      },
                    },

                    {
                      city: {
                        contains: q,
                        mode: "insensitive",
                      },
                    },

                    {
                      profile: {
                        displayName: {
                          contains: q,
                          mode: "insensitive",
                        },
                      },
                    },

                    {
                      vendor: {
                        displayName: {
                          contains: q,
                          mode: "insensitive",
                        },
                      },
                    },
                  ],
                }
              : {}),
          },

          include: {
            profile: true,

            vendor: {
              select: {
                id: true,
                displayName: true,
                logoUrl: true,
                coverUrl: true,
                city: true,
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

          orderBy: {
            createdAt: "desc",
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

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut căuta artizanii.",
      });
    }
  }
);

/* =========================================================
   CREARE / ÎNLOCUIRE MANUALĂ PRODUSUL ZILEI
========================================================= */

/**
 * Păstrăm ruta pentru compatibilitate cu
 * formularul actual și pentru schimbări manuale.
 *
 * Nu trimite automat notificarea vendorului.
 */
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
      } = getDayRange(
        parsedDate
      );

      const advanceError =
        validateAdvance({
          startsAt,
          force,
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
        getDayKey(
          startsAt
        );

      const existing =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "PRODUCT_OF_DAY",

              dateKey,
            },
          },
        });

      const selectionChanged =
        Boolean(
          existing &&
            (
              existing.productId !==
                product.id ||
              existing.serviceId !==
                product.service.id ||
              existing.vendorId !==
                product.service.vendorId
            )
        );

      const feature =
        existing
          ? await prisma.homepageFeature.update({
              where: {
                id: existing.id,
              },

              data: {
                source: "MANUAL",

                productId:
                  product.id,

                serviceId:
                  product.service.id,

                vendorId:
                  product.service
                    .vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...(selectionChanged
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
                source: "MANUAL",

                productId:
                  product.id,

                serviceId:
                  product.service.id,

                vendorId:
                  product.service
                    .vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...resetVendorResponseData(),
              },

              include:
                featureInclude,
            });

      return res
        .status(
          existing
            ? 200
            : 201
        )
        .json({
          ok: true,
          feature,
        });
    } catch (error) {
      console.error(
        "[admin-homepage-features] product",
        error
      );

      if (error?.code === "P2002") {
        return res.status(409).json({
          ok: false,

          message:
            buildDuplicateMessage(
              "PRODUCT_OF_DAY"
            ),
        });
      }

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut salva Produsul zilei.",
      });
    }
  }
);

/* =========================================================
   CREARE / ÎNLOCUIRE MANUALĂ ARTIZAN
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
          .status(
            advanceError.status
          )
          .json(
            advanceError.body
          );
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
        getWeekKey(
          startsAt
        );

      const existing =
        await prisma.homepageFeature.findUnique({
          where: {
            type_dateKey: {
              type:
                "ARTISAN_OF_WEEK",

              dateKey,
            },
          },
        });

      const selectionChanged =
        Boolean(
          existing &&
            (
              existing.serviceId !==
                service.id ||
              existing.vendorId !==
                service.vendorId
            )
        );

      const feature =
        existing
          ? await prisma.homepageFeature.update({
              where: {
                id: existing.id,
              },

              data: {
                source: "MANUAL",

                productId: null,

                serviceId:
                  service.id,

                vendorId:
                  service.vendorId,

                startsAt,
                endsAt,

                platformDiscountPercent:
                  discount,

                ...(selectionChanged
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
                source: "MANUAL",

                productId: null,

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

      return res
        .status(
          existing
            ? 200
            : 201
        )
        .json({
          ok: true,
          feature,
        });
    } catch (error) {
      console.error(
        "[admin-homepage-features] artisan",
        error
      );

      if (error?.code === "P2002") {
        return res.status(409).json({
          ok: false,

          message:
            buildDuplicateMessage(
              "ARTISAN_OF_WEEK"
            ),
        });
      }

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut salva Artizanul săptămânii.",
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
              req.body?.force === true,
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
                not: id,
              },
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

        const selectionChanged =
          existing.productId !==
            product.id ||
          existing.serviceId !==
            product.service.id ||
          existing.vendorId !==
            product.service.vendorId;

        const feature =
          await prisma.homepageFeature.update({
            where: {
              id,
            },

            data: {
              dateKey,
              source: "MANUAL",

              productId:
                product.id,

              serviceId:
                product.service.id,

              vendorId:
                product.service
                  .vendorId,

              startsAt,
              endsAt,

              platformDiscountPercent:
                discount,

              ...(selectionChanged
                ? resetVendorResponseData()
                : {}),
            },

            include:
              featureInclude,
          });

        return res.json({
          ok: true,
          feature,
        });
      }

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
          req.body?.weekStartDate
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
            req.body?.force === true,
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
              not: id,
            },
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

      const selectionChanged =
        existing.serviceId !==
          service.id ||
        existing.vendorId !==
          service.vendorId;

      const feature =
        await prisma.homepageFeature.update({
          where: {
            id,
          },

          data: {
            dateKey,
            source: "MANUAL",

            productId: null,

            serviceId:
              service.id,

            vendorId:
              service.vendorId,

            startsAt,
            endsAt,

            platformDiscountPercent:
              discount,

            ...(selectionChanged
              ? resetVendorResponseData()
              : {}),
          },

          include:
            featureInclude,
        });

      return res.json({
        ok: true,
        feature,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] update",
        error
      );

      if (error?.code === "P2002") {
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
   TRIMITERE NOTIFICARE VENDOR
========================================================= */

/**
 * POST /api/admin/homepage-features/:id/send-notification
 *
 * Notificarea pleacă numai după ce adminul
 * verifică selecția și reducerea.
 */
router.post(
  "/:id/send-notification",
  async (req, res) => {
    try {
      const id = String(
        req.params.id || ""
      ).trim();

      if (!id) {
        return res.status(400).json({
          ok: false,

          message:
            "ID-ul promovării nu este valid.",
        });
      }

      const feature =
        await prisma.homepageFeature.findUnique({
          where: {
            id,
          },

          include:
            featureInclude,
        });

      if (!feature) {
        return res.status(404).json({
          ok: false,

          message:
            "Promovarea nu există.",
        });
      }

      if (!feature.vendorId) {
        return res.status(409).json({
          ok: false,

          message:
            "Promovarea nu are un vendor asociat.",
        });
      }

      const result =
  await notifyVendorAboutFeatureCreated(
    feature
  );

      const updated =
        await prisma.homepageFeature.findUnique({
          where: {
            id: feature.id,
          },

          include:
            featureInclude,
        });
if (
  !result.notificationSent &&
  !result.emailSent &&
  !result.emailSkipped &&
  !feature.vendorNotifiedAt
) {
  return res.status(500).json({
    ok: false,

    message:
      "Promovarea există, dar notificarea și emailul nu au putut fi trimise.",

    notificationError:
      result.notificationError
        ?.message ||
      null,

    emailError:
      result.emailError
        ?.message ||
      null,

    feature:
      updated,
  });
}

      const notificationDone =
  result.notificationSent ||
  Boolean(
    feature.vendorNotifiedAt
  );

const emailDone =
  result.emailSent ||
  result.emailSkipped ||
  Boolean(
    feature.vendorEmailedAt
  );

let message =
  "Trimiterea a fost procesată.";

if (
  notificationDone &&
  emailDone
) {
  message =
    result.emailSkipped
      ? "Vendorul fusese deja notificat și emailul fusese deja trimis."
      : "Notificarea și emailul au fost trimise vendorului.";
} else if (
  notificationDone
) {
  message =
    "Notificarea a fost trimisă, dar emailul nu a putut fi trimis.";
} else if (
  emailDone
) {
  message =
    "Emailul a fost trimis, dar notificarea din platformă nu a putut fi creată.";
}

return res.json({
  ok:
    notificationDone ||
    emailDone,

  created:
    Boolean(
      result.notification
    ),

  notificationSent:
    notificationDone,

  emailSent:
    emailDone,

  emailError:
    result.emailError
      ?.message ||
    updated
      ?.vendorEmailError ||
    null,

  message,

  feature:
    updated,
});
    } catch (error) {
      console.error(
        "[admin-homepage-features] send notification",
        error
      );

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut trimite notificarea vendorului.",
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
      const id = String(
        req.params.id || ""
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
            id: true,
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

/* =========================================================
   GENERARE IMAGINE - PRODUSUL ZILEI
========================================================= */

/**
 * POST /api/admin/homepage-features/:id/generate-image
 *
 * Generează (sau regenerează) materialul social media 1:1 pentru
 * un feature de tip PRODUCT_OF_DAY, pornind STRICT de la poza reală
 * a produsului asociat acelui feature (citit din DB, nu primit din
 * body - nu acceptă productId arbitrar din frontend).
 *
 * Aceeași rută servește și Generate și Regenerate: rezultatul
 * suprascrie generatedImageUrl/generatedImageGeneratedAt, fără
 * istoric de versiuni. Vechiul obiect din R2 (dacă exista) NU este
 * șters, ca să nu complicăm fluxul în această primă versiune.
 */
router.post(
  "/:id/generate-image",
  async (req, res) => {
    try {
      const id = String(
        req.params.id || ""
      ).trim();

      if (!id) {
        return res.status(400).json({
          ok: false,

          message:
            "ID-ul promovării nu este valid.",
        });
      }

      const feature =
        await prisma.homepageFeature.findUnique({
          where: {
            id,
          },

          include:
            featureInclude,
        });

      if (!feature) {
        return res.status(404).json({
          ok: false,

          message:
            "Promovarea nu există.",
        });
      }

      if (
        feature.type !==
        "PRODUCT_OF_DAY"
      ) {
        return res.status(400).json({
          ok: false,

          message:
            "Generarea de imagine este disponibilă doar pentru Produsul zilei.",
        });
      }

      if (!feature.product) {
        return res.status(404).json({
          ok: false,

          message:
            "Produsul asociat acestei promovări nu mai există.",
        });
      }

      /*
       * TIME GUARD - sursa de adevăr este feature.startsAt din DB,
       * nu starea butonului din frontend. Un feature UPCOMING nu
       * poate genera imaginea încă; ACTIVE și PAST sunt permise
       * (regenerarea din istoric e permisă la nivel de backend -
       * frontendul cere doar o confirmare suplimentară pentru PAST).
       */
      const startsAtMs = new Date(
        feature.startsAt
      ).getTime();

      if (
        Number.isFinite(startsAtMs) &&
        Date.now() < startsAtMs
      ) {
        return res.status(409).json({
          ok: false,

          code:
            "FEATURE_NOT_ACTIVE_YET",

          message: `Acest Produs al zilei devine activ pe ${formatRomanianDateTime(
            feature.startsAt
          )}. Imaginea poate fi generată doar de la acel moment.`,
        });
      }

      const sourceImageUrl =
        Array.isArray(
          feature.product.images
        )
          ? feature.product.images.find(
              (url) =>
                typeof url === "string" &&
                /^https?:\/\//i.test(url)
            )
          : null;

      if (!sourceImageUrl) {
        return res.status(409).json({
          ok: false,

          code:
            "NO_PRODUCT_IMAGE",

          message:
            "Produsul nu are o imagine validă pentru generarea materialului.",
        });
      }

      const imageFile =
        await fetchImageAsOpenAIFile(
          sourceImageUrl
        );

      const result =
        await openai.images.edit({
          model:
            "gpt-image-1",

          image:
            imageFile,

          prompt:
            buildProductOfDayBackgroundPrompt(),

          size:
            "1024x1536",

          quality:
            "high",
        });

      const b64 =
        result.data?.[0]?.b64_json;

      if (!b64) {
        return res.status(500).json({
          ok: false,

          code:
            "NO_IMAGE_GENERATED",

          message:
            "OpenAI nu a returnat imaginea generată.",
        });
      }

      const aiImageBuffer =
        Buffer.from(b64, "base64");

      /*
       * Preț/reducere - EXACT formula folosită de homepage/pricing
       * (calculateProductPromotionPricing), nu recalculăm nimic
       * separat. vendorDiscountPercent contează doar dacă vendorul
       * a acceptat explicit (identic cu homepageFeatureToPromotion
       * din productPromotionPrice.js).
       */
      const platformDiscountPercent =
        Math.min(
          100,
          Math.max(
            0,
            Math.round(
              Number(
                feature.platformDiscountPercent
              ) || 0
            )
          )
        );

      const vendorDiscountPercent =
        feature.vendorDiscountStatus ===
        "ACCEPTED"
          ? Math.min(
              100,
              Math.max(
                0,
                Math.round(
                  Number(
                    feature.vendorDiscountPercent
                  ) || 0
                )
              )
            )
          : 0;

      const totalDiscountPercent =
        Math.min(
          100,
          platformDiscountPercent +
            vendorDiscountPercent
        );

      const promotion =
        totalDiscountPercent > 0
          ? {
              active: true,
              source: "PRODUCT_OF_DAY",
              label: "Produsul zilei",
              totalDiscountPercent,
              platformDiscountPercent,
              vendorDiscountPercent,
            }
          : null;

      const pricing =
        calculateProductPromotionPricing(
          feature.product,
          promotion
        );

      const isQuoteOnly =
        feature.product.orderMode ===
        "QUOTE_ONLY";

      const vendorName =
        feature.product.service
          ?.profile?.displayName ||
        feature.product.service
          ?.vendor?.displayName ||
        feature.product.service
          ?.title ||
        "";

      const finalImageBuffer =
        await composeProductOfDayImage({
          aiImageBuffer,
          title:
            feature.product.title,
          vendorName,
          pricing,
          isQuoteOnly,
        });

      const uploaded =
        await uploadToR2({
          file: {
            buffer:
              finalImageBuffer,

            mimetype:
              "image/png",

            originalname: `product-of-day-${feature.id}-${Date.now()}.png`,
          },

          folder:
            "product-of-day",

          userId:
            feature.id,
        });

      const updated =
        await prisma.homepageFeature.update({
          where: {
            id: feature.id,
          },

          data: {
            generatedImageUrl:
              uploaded.url,

            generatedImageGeneratedAt:
              new Date(),
          },

          include:
            featureInclude,
        });

      return res.json({
        ok: true,
        feature: updated,
      });
    } catch (error) {
      console.error(
        "[admin-homepage-features] generate-image",
        error
      );

      return res.status(500).json({
        ok: false,

        message:
          "Nu am putut genera imaginea pentru Produsul zilei.",
      });
    }
  }
);

export default router;