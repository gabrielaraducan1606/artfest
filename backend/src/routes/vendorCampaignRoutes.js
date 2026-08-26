// src/routes/vendorCampaignRoutes.js

import express from "express";
import crypto from "crypto";

import {
  prisma,
} from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  getVendorCampaignRoute,
} from "../ai/manifests/vendorCampaigns.manifest.js";

const router =
  express.Router();

/* =========================================================
   CONFIG
========================================================= */

const ALLOWED_DISCOUNTS = [
  0,
  5,
  10,
  15,
];

/*
 * Comisionul redus este controlat
 * exclusiv de Artfest.
 *
 * 500 = 5%
 */
export const CAMPAIGN_COMMISSION_BPS =
  500;

/*
 * 168 ore = 7 zile
 */
const DEFAULT_ATTRIBUTION_WINDOW_HOURS =
  168;

/* =========================================================
   AUTH
========================================================= */

router.use(
  authRequired,
  enforceTokenVersion,
  requireRole(
    "VENDOR",
    "ADMIN"
  )
);

/* =========================================================
   HELPERS
========================================================= */

async function getVendorForRequest(
  req
) {
  const userId =
    req.user?.sub;

  if (!userId) {
    return null;
  }

  return prisma.vendor.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
      userId: true,
      displayName: true,
      isActive: true,
    },
  });
}

function slugify(
  value = ""
) {
  return String(value)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .slice(
      0,
      100
    );
}

function randomSlugSuffix() {
  return crypto
    .randomBytes(4)
    .toString("hex");
}

async function createUniqueSlug(
  name
) {
  const base =
    slugify(name) ||
    "campanie";

  for (
    let attempt = 0;
    attempt < 10;
    attempt += 1
  ) {
    const slug =
      `${base}-${randomSlugSuffix()}`;

    const exists =
      await prisma.vendorCampaign.findUnique({
        where: {
          slug,
        },

        select: {
          id: true,
        },
      });

    if (!exists) {
      return slug;
    }
  }

  return `${base}-${Date.now()}-${randomSlugSuffix()}`;
}

function normalizeScope(
  value
) {
  return value ===
    "SELECTED_PRODUCTS"
    ? "SELECTED_PRODUCTS"
    : "ALL_PRODUCTS";
}

function normalizeDiscount(
  value
) {
  const discount =
    Number(value);

  if (
    !ALLOWED_DISCOUNTS.includes(
      discount
    )
  ) {
    return null;
  }

  return discount;
}

function normalizeDate(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return undefined;
  }

  return date;
}

function normalizeIds(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((id) =>
          String(
            id || ""
          ).trim()
        )
        .filter(Boolean)
    ),
  ].slice(
    0,
    1000
  );
}

async function findOwnedCampaign(
  campaignId,
  vendorId
) {
  return prisma.vendorCampaign.findFirst({
    where: {
      id:
        campaignId,

      vendorId,
    },

    include: {
      products: {
        select: {
          productId:
            true,
        },
      },

      creatives: true,
    },
  });
}

async function validateOwnedProducts(
  vendorId,
  productIds
) {
  const ids =
    normalizeIds(
      productIds
    );

  if (!ids.length) {
    return {
      ok: true,
      ids: [],
    };
  }

  const products =
    await prisma.product.findMany({
      where: {
        id: {
          in: ids,
        },

        service: {
          vendorId,
        },
      },

      select: {
        id: true,
      },
    });

  const ownedIds =
    products.map(
      (product) =>
        product.id
    );

  if (
    ownedIds.length !==
    ids.length
  ) {
    return {
      ok: false,
      ids: ownedIds,
    };
  }

  return {
    ok: true,
    ids: ownedIds,
  };
}

