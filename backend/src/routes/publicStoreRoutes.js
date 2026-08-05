import { Router } from "express";
import { prisma } from "../db.js";

import {
  CATEGORIES,
  CATEGORY_SET,
  CATEGORIES_DETAILED,
} from "../constants/categories.js";

import {
  normalizeCityName,
  hasRomanianDiacritics,
} from "../utils/cityUtils.js";

import {
  applyPromotionsToProducts,
} from "../services/productPromotionPrice.js";

const router = Router();

/* =========================================================
   HELPERS
========================================================= */

function buildStoreOrderBy(sort) {
  switch (
    String(sort || "new")
      .trim()
      .toLowerCase()
  ) {
    case "name_asc":
      return [
        {
          displayName:
            "asc",
        },
        {
          createdAt:
            "desc",
        },
        {
          id:
            "desc",
        },
      ];

    case "name_desc":
      return [
        {
          displayName:
            "desc",
        },
        {
          createdAt:
            "desc",
        },
        {
          id:
            "desc",
        },
      ];

    case "popular":
      return [
        {
          createdAt:
            "desc",
        },
        {
          id:
            "desc",
        },
      ];

    case "new":
    default:
      return [
        {
          createdAt:
            "desc",
        },
        {
          id:
            "desc",
        },
      ];
  }
}

function pickBetterLabel(
  existing,
  candidate
) {
  if (!existing) {
    return candidate;
  }

  if (!candidate) {
    return existing;
  }

  if (
    hasRomanianDiacritics(
      candidate
    ) &&
    !hasRomanianDiacritics(
      existing
    )
  ) {
    return candidate;
  }

  return existing;
}

function publicSellerTypeFromBilling(
  billing
) {
  const hasBusinessBillingData =
    Boolean(
      billing?.legalType ||
        billing?.companyName ||
        billing?.cui ||
        billing?.regCom ||
        billing?.vatStatus
    );

  const sellerType =
    billing?.sellerType ||
    (
      hasBusinessBillingData
        ? "verified_business"
        : null
    );

  if (
    sellerType ===
    "independent_creator"
  ) {
    return {
      sellerType:
        "independent_creator",

      sellerTypeLabel:
        "Creator independent la început de drum",
    };
  }

  if (
    sellerType ===
    "verified_business"
  ) {
    return {
      sellerType:
        "verified_business",

      sellerTypeLabel:
        "Business verificat",
    };
  }

  return {
    sellerType:
      null,

    sellerTypeLabel:
      null,
  };
}

function buildCityMetaFromProfile(
  profile,
  dictMap
) {
  const service =
    profile.service;

  const vendor =
    service?.vendor;

  const rawCity =
    String(
      profile.city ||
        service?.city ||
        vendor?.city ||
        ""
    ).trim();

  const slugFromProfile =
    profile.citySlug ||
    service?.citySlug ||
    vendor?.citySlug ||
    (
      rawCity
        ? normalizeCityName(
            rawCity
          )
        : null
    );

  const citySlug =
    slugFromProfile ||
    null;

  let cityLabel =
    null;

  if (citySlug) {
    const fromDict =
      String(
        dictMap.get(
          citySlug
        ) ||
          ""
      ).trim();

    if (fromDict) {
      cityLabel =
        fromDict;
    }
  }

  if (!cityLabel) {
    cityLabel =
      rawCity ||
      null;
  }

  return {
    city:
      cityLabel,

    citySlug,
  };
}

function buildProductOrderBy(
  sort
) {
  switch (
    String(sort || "new")
      .trim()
      .toLowerCase()
  ) {
    case "price_asc":
      return [
        {
          priceCents:
            "asc",
        },
        {
          createdAt:
            "desc",
        },
      ];

    case "price_desc":
      return [
        {
          priceCents:
            "desc",
        },
        {
          createdAt:
            "desc",
        },
      ];

    case "popular":
      return [
        {
          popularityScore:
            "desc",
        },
        {
          createdAt:
            "desc",
        },
      ];

    case "new":
    default:
      return [
        {
          createdAt:
            "desc",
        },
      ];
  }
}

