// backend/src/services/homepageFeatureScheduler.js

import {
  prisma,
} from "../db.js";

/* =========================================================
   CONFIGURARE
========================================================= */

const MIN_ARTISAN_PRODUCTS =
  Math.max(
    1,
    Number(
      process.env
        .HOMEPAGE_MIN_ARTISAN_PRODUCTS ||
        3
    )
  );

const PRODUCT_REPEAT_DAYS =
  Math.max(
    1,
    Number(
      process.env
        .HOMEPAGE_PRODUCT_REPEAT_DAYS ||
        30
    )
  );

const ARTISAN_REPEAT_WEEKS =
  Math.max(
    1,
    Number(
      process.env
        .HOMEPAGE_ARTISAN_REPEAT_WEEKS ||
        12
    )
  );

const FEATURE_CANDIDATE_LIMIT =
  Math.max(
    10,
    Math.min(
      500,
      Number(
        process.env
          .HOMEPAGE_FEATURE_CANDIDATE_LIMIT ||
          100
      )
    )
  );

/*
 * Reducerea Artfest implicită.
 *
 * Poți seta în Render:
 *
 * HOMEPAGE_PLATFORM_DISCOUNT_PERCENT=5
 */
const PLATFORM_DISCOUNT_PERCENT =
  Math.min(
    50,
    Math.max(
      0,
      Math.round(
        Number(
          process.env
            .HOMEPAGE_PLATFORM_DISCOUNT_PERCENT ||
            5
        )
      )
    )
  );

/* =========================================================
   INCLUDE-URI PRISMA
========================================================= */

export const productFeatureInclude = {
  product: {
    include: {
      service: {
        include: {
          profile:
            true,

          vendor:
            true,
        },
      },
    },
  },

  service: {
    include: {
      profile:
        true,

      vendor:
        true,
    },
  },

  vendor:
    true,
};

export const artisanFeatureInclude = {
  service: {
    include: {
      profile:
        true,

      vendor:
        true,

      products: {
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

          images: {
            isEmpty:
              false,
          },
        },

        take:
          6,

        orderBy: {
          createdAt:
            "desc",
        },
      },
    },
  },

  vendor:
    true,
};

/* =========================================================
   FILTRE ELIGIBILITATE
========================================================= */