function mapCampaign(
  campaign
) {
  return {
    id:
      campaign.id,

    name:
      campaign.name,

    slug:
      campaign.slug,

    publicPath:
      `/c/${campaign.slug}`,

    isActive:
      campaign.isActive,

    scope:
      campaign.scope,

    discountPercent:
      campaign.discountPercent,

    commissionBps:
      campaign.commissionBps,

    commissionPercent:
      campaign.commissionBps /
      100,

    attributionWindowHours:
      campaign.attributionWindowHours,

    visits:
      campaign.visits,

    attributedOrdersCount:
      campaign.attributedOrdersCount,

    attributedRevenueCents:
      campaign.attributedRevenueCents,

    attributedRevenue:
      campaign.attributedRevenueCents /
      100,

    startsAt:
      campaign.startsAt,

    endsAt:
      campaign.endsAt,

    createdAt:
      campaign.createdAt,

    updatedAt:
      campaign.updatedAt,

    productIds:
      Array.isArray(
        campaign.products
      )
        ? campaign.products.map(
            (item) =>
              item.productId
          )
        : [],

    productsCount:
      campaign._count
        ?.products ??
      campaign.products
        ?.length ??
      0,

    creativesCount:
      campaign._count
        ?.creatives ??
      campaign.creatives
        ?.length ??
      0,
  };
}

/* =========================================================
   GET /
   LISTA CAMPANIILOR
========================================================= */

router.get(
  getVendorCampaignRoute(
    "list"
  ),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaigns =
        await prisma.vendorCampaign.findMany({
          where: {
            vendorId:
              vendor.id,
          },

          orderBy: {
            createdAt:
              "desc",
          },

          include: {
            _count: {
              select: {
                products:
                  true,

                creatives:
                  true,
              },
            },
          },
        });

      const items =
        campaigns.map(
          mapCampaign
        );

      return res.json({
        items,

        total:
          items.length,

        activeCount:
          items.filter(
            (item) =>
              item.isActive
          ).length,
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] list:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaigns_load_failed",

          message:
            "Campaniile nu au putut fi încărcate.",
        });
    }
  }
);

/* =========================================================
   POST /
   CREARE CAMPANIE

   BODY:
   {
     name,
     discountPercent,
     scope,
     productIds?,
     startsAt?,
     endsAt?
   }
========================================================= */

router.post(
  getVendorCampaignRoute(
    "create"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      if (
        vendor.isActive ===
        false
      ) {
        return res
          .status(403)
          .json({
            error:
              "vendor_inactive",

            message:
              "Magazinul trebuie să fie activ pentru a crea campanii.",
          });
      }

      const name =
        String(
          req.body?.name ||
            ""
        )
          .trim()
          .slice(
            0,
            160
          );

      if (!name) {
        return res
          .status(400)
          .json({
            error:
              "name_required",

            message:
              "Scrie un nume pentru campanie.",
          });
      }

      const discountPercent =
        normalizeDiscount(
          req.body
            ?.discountPercent ??
            0
        );

      if (
        discountPercent ===
        null
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_discount",

            message:
              "Reducerea permisă este 0%, 5%, 10% sau 15%.",
          });
      }

      const scope =
        normalizeScope(
          req.body?.scope
        );

      const startsAt =
        normalizeDate(
          req.body?.startsAt
        );

      const endsAt =
        normalizeDate(
          req.body?.endsAt
        );

      if (
        startsAt ===
        undefined ||
        endsAt ===
        undefined
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_date",

            message:
              "Data campaniei nu este validă.",
          });
      }

      if (
        startsAt &&
        endsAt &&
        endsAt <= startsAt
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_period",

            message:
              "Data de final trebuie să fie după data de început.",
          });
      }

      let productIds = [];

      if (
        scope ===
        "SELECTED_PRODUCTS"
      ) {
        const ownership =
          await validateOwnedProducts(
            vendor.id,
            req.body
              ?.productIds
          );

        if (
          !ownership.ok
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_products",

              message:
                "Unele produse selectate nu aparțin magazinului tău.",
            });
        }

        productIds =
          ownership.ids;

        if (
          !productIds.length
        ) {
          return res
            .status(400)
            .json({
              error:
                "products_required",

              message:
                "Selectează cel puțin un produs pentru această campanie.",
            });
        }
      }

      const slug =
        await createUniqueSlug(
          name
        );

      const campaign =
        await prisma.vendorCampaign.create({
          data: {
            vendorId:
              vendor.id,

            name,

            slug,

            isActive:
              true,

            scope,

            discountPercent,

            /*
             * NU folosim valoare
             * venită din frontend.
             */
            commissionBps:
              CAMPAIGN_COMMISSION_BPS,

            attributionWindowHours:
              DEFAULT_ATTRIBUTION_WINDOW_HOURS,

            startsAt,

            endsAt,

            products:
              scope ===
                "SELECTED_PRODUCTS"
                ? {
                    create:
                      productIds.map(
                        (
                          productId
                        ) => ({
                          productId,
                        })
                      ),
                  }
                : undefined,
          },

          include: {
            products: {
              select: {
                productId:
                  true,
              },
            },

            creatives:
              true,
          },
        });

      return res
        .status(201)
        .json({
          ok: true,

          message:
            "Campania a fost creată.",

          campaign:
            mapCampaign(
              campaign
            ),
        });
    } catch (error) {
      console.error(
        "[vendor-campaigns] create:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_create_failed",

          message:
            "Campania nu a putut fi creată.",
        });
    }
  }
);