function hasNumericValue(
  value
) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(
      Number(value)
    )
  );
}

/*
 * Mapează produsul public după ce
 * applyPromotionsToProducts a calculat prețul.
 *
 * Convenție:
 * - priceCents = prețul final afișat;
 * - originalPriceCents = prețul fără reducere;
 * - finalPriceCents = prețul final;
 * - discountedPriceCents = alias pentru prețul final.
 */
function mapPublicProduct(
  product
) {
  const finalPriceCents =
    hasNumericValue(
      product?.finalPriceCents
    )
      ? Number(
          product.finalPriceCents
        )
      : hasNumericValue(
            product?.discountedPriceCents
          )
        ? Number(
            product.discountedPriceCents
          )
        : hasNumericValue(
              product?.priceCents
            )
          ? Number(
              product.priceCents
            )
          : null;

  const normalPriceCents =
    hasNumericValue(
      product
        ?.originalPriceCents
    )
      ? Number(
          product
            .originalPriceCents
        )
      : hasNumericValue(
            product?.priceCents
          )
        ? Number(
            product.priceCents
          )
        : finalPriceCents;

  const totalDiscountPercent =
    hasNumericValue(
      product
        ?.totalDiscountPercent
    )
      ? Number(
          product
            .totalDiscountPercent
        )
      : hasNumericValue(
            product
              ?.discountPercent
          )
        ? Number(
            product
              .discountPercent
          )
        : hasNumericValue(
              product
                ?.discount
                ?.totalDiscountPercent
            )
          ? Number(
              product
                .discount
                .totalDiscountPercent
            )
          : 0;

  const hasDiscount =
    product?.hasDiscount ===
      true &&
    finalPriceCents !==
      null &&
    normalPriceCents !==
      null &&
    finalPriceCents >
      0 &&
    finalPriceCents <
      normalPriceCents &&
    totalDiscountPercent >
      0;

  return {
    id:
      product.id,

    title:
      product.title,

    description:
      product.description ||
      "",

    /*
     * Prețul final pe care îl vede clientul.
     */
    price:
      finalPriceCents !==
      null
        ? finalPriceCents /
          100
        : null,

    priceCents:
      finalPriceCents,

    /*
     * Prețul inițial apare numai
     * dacă reducerea este validă.
     */
    originalPrice:
      hasDiscount
        ? normalPriceCents /
          100
        : null,

    originalPriceCents:
      hasDiscount
        ? normalPriceCents
        : null,

    finalPrice:
      finalPriceCents !==
      null
        ? finalPriceCents /
          100
        : null,

    finalPriceCents,

    discountedPriceCents:
      finalPriceCents,

    hasDiscount,

    discountPercent:
      hasDiscount
        ? totalDiscountPercent
        : 0,

    totalDiscountPercent:
      hasDiscount
        ? totalDiscountPercent
        : 0,

    platformDiscountPercent:
      hasDiscount
        ? Number(
            product
              ?.platformDiscountPercent ||
              product
                ?.discount
                ?.platformDiscountPercent ||
              0
          )
        : 0,

    vendorDiscountPercent:
      hasDiscount
        ? Number(
            product
              ?.vendorDiscountPercent ||
              product
                ?.discount
                ?.vendorDiscountPercent ||
              0
          )
        : 0,

    hasActiveHomepageDiscount:
      hasDiscount &&
      (
        product
          ?.hasActiveHomepageDiscount ===
          true ||
        product
          ?.discount
          ?.active ===
          true
      ),

    promoLabel:
      hasDiscount
        ? product
            ?.promoLabel ||
          "Reducere Artfest"
        : null,

    promoFundingSource:
      hasDiscount
        ? product
            ?.promoFundingSource ||
          null
        : null,

    promoCollectionId:
      hasDiscount
        ? product
            ?.promoCollectionId ||
          null
        : null,

    discount:
      hasDiscount
        ? product
            ?.discount ||
          null
        : null,

    currency:
      product.currency ||
      "RON",

    images:
      Array.isArray(
        product.images
      )
        ? product.images
        : [],

    category:
      product.category ||
      null,

    isActive:
      product.isActive,

    isHidden:
      Boolean(
        product.isHidden
      ),

    moderationStatus:
      product
        .moderationStatus ||
      "APPROVED",

    orderMode:
      product.orderMode ||
      "READY_TO_BUY",

    availability:
      product.availability ||
      "READY",

    leadTimeDays:
      product
        .leadTimeDays ??
      null,

    readyQty:
      product.readyQty ??
      0,

    nextShipDate:
      product.nextShipDate ||
      null,

    acceptsCustom:
      Boolean(
        product
          .acceptsCustom
      ),

    color:
      product.color ||
      "",

    materialMain:
      product
        .materialMain ||
      "",

    technique:
      product.technique ||
      "",

    styleTags:
      Array.isArray(
        product.styleTags
      )
        ? product.styleTags
        : [],

    occasionTags:
      Array.isArray(
        product
          .occasionTags
      )
        ? product
            .occasionTags
        : [],

    dimensions:
      product.dimensions ||
      "",

    careInstructions:
      product
        .careInstructions ||
      "",

    specialNotes:
      product
        .specialNotes ||
      "",

    optionsSchema:
      Array.isArray(
        product
          .optionsSchema
      )
        ? product
            .optionsSchema
        : [],

    customSchema:
      Array.isArray(
        product
          .customSchema
      )
        ? product
            .customSchema
        : [],

    quoteSchema:
      Array.isArray(
        product
          .quoteSchema
      )
        ? product
            .quoteSchema
        : [],

    createdAt:
      product.createdAt,

    updatedAt:
      product.updatedAt,
  };
}