export const eligibleProductWhere = {
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

  images: {
    isEmpty:
      false,
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
};

/* =========================================================
   HELPERS DATĂ
========================================================= */

function cloneDate(value) {
  const date =
    value instanceof Date
      ? new Date(
          value.getTime()
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

export function getDayRange(
  value = new Date()
) {
  const startsAt =
    cloneDate(value);

  if (!startsAt) {
    return null;
  }

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

export function getWeekRange(
  value = new Date()
) {
  const startsAt =
    cloneDate(value);

  if (!startsAt) {
    return null;
  }

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

export function getDayKey(
  value = new Date()
) {
  const range =
    getDayRange(value);

  if (!range) {
    return null;
  }

  const date =
    range.startsAt;

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

export function getWeekKey(
  value = new Date()
) {
  const range =
    getWeekRange(value);

  if (!range) {
    return null;
  }

  const localDate =
    range.startsAt;

  const date =
    new Date(
      Date.UTC(
        localDate.getFullYear(),
        localDate.getMonth(),
        localDate.getDate()
      )
    );

  const dayNumber =
    date.getUTCDay() ||
    7;

  date.setUTCDate(
    date.getUTCDate() +
      4 -
      dayNumber
  );

  const yearStart =
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        0,
        1
      )
    );

  const weekNumber =
    Math.ceil(
      (
        (
          date -
          yearStart
        ) /
          86400000 +
        1
      ) /
        7
    );

  return `${date.getUTCFullYear()}-W${String(
    weekNumber
  ).padStart(
    2,
    "0"
  )}`;
}

function addDays(
  value,
  days
) {
  const date =
    cloneDate(value);

  if (!date) {
    return null;
  }

  date.setDate(
    date.getDate() +
      Number(days || 0)
  );

  return date;
}

function addWeeks(
  value,
  weeks
) {
  return addDays(
    value,
    Number(weeks || 0) *
      7
  );
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

  const index =
    Math.floor(
      Math.random() *
        items.length
    );

  return items[index] ||
    null;
}

function uniqueIds(values) {
  return [
    ...new Set(
      (
        Array.isArray(values)
          ? values
          : []
      ).filter(Boolean)
    ),
  ];
}

function buildInitialVendorResponse() {
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

function isServiceVisuallyEligible(
  service
) {
  if (!service) {
    return false;
  }

  const productsCount =
    Number(
      service?._count
        ?.products ||
        0
    );

  const hasImage =
    Boolean(
      service?.profile
        ?.coverUrl ||
        service?.profile
          ?.logoUrl ||
        service?.vendor
          ?.coverUrl ||
        service?.vendor
          ?.logoUrl ||
        service?.mediaUrls?.[0]
    );

  return (
    productsCount >=
      MIN_ARTISAN_PRODUCTS &&
    hasImage
  );
}

/* =========================================================
   PRODUSUL ZILEI – CANDIDAȚI
========================================================= */

async function getRecentProductIds(
  targetDate
) {
  const repeatCutoff =
    new Date(
      targetDate.getTime() -
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

          lt:
            targetDate,
        },

        productId: {
          not:
            null,
        },
      },

      select: {
        productId:
          true,
      },
    });

  return uniqueIds(
    recentFeatures.map(
      (feature) =>
        feature.productId
    )
  );
}

async function getScheduledProductIds() {
  const scheduled =
    await prisma.homepageFeature.findMany({
      where: {
        type:
          "PRODUCT_OF_DAY",

        productId: {
          not:
            null,
        },
      },

      select: {
        productId:
          true,
      },
    });

  return uniqueIds(
    scheduled.map(
      (feature) =>
        feature.productId
    )
  );
}

async function getArtisanServiceIdForDate(
  targetDate
) {
  const weekKey =
    getWeekKey(targetDate);

  if (!weekKey) {
    return null;
  }

  const feature =
    await prisma.homepageFeature.findUnique({
      where: {
        type_dateKey: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey:
            weekKey,
        },
      },

      select: {
        serviceId:
          true,
      },
    });

  return (
    feature?.serviceId ||
    null
  );
}

async function findProductCandidates({
  excludedProductIds,
  excludedServiceId,
  allowRecentProducts,
  allowArtisanService,
}) {
  const excludedIds =
    uniqueIds(
      excludedProductIds
    );

  return prisma.product.findMany({
    where: {
      ...eligibleProductWhere,

      ...(
        !allowRecentProducts &&
        excludedIds.length
          ? {
              id: {
                notIn:
                  excludedIds,
              },
            }
          : {}
      ),

      ...(
        !allowArtisanService &&
        excludedServiceId
          ? {
              serviceId: {
                not:
                  excludedServiceId,
              },
            }
          : {}
      ),
    },

    include: {
      service: {
        include: {
          profile:
            true,

          vendor:
            true,
        },
      },
    },

    take:
      FEATURE_CANDIDATE_LIMIT,

    orderBy: {
      createdAt:
        "desc",
    },
  });
}

async function chooseProductForDate(
  targetDate
) {
  const recentProductIds =
    await getRecentProductIds(
      targetDate
    );

  const scheduledProductIds =
    await getScheduledProductIds();

  const excludedProductIds =
    uniqueIds([
      ...recentProductIds,
      ...scheduledProductIds,
    ]);

  const artisanServiceId =
    await getArtisanServiceIdForDate(
      targetDate
    );

  /*
   * Încercarea 1:
   * - fără produse recente/programate;
   * - fără produse de la Artizanul săptămânii.
   */
  let candidates =
    await findProductCandidates({
      excludedProductIds,
      excludedServiceId:
        artisanServiceId,
      allowRecentProducts:
        false,
      allowArtisanService:
        false,
    });

  /*
   * Încercarea 2:
   * - fără produse recente/programate;
   * - permitem magazinul Artizanului săptămânii.
   */
  if (!candidates.length) {
    candidates =
      await findProductCandidates({
        excludedProductIds,
        excludedServiceId:
          artisanServiceId,
        allowRecentProducts:
          false,
        allowArtisanService:
          true,
      });
  }

  /*
   * Încercarea 3:
   * - permitem repetarea;
   * - evităm Artizanul săptămânii.
   */
  if (!candidates.length) {
    candidates =
      await findProductCandidates({
        excludedProductIds:
          [],
        excludedServiceId:
          artisanServiceId,
        allowRecentProducts:
          true,
        allowArtisanService:
          false,
      });
  }

  /*
   * Ultimul fallback:
   * orice produs eligibil.
   */
  if (!candidates.length) {
    candidates =
      await findProductCandidates({
        excludedProductIds:
          [],
        excludedServiceId:
          null,
        allowRecentProducts:
          true,
        allowArtisanService:
          true,
      });
  }

  return pickRandom(
    candidates
  );
}

/* =========================================================
   ARTIZANUL SĂPTĂMÂNII – CANDIDAȚI
========================================================= */

async function getRecentServiceIds(
  targetDate
) {
  const repeatCutoff =
    new Date(
      targetDate.getTime() -
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

          lt:
            targetDate,
        },

        serviceId: {
          not:
            null,
        },
      },

      select: {
        serviceId:
          true,
      },
    });

  return uniqueIds(
    recentFeatures.map(
      (feature) =>
        feature.serviceId
    )
  );
}

