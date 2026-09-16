// backend/src/routes/adminVendorDiscountCodesRoutes.js

/*
 * Admin - vizibilitate READ-ONLY (+ toggle activ/inactiv) asupra
 * codurilor de reducere create de VENDORI (DiscountCode, ownerType
 * VENDOR). Mirror structural cu adminInfluencersRoutes.js (adminOnly
 * local, verificat fresh din DB, nu doar din JWT).
 *
 * REUTILIZEAZĂ modelul existent DiscountCode - platformFundingBps/
 * vendorFundingBps/fundingSource au fost introduse și corect
 * alimentate de vendorDiscountCodesRoutes.js (audit anterior) - NU
 * schimbăm Prisma, NU introducem o a doua logică financiară.
 *
 * IMPORTANT (separare de influenceri, cerută explicit):
 * - filtrăm STRICT `ownerType: "VENDOR"` - codurile influencer
 *   (ownerType INFLUENCER) NU apar niciodată aici, au propriul tab
 *   deja existent (AdminInfluencersTab.jsx);
 * - NU expunem NICIODATĂ date din VendorBilling (IBAN/date fiscale) -
 *   select explicit, minimal, pe Vendor (id/displayName/city/isActive),
 *   niciun include generic.
 *
 * Admin NU poate edita procentele (artfest/vendor) - doar vede și
 * poate activa/dezactiva. Editarea procentelor rămâne exclusiv a
 * vendorului (business rule confirmată explicit în auditul anterior).
 */

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  getDiscountCodeStats,
  computeAdminAttributionRow,
} from "../services/vendorAttributionStats.js";

const router = Router();

/* =========================================================
   ADMIN GUARD - identic ca formă cu adminInfluencersRoutes.js
   (rol citit fresh din DB, nu doar din JWT).
========================================================= */

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
      console.error("[adminVendorDiscountCodes] adminOnly error:", error);
      return res.status(500).json({ ok: false, error: "auth_check_failed" });
    });
}

router.use(authRequired, adminOnly);

/* =========================================================
   SERIALIZARE - identică ca logică cu splitDiscountPercentForDisplay
   din vendorDiscountCodesRoutes.js (nu importăm din acel fișier ca
   să nu cuplăm o rută admin de una vendor - duplicare intenționată,
   3 linii, nu o a doua logică financiară).
========================================================= */

function splitDiscountPercentForDisplay(discountCode) {
  const total = Number(discountCode?.discountPercent || 0);

  if (discountCode?.fundingSource === "VENDOR") {
    return { artfestDiscountPercent: 0, vendorDiscountPercent: total };
  }

  if (discountCode?.fundingSource === "PLATFORM") {
    return { artfestDiscountPercent: total, vendorDiscountPercent: 0 };
  }

  const platformBps = Math.max(
    0,
    Math.min(10000, Number(discountCode?.platformFundingBps || 0))
  );

  const artfestPart = Math.round((total * platformBps) / 10000);
  const vendorPart = Math.max(0, total - artfestPart);

  return { artfestDiscountPercent: artfestPart, vendorDiscountPercent: vendorPart };
}

const EMPTY_STATS = {
  ordersCount: 0,
  componentsCount: 0,
  salesValue: 0,
  totalDiscount: 0,
  artfestFunded: 0,
  vendorFunded: 0,
  vendorNetGenerated: 0,
};

function serializeListRow(discountCode, stats = null) {
  const { artfestDiscountPercent, vendorDiscountPercent } =
    splitDiscountPercentForDisplay(discountCode);

  return {
    id: discountCode.id,
    code: discountCode.code,
    name: discountCode.name,

    vendor: discountCode.vendor
      ? {
          id: discountCode.vendor.id,
          displayName: discountCode.vendor.displayName,
          city: discountCode.vendor.city,
          isActive: discountCode.vendor.isActive,
        }
      : null,

    isActive: discountCode.isActive,
    status: discountCode.status,

    scope: discountCode.scope,

    /*
     * "Ce promovează" (regula finală de business, audit 2026-09-14) -
     * derivat STRICT din scope, la fel ca derivePromotionMode din
     * vendorDiscountCodesRoutes.js (nu importat aici, aceeași regulă
     * de duplicare minimă documentată mai sus pentru split).
     */
    promotionMode:
      discountCode.scope === "VENDOR_ALL_PRODUCTS"
        ? "OWN_PRODUCTS"
        : "ALL_ARTFEST",

    totalDiscountPercent: discountCode.discountPercent,
    artfestDiscountPercent,
    vendorDiscountPercent,

    fundingSource: discountCode.fundingSource,

    usedCount: discountCode.usedCount,
    usageLimit: discountCode.usageLimit,
    usageLimitPerUser: discountCode.usageLimitPerUser,

    startsAt: discountCode.startsAt,
    endsAt: discountCode.endsAt,

    createdAt: discountCode.createdAt,
    updatedAt: discountCode.updatedAt,

    redemptionsCount: Number(discountCode?._count?.redemptions || 0),

    stats: stats || EMPTY_STATS,
  };
}