/* =========================================================
   GET /:campaignId
   DETALII CAMPANIE
========================================================= */

router.get(
  getVendorCampaignRoute(
    "detail"
  ),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaign =
        await findOwnedCampaign(
          req.params
            .campaignId,
          vendor.id
        );

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",

            message:
              "Campania nu a fost găsită.",
          });
      }

      return res.json({
        campaign:
          mapCampaign(
            campaign
          ),

        creatives:
          campaign.creatives,
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] detail:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_load_failed",
        });
    }
  }
);

/* =========================================================
   PATCH /:campaignId
   EDITARE CAMPANIE

   NU permite schimbarea commissionBps.
========================================================= */

router.patch(
  getVendorCampaignRoute(
    "update"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaign =
        await findOwnedCampaign(
          req.params
            .campaignId,
          vendor.id
        );

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",
          });
      }

      const data = {};

      if (
        req.body?.name !==
        undefined
      ) {
        const name =
          String(
            req.body.name ||
              ""
          )
            .trim()
            .slice(
              0,
              160
            );

        if (!name) {
          return res
            .status(400)
            .json({
              error:
                "name_required",
            });
        }

        data.name =
          name;
      }

      if (
        req.body
          ?.discountPercent !==
        undefined
      ) {
        const discount =
          normalizeDiscount(
            req.body
              .discountPercent
          );

        if (
          discount === null
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_discount",

              message:
                "Reducerea permisă este 0%, 5%, 10% sau 15%.",
            });
        }

        data.discountPercent =
          discount;
      }

      if (
        req.body?.startsAt !==
        undefined
      ) {
        const startsAt =
          normalizeDate(
            req.body
              .startsAt
          );

        if (
          startsAt ===
          undefined
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_starts_at",
            });
        }

        data.startsAt =
          startsAt;
      }

      if (
        req.body?.endsAt !==
        undefined
      ) {
        const endsAt =
          normalizeDate(
            req.body
              .endsAt
          );

        if (
          endsAt ===
          undefined
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_ends_at",
            });
        }

        data.endsAt =
          endsAt;
      }

      const finalStartsAt =
        data.startsAt !==
        undefined
          ? data.startsAt
          : campaign.startsAt;

      const finalEndsAt =
        data.endsAt !==
        undefined
          ? data.endsAt
          : campaign.endsAt;

      if (
        finalStartsAt &&
        finalEndsAt &&
        finalEndsAt <=
          finalStartsAt
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_period",

            message:
              "Data de final trebuie să fie după data de început.",
          });
      }

      const updated =
        await prisma.vendorCampaign.update({
          where: {
            id:
              campaign.id,
          },

          data,

          include: {
            products: {
              select: {
                productId:
                  true,
              },
            },

            creatives:
              true,
          },
        });

      return res.json({
        ok: true,

        campaign:
          mapCampaign(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] update:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_update_failed",

          message:
            "Campania nu a putut fi modificată.",
        });
    }
  }
);

/* =========================================================
   PATCH /:campaignId/status

   BODY:
   {
     active: true
   }
========================================================= */

router.patch(
  getVendorCampaignRoute(
    "status"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const active =
        req.body?.active;

      if (
        typeof active !==
        "boolean"
      ) {
        return res
          .status(400)
          .json({
            error:
              "active_required",
          });
      }

      const campaign =
        await prisma.vendorCampaign.findFirst({
          where: {
            id:
              req.params
                .campaignId,

            vendorId:
              vendor.id,
          },

          select: {
            id: true,
          },
        });

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",
          });
      }

      const updated =
        await prisma.vendorCampaign.update({
          where: {
            id:
              campaign.id,
          },

          data: {
            isActive:
              active,
          },

          include: {
            products: {
              select: {
                productId:
                  true,
              },
            },

            creatives:
              true,
          },
        });

      return res.json({
        ok: true,

        message:
          active
            ? "Campania a fost activată."
            : "Campania a fost oprită.",

        campaign:
          mapCampaign(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] status:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_status_failed",
        });
    }
  }
);

/* =========================================================
   PUT /:campaignId/products

   BODY:
   {
     scope: "ALL_PRODUCTS"
   }

   SAU

   {
     scope: "SELECTED_PRODUCTS",
     productIds: [...]
   }
========================================================= */

router.put(
  getVendorCampaignRoute(
    "products"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaign =
        await prisma.vendorCampaign.findFirst({
          where: {
            id:
              req.params
                .campaignId,

            vendorId:
              vendor.id,
          },

          select: {
            id: true,
          },
        });

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",
          });
      }

      const scope =
        normalizeScope(
          req.body?.scope
        );

      let productIds =
        [];

      if (
        scope ===
        "SELECTED_PRODUCTS"
      ) {
        const ownership =
          await validateOwnedProducts(
            vendor.id,
            req.body
              ?.productIds
          );

        if (
          !ownership.ok
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_products",

              message:
                "Unele produse nu aparțin magazinului tău.",
            });
        }

        productIds =
          ownership.ids;

        if (
          !productIds.length
        ) {
          return res
            .status(400)
            .json({
              error:
                "products_required",
            });
        }
      }

      const updated =
        await prisma.$transaction(
          async (
            tx
          ) => {
            await tx.vendorCampaignProduct.deleteMany({
              where: {
                campaignId:
                  campaign.id,
              },
            });

            await tx.vendorCampaign.update({
              where: {
                id:
                  campaign.id,
              },

              data: {
                scope,
              },
            });

            if (
              scope ===
                "SELECTED_PRODUCTS" &&
              productIds.length
            ) {
              await tx.vendorCampaignProduct.createMany({
                data:
                  productIds.map(
                    (
                      productId
                    ) => ({
                      campaignId:
                        campaign.id,

                      productId,
                    })
                  ),

                skipDuplicates:
                  true,
              });
            }

            return tx.vendorCampaign.findUnique({
              where: {
                id:
                  campaign.id,
              },

              include: {
                products: {
                  select: {
                    productId:
                      true,
                  },
                },

                creatives:
                  true,
              },
            });
          }
        );

      return res.json({
        ok: true,

        campaign:
          mapCampaign(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] products:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_products_failed",

          message:
            "Produsele campaniei nu au putut fi actualizate.",
        });
    }
  }
);

/* =========================================================
   GET /:campaignId/creatives
========================================================= */

router.get(
  getVendorCampaignRoute(
    "creatives"
  ),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaign =
        await prisma.vendorCampaign.findFirst({
          where: {
            id:
              req.params
                .campaignId,

            vendorId:
              vendor.id,
          },

          select: {
            id: true,
          },
        });

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",
          });
      }

      const creatives =
        await prisma.vendorCampaignCreative.findMany({
          where: {
            campaignId:
              campaign.id,
          },

          orderBy: {
            createdAt:
              "desc",
          },
        });

      return res.json({
        items:
          creatives,
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] creatives:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_creatives_load_failed",
        });
    }
  }
);

/* =========================================================
   POST /:campaignId/creatives/generate

   Deocamdată PLANNED.
========================================================= */

router.post(
  getVendorCampaignRoute(
    "generateCreatives"
  ),

  async (
    req,
    res
  ) => {
    return res
      .status(501)
      .json({
        error:
          "not_implemented",

        message:
          "Generarea automată a materialelor promoționale va fi disponibilă în curând.",
      });
  }
);

/* =========================================================
   DELETE /:campaignId
========================================================= */

router.delete(
  getVendorCampaignRoute(
    "delete"
  ),

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getVendorForRequest(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const campaign =
        await prisma.vendorCampaign.findFirst({
          where: {
            id:
              req.params
                .campaignId,

            vendorId:
              vendor.id,
          },

          select: {
            id: true,
            name: true,
          },
        });

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",
          });
      }

      await prisma.vendorCampaign.delete({
        where: {
          id:
            campaign.id,
        },
      });

      return res.json({
        ok: true,

        message:
          "Campania a fost ștearsă.",
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] delete:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_delete_failed",

          message:
            "Campania nu a putut fi ștearsă.",
        });
    }
  }
);

export default router;