async function getScheduledServiceIds() {
  const scheduled =
    await prisma.homepageFeature.findMany({
      where: {
        type:
          "ARTISAN_OF_WEEK",

        serviceId: {
          not:
            null,
        },
      },

      select: {
        serviceId:
          true,
      },
    });

  return uniqueIds(
    scheduled.map(
      (feature) =>
        feature.serviceId
    )
  );
}

async function findArtisanCandidates({
  excludedServiceIds,
}) {
  const excludedIds =
    uniqueIds(
      excludedServiceIds
    );

  const services =
    await prisma.vendorService.findMany({
      where: {
        ...(
          excludedIds.length
            ? {
                id: {
                  notIn:
                    excludedIds,
                },
              }
            : {}
        ),

        isActive:
          true,

        status:
          "ACTIVE",

        vendor: {
          isActive:
            true,
        },

        products: {
          some:
            eligibleProductWhere,
        },
      },

      select: {
        id:
          true,

        vendorId:
          true,

        title:
          true,

        description:
          true,

        city:
          true,

        mediaUrls:
          true,

        profile:
          true,

        vendor: {
          select: {
            id:
              true,

            displayName:
              true,

            about:
              true,

            logoUrl:
              true,

            coverUrl:
              true,

            city:
              true,

            email:
              true,

            userId:
              true,
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

      orderBy: {
        createdAt:
          "desc",
      },
    });

  return services.filter(
    isServiceVisuallyEligible
  );
}

async function chooseArtisanForDate(
  targetDate
) {
  const recentServiceIds =
    await getRecentServiceIds(
      targetDate
    );

  const scheduledServiceIds =
    await getScheduledServiceIds();

  const excludedServiceIds =
    uniqueIds([
      ...recentServiceIds,
      ...scheduledServiceIds,
    ]);

  /*
   * Încercarea principală:
   * evităm magazinele promovate recent
   * și magazinele deja programate.
   */
  let candidates =
    await findArtisanCandidates({
      excludedServiceIds,
    });

  /*
   * Fallback:
   * permitem reutilizarea unui magazin
   * dacă nu mai există alt candidat.
   */
  if (!candidates.length) {
    candidates =
      await findArtisanCandidates({
        excludedServiceIds:
          [],
      });
  }

  return pickRandom(
    candidates
  );
}

/* =========================================================
   GENERARE PRODUSUL ZILEI
========================================================= */

export async function generateProductFeatureForDate(
  value,
  {
    platformDiscountPercent =
      PLATFORM_DISCOUNT_PERCENT,
  } = {}
) {
  const range =
    getDayRange(value);

  if (!range) {
    throw new Error(
      "Data pentru Produsul zilei nu este validă."
    );
  }

  const {
    startsAt,
    endsAt,
  } = range;

  const dateKey =
    getDayKey(startsAt);

  const existing =
    await prisma.homepageFeature.findUnique({
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

  /*
   * Nu suprascriem o selecție deja existentă,
   * indiferent dacă este MANUAL sau AUTOMATIC.
   */
  if (existing) {
    return {
      created:
        false,

      feature:
        existing,

      reason:
        "already_exists",
    };
  }

  const selected =
    await chooseProductForDate(
      startsAt
    );

  if (!selected) {
    return {
      created:
        false,

      feature:
        null,

      reason:
        "no_eligible_product",
    };
  }

  try {
    const feature =
      await prisma.homepageFeature.create({
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
            selected.service
              .vendorId,

          startsAt,
          endsAt,

          platformDiscountPercent:
            Math.min(
              50,
              Math.max(
                0,
                Math.round(
                  Number(
                    platformDiscountPercent ||
                      0
                  )
                )
              )
            ),

          ...buildInitialVendorResponse(),
        },

        include:
          productFeatureInclude,
      });

    return {
      created:
        true,

      feature,

      reason:
        "created",
    };
  } catch (error) {
    /*
     * Protecție pentru două requesturi simultane.
     */
    if (
      error?.code ===
      "P2002"
    ) {
      const feature =
        await prisma.homepageFeature.findUnique({
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

      return {
        created:
          false,

        feature,

        reason:
          "already_exists",
      };
    }

    throw error;
  }
}

/* =========================================================
   GENERARE ARTIZANUL SĂPTĂMÂNII
========================================================= */

export async function generateArtisanFeatureForDate(
  value,
  {
    platformDiscountPercent =
      PLATFORM_DISCOUNT_PERCENT,
  } = {}
) {
  const range =
    getWeekRange(value);

  if (!range) {
    throw new Error(
      "Data pentru Artizanul săptămânii nu este validă."
    );
  }

  const {
    startsAt,
    endsAt,
  } = range;

  const dateKey =
    getWeekKey(startsAt);

  const existing =
    await prisma.homepageFeature.findUnique({
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

  if (existing) {
    return {
      created:
        false,

      feature:
        existing,

      reason:
        "already_exists",
    };
  }

  const selected =
    await chooseArtisanForDate(
      startsAt
    );

  if (!selected) {
    return {
      created:
        false,

      feature:
        null,

      reason:
        "no_eligible_artisan",
    };
  }

  try {
    const feature =
      await prisma.homepageFeature.create({
        data: {
          type:
            "ARTISAN_OF_WEEK",

          dateKey,

          source:
            "AUTOMATIC",

          productId:
            null,

          serviceId:
            selected.id,

          vendorId:
            selected.vendorId,

          startsAt,
          endsAt,

          platformDiscountPercent:
            Math.min(
              50,
              Math.max(
                0,
                Math.round(
                  Number(
                    platformDiscountPercent ||
                      0
                  )
                )
              )
            ),

          ...buildInitialVendorResponse(),
        },

        include:
          artisanFeatureInclude,
      });

    return {
      created:
        true,

      feature,

      reason:
        "created",
    };
  } catch (error) {
    if (
      error?.code ===
      "P2002"
    ) {
      const feature =
        await prisma.homepageFeature.findUnique({
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

      return {
        created:
          false,

        feature,

        reason:
          "already_exists",
      };
    }

    throw error;
  }
}

/* =========================================================
   GENERARE CALENDAR COMPLET
========================================================= */

export async function generateHomepageSchedule({
  startDate =
    new Date(),

  productDays =
    14,

  artisanWeeks =
    4,

  platformDiscountPercent =
    PLATFORM_DISCOUNT_PERCENT,
} = {}) {
  const normalizedStartDate =
    cloneDate(startDate);

  if (!normalizedStartDate) {
    throw new Error(
      "Data de început pentru calendar nu este validă."
    );
  }

  const normalizedProductDays =
    Math.min(
      90,
      Math.max(
        0,
        Math.round(
          Number(
            productDays ||
              0
          )
        )
      )
    );

  const normalizedArtisanWeeks =
    Math.min(
      26,
      Math.max(
        0,
        Math.round(
          Number(
            artisanWeeks ||
              0
          )
        )
      )
    );

  const productResults =
    [];

  const artisanResults =
    [];

  /*
   * Generăm mai întâi artizanii.
   *
   * Astfel, la alegerea produselor zilei,
   * sistemul poate evita produsele magazinului
   * care este Artizanul săptămânii.
   */
  for (
    let index = 0;
    index <
    normalizedArtisanWeeks;
    index += 1
  ) {
    const targetDate =
      addWeeks(
        normalizedStartDate,
        index
      );

    try {
      const result =
        await generateArtisanFeatureForDate(
          targetDate,
          {
            platformDiscountPercent,
          }
        );

      artisanResults.push({
        index,
        dateKey:
          getWeekKey(
            targetDate
          ),
        ...result,
      });
    } catch (error) {
      console.error(
        "[homepage-feature-scheduler] artisan generation failed",
        {
          index,
          targetDate,
          error,
        }
      );

      artisanResults.push({
        index,
        dateKey:
          getWeekKey(
            targetDate
          ),
        created:
          false,
        feature:
          null,
        reason:
          "error",
        error:
          error?.message ||
          "unknown_error",
      });
    }
  }

  for (
    let index = 0;
    index <
    normalizedProductDays;
    index += 1
  ) {
    const targetDate =
      addDays(
        normalizedStartDate,
        index
      );

    try {
      const result =
        await generateProductFeatureForDate(
          targetDate,
          {
            platformDiscountPercent,
          }
        );

      productResults.push({
        index,
        dateKey:
          getDayKey(
            targetDate
          ),
        ...result,
      });
    } catch (error) {
      console.error(
        "[homepage-feature-scheduler] product generation failed",
        {
          index,
          targetDate,
          error,
        }
      );

      productResults.push({
        index,
        dateKey:
          getDayKey(
            targetDate
          ),
        created:
          false,
        feature:
          null,
        reason:
          "error",
        error:
          error?.message ||
          "unknown_error",
      });
    }
  }

  const createdProducts =
    productResults.filter(
      (item) =>
        item.created
    ).length;

  const existingProducts =
    productResults.filter(
      (item) =>
        item.reason ===
        "already_exists"
    ).length;

  const missingProducts =
    productResults.filter(
      (item) =>
        item.reason ===
        "no_eligible_product"
    ).length;

  const productErrors =
    productResults.filter(
      (item) =>
        item.reason ===
        "error"
    ).length;

  const createdArtisans =
    artisanResults.filter(
      (item) =>
        item.created
    ).length;

  const existingArtisans =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "already_exists"
    ).length;

  const missingArtisans =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "no_eligible_artisan"
    ).length;

  const artisanErrors =
    artisanResults.filter(
      (item) =>
        item.reason ===
        "error"
    ).length;

  return {
    ok:
      true,

    configuration: {
      startDate:
        normalizedStartDate,

      productDays:
        normalizedProductDays,

      artisanWeeks:
        normalizedArtisanWeeks,

      platformDiscountPercent:
        Math.min(
          50,
          Math.max(
            0,
            Math.round(
              Number(
                platformDiscountPercent ||
                  0
              )
            )
          )
        ),
    },

    summary: {
      createdProducts,
      existingProducts,
      missingProducts,
      productErrors,

      createdArtisans,
      existingArtisans,
      missingArtisans,
      artisanErrors,
    },

    products:
      productResults,

    artisans:
      artisanResults,
  };
}

/* =========================================================
   ASIGURARE PERIOADĂ CURENTĂ
========================================================= */

/*
 * Aceste funcții pot fi folosite de ruta publică
 * drept fallback dacă, din orice motiv, calendarul
 * nu a fost generat în avans.
 */

export async function ensureCurrentProductFeature() {
  return generateProductFeatureForDate(
    new Date()
  );
}

export async function ensureCurrentArtisanFeature() {
  return generateArtisanFeatureForDate(
    new Date()
  );
}