// backend/src/routes/adminVendorCampaignsRoutes.js

/*
 * Admin - vizibilitate READ-ONLY (+ toggle activ/inactiv) asupra
 * campaniilor create de VENDORI (VendorCampaign). Mirror structural
 * cu adminVendorDiscountCodesRoutes.js / adminInfluencersRoutes.js.
 *
 * REUTILIZEAZĂ modelul existent VendorCampaign/VendorCampaignProduct -
 * NU schimbăm Prisma. commissionBps este deja controlat exclusiv de
 * Artfest la creare (vendorCampaignRoutes.js, CAMPAIGN_COMMISSION_BPS),
 * vendorul nu-l poate schimba - admin îl vede, nu îl editează aici.
 *
 * Separare de influenceri: acest fișier NU atinge InfluencerCollection/
 * InfluencerFile/InfluencerCommissionAgreement - strict VendorCampaign.
 *
 * NU expunem date din VendorBilling - select explicit, minimal, pe
 * Vendor (id/displayName/city/isActive).
 */

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  getCampaignStats,
  computeAdminAttributionRow,
} from "../services/vendorAttributionStats.js";
import { splitDiscountPercentForDisplay } from "./vendorDiscountCodesRoutes.js";

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user?.sub) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  prisma.user
    .findUnique({
      where: { id: req.user.sub },
      select: { id: true, role: true },
    })
    .then((user) => {
      if (!user) {
        return res.status(401).json({ ok: false, error: "user_not_found" });
      }

      if (user.role !== "ADMIN") {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      req.adminUser = user;
      next();
    })
    .catch((error) => {
      console.error("[adminVendorCampaigns] adminOnly error:", error);
      return res.status(500).json({ ok: false, error: "auth_check_failed" });
    });
}

router.use(authRequired, adminOnly);

/* =========================================================
   SERIALIZARE - identică ca formă cu mapCampaign din
   vendorCampaignRoutes.js (nu importăm direct - acel fișier e
   scoped pe vendorul cerut din JWT, aici e admin, cuplarea ar
   introduce risc de confuzie de scope; duplicare intenționată,
   formă identică, fără logică nouă).
========================================================= */

/*
 * GĂSIT LA AUDIT: VendorCampaign.attributedOrdersCount/
 * attributedRevenueCents NU sunt incrementate nicăieri în cod - rămân
 * mereu 0. Când `stats` (getCampaignStats) e furnizat, îl folosim în
 * locul coloanei stocate.
 */
function serializeListRow(campaign, stats = null) {
  return {
    id: campaign.id,
    name: campaign.name,
    slug: campaign.slug,
    publicPath: `/c/${campaign.slug}`,

    vendor: campaign.vendor
      ? {
          id: campaign.vendor.id,
          displayName: campaign.vendor.displayName,
          city: campaign.vendor.city,
          isActive: campaign.vendor.isActive,
        }
      : null,

    isActive: campaign.isActive,
    scope: campaign.scope,

    /*
     * VendorCampaign e tehnic DOAR own-products (validateOwnedProducts
     * din vendorCampaignRoutes.js) - promotionMode e mereu OWN_PRODUCTS,
     * afișat totuși explicit pentru consistență cu coduri/colecții
     * (regula finală de business, audit 2026-09-14).
     */
    promotionMode: "OWN_PRODUCTS",

    discountPercent: campaign.discountPercent,
    totalDiscountPercent: campaign.discountPercent,

    /*
     * Split Artfest/Vendor - reconstruit din discountPercent +
     * fundingSource/platformFundingBps, reutilizând EXACT
     * splitDiscountPercentForDisplay din vendorDiscountCodesRoutes.js
     * (aceeași sursă ca ecranul vendorului, nicio logică nouă).
     * Campanie legacy (fundingSource null) => Artfest 0%, Vendor =
     * totalul, identic comportamentul dinainte de split.
     */
    ...splitDiscountPercentForDisplay(campaign),
    fundingSource: campaign.fundingSource,

    commissionBps: campaign.commissionBps,
    commissionPercent: campaign.commissionBps / 100,

    attributionWindowHours: campaign.attributionWindowHours,

    visits: campaign.visits,
    attributedOrdersCount: stats
      ? stats.ordersCount
      : campaign.attributedOrdersCount,
    attributedRevenueCents: stats
      ? Math.round(stats.salesValue * 100)
      : campaign.attributedRevenueCents,
    attributedRevenue: stats
      ? stats.salesValue
      : campaign.attributedRevenueCents / 100,

    productsSoldCount: stats?.productsSoldCount ?? null,
    discountGiven: stats?.discountGiven ?? null,
    artfestFunded: stats?.artfestFunded ?? null,
    vendorFunded: stats?.vendorFunded ?? null,
    vendorNetGenerated: stats?.vendorNetGenerated ?? null,

    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,

    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,

    productsCount: Number(campaign?._count?.products || 0),
    creativesCount: Number(campaign?._count?.creatives || 0),
  };
}

