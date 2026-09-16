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

import {
  getCampaignStats,
} from "../services/vendorAttributionStats.js";

import {
  computeVendorEarningForShipment,
} from "./vendorOrdersRoutes.js";

import {
  MAX_TOTAL_DISCOUNT_PERCENT,
  computeFundingFields,
  splitDiscountPercentForDisplay,
} from "./vendorDiscountCodesRoutes.js";

const router =
  express.Router();

/* =========================================================
   CONFIG
========================================================= */

export { MAX_TOTAL_DISCOUNT_PERCENT };

/*
 * REGULA FINALĂ DE BUSINESS (audit 2026-09-14): VendorCampaign e
 * tehnic DOAR OWN-SALE (validateOwnedProducts mai jos impune strict
 * produse proprii - nu există niciun scenariu cross-vendor pentru
 * campanii). De aceea UN SINGUR câmp discount (0-50%), 100% suportat
 * de vendor - NU mai există split Artfest/Vendor în UI-ul nou pentru
 * campanii NOI (spre deosebire de audit 2026-09-13, rundă anterioară).
 *
 * Câmpurile Prisma platformFundingBps/vendorFundingBps/fundingSource
 * RĂMÂN pe model (backward compatibility, cerut explicit) - campanii
 * VECHI cu split SHARED real (create în runda anterioară) își păstrează
 * afișarea corectă prin splitDiscountPercentForDisplay, fără backfill.
 * Pentru campanii NOI, computeFundingFields e apelat mereu cu
 * artfestDiscountPercent: 0 -> fundingSource "VENDOR" garantat.
 */
function normalizeCampaignDiscount(value) {
  const n = Number(value);

  if (!Number.isInteger(n) || n < 0 || n > MAX_TOTAL_DISCOUNT_PERCENT) {
    return null;
  }

  return n;
}

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

/*
 * `stats` - din getCampaignStats() (vendorAttributionStats.js),
 * calculate LIVE din Shipment/ShipmentItem. NECESAR pentru că
 * VendorCampaign.attributedOrdersCount/attributedRevenueCents NU
 * sunt incrementate NICĂIERI în cod (verificat la audit) - rămân
 * mereu 0 dacă le citim direct din coloană. Când `stats` e furnizat,
 * înlocuim acele 2 câmpuri cu valorile reale; când lipsește
 * (apelant vechi), rămân pe coloana stocată (0), comportament
 * identic cu înainte.
 */
function mapCampaign(
  campaign,
  stats = null
) {
  /*
   * Split Artfest/Vendor - reconstruit din discountPercent (total) +
   * fundingSource/platformFundingBps, IDENTIC ca sursă cu
   * vendorDiscountCodesRoutes.js (splitDiscountPercentForDisplay,
   * reutilizată, nu recalculată). Campanie legacy (fundingSource
   * null) => artfestDiscountPercent 0, vendorDiscountPercent = total,
   * exact comportamentul dinainte de split.
   */
  const { artfestDiscountPercent, vendorDiscountPercent } =
    splitDiscountPercentForDisplay(campaign);

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
    totalDiscountPercent:
      campaign.discountPercent,
    artfestDiscountPercent,
    vendorDiscountPercent,
    fundingSource:
      campaign.fundingSource,

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
      stats
        ? stats.ordersCount
        : campaign.attributedOrdersCount,

    attributedRevenueCents:
      stats
        ? Math.round(stats.salesValue * 100)
        : campaign.attributedRevenueCents,

    attributedRevenue:
      stats
        ? stats.salesValue
        : campaign.attributedRevenueCents / 100,

    /*
     * Statistici suplimentare, doar când `stats` e furnizat (listă/
     * detaliu îmbogățite) - vezi getCampaignStats().
     */
    productsSoldCount:
      stats?.productsSoldCount ??
      null,

    discountGiven:
      stats?.discountGiven ??
      null,

    artfestFunded:
      stats?.artfestFunded ??
      null,

    vendorFunded:
      stats?.vendorFunded ??
      null,

    vendorNetGenerated:
      stats?.vendorNetGenerated ??
      null,

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

      const statsByCampaignId =
        await getCampaignStats(
          campaigns.map((c) => c.id)
        );

      const items =
        campaigns.map(
          (campaign) =>
            mapCampaign(
              campaign,
              statsByCampaignId.get(campaign.id)
            )
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

        maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
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

      const discountPercent = normalizeCampaignDiscount(
        req.body?.discountPercent ?? 0
      );

      if (discountPercent === null) {
        return res.status(400).json({
          error: "invalid_discount",
          message: `Reducerea trebuie să fie un număr întreg între 0% și ${MAX_TOTAL_DISCOUNT_PERCENT}%.`,
        });
      }

      /*
       * Campanie = mereu OWN-SALE (own-products-only, vezi
       * validateOwnedProducts mai jos) - fundingSource FORȚAT VENDOR,
       * niciodată SHARED pentru campanii NOI.
       */
      const { totalDiscountPercent: _ignored, ...fundingFields } =
        computeFundingFields({
          artfestDiscountPercent: 0,
          vendorDiscountPercent: discountPercent,
        });

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
            ...fundingFields,

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

          maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
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

      const statsByCampaignId =
        await getCampaignStats([
          campaign.id,
        ]);

      return res.json({
        campaign:
          mapCampaign(
            campaign,
            statsByCampaignId.get(
              campaign.id
            )
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
   GET /:campaignId/orders

   Comenzile/componentele atribuite acestei campanii - filtrăm
   STRICT pe Shipment.campaignId = această campanie (NU pe orderId),
   ca să nu expunem componente ale altor vendori dintr-o comandă
   multi-vendor care nu au legătură cu campania.

   NU e înregistrată în manifest-ul AI (vendorCampaigns.manifest.js) -
   nu modificăm manifeste în această rundă.
========================================================= */

router.get(
  "/:campaignId/orders",
  async (req, res) => {
    try {
      const vendor =
        await getVendorForRequest(req);

      if (!vendor) {
        return res.status(404).json({
          error: "vendor_not_found",
        });
      }

      const campaign =
        await prisma.vendorCampaign.findFirst({
          where: {
            id: req.params.campaignId,
            vendorId: vendor.id,
          },
          select: { id: true },
        });

      if (!campaign) {
        return res.status(404).json({
          error: "campaign_not_found",
          message: "Campania nu a fost găsită.",
        });
      }

      const page = Math.max(
        parseInt(req.query.page ?? "1", 10) || 1,
        1
      );
      const pageSizeRaw =
        parseInt(req.query.pageSize ?? "20", 10) || 20;
      const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

      const where = { campaignId: campaign.id };

      const [shipments, total] = await Promise.all([
        prisma.shipment.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },

          select: {
            id: true,
            vendorId: true,
            status: true,
            order: {
              select: {
                id: true,
                orderNumber: true,
                createdAt: true,
              },
            },
            items: {
              select: {
                title: true,
                qty: true,
                price: true,
                discountAmount: true,
                discountSource: true,
              },
            },
          },
        }),

        prisma.shipment.count({ where }),
      ]);

      const rows = await Promise.all(
        shipments.map(async (shipment) => {
          let vendorNet = null;

          try {
            const earning = await computeVendorEarningForShipment({
              vendorId: shipment.vendorId,
              shipmentId: shipment.id,
            });

            vendorNet = Number(earning?.vendorNet || 0);
          } catch {
            vendorNet = null;
          }

          const value = (shipment.items || []).reduce(
            (sum, it) =>
              sum + Number(it.price || 0) * Number(it.qty || 0),
            0
          );

          const discountFromCampaign = (shipment.items || []).reduce(
            (sum, it) =>
              it.discountSource === "CAMPAIGN"
                ? sum + Number(it.discountAmount || 0)
                : sum,
            0
          );

          return {
            shipmentId: shipment.id,
            orderId: shipment.order?.id || null,
            orderNumber: shipment.order?.orderNumber || null,
            orderDate: shipment.order?.createdAt || null,
            shipmentStatus: shipment.status,
            products: (shipment.items || []).map((it) => ({
              title: it.title,
              qty: it.qty,
            })),
            value,
            discountGiven: discountFromCampaign,
            vendorNet,
          };
        })
      );

      return res.json({
        items: rows,
        total,
        page,
        pageSize,
      });
    } catch (error) {
      console.error(
        "[vendor-campaigns] orders:",
        error
      );

      return res.status(500).json({
        error: "campaign_orders_load_failed",
        message: "Nu am putut încărca comenzile campaniei.",
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

      if (req.body?.discountPercent !== undefined) {
        const discountPercent = normalizeCampaignDiscount(
          req.body.discountPercent
        );

        if (discountPercent === null) {
          return res.status(400).json({
            error: "invalid_discount",
            message: `Reducerea trebuie să fie un număr întreg între 0% și ${MAX_TOTAL_DISCOUNT_PERCENT}%.`,
          });
        }

        /*
         * Editarea unei campanii VECHI cu split SHARED (rundă
         * anterioară) resetează funding-ul la 100% vendor - regula
         * finală nu mai permite split pe câmpul unic din UI-ul nou.
         * Nu e backfill (nimic nu se schimbă până la un edit
         * deliberat al vendorului).
         */
        const { totalDiscountPercent, ...fundingFields } =
          computeFundingFields({
            artfestDiscountPercent: 0,
            vendorDiscountPercent: discountPercent,
          });

        data.discountPercent = totalDiscountPercent;
        data.platformFundingBps = fundingFields.platformFundingBps;
        data.vendorFundingBps = fundingFields.vendorFundingBps;
        data.fundingSource = fundingFields.fundingSource;
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

        maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
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

      /*
       * GĂSIT LA AUDIT: spre deosebire de DiscountCode (care blochează
       * ștergerea dacă are redemptions/usedCount), campania nu avea
       * NICIO protecție - ștergerea unei campanii cu comenzi reale
       * atribuite ar fi pus NULL pe Shipment.campaignId (onDelete:
       * SetNull), pierzând definitiv identitatea campaniei pentru
       * acele comenzi istorice. Adăugăm aceeași protecție, simetrică.
       */
      const attributedShipmentsCount =
        await prisma.shipment.count({
          where: { campaignId: campaign.id },
        });

      if (attributedShipmentsCount > 0) {
        return res.status(409).json({
          error:
            "campaign_has_attributed_orders",

          message:
            "Această campanie are deja comenzi atribuite și nu mai poate fi ștearsă. O poți dezactiva pentru a păstra istoricul comenzilor.",
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