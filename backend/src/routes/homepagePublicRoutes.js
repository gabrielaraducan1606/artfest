import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

const MIN_ARTISAN_PRODUCTS = 3;
const PRODUCT_REPEAT_DAYS = 30;
const ARTISAN_REPEAT_WEEKS = 12;
const FEATURE_CANDIDATE_LIMIT = 50;

/*
 * Cache în memoria backendului.
 *
 * Se golește automat dacă serverul repornește,
 * apoi se reconstruiește la prima cerere.
 */
const homepageCache = {
  product: {
    key: null,
    value: null,
  },

  artisan: {
    key: null,
    value: null,
  },
};

/* =========================================================
   HELPERS DATĂ
========================================================= */

function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getWeekKey(date = new Date()) {
  const d = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    )
  );

  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() + 4 - dayNum
  );

  const yearStart = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      0,
      1
    )
  );

  const weekNo = Math.ceil(
    (
      (d - yearStart) /
        86400000 +
      1
    ) / 7
  );

  return `${d.getUTCFullYear()}-W${String(
    weekNo
  ).padStart(2, "0")}`;
}

function getDayRange(date = new Date()) {
  const start = new Date(date);

  start.setHours(
    0,
    0,
    0,
    0
  );

  const end = new Date(start);

  end.setDate(
    end.getDate() + 1
  );

  return {
    startsAt: start,
    endsAt: end,
  };
}

function getWeekRange(date = new Date()) {
  const current = new Date(date);

  const day =
    current.getDay();

  const diff =
    current.getDate() -
    day +
    (day === 0 ? -6 : 1);

  const start =
    new Date(current);

  start.setDate(diff);

  start.setHours(
    0,
    0,
    0,
    0
  );

  const end =
    new Date(start);

  end.setDate(
    end.getDate() + 7
  );

  return {
    startsAt: start,
    endsAt: end,
  };
}

/* =========================================================
   HELPERS GENERALE
========================================================= */

function pickRandom(items) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return null;
  }

  return items[
    Math.floor(
      Math.random() *
        items.length
    )
  ];
}

function buildProductPayload(
  feature
) {
  if (!feature?.product) {
    return null;
  }

  return {
    ok: true,

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
    },

    product:
      feature.product,
  };
}

function buildArtisanPayload(
  feature
) {
  if (!feature?.service) {
    return null;
  }

  return {
    ok: true,

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
    },

    artisan:
      feature.service,
  };
}

/* =========================================================
   FILTRU PRODUSE ELIGIBILE
========================================================= */

const eligibleProductWhere = {
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

  images: {
    isEmpty: false,
  },

  service: {
    isActive: true,
    status: "ACTIVE",

    vendor: {
      isActive: true,
    },
  },
};

/* =========================================================
   PRODUSUL ZILEI
========================================================= */

async function getOrCreateProductOfTheDay() {
  const now = new Date();

  const dateKey =
    getDayKey(now);

  /*
   * Dacă produsul zilei există deja,
   * îl returnăm direct.
   */
  const existing =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "PRODUCT_OF_DAY",

          dateKey,
        },
      },

      include: {
        product: {
          include: {
            service: {
              include: {
                profile: true,
                vendor: true,
              },
            },
          },
        },
      },
    });

  if (existing?.product) {
    return existing;
  }

  /*
   * Produsele promovate în ultimele
   * 30 de zile.
   */
  const repeatCutoff =
    new Date(
      now.getTime() -
        PRODUCT_REPEAT_DAYS *
          24 *
          60 *
          60 *
          1000
    );

  const recentFeatures =
    await prisma.homepageFeature.findMany({
      where: {
        type:
          "PRODUCT_OF_DAY",

        startsAt: {
          gte:
            repeatCutoff,
        },

        productId: {
          not: null,
        },
      },

      select: {
        productId: true,
      },
    });

  const excludedProductIds =
    recentFeatures
      .map(
        (item) =>
          item.productId
      )
      .filter(Boolean);

  /*
   * Identificăm artizanul
   * săptămânii curente.
   */
  const currentWeekKey =
    getWeekKey(now);

  const artisanOfTheWeek =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey:
            currentWeekKey,
        },
      },

      select: {
        serviceId: true,
      },
    });

  const artisanServiceId =
    artisanOfTheWeek?.serviceId ||
    null;

  /*
   * Prima încercare:
   *
   * - evită produsele promovate
   *   în ultimele 30 de zile;
   *
   * - evită produsele artizanului
   *   săptămânii.
   */
  let products =
    await prisma.product.findMany({
      where: {
        ...eligibleProductWhere,

        id: {
          notIn:
            excludedProductIds,
        },

        ...(artisanServiceId
          ? {
              serviceId: {
                not:
                  artisanServiceId,
              },
            }
          : {}),
      },

      include: {
        service: {
          include: {
            profile: true,
            vendor: true,
          },
        },
      },

      take:
        FEATURE_CANDIDATE_LIMIT,
    });

  /*
   * Al doilea fallback:
   *
   * permitem repetarea produselor,
   * dar evităm în continuare
   * artizanul săptămânii.
   */
  if (!products.length) {
    products =
      await prisma.product.findMany({
        where: {
          ...eligibleProductWhere,

          ...(artisanServiceId
            ? {
                serviceId: {
                  not:
                    artisanServiceId,
                },
              }
            : {}),
        },

        include: {
          service: {
            include: {
              profile: true,
              vendor: true,
            },
          },
        },

        take:
          FEATURE_CANDIDATE_LIMIT,
      });
  }

  /*
   * Ultimul fallback:
   *
   * dacă artizanul săptămânii
   * este singurul care are produse,
   * permitem și produsele lui.
   */
  if (!products.length) {
    products =
      await prisma.product.findMany({
        where:
          eligibleProductWhere,

        include: {
          service: {
            include: {
              profile: true,
              vendor: true,
            },
          },
        },

        take:
          FEATURE_CANDIDATE_LIMIT,
      });
  }

  const selected =
    pickRandom(products);

  if (!selected) {
    return null;
  }

  const {
    startsAt,
    endsAt,
  } = getDayRange(now);

  try {
    return await prisma.homepageFeature.create({
      data: {
        type:
          "PRODUCT_OF_DAY",

        dateKey,

        source:
          "AUTOMATIC",

        productId:
          selected.id,

        serviceId:
          selected.serviceId,

        vendorId:
          selected.service.vendorId,

        startsAt,
        endsAt,
      },

      include: {
        product: {
          include: {
            service: {
              include: {
                profile: true,
                vendor: true,
              },
            },
          },
        },
      },
    });
  } catch (error) {
    /*
     * Dacă două cereri ajung simultan
     * la prima încărcare, una poate crea
     * selecția înaintea celeilalte.
     */
    if (
      error?.code ===
      "P2002"
    ) {
      return prisma.homepageFeature.findUnique({
        where: {
          type_dateKey: {
            type:
              "PRODUCT_OF_DAY",

            dateKey,
          },
        },

        include: {
          product: {
            include: {
              service: {
                include: {
                  profile: true,
                  vendor: true,
                },
              },
            },
          },
        },
      });
    }

    throw error;
  }
}

/* =========================================================
   ARTIZANUL SĂPTĂMÂNII
========================================================= */

async function getOrCreateArtisanOfTheWeek() {
  const now =
    new Date();

  const dateKey =
    getWeekKey(now);

  /*
   * Dacă artizanul săptămânii
   * există deja, îl returnăm.
   */
  const existing =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey,
        },
      },

      include: {
        service: {
          include: {
            profile: true,
            vendor: true,

            products: {
              where:
                eligibleProductWhere,

              take: 6,

              orderBy: {
                createdAt:
                  "desc",
              },
            },
          },
        },
      },
    });

  if (existing?.service) {
    return existing;
  }

  /*
   * Artizanii promovați în
   * ultimele 12 săptămâni.
   */
  const repeatCutoff =
    new Date(
      now.getTime() -
        ARTISAN_REPEAT_WEEKS *
          7 *
          24 *
          60 *
          60 *
          1000
    );

  const recentFeatures =
    await prisma.homepageFeature.findMany({
      where: {
        type:
          "ARTISAN_OF_WEEK",

        startsAt: {
          gte:
            repeatCutoff,
        },

        serviceId: {
          not: null,
        },
      },

      select: {
        serviceId: true,
      },
    });

  const excludedServiceIds =
    recentFeatures
      .map(
        (item) =>
          item.serviceId
      )
      .filter(Boolean);

  /*
   * Prima selecție:
   *
   * evităm artizanii promovați
   * recent.
   */
  const services =
    await prisma.vendorService.findMany({
      where: {
        id: {
          notIn:
            excludedServiceIds,
        },

        isActive: true,
        status: "ACTIVE",

        vendor: {
          isActive: true,
        },

        products: {
          some:
            eligibleProductWhere,
        },
      },

      select: {
        id: true,
        vendorId: true,
        title: true,
        description: true,
        city: true,
        mediaUrls: true,

        profile: true,

        vendor: {
          select: {
            id: true,
            displayName: true,
            about: true,
            logoUrl: true,
            coverUrl: true,
            city: true,
          },
        },

        _count: {
          select: {
            products: {
              where:
                eligibleProductWhere,
            },
          },
        },
      },

      take:
        FEATURE_CANDIDATE_LIMIT,
    });

  let eligibleServices =
    services.filter(
      (service) => {
        const hasEnoughProducts =
          service._count.products >=
          MIN_ARTISAN_PRODUCTS;

        const hasImage =
          Boolean(
            service.profile
              ?.coverUrl ||
              service.profile
                ?.logoUrl ||
              service.vendor
                .coverUrl ||
              service.vendor
                .logoUrl ||
              service.mediaUrls
                ?.[0]
          );

        return (
          hasEnoughProducts &&
          hasImage
        );
      }
    );

  /*
   * Fallback:
   *
   * dacă toți artizanii eligibili
   * au fost promovați recent,
   * permitem reutilizarea lor.
   */
  if (!eligibleServices.length) {
    const fallbackServices =
      await prisma.vendorService.findMany({
        where: {
          isActive: true,
          status: "ACTIVE",

          vendor: {
            isActive: true,
          },

          products: {
            some:
              eligibleProductWhere,
          },
        },

        select: {
          id: true,
          vendorId: true,
          title: true,
          description: true,
          city: true,
          mediaUrls: true,

          profile: true,

          vendor: {
            select: {
              id: true,
              displayName: true,
              about: true,
              logoUrl: true,
              coverUrl: true,
              city: true,
            },
          },

          _count: {
            select: {
              products: {
                where:
                  eligibleProductWhere,
              },
            },
          },
        },

        take:
          FEATURE_CANDIDATE_LIMIT,
      });

    eligibleServices =
      fallbackServices.filter(
        (service) =>
          service._count
            .products >=
            MIN_ARTISAN_PRODUCTS &&
          Boolean(
            service.profile
              ?.coverUrl ||
              service.profile
                ?.logoUrl ||
              service.vendor
                .coverUrl ||
              service.vendor
                .logoUrl ||
              service.mediaUrls
                ?.[0]
          )
      );
  }

  const selected =
    pickRandom(
      eligibleServices
    );

  if (!selected) {
    return null;
  }

  const {
    startsAt,
    endsAt,
  } = getWeekRange(now);

  try {
    return await prisma.homepageFeature.create({
      data: {
        type:
          "ARTISAN_OF_WEEK",

        dateKey,

        source:
          "AUTOMATIC",

        serviceId:
          selected.id,

        vendorId:
          selected.vendorId,

        startsAt,
        endsAt,
      },

      include: {
        service: {
          include: {
            profile: true,
            vendor: true,

            products: {
              where:
                eligibleProductWhere,

              take: 6,

              orderBy: {
                createdAt:
                  "desc",
              },
            },
          },
        },
      },
    });
  } catch (error) {
    /*
     * Protecție pentru două cereri
     * simultane la începutul săptămânii.
     */
    if (
      error?.code ===
      "P2002"
    ) {
      return prisma.homepageFeature.findUnique({
        where: {
          type_dateKey: {
            type:
              "ARTISAN_OF_WEEK",

            dateKey,
          },
        },

        include: {
          service: {
            include: {
              profile: true,
              vendor: true,

              products: {
                where:
                  eligibleProductWhere,

                take: 6,

                orderBy: {
                  createdAt:
                    "desc",
                },
              },
            },
          },
        },
      });
    }

    throw error;
  }
}

/* =========================================================
   RUTA PRODUSUL ZILEI
========================================================= */

router.get(
  "/product-of-the-day",
  async (req, res) => {
    try {
      const dateKey =
        getDayKey();

      /*
       * Dacă avem deja produsul în cache
       * pentru ziua curentă, răspundem direct.
       */
      if (
        homepageCache.product
          .key === dateKey &&
        homepageCache.product
          .value
      ) {
        return res.json(
          homepageCache.product
            .value
        );
      }

      const feature =
        await getOrCreateProductOfTheDay();

      const payload =
        buildProductPayload(
          feature
        );

      if (!payload) {
        return res.status(
          404
        ).json({
          ok: false,

          message:
            "Nu există niciun produs eligibil.",
        });
      }

      homepageCache.product = {
        key: dateKey,
        value: payload,
      };

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
        ok: false,

        message:
          "Nu am putut încărca produsul zilei.",
      });
    }
  }
);

/* =========================================================
   RUTA ARTIZANUL SĂPTĂMÂNII
========================================================= */

router.get(
  "/artisan-of-the-week",
  async (req, res) => {
    try {
      const dateKey =
        getWeekKey();

      /*
       * Dacă avem artizanul în cache
       * pentru săptămâna curentă,
       * răspundem direct.
       */
      if (
        homepageCache.artisan
          .key === dateKey &&
        homepageCache.artisan
          .value
      ) {
        return res.json(
          homepageCache.artisan
            .value
        );
      }

      const feature =
        await getOrCreateArtisanOfTheWeek();

      const payload =
        buildArtisanPayload(
          feature
        );

      if (!payload) {
        return res.status(
          404
        ).json({
          ok: false,

          message:
            "Nu există niciun artizan eligibil.",
        });
      }

      homepageCache.artisan = {
        key: dateKey,
        value: payload,
      };

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
        ok: false,

        message:
          "Nu am putut încărca artizanul săptămânii.",
      });
    }
  }
);

export default router;