const listInclude = {
  vendor: {
    select: { id: true, displayName: true, city: true, isActive: true },
  },

  _count: {
    select: { products: true, creatives: true },
  },
};

/* =========================================================
   GET /api/admin/vendor-campaigns

   Query: page, pageSize, q (nume campanie sau magazin), status
   (active|inactive), scope.
========================================================= */

router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize ?? "25", 10) || 25;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

    const { q, status, scope } = req.query;

    const where = {
      ...(q
        ? {
            OR: [
              { name: { contains: String(q).trim(), mode: "insensitive" } },
              {
                vendor: {
                  displayName: {
                    contains: String(q).trim(),
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),

      ...(status === "active" ? { isActive: true } : {}),
      ...(status === "inactive" ? { isActive: false } : {}),

      ...(scope ? { scope: String(scope) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.vendorCampaign.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
        orderBy: { createdAt: "desc" },
      }),

      prisma.vendorCampaign.count({ where }),
    ]);

    const statsByCampaignId = await getCampaignStats(
      items.map((c) => c.id)
    );

    return res.json({
      ok: true,
      items: items.map((c) =>
        serializeListRow(c, statsByCampaignId.get(c.id))
      ),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("[adminVendorCampaigns] GET / error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_campaigns_load_failed",
      message: "Nu am putut încărca campaniile.",
    });
  }
});

/* =========================================================
   GET /api/admin/vendor-campaigns/:id

   Detalii complete + produsele incluse (imagine/titlu/preț/status/
   link), din Product - date deja existente, fără analytics nou.
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const campaign = await prisma.vendorCampaign.findFirst({
      where: { id },
      include: {
        ...listInclude,

        products: {
          select: {
            product: {
              select: {
                id: true,
                title: true,
                priceCents: true,
                images: true,
                isActive: true,
                isHidden: true,
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "campaign_not_found",
        message: "Campania nu a fost găsită.",
      });
    }

    const statsByCampaignId = await getCampaignStats([campaign.id]);

    return res.json({
      ok: true,
      campaign: {
        ...serializeListRow(campaign, statsByCampaignId.get(campaign.id)),

        products: campaign.products.map((link) => ({
          id: link.product.id,
          title: link.product.title,
          priceCents: link.product.priceCents,
          imageUrl: link.product.images?.[0] || null,
          isActive: link.product.isActive,
          isHidden: link.product.isHidden,
          link: `/produs/${link.product.id}`,
        })),
      },
    });
  } catch (error) {
    console.error("[adminVendorCampaigns] GET /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_campaign_load_failed",
      message: "Nu am putut încărca campania.",
    });
  }
});

/* =========================================================
   GET /api/admin/vendor-campaigns/:id/orders

   Identic ca logică cu GET /api/vendor/campaigns/:campaignId/orders -
   filtrăm STRICT pe Shipment.campaignId, nu pe orderId.
========================================================= */

router.get("/:id/orders", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const campaign = await prisma.vendorCampaign.findFirst({
      where: { id },
      select: {
        id: true,
        vendorId: true,
        vendor: { select: { id: true, displayName: true } },
      },
    });

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        error: "campaign_not_found",
        message: "Campania nu a fost găsită.",
      });
    }

    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize ?? "20", 10) || 20;
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
          referrerVendorCommissionBpsSnapshot: true,
          vendor: { select: { id: true, displayName: true } },
          order: {
            select: { id: true, orderNumber: true, createdAt: true },
          },
          vendorReferralEarningEntry: {
            select: { earningNet: true },
          },
          items: {
            select: {
              title: true,
              qty: true,
              price: true,
              originalPrice: true,
              discountAmount: true,
              discountSource: true,
              platformDiscountAmount: true,
              vendorDiscountAmount: true,
            },
          },
        },
      }),

      prisma.shipment.count({ where }),
    ]);

    /*
     * VendorCampaign e tehnic DOAR own-products (validateOwnedProducts
     * din vendorCampaignRoutes.js) - promoterVendorId === sellerVendorId
     * mereu (campaign.vendorId), deci promotionType e mereu OWN_SALE.
     * Lucrăm STRICT per shipment (o comandă multi-vendor cu campania
     * unui singur vendor atribuie o singură componentă), niciodată per
     * orderId (regula finală de business, audit 2026-09-14).
     */
    const rows = await Promise.all(
      shipments.map(async (shipment) => {
        const attribution = await computeAdminAttributionRow({
          sellerVendorId: shipment.vendorId,
          promoterVendorId: campaign.vendorId,
          shipment,
        });

        const grossValue = (shipment.items || []).reduce(
          (sum, it) =>
            sum +
            Number(it.originalPrice ?? it.price ?? 0) * Number(it.qty || 0),
          0
        );

        const netValue = (shipment.items || []).reduce(
          (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
          0
        );

        const discountFromCampaign = (shipment.items || []).reduce(
          (sum, it) =>
            it.discountSource === "CAMPAIGN"
              ? sum + Number(it.discountAmount || 0)
              : sum,
          0
        );

        const artfestFunded = (shipment.items || []).reduce(
          (sum, it) =>
            it.discountSource === "CAMPAIGN"
              ? sum + Number(it.platformDiscountAmount || 0)
              : sum,
          0
        );

        const vendorFunded = (shipment.items || []).reduce(
          (sum, it) =>
            it.discountSource === "CAMPAIGN"
              ? sum + Number(it.vendorDiscountAmount || 0)
              : sum,
          0
        );

        const whoFundsDiscount =
          artfestFunded > 0 && vendorFunded > 0
            ? "SHARED"
            : artfestFunded > 0
            ? "ARTFEST"
            : vendorFunded > 0
            ? "VENDOR"
            : "NONE";

        return {
          shipmentId: shipment.id,
          orderId: shipment.order?.id || null,
          orderNumber: shipment.order?.orderNumber || null,
          orderDate: shipment.order?.createdAt || null,
          shipmentStatus: shipment.status,

          promotionType: attribution.promotionType,
          promoterVendor: campaign.vendor,
          sellerVendor: shipment.vendor || null,

          products: (shipment.items || []).map((it) => ({
            title: it.title,
            qty: it.qty,
          })),

          grossValue,
          discountAmount: discountFromCampaign,
          whoFundsDiscount,
          artfestFunded,
          vendorFunded,

          artfestCommissionGross: attribution.artfestCommissionGross,
          promoterPercent: attribution.promoterPercent,
          promoterEarning: attribution.promoterEarning,
          netArtfest: attribution.netArtfest,
          netSeller: attribution.netSeller,
          ownSaleBenefit: attribution.ownSaleBenefit,

          /*
           * Compat cu UI-ul existent (AdminVendorCampaignsTab.jsx) -
           * păstrate, neafectate de câmpurile noi de mai sus.
           */
          value: netValue,
          discountGiven: discountFromCampaign,
          vendorNet: attribution.netSeller,
        };
      })
    );

    return res.json({ ok: true, items: rows, total, page, pageSize });
  } catch (error) {
    console.error("[adminVendorCampaigns] GET /:id/orders error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_campaign_orders_load_failed",
      message: "Nu am putut încărca comenzile campaniei.",
    });
  }
});

/* =========================================================
   PATCH /api/admin/vendor-campaigns/:id/status

   Doar activ/inactiv - identic cu PATCH .../status din
   vendorCampaignRoutes.js (fără verificări suplimentare acolo,
   deci fără verificări suplimentare nici aici).
========================================================= */

router.patch("/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const active = req.body?.active;

    if (typeof active !== "boolean") {
      return res.status(400).json({
        ok: false,
        error: "active_required",
        message: "Lipsește valoarea de status (active: true/false).",
      });
    }

    const current = await prisma.vendorCampaign.findFirst({
      where: { id },
      select: { id: true },
    });

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "campaign_not_found",
        message: "Campania nu a fost găsită.",
      });
    }

    const updated = await prisma.vendorCampaign.update({
      where: { id: current.id },
      data: { isActive: active },
      include: listInclude,
    });

    return res.json({
      ok: true,
      message: active
        ? "Campania a fost activată."
        : "Campania a fost dezactivată.",
      campaign: serializeListRow(updated),
    });
  } catch (error) {
    console.error("[adminVendorCampaigns] PATCH /:id/status error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_campaign_toggle_failed",
      message: "Nu am putut modifica statusul campaniei.",
    });
  }
});

export default router;