/* =========================================================
   CACHE ORAȘE
========================================================= */

let cityDictionaryCache = {
  at:
    0,

  map:
    new Map(),
};

const DICT_TTL_MS =
  5 * 60 * 1000;

async function getCityDictMapCached() {
  const now =
    Date.now();

  if (
    cityDictionaryCache
      .map.size &&
    now -
      cityDictionaryCache.at <
      DICT_TTL_MS
  ) {
    return cityDictionaryCache
      .map;
  }

  const dictionaryRows =
    await prisma.cityDictionary.findMany({
      select: {
        slug:
          true,

        canonicalLabel:
          true,
      },
    });

  const dictionaryMap =
    new Map(
      dictionaryRows.map(
        (row) => [
          row.slug,
          row.canonicalLabel,
        ]
      )
    );

  cityDictionaryCache = {
    at:
      now,

    map:
      dictionaryMap,
  };

  return dictionaryMap;
}

/* =========================================================
   GET /api/public/stores
========================================================= */

router.get(
  "/stores",
  async (
    req,
    res,
    next
  ) => {
    try {
      const page =
        Math.max(
          1,
          parseInt(
            req.query.page ||
              "1",
            10
          )
        );

      const limit =
        Math.min(
          60,
          Math.max(
            1,
            parseInt(
              req.query
                .limit ||
                "24",
              10
            )
          )
        );

      const skip =
        (
          page - 1
        ) * limit;

      const q =
        String(
          req.query.q ||
            ""
        ).trim();

      const citySlugParam =
        String(
          req.query.city ||
            ""
        ).trim();

      const sort =
        String(
          req.query.sort ||
            "new"
        ).trim();

      const baseWhere = {
        service: {
          is: {
            isActive:
              true,

            status:
              "ACTIVE",

            vendor: {
              is: {
                isActive:
                  true,
              },
            },

            type: {
              is: {
                code:
                  "products",
              },
            },
          },
        },
      };

      const where = {
        ...baseWhere,

        ...(
          q
            ? {
                OR: [
                  {
                    displayName: {
                      contains:
                        q,

                      mode:
                        "insensitive",
                    },
                  },

                  {
                    about: {
                      contains:
                        q,

                      mode:
                        "insensitive",
                    },
                  },

                  {
                    shortDescription: {
                      contains:
                        q,

                      mode:
                        "insensitive",
                    },
                  },

                  {
                    service: {
                      is: {
                        vendor: {
                          is: {
                            displayName: {
                              contains:
                                q,

                              mode:
                                "insensitive",
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              }
            : {}
        ),

        ...(
          citySlugParam
            ? {
                OR: [
                  {
                    citySlug:
                      citySlugParam,
                  },

                  {
                    service: {
                      is: {
                        citySlug:
                          citySlugParam,

                        vendor: {
                          is: {
                            citySlug:
                              citySlugParam,
                          },
                        },
                      },
                    },
                  },
                ],
              }
            : {}
        ),
      };

      const dictionaryMap =
        await getCityDictMapCached();

      const take =
        limit + 1;

      const [
        totalFirstPage,
        profilesRaw,
      ] =
        await Promise.all([
          page === 1
            ? prisma.serviceProfile.count({
                where,
              })
            : Promise.resolve(
                null
              ),

          prisma.serviceProfile.findMany({
            where,
            skip,
            take,

            orderBy:
              buildStoreOrderBy(
                sort
              ),

            include: {
              service: {
                include: {
                  vendor: {
                    include: {
                      billing: {
                        select: {
                          sellerType:
                            true,

                          legalType:
                            true,

                          companyName:
                            true,

                          cui:
                            true,

                          regCom:
                            true,

                          vatStatus:
                            true,
                        },
                      },
                    },
                  },

                  _count: {
                    select: {
                      products:
                        true,
                    },
                  },
                },
              },
            },
          }),
        ]);

      const hasMore =
        profilesRaw.length >
        limit;

      const profiles =
        hasMore
          ? profilesRaw.slice(
              0,
              limit
            )
          : profilesRaw;

      const items =
        profiles.map(
          (profile) => {
            const service =
              profile.service;

            const vendor =
              service?.vendor;

            const sellerTypeInfo =
              publicSellerTypeFromBilling(
                vendor?.billing
              );

            const storeName =
              profile.displayName ||
              vendor?.displayName ||
              "Magazin";

            const logoUrl =
              profile.logoUrl ||
              vendor?.logoUrl ||
              null;

            const {
              city,
              citySlug,
            } =
              buildCityMetaFromProfile(
                profile,
                dictionaryMap
              );

            const productsCount =
              service?._count
                ?.products ||
              0;

            const aboutRaw =
              profile
                .shortDescription ||
              profile.about ||
              vendor?.about ||
              null;

            const about =
              aboutRaw &&
              String(
                aboutRaw
              ).length >
                180
                ? `${String(
                    aboutRaw
                  )
                    .slice(
                      0,
                      179
                    )
                    .trimEnd()}…`
                : aboutRaw;

            return {
              id:
                service?.id,

              profileSlug:
                profile.slug ||
                null,

              storeName,

              displayName:
                storeName,

              city,
              citySlug,

              category:
                null,

              about,
              logoUrl,
              productsCount,

              sellerType:
                sellerTypeInfo
                  .sellerType,

              sellerTypeLabel:
                sellerTypeInfo
                  .sellerTypeLabel,
            };
          }
        );

      res.set(
        "Cache-Control",
        "public, max-age=5, stale-while-revalidate=30"
      );

      return res.json({
        total:
          page === 1
            ? totalFirstPage ??
              0
            : null,

        items,
        page,
        limit,
        hasMore,
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   GET /api/public/stores/suggest
========================================================= */

router.get(
  "/stores/suggest",
  async (
    req,
    res,
    next
  ) => {
    try {
      const q =
        String(
          req.query.q ||
            ""
        ).trim();

      if (
        !q ||
        q.length <
          2
      ) {
        return res.json({
          stores:
            [],
        });
      }

      const dictionaryMap =
        await getCityDictMapCached();

      const profiles =
        await prisma.serviceProfile.findMany({
          where: {
            service: {
              is: {
                isActive:
                  true,

                status:
                  "ACTIVE",

                vendor: {
                  is: {
                    isActive:
                      true,
                  },
                },

                type: {
                  is: {
                    code:
                      "products",
                  },
                },
              },
            },

            OR: [
              {
                displayName: {
                  contains:
                    q,

                  mode:
                    "insensitive",
                },
              },

              {
                about: {
                  contains:
                    q,

                  mode:
                    "insensitive",
                },
              },

              {
                shortDescription: {
                  contains:
                    q,

                  mode:
                    "insensitive",
                },
              },

              {
                service: {
                  is: {
                    vendor: {
                      is: {
                        displayName: {
                          contains:
                            q,

                          mode:
                            "insensitive",
                        },
                      },
                    },
                  },
                },
              },
            ],
          },

          take:
            10,

          orderBy: [
            {
              displayName:
                "asc",
            },

            {
              createdAt:
                "desc",
            },

            {
              id:
                "desc",
            },
          ],

          include: {
            service: {
              include: {
                vendor: {
                  include: {
                    billing: {
                      select: {
                        sellerType:
                          true,

                        legalType:
                          true,

                        companyName:
                          true,

                        cui:
                          true,

                        regCom:
                          true,

                        vatStatus:
                          true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

      const stores =
        profiles.map(
          (profile) => {
            const service =
              profile.service;

            const vendor =
              service?.vendor;

            const sellerTypeInfo =
              publicSellerTypeFromBilling(
                vendor?.billing
              );

            const storeName =
              profile.displayName ||
              vendor?.displayName ||
              "Magazin";

            const logoUrl =
              profile.logoUrl ||
              vendor?.logoUrl ||
              null;

            const {
              city,
              citySlug,
            } =
              buildCityMetaFromProfile(
                profile,
                dictionaryMap
              );

            return {
              id:
                service?.id,

              profileSlug:
                profile.slug ||
                null,

              storeName,

              displayName:
                storeName,

              city,
              citySlug,
              logoUrl,

              sellerType:
                sellerTypeInfo
                  .sellerType,

              sellerTypeLabel:
                sellerTypeInfo
                  .sellerTypeLabel,
            };
          }
        );

      res.set(
        "Cache-Control",
        "public, max-age=15, stale-while-revalidate=60"
      );

      return res.json({
        stores,
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   GET /api/public/store/:slug
========================================================= */

router.get(
  "/store/:slug",
  async (
    req,
    res,
    next
  ) => {
    try {
      const slug =
        String(
          req.params.slug ||
            ""
        )
          .trim()
          .toLowerCase();

      if (!slug) {
        return res
          .status(400)
          .json({
            error:
              "invalid_slug",
          });
      }

      const profile =
        await prisma.serviceProfile.findUnique({
          where: {
            slug,
          },

          include: {
            service: {
              include: {
                type:
                  true,

                vendor: {
                  include: {
                    billing: {
                      select: {
                        sellerType:
                          true,

                        legalType:
                          true,

                        companyName:
                          true,

                        cui:
                          true,

                        regCom:
                          true,

                        vatStatus:
                          true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

      if (
        !profile ||
        !profile.service
          ?.isActive ||
        profile.service
          ?.status !==
          "ACTIVE" ||
        !profile.service
          ?.vendor
          ?.isActive ||
        profile.service
          ?.type
          ?.code !==
          "products"
      ) {
        return res
          .status(404)
          .json({
            error:
              "store_not_found",
          });
      }

      const service =
        profile.service;

      const vendor =
        service.vendor;

      const sellerTypeInfo =
        publicSellerTypeFromBilling(
          vendor.billing
        );

      res.set(
        "Cache-Control",
        "public, max-age=5, stale-while-revalidate=30"
      );

      return res.json({
        serviceId:
          service.id,

        vendorId:
          vendor.id,

        userId:
          vendor.userId,

        slug:
          profile.slug,

        shopName:
          profile.displayName ||
          vendor.displayName ||
          "Magazin",

        displayName:
          profile.displayName ||
          vendor.displayName ||
          "Magazin",

        shortDescription:
          profile
            .shortDescription ||
          "",

        tagline:
          profile.tagline ||
          "",

        about:
          profile.about ||
          vendor.about ||
          "",

        city:
          profile.city ||
          service.city ||
          vendor.city ||
          "",

        citySlug:
          profile.citySlug ||
          service.citySlug ||
          vendor.citySlug ||
          null,

        country:
          "România",

        address:
          profile.address ||
          vendor.address ||
          "",

        publicEmail:
          profile.email ||
          vendor.email ||
          "",

        email:
          profile.email ||
          vendor.email ||
          "",

        phone:
          profile.phone ||
          vendor.phone ||
          "",

        website:
          profile.website ||
          vendor.website ||
          "",

        delivery:
          Array.isArray(
            profile.delivery
          )
            ? profile.delivery
            : [],

        logoUrl:
          profile.logoUrl ||
          vendor.logoUrl ||
          "",

        coverUrl:
          profile.coverUrl ||
          vendor.coverUrl ||
          "",

        profileImageUrl:
          profile.logoUrl ||
          vendor.logoUrl ||
          "",

        coverImageUrl:
          profile.coverUrl ||
          vendor.coverUrl ||
          "",

        leadTimes:
          service
            .attributes
            ?.leadTimes ||
          "",

        status:
          "active",

        sellerType:
          sellerTypeInfo
            .sellerType,

        sellerTypeLabel:
          sellerTypeInfo
            .sellerTypeLabel,

        updatedAt:
          profile.updatedAt,

        profile,
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   GET /api/public/store/:slug/initial
========================================================= */

router.get(
  "/store/:slug/initial",
  async (
    req,
    res,
    next
  ) => {
    try {
      const slug =
        String(
          req.params.slug ||
            ""
        )
          .trim()
          .toLowerCase();

      if (!slug) {
        return res
          .status(400)
          .json({
            error:
              "invalid_slug",
          });
      }

      const profile =
        await prisma.serviceProfile.findUnique({
          where: {
            slug,
          },

          include: {
            service: {
              include: {
                type:
                  true,

                vendor: {
                  include: {
                    billing: {
                      select: {
                        sellerType:
                          true,

                        legalType:
                          true,

                        companyName:
                          true,

                        cui:
                          true,

                        regCom:
                          true,

                        vatStatus:
                          true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

      if (
        !profile ||
        !profile.service
          ?.isActive ||
        profile.service
          ?.status !==
          "ACTIVE" ||
        !profile.service
          ?.vendor
          ?.isActive ||
        profile.service
          ?.type
          ?.code !==
          "products"
      ) {
        return res
          .status(404)
          .json({
            error:
              "store_not_found",
          });
      }

      const service =
        profile.service;

      const vendor =
        service.vendor;

      const sellerTypeInfo =
        publicSellerTypeFromBilling(
          vendor.billing
        );

      const products =
        await prisma.product.findMany({
          where: {
            serviceId:
              profile.serviceId,

            isActive:
              true,

            isHidden:
              false,

            moderationStatus:
              "APPROVED",
          },

          orderBy: {
            createdAt:
              "desc",
          },

          take:
            24,
        });

      let promotedProducts =
        products;

      try {
        promotedProducts =
          await applyPromotionsToProducts(
            products
          );
      } catch (
        promotionError
      ) {
        console.error(
          "[public store initial] promotion pricing failed:",
          promotionError
        );
      }

      res.set(
        "Cache-Control",
        "public, max-age=0, must-revalidate"
      );

      return res.json({
        shop: {
          serviceId:
            service.id,

          vendorId:
            vendor.id,

          userId:
            vendor.userId,

          slug:
            profile.slug,

          shopName:
            profile.displayName ||
            vendor.displayName ||
            "Magazin",

          displayName:
            profile.displayName ||
            vendor.displayName ||
            "Magazin",

          shortDescription:
            profile
              .shortDescription ||
            "",

          tagline:
            profile.tagline ||
            "",

          about:
            profile.about ||
            vendor.about ||
            "",

          city:
            profile.city ||
            service.city ||
            vendor.city ||
            "",

          citySlug:
            profile.citySlug ||
            service.citySlug ||
            vendor.citySlug ||
            null,

          country:
            "România",

          address:
            profile.address ||
            vendor.address ||
            "",

          publicEmail:
            profile.email ||
            vendor.email ||
            "",

          email:
            profile.email ||
            vendor.email ||
            "",

          phone:
            profile.phone ||
            vendor.phone ||
            "",

          website:
            profile.website ||
            vendor.website ||
            "",

          delivery:
            Array.isArray(
              profile.delivery
            )
              ? profile.delivery
              : [],

          logoUrl:
            profile.logoUrl ||
            vendor.logoUrl ||
            "",

          coverUrl:
            profile.coverUrl ||
            vendor.coverUrl ||
            "",

          profileImageUrl:
            profile.logoUrl ||
            vendor.logoUrl ||
            "",

          coverImageUrl:
            profile.coverUrl ||
            vendor.coverUrl ||
            "",

          leadTimes:
            service
              .attributes
              ?.leadTimes ||
            "",

          status:
            "active",

          sellerType:
            sellerTypeInfo
              .sellerType,

          sellerTypeLabel:
            sellerTypeInfo
              .sellerTypeLabel,

          updatedAt:
            profile.updatedAt,
        },

        products:
          promotedProducts.map(
            mapPublicProduct
          ),
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   GET /api/public/store/:slug/products
========================================================= */

router.get(
  "/store/:slug/products",
  async (
    req,
    res,
    next
  ) => {
    try {
      const slug =
        String(
          req.params.slug ||
            ""
        )
          .trim()
          .toLowerCase();

      if (!slug) {
        return res
          .status(400)
          .json({
            error:
              "invalid_slug",
          });
      }

      const profile =
        await prisma.serviceProfile.findUnique({
          where: {
            slug,
          },

          include: {
            service: {
              include: {
                type:
                  true,

                vendor:
                  true,
              },
            },
          },
        });

      if (
        !profile ||
        !profile.service
          ?.isActive ||
        profile.service
          ?.status !==
          "ACTIVE" ||
        !profile.service
          ?.vendor
          ?.isActive ||
        profile.service
          ?.type
          ?.code !==
          "products"
      ) {
        return res
          .status(404)
          .json({
            error:
              "store_not_found",
          });
      }

      const page =
        Math.max(
          1,
          parseInt(
            req.query.page ||
              "1",
            10
          )
        );

      const limit =
        Math.min(
          60,
          Math.max(
            1,
            parseInt(
              req.query.limit ||
                "24",
              10
            )
          )
        );

      const skip =
        (
          page - 1
        ) * limit;

      const sort =
        String(
          req.query.sort ||
            "new"
        ).trim();

      const where = {
        serviceId:
          profile.serviceId,

        isActive:
          true,

        isHidden:
          false,

        moderationStatus:
          "APPROVED",
      };

      const [
        total,
        items,
      ] =
        await Promise.all([
          prisma.product.count({
            where,
          }),

          prisma.product.findMany({
            where,
            skip,
            take:
              limit,

            orderBy:
              buildProductOrderBy(
                sort
              ),
          }),
        ]);

      let promotedItems =
        items;

      try {
        promotedItems =
          await applyPromotionsToProducts(
            items
          );
      } catch (
        promotionError
      ) {
        console.error(
          "[public store products] promotion pricing failed:",
          promotionError
        );
      }

      res.set(
        "Cache-Control",
        "public, max-age=0, must-revalidate"
      );

      return res.json({
        total,
        page,
        limit,

        items:
          promotedItems.map(
            mapPublicProduct
          ),
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   GET /api/public/stores/cities
========================================================= */

router.get(
  "/stores/cities",
  async (
    _req,
    res,
    next
  ) => {
    try {
      const dictionaryMap =
        await getCityDictMapCached();

      const profileCities =
        await prisma.serviceProfile.findMany({
          where: {
            service: {
              is: {
                isActive:
                  true,

                status:
                  "ACTIVE",

                vendor: {
                  is: {
                    isActive:
                      true,
                  },
                },

                type: {
                  is: {
                    code:
                      "products",
                  },
                },
              },
            },

            OR: [
              {
                city: {
                  not:
                    null,
                },
              },

              {
                citySlug: {
                  not:
                    null,
                },
              },
            ],
          },

          select: {
            city:
              true,

            citySlug:
              true,
          },
        });

      const vendorCities =
        await prisma.vendor.findMany({
          where: {
            isActive:
              true,

            OR: [
              {
                city: {
                  not:
                    null,
                },
              },

              {
                citySlug: {
                  not:
                    null,
                },
              },
            ],
          },

          select: {
            city:
              true,

            citySlug:
              true,
          },
        });

      const allCities = [
        ...profileCities,
        ...vendorCities,
      ];

      const citiesMap =
        new Map();

      for (
        const row of
        allCities
      ) {
        const rawLabel =
          String(
            row.city ||
              ""
          ).trim();

        if (!rawLabel) {
          continue;
        }

        const citySlug =
          row.citySlug ||
          normalizeCityName(
            rawLabel
          );

        if (!citySlug) {
          continue;
        }

        const fromDictionary =
          String(
            dictionaryMap.get(
              citySlug
            ) ||
              ""
          ).trim();

        if (
          fromDictionary
        ) {
          citiesMap.set(
            citySlug,
            fromDictionary
          );

          continue;
        }

        const existing =
          citiesMap.get(
            citySlug
          ) ||
          null;

        const better =
          pickBetterLabel(
            existing,
            rawLabel
          );

        citiesMap.set(
          citySlug,
          better
        );
      }

      const cities =
        Array.from(
          citiesMap.entries()
        )
          .map(
            ([
              citySlug,
              label,
            ]) => ({
              slug:
                citySlug,

              label,
            })
          )
          .sort(
            (
              first,
              second
            ) =>
              first.label.localeCompare(
                second.label,
                "ro-RO",
                {
                  sensitivity:
                    "base",
                }
              )
          );

      res.set(
        "Cache-Control",
        "public, max-age=3600, stale-while-revalidate=86400"
      );

      return res.json({
        cities,
      });
    } catch (error) {
      return next(
        error
      );
    }
  }
);

/* =========================================================
   CATEGORII PUBLICE
========================================================= */

router.get(
  "/categories",
  (
    _req,
    res
  ) => {
    return res.json(
      CATEGORIES
    );
  }
);

router.get(
  "/categories/detailed",
  (
    _req,
    res
  ) => {
    return res.json(
      CATEGORIES_DETAILED
    );
  }
);

/* =========================================================
   STATISTICI CATEGORII
========================================================= */

router.get(
  "/products/categories/stats",
  async (
    _req,
    res,
    next
  ) => {
    try {
      const groupedProducts =
        await prisma.product.groupBy({
          by: [
            "category",
          ],

          where: {
            isActive:
              true,

            isHidden:
              false,

            moderationStatus:
              "APPROVED",

            category: {
              not:
                null,
            },

            service: {
              is: {
                isActive:
                  true,

                status:
                  "ACTIVE",

                vendor: {
                  is: {
                    isActive:
                      true,
                  },
                },

                type: {
                  is: {
                    code:
                      "products",
                  },
                },
              },
            },
          },

          _count: {
            category:
              true,
          },
        });

      const output =
        groupedProducts
          .filter(
            (row) =>
              row.category &&
              CATEGORY_SET.has(
                row.category
              )
          )
          .map(
            (row) => ({
              category:
                row.category,

              count:
                row._count
                  .category,
            })
          )
          .sort(
            (
              first,
              second
            ) =>
              second.count -
              first.count
          );

      return res.json(
        output
      );
    } catch (error) {
      return next(
        error
      );
    }
  }
);

export default router;