const listInclude = {
  vendor: {
    select: { id: true, displayName: true, city: true, isActive: true },
  },

  _count: {
    select: { redemptions: true },
  },
};

/* =========================================================
   GET /api/admin/vendor-discount-codes

   Query: page, pageSize, q (cod sau nume magazin), status
   (active|inactive), funding (PLATFORM|VENDOR|SHARED), scope.
========================================================= */

router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize ?? "25", 10) || 25;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

    const { q, status, funding, scope } = req.query;

    const where = {
      ownerType: "VENDOR",

      ...(q
        ? {
            OR: [
              { code: { contains: String(q).trim(), mode: "insensitive" } },
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

      ...(funding &&
      ["PLATFORM", "VENDOR", "SHARED"].includes(String(funding))
        ? { fundingSource: String(funding) }
        : {}),

      ...(scope ? { scope: String(scope) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.discountCode.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
        orderBy: { createdAt: "desc" },
      }),

      prisma.discountCode.count({ where }),
    ]);

    const statsByCodeId = await getDiscountCodeStats(
      items.map((c) => c.id)
    );

    return res.json({
      ok: true,
      items: items.map((c) =>
        serializeListRow(c, statsByCodeId.get(c.id))
      ),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("[adminVendorDiscountCodes] GET / error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_discount_codes_load_failed",
      message: "Nu am putut încărca codurile de reducere.",
    });
  }
});

/* =========================================================
   GET /api/admin/vendor-discount-codes/:id

   Detalii complete + produse eligibile (dacă scope permite) +
   ultimele comenzi unde a fost folosit (redemptions - rută simplă,
   deja existentă ca model, fără analytics nou).
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const discountCode = await prisma.discountCode.findFirst({
      where: { id, ownerType: "VENDOR" },
      include: {
        ...listInclude,

        vendorCollection: {
          select: { id: true, title: true, slug: true, isActive: true },
        },

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

    if (!discountCode) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    const recentRedemptions = await prisma.discountCodeRedemption.findMany({
      where: { discountCodeId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderId: true,
        customerEmail: true,
        discountAmountCents: true,
        createdAt: true,
      },
    });

    const statsByCodeId = await getDiscountCodeStats([discountCode.id]);

    return res.json({
      ok: true,
      discountCode: {
        ...serializeListRow(discountCode, statsByCodeId.get(discountCode.id)),

        collection: discountCode.vendorCollection
          ? {
              id: discountCode.vendorCollection.id,
              title: discountCode.vendorCollection.title,
              slug: discountCode.vendorCollection.slug,
              isActive: discountCode.vendorCollection.isActive,
            }
          : null,

        eligibleProducts: discountCode.products.map((link) => ({
          id: link.product.id,
          title: link.product.title,
          priceCents: link.product.priceCents,
          imageUrl: link.product.images?.[0] || null,
          isActive: link.product.isActive,
          isHidden: link.product.isHidden,
          link: `/produs/${link.product.id}`,
        })),

        recentRedemptions: recentRedemptions.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          customerEmail: r.customerEmail,
          discountAmount: Number(r.discountAmountCents || 0) / 100,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("[adminVendorDiscountCodes] GET /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_discount_code_load_failed",
      message: "Nu am putut încărca codul de reducere.",
    });
  }
});

/* =========================================================
   GET /api/admin/vendor-discount-codes/:id/orders

   Identic ca logică cu GET /api/vendor/discount-codes/:id/orders -
   filtrăm STRICT pe ShipmentItem.discountCodeId, nu pe orderId.
========================================================= */

router.get("/:id/orders", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const discountCode = await prisma.discountCode.findFirst({
      where: { id, ownerType: "VENDOR" },
      select: {
        id: true,
        vendorId: true,
        vendor: { select: { id: true, displayName: true } },
      },
    });

    if (!discountCode) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    const page = Math.max(parseInt(req.query.page ?? "1", 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize ?? "20", 10) || 20;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);

    const where = { discountCodeId: id };

    const [items, total] = await Promise.all([
      prisma.shipmentItem.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: "desc" },

        select: {
          id: true,
          title: true,
          qty: true,
          price: true,
          originalPrice: true,
          discountAmount: true,
          platformDiscountAmount: true,
          vendorDiscountAmount: true,

          shipment: {
            select: {
              id: true,
              vendorId: true,
              status: true,
              referrerVendorCommissionBpsSnapshot: true,
              vendor: {
                select: { id: true, displayName: true },
              },
              order: {
                select: { id: true, orderNumber: true, createdAt: true },
              },
              vendorReferralEarningEntry: {
                select: { earningNet: true },
              },
            },
          },
        },
      }),

      prisma.shipmentItem.count({ where }),
    ]);

    /*
     * O comandă multi-vendor atribuie o singură componentă (shipment)
     * per vendor - lucrăm STRICT per shipment/ShipmentItem, niciodată
     * per orderId (regula finală de business, audit 2026-09-14).
     */
    const rows = await Promise.all(
      items.map(async (item) => {
        const sellerVendorId = item.shipment?.vendorId || null;

        const attribution = item.shipment
          ? await computeAdminAttributionRow({
              sellerVendorId,
              promoterVendorId: discountCode.vendorId,
              shipment: item.shipment,
            })
          : null;

        const artfestFunded = Number(item.platformDiscountAmount || 0);
        const vendorFunded = Number(item.vendorDiscountAmount || 0);

        const whoFundsDiscount =
          artfestFunded > 0 && vendorFunded > 0
            ? "SHARED"
            : artfestFunded > 0
            ? "ARTFEST"
            : vendorFunded > 0
            ? "VENDOR"
            : "NONE";

        return {
          shipmentItemId: item.id,
          orderId: item.shipment?.order?.id || null,
          orderNumber: item.shipment?.order?.orderNumber || null,
          orderDate: item.shipment?.order?.createdAt || null,
          shipmentStatus: item.shipment?.status || null,

          promotionType: attribution?.promotionType || null,

          promoterVendor: discountCode.vendor,
          sellerVendor: item.shipment?.vendor || null,

          productTitle: item.title,
          qty: item.qty,

          grossValue:
            Number(item.originalPrice ?? item.price ?? 0) *
            Number(item.qty || 0),
          discountAmount: Number(item.discountAmount || 0),
          whoFundsDiscount,
          artfestFunded,
          vendorFunded,

          artfestCommissionGross: attribution?.artfestCommissionGross ?? null,
          promoterPercent: attribution?.promoterPercent ?? null,
          promoterEarning: attribution?.promoterEarning ?? null,
          netArtfest: attribution?.netArtfest ?? null,
          netSeller: attribution?.netSeller ?? null,
          ownSaleBenefit: attribution?.ownSaleBenefit ?? null,

          /*
           * Compat cu UI-ul existent (AdminVendorDiscountCodesTab.jsx) -
           * păstrate, neafectate de câmpurile noi de mai sus.
           */
          sellingVendor: item.shipment?.vendor
            ? {
                id: item.shipment.vendor.id,
                displayName: item.shipment.vendor.displayName,
              }
            : null,
          lineValue: Number(item.price || 0) * Number(item.qty || 0),
          vendorNet: attribution?.netSeller ?? null,
        };
      })
    );

    return res.json({ ok: true, items: rows, total, page, pageSize });
  } catch (error) {
    console.error(
      "[adminVendorDiscountCodes] GET /:id/orders error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_discount_code_orders_load_failed",
      message: "Nu am putut încărca comenzile pentru acest cod.",
    });
  }
});

/* =========================================================
   PATCH /api/admin/vendor-discount-codes/:id/toggle

   Doar activ/inactiv. NU permite modificarea procentelor -
   business rule confirmată: split-ul rămâne exclusiv al
   vendorului. Reutilizează EXACT aceleași verificări de
   siguranță ca toggle-ul vendorului (vendorDiscountCodesRoutes.js)
   - nu reactivăm silențios un cod expirat/epuizat.
========================================================= */

router.patch("/:id/toggle", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const current = await prisma.discountCode.findFirst({
      where: { id, ownerType: "VENDOR" },
      select: {
        id: true,
        isActive: true,
        endsAt: true,
        usageLimit: true,
        usedCount: true,
      },
    });

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    if (
      !current.isActive &&
      current.endsAt &&
      current.endsAt.getTime() < Date.now()
    ) {
      return res.status(400).json({
        ok: false,
        error: "discount_code_expired",
        message:
          "Codul este expirat. Vendorul trebuie să modifice data de expirare înainte să fie reactivat.",
      });
    }

    if (
      !current.isActive &&
      current.usageLimit !== null &&
      current.usageLimit !== undefined &&
      current.usedCount >= current.usageLimit
    ) {
      return res.status(400).json({
        ok: false,
        error: "discount_code_usage_limit_reached",
        message:
          "Codul și-a atins limita de utilizări. Vendorul trebuie să mărească limita înainte să fie reactivat.",
      });
    }

    const nextActive = !current.isActive;

    const updated = await prisma.discountCode.update({
      where: { id: current.id },
      data: {
        isActive: nextActive,
        status: nextActive ? "ACTIVE" : "DISABLED",
      },
      include: listInclude,
    });

    return res.json({
      ok: true,
      message: nextActive
        ? "Codul de reducere a fost activat."
        : "Codul de reducere a fost dezactivat.",
      discountCode: serializeListRow(updated),
    });
  } catch (error) {
    console.error("[adminVendorDiscountCodes] PATCH /:id/toggle error:", error);

    return res.status(500).json({
      ok: false,
      error: "admin_vendor_discount_code_toggle_failed",
      message: "Nu am putut modifica statusul codului.",
    });
  }
});

export default router;
