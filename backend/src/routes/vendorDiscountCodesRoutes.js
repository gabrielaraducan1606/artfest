// backend/src/routes/vendorDiscountCodesRoutes.js

/*
 * CRUD coduri de reducere VENDOR - mirror STRUCTURAL al
 * influencerDiscountCodesRoutes.js (același model DiscountCode,
 * doar ownerType/vendorId în loc de influencerId, și scope-urile
 * disponibile pentru vendor).
 *
 * REGULA FINALĂ DE BUSINESS (audit 2026-09-14) - înlocuiește split-ul
 * Artfest/Vendor pe ACELAȘI cod (audit 2026-09-13, rundă anterioară):
 * la creare, vendorul alege UNUL din DOUĂ moduri, niciodată un mix:
 *
 * - PROMOTION_MODE_OWN_PRODUCTS ("Doar produsele mele") -> scope
 *   FORȚAT VENDOR_ALL_PRODUCTS, UN SINGUR câmp discount (0-50%), 100%
 *   suportat de vendor (fundingSource "VENDOR"). resolveEligibleProductIds
 *   (discountCodeValidation.js) filtrează deja strict pe vendorId
 *   pentru acest scope - produsul câștigat e mereu al aceluiași
 *   vendor, deci la checkout devine mereu OWN_SALE (comision Artfest
 *   5% după discount, fără referral earning - vezi
 *   VENDOR_REFERRAL_OWN_SALE_COMMISSION_BPS din vendorAttribution.js).
 *
 * - PROMOTION_MODE_ALL_ARTFEST ("Toate produsele Artfest") -> scope
 *   ALL_PRODUCTS (platformă-wide) sau VENDOR_COLLECTION (colecție
 *   proprie - poate conține produse ale altor vendori, vezi
 *   vendorCollectionsRoutes.js), UN SINGUR câmp discount (0-5%), 100%
 *   suportat de Artfest (fundingSource "PLATFORM"). La checkout:
 *   produs PROPRIU -> OWN_SALE (5% comision, fără referral); produs
 *   AL ALTUI vendor -> CROSS_VENDOR_REFERRAL (sellerul își păstrează
 *   comisionul normal - motorul de subvenție din commissionCalc.js îl
 *   protejează, NEATINS -, promoterul primește referral earning din
 *   comisionul Artfest rămas, vezi vendorAttribution.js/
 *   ensureVendorReferralSaleLedgerEntry).
 *
 * Funcțiile computeFundingFields/splitDiscountPercentForDisplay
 * (exportate, reutilizate și de vendorCampaignRoutes.js/
 * adminVendorDiscountCodesRoutes.js/adminVendorCampaignsRoutes.js)
 * rămân - dar pentru coduri NOI sunt apelate mereu cu o parte fixată
 * la 0 (nu mai există SHARED nou). splitDiscountPercentForDisplay
 * rămâne singura cale de afișat corect coduri VECHI (create în runda
 * anterioară, cu split real SHARED) - fără backfill, fără rescriere
 * de istoric.
 */

import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { deriveDiscountCodeStatus } from "../services/discountCodeValidation.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  getDiscountCodeStats,
} from "../services/vendorAttributionStats.js";

import {
  computeVendorEarningForShipment,
} from "./vendorOrdersRoutes.js";

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

/*
 * Plafonul pentru partea SUSȚINUTĂ DE ARTFEST - neschimbat față de
 * dinainte de split (era plafonul întregului discountPercent, care
 * era 100% Artfest). Redenumit pentru claritate, valoare identică.
 */
export const MAX_ARTFEST_FUNDED_PERCENT = 5;

/*
 * Plafonul TOTAL (Artfest + Vendor) - regulă confirmată explicit:
 * Artfest max 5%, Vendor liber, dar suma nu depășește niciodată 50%.
 */
export const MAX_TOTAL_DISCOUNT_PERCENT = 50;

const MAX_CODE_LENGTH = 32;
const MAX_NAME_LENGTH = 160;
const MAX_USAGE_LIMIT = 10_000;
const MAX_USAGE_PER_USER = 10;

const SCOPE_ALL_PRODUCTS = "ALL_PRODUCTS";
const SCOPE_COLLECTION = "VENDOR_COLLECTION";
const SCOPE_OWN_PRODUCTS = "VENDOR_ALL_PRODUCTS";
const SCOPE_SELECTED_PRODUCTS = "SELECTED_PRODUCTS";

/*
 * „Doar anumite produse din magazinul meu” (SELECTED_PRODUCTS): maximum
 * 300 de produse per cod, toate ale vendorului (verificat la creare ȘI la
 * editare), finanțat 100% de vendor, plafon 0-50% - aceleași reguli ca
 * „Doar produsele mele”, doar pe o listă restrânsă (DiscountCodeProduct).
 */
export const MAX_SELECTED_PRODUCTS = 300;
const PRODUCT_SEARCH_MAX_LIMIT = 48;

/*
 * Aceleași filtre ca selectorul din Colecții (scope "own" = doar produsele
 * vendorului). Încărcat LA CERERE (nu import static): graful de importuri al
 * acestui fișier rămâne neschimbat pentru checkout / admin / testele lor.
 */
async function ownProductSearchWhere(filters, vendorId) {
  const { buildCollectionProductSearchWhere } = await import("./vendorCollectionsRoutes.js");
  return buildCollectionProductSearchWhere({ ...(filters || {}), scope: "own" }, vendorId);
}

/*
 * Cele DOUĂ moduri de promovare vendor (regula finală de business,
 * audit 2026-09-14) - înlocuiesc split-ul Artfest/Vendor pe ACELAȘI
 * cod (audit 2026-09-13). Un cod e ORICE din cele două, niciodată
 * ambele simultan:
 *
 * - OWN_PRODUCTS ("Doar produsele mele") -> scope FORȚAT
 *   SCOPE_OWN_PRODUCTS (deja exista în schema Prisma, dar nu era
 *   folosit de nicio rută - vezi resolveEligibleProductIds din
 *   discountCodeValidation.js, unde filtrează deja strict pe
 *   vendorId === discountCode.vendorId). UN SINGUR câmp discount
 *   (0-50%), 100% suportat de vendor (fundingSource FORȚAT "VENDOR").
 *   La checkout devine mereu OWN_SALE (produsul e mereu al aceluiași
 *   vendor - scope-ul garantează asta), comision Artfest 5% după
 *   discount, fără referral earning.
 *
 * - ALL_ARTFEST ("Toate produsele Artfest") -> scope SCOPE_ALL_PRODUCTS
 *   (platformă-wide) SAU SCOPE_COLLECTION (dacă vendorul alege o
 *   colecție proprie - poate conține produse ale altor vendori, vezi
 *   vendorCollectionsRoutes.js). UN SINGUR câmp discount (0-5%), 100%
 *   suportat de Artfest (fundingSource FORȚAT "PLATFORM"). La checkout:
 *   pe produsul PROPRIU al vendorului -> OWN_SALE (5% comision, fără
 *   referral); pe produsul ALTUI vendor -> CROSS_VENDOR_REFERRAL
 *   (sellerul își păstrează comisionul normal, promoterul primește
 *   referral earning din comisionul Artfest - vezi vendorAttribution.js/
 *   ensureVendorReferralSaleLedgerEntry, NEATINSE).
 *
 * NU mai există split SHARED pentru coduri NOI - funcțiile
 * computeFundingFields/splitDiscountPercentForDisplay rămân doar
 * pentru afișarea corectă a codurilor VECHI (create în runda
 * anterioară, cu split real SHARED), fără backfill.
 */
const PROMOTION_MODE_OWN_PRODUCTS = "OWN_PRODUCTS";
const PROMOTION_MODE_ALL_ARTFEST = "ALL_ARTFEST";
const PROMOTION_MODE_SELECTED_PRODUCTS = "SELECTED_PRODUCTS";

/*
 * Codurile existente rămân exact cum erau: VENDOR_ALL_PRODUCTS -> OWN_PRODUCTS,
 * ALL_PRODUCTS / VENDOR_COLLECTION -> ALL_ARTFEST. Doar SELECTED_PRODUCTS
 * (nou pentru vendori - nicio rută nu-l crea până acum) are modul lui.
 */
function derivePromotionMode(discountCode) {
  if (discountCode?.scope === SCOPE_OWN_PRODUCTS) return PROMOTION_MODE_OWN_PRODUCTS;
  if (discountCode?.scope === SCOPE_SELECTED_PRODUCTS) return PROMOTION_MODE_SELECTED_PRODUCTS;
  return PROMOTION_MODE_ALL_ARTFEST;
}

/* =========================================================
   AUTH - identic cu vendorCampaignRoutes.js
========================================================= */

router.use(
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN")
);

async function getVendorForRequest(req) {
  const userId = req.user?.sub;
  if (!userId) return null;

  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true, userId: true, displayName: true, isActive: true },
  });
}

async function requireVendor(req, res) {
  const vendor = await getVendorForRequest(req);

  if (!vendor) {
    res.status(403).json({
      ok: false,
      error: "vendor_required",
      message: "Este necesar un cont de vendor.",
    });

    return null;
  }

  return vendor;
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeCode(value = "") {
  return normalizeString(value).toUpperCase().replace(/\s+/g, "");
}

function parseNullableDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/*
 * Reconstruiește split-ul Artfest/Vendor din discountPercent (total) +
 * platformFundingBps/vendorFundingBps - SURSA UNICĂ pentru orice ecran
 * (create/edit/listă). Funcționează identic pentru codurile vechi
 * (fundingSource="PLATFORM", platformFundingBps=10000) - rezultă
 * automat artfestDiscountPercent = discountPercent, vendorDiscountPercent = 0,
 * fără nicio migrare sau caz special.
 *
 * vendorDiscountPercent se derivă prin SCĂDERE (total - artfestPart),
 * nu prin rotunjire separată - garantează suma exactă, identică cu
 * strategia din vendorCommissionService.splitDiscountAmounts.
 */
export function splitDiscountPercentForDisplay(discountCode) {
  const total = Number(discountCode?.discountPercent || 0);

  if (discountCode?.fundingSource === "VENDOR") {
    return { artfestDiscountPercent: 0, vendorDiscountPercent: total };
  }

  if (discountCode?.fundingSource === "PLATFORM") {
    return { artfestDiscountPercent: total, vendorDiscountPercent: 0 };
  }

  // SHARED
  const platformBps = Math.max(
    0,
    Math.min(10000, Number(discountCode?.platformFundingBps || 0))
  );

  const artfestPart = Math.round((total * platformBps) / 10000);
  const vendorPart = Math.max(0, total - artfestPart);

  return {
    artfestDiscountPercent: artfestPart,
    vendorDiscountPercent: vendorPart,
  };
}

const EMPTY_DISCOUNT_CODE_STATS = {
  ordersCount: 0,
  componentsCount: 0,
  salesValue: 0,
  totalDiscount: 0,
  artfestFunded: 0,
  vendorFunded: 0,
  vendorNetGenerated: 0,
};

export function serializeVendorDiscountCode(discountCode, stats = null) {
  if (!discountCode) return null;

  const { artfestDiscountPercent, vendorDiscountPercent } =
    splitDiscountPercentForDisplay(discountCode);

  return {
    id: discountCode.id,
    code: discountCode.code,
    name: discountCode.name,
    description: discountCode.description,
    ownerType: discountCode.ownerType,
    scope: discountCode.scope,
    promotionMode: derivePromotionMode(discountCode),
    discountType: discountCode.discountType,

    /*
     * discountPercent rămâne TOTALUL (compat cu orice cod existent
     * care îl citește direct) - artfest/vendor sunt câmpurile noi,
     * derivate, pentru UI-ul cu split.
     */
    discountPercent: discountCode.discountPercent,
    totalDiscountPercent: discountCode.discountPercent,
    artfestDiscountPercent,
    vendorDiscountPercent,

    currency: discountCode.currency,
    minimumOrderCents: discountCode.minimumOrderCents,
    maxDiscountCents: discountCode.maxDiscountCents,
    fundingSource: discountCode.fundingSource,
    status: discountCode.status,
    isActive: discountCode.isActive,
    // status efectiv (Programat / Activ / Expirat / Inactiv / Epuizat) - aceeași regulă ca validarea
    effectiveStatus: deriveDiscountCodeStatus(discountCode),
    startsAt: discountCode.startsAt,
    endsAt: discountCode.endsAt,
    usageLimit: discountCode.usageLimit,
    usageLimitPerUser: discountCode.usageLimitPerUser,
    usedCount: discountCode.usedCount,
    createdAt: discountCode.createdAt,
    updatedAt: discountCode.updatedAt,

    vendorCollectionId: discountCode.vendorCollectionId,

    // SELECTED_PRODUCTS: câte produse sunt pe cod (+ lista, doar la GET /:id)
    selectedProductsCount: Number(discountCode?._count?.products || 0),
    ...(Array.isArray(discountCode.selectedProducts)
      ? { selectedProducts: discountCode.selectedProducts }
      : {}),

    collection: discountCode.vendorCollection
      ? {
          id: discountCode.vendorCollection.id,
          title: discountCode.vendorCollection.title,
          slug: discountCode.vendorCollection.slug,
          isActive: discountCode.vendorCollection.isActive,
        }
      : null,

    redemptionsCount: Number(
      discountCode?._count?.redemptions || 0
    ),

    /*
     * Statistici REALE, calculate din ShipmentItem (vezi
     * vendorAttributionStats.js) - NU citite dintr-un contor stocat
     * (nu există unul pentru DiscountCode; usedCount de mai sus e
     * doar un număr de utilizări, fără valoare/reducere).
     */
    stats: stats || EMPTY_DISCOUNT_CODE_STATS,
  };
}

/* =========================================================
   COLLECTION OWNERSHIP

   Colecția este necesară doar dacă scope-ul este
   VENDOR_COLLECTION.
========================================================= */

async function getOwnedCollection(collectionId, vendorId) {
  if (!collectionId || !vendorId) return null;

  return prisma.vendorCollection.findFirst({
    where: { id: collectionId, vendorId },
    select: { id: true, title: true, slug: true, isActive: true },
  });
}

/* =========================================================
   SPLIT ARTFEST / VENDOR -> câmpurile reale din DiscountCode

   Inversul lui splitDiscountPercentForDisplay - din cele 2 procente
   introduse de vendor calculează discountPercent (total),
   fundingSource, platformFundingBps, vendorFundingBps, EXACT formatul
   pe care discountCodeToPromotion() (productPromotionPrice.js) și
   splitDiscountAmounts() (vendorCommissionService.js) le așteaptă deja
   - nicio logică financiară paralelă, doar alimentăm cea existentă.
========================================================= */

export function computeFundingFields({ artfestDiscountPercent, vendorDiscountPercent }) {
  const totalDiscountPercent = artfestDiscountPercent + vendorDiscountPercent;

  if (vendorDiscountPercent === 0) {
    return {
      totalDiscountPercent,
      fundingSource: "PLATFORM",
      platformFundingBps: 10000,
      vendorFundingBps: 0,
    };
  }

  if (artfestDiscountPercent === 0) {
    return {
      totalDiscountPercent,
      fundingSource: "VENDOR",
      platformFundingBps: 0,
      vendorFundingBps: 10000,
    };
  }

  /*
   * SHARED - bps = ponderea fiecărei părți DIN TOTAL (nu procent
   * absolut). vendorFundingBps se derivă prin scădere din 10000, ca
   * suma să fie mereu exact 10000, indiferent de rotunjire.
   */
  const platformFundingBps = Math.round(
    (artfestDiscountPercent / totalDiscountPercent) * 10000
  );

  return {
    totalDiscountPercent,
    fundingSource: "SHARED",
    platformFundingBps,
    vendorFundingBps: 10000 - platformFundingBps,
  };
}

/* =========================================================
   DISCOUNT CODE OWNERSHIP
========================================================= */

const vendorDiscountCodeInclude = {
  vendorCollection: {
    select: { id: true, title: true, slug: true, isActive: true },
  },

  _count: {
    select: { redemptions: true, products: true },
  },
};

async function getOwnedDiscountCode(discountCodeId, vendorId) {
  if (!discountCodeId || !vendorId) return null;

  return prisma.discountCode.findFirst({
    where: {
      id: discountCodeId,
      vendorId,
      ownerType: "VENDOR",
    },

    include: vendorDiscountCodeInclude,
  });
}

/* =========================================================
   PRODUSE SELECTATE (SELECTED_PRODUCTS)
========================================================= */

/*
 * Verificare STRICTĂ: fiecare id trebuie să fie un produs existent al
 * ACESTUI vendor (Product.service.vendorId). Orice id străin / inexistent
 * respinge toată cererea - nu salvăm niciodată o listă parțială în tăcere.
 * Produsele proprii inactive sau ascunse se pot păstra pe cod (nu se pot
 * cumpăra oricum cât timp nu sunt publice).
 */
async function resolveOwnedProductIds(productIds, vendorId) {
  const ids = [...new Set((productIds || []).map((id) => normalizeString(id)).filter(Boolean))];

  if (!ids.length) {
    return {
      ok: false,
      status: 400,
      error: "products_required",
      message: "Alege cel puțin un produs pentru acest cod.",
    };
  }

  if (ids.length > MAX_SELECTED_PRODUCTS) {
    return {
      ok: false,
      status: 400,
      error: "too_many_products",
      maxProducts: MAX_SELECTED_PRODUCTS,
      message: `Un cod poate avea maximum ${MAX_SELECTED_PRODUCTS} de produse.`,
    };
  }

  const owned = await prisma.product.findMany({
    where: { id: { in: ids }, service: { is: { vendorId } } },
    select: { id: true },
  });

  const ownedIds = new Set(owned.map((p) => p.id));
  const rejected = ids.filter((id) => !ownedIds.has(id));

  if (rejected.length) {
    return {
      ok: false,
      status: 400,
      error: "products_not_owned",
      rejectedCount: rejected.length,
      message:
        rejected.length === 1
          ? "Un produs ales nu aparține magazinului tău sau nu mai există."
          : `${rejected.length} produse alese nu aparțin magazinului tău sau nu mai există.`,
    };
  }

  return { ok: true, ids };
}

/*
 * Produsele unui cod SELECTED_PRODUCTS, pentru editare - cu starea fiecăruia:
 *  - "available":   produs public al vendorului;
 *  - "unavailable": inactiv / ascuns / neaprobat (codul nu-l reduce oricum,
 *                   nu se poate cumpăra);
 *  - "other_store": produsul a ajuns la ALT vendor - protecția din
 *                   discountCodeValidation.js nu-l mai reduce.
 */
async function loadSelectedProducts(discountCodeId, vendorId) {
  const links = await prisma.discountCodeProduct.findMany({
    where: { discountCodeId },
    orderBy: { createdAt: "asc" },
    select: {
      productId: true,
      product: {
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          isActive: true,
          isHidden: true,
          moderationStatus: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  return links
    .filter((link) => link.product)
    .map(({ product }) => {
      const sameStore = String(product.service?.vendorId || "") === String(vendorId);
      const isPublic =
        product.isActive === true && product.isHidden !== true && product.moderationStatus === "APPROVED";

      return {
        id: product.id,
        title: product.title,
        image: Array.isArray(product.images) ? product.images[0] || null : null,
        priceCents: product.priceCents,
        price: Number(product.priceCents || 0) / 100,
        currency: product.currency || "RON",
        status: !sameStore ? "other_store" : isPublic ? "available" : "unavailable",
      };
    });
}

/* =========================================================
   VALIDATION
========================================================= */

const ProductIdsSchema = z.array(z.string().trim().min(1).max(64)).max(MAX_SELECTED_PRODUCTS * 2);

const NullableCollectionIdSchema = z.union([
  z.string().trim().min(1),
  z.null(),
]);

const PromotionModeSchema = z.enum([
  PROMOTION_MODE_OWN_PRODUCTS,
  PROMOTION_MODE_ALL_ARTFEST,
  PROMOTION_MODE_SELECTED_PRODUCTS,
]);

const CreateDiscountCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Codul trebuie să aibă minimum 3 caractere.")
    .max(MAX_CODE_LENGTH),

  name: z.string().trim().max(MAX_NAME_LENGTH).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),

  /*
   * "Ce vrei să promovezi?" - primul pas la creare (regula finală de
   * business). Determină scope-ul REAL (mai jos) și funding-ul
   * (100% vendor sau 100% Artfest, niciodată SHARED pentru coduri noi).
   */
  promotionMode: PromotionModeSchema,

  /*
   * Doar pentru promotionMode ALL_ARTFEST - opțional, o colecție
   * proprie (poate conține produse ale altor vendori). Ignorat/
   * respins pentru OWN_PRODUCTS (scope-ul e mereu VENDOR_ALL_PRODUCTS
   * acolo, fără sub-selecție).
   */
  vendorCollectionId: NullableCollectionIdSchema.optional().nullable(),

  // doar pentru SELECTED_PRODUCTS (verificate strict: produsele vendorului)
  productIds: ProductIdsSchema.optional(),

  /*
   * UN SINGUR câmp discount - interpretarea (0-50% vendor, sau 0-5%
   * Artfest) depinde de promotionMode, validată mai jos (mesaj
   * specific per mod, nu doar Zod generic).
   */
  discountPercent: z.coerce.number().int().min(0).max(MAX_TOTAL_DISCOUNT_PERCENT),

  startsAt: z.union([z.string(), z.date(), z.null()]).optional(),
  endsAt: z.union([z.string(), z.date(), z.null()]).optional(),

  usageLimit: z
    .union([z.coerce.number().int().min(1).max(MAX_USAGE_LIMIT), z.null()])
    .optional(),

  usageLimitPerUser: z
    .union([z.coerce.number().int().min(1).max(MAX_USAGE_PER_USER), z.null()])
    .optional(),

  minimumOrderCents: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional(),

  maxDiscountCents: z
    .union([z.coerce.number().int().min(1), z.null()])
    .optional(),
});

const UpdateDiscountCodeSchema = z.object({
  code: z.string().trim().min(3).max(MAX_CODE_LENGTH).optional(),
  name: z.string().trim().max(MAX_NAME_LENGTH).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),

  /*
   * Modul NU se poate schimba la editare (ar însemna să schimbi
   * scope-ul unui cod deja folosit posibil - risc de confuzie pe
   * comenzi vechi). Dacă vendorul vrea alt mod, creează un cod nou.
   */
  vendorCollectionId: NullableCollectionIdSchema.optional().nullable(),

  // doar pentru codurile SELECTED_PRODUCTS: înlocuiește lista de produse
  productIds: ProductIdsSchema.optional(),

  discountPercent: z
    .coerce.number()
    .int()
    .min(0)
    .max(MAX_TOTAL_DISCOUNT_PERCENT)
    .optional(),

  startsAt: z.union([z.string(), z.date(), z.null()]).optional(),
  endsAt: z.union([z.string(), z.date(), z.null()]).optional(),

  usageLimit: z
    .union([z.coerce.number().int().min(1).max(MAX_USAGE_LIMIT), z.null()])
    .optional(),

  usageLimitPerUser: z
    .union([z.coerce.number().int().min(1).max(MAX_USAGE_PER_USER), z.null()])
    .optional(),

  minimumOrderCents: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional(),

  maxDiscountCents: z
    .union([z.coerce.number().int().min(1), z.null()])
    .optional(),
});

/* =========================================================
   GET /api/vendor/discount-codes
========================================================= */

router.get("/", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const discountCodes = await prisma.discountCode.findMany({
      where: { vendorId: vendor.id, ownerType: "VENDOR" },
      include: vendorDiscountCodeInclude,
      orderBy: { createdAt: "desc" },
    });

    const statsByCodeId = await getDiscountCodeStats(
      discountCodes.map((c) => c.id)
    );

    return res.json({
      ok: true,
      maxArtfestDiscountPercent: MAX_ARTFEST_FUNDED_PERCENT,
      maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
      discountCodes: discountCodes.map((c) =>
        serializeVendorDiscountCode(c, statsByCodeId.get(c.id))
      ),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] GET / error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_codes_load_failed",
      message: "Nu am putut încărca codurile de reducere.",
    });
  }
});

/* =========================================================
   GET /api/vendor/discount-codes/product-search
     ?q=&category=&occasion=&availability=&minPrice=&maxPrice=&personalizable=&page=&limit=

   Selectorul „Doar anumite produse”: STRICT produsele publice ale
   vendorului curent (aceleași filtre ca selectorul din Colecții, scope
   forțat "own"). Read-only.
========================================================= */

router.get("/product-search", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(
      PRODUCT_SEARCH_MAX_LIMIT,
      Math.max(1, Number.parseInt(req.query?.limit, 10) || 24)
    );

    const where = await ownProductSearchWhere(req.query, vendor.id);

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit + 1,
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          category: true,
          availability: true,
          readyQty: true,
          acceptsCustom: true,
        },
      }),
      prisma.product.count({ where }),
    ]);

    const hasMore = rows.length > limit;

    return res.json({
      ok: true,
      page,
      limit,
      hasMore,
      total,
      selectableTotal: total,
      maxProducts: MAX_SELECTED_PRODUCTS,
      products: rows.slice(0, limit).map((product) => ({
        id: product.id,
        title: product.title,
        image: Array.isArray(product.images) ? product.images[0] || null : null,
        priceCents: product.priceCents,
        price: Number(product.priceCents || 0) / 100,
        currency: product.currency || "RON",
        category: product.category || null,
        isOwn: true,
        availability: product.availability || null,
        soldOut:
          product.availability === "SOLD_OUT" ||
          (product.availability === "READY" && typeof product.readyQty === "number" && product.readyQty <= 0),
        personalizable: product.acceptsCustom === true,
      })),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] GET /product-search error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_product_search_failed",
      message: "Nu am putut căuta produsele.",
    });
  }
});

/* =========================================================
   POST /api/vendor/discount-codes/product-ids
   Body: aceleași filtre ca product-search

   „Toate rezultatele filtrate”: id-urile produselor vendorului care
   corespund filtrului, maximum MAX_SELECTED_PRODUCTS (selecția rămâne în
   formular; se salvează abia la POST/PATCH, cu verificarea strictă).
========================================================= */

router.post("/product-ids", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const filters = req.body && typeof req.body === "object" ? req.body : {};
    const where = await ownProductSearchWhere(filters, vendor.id);

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAX_SELECTED_PRODUCTS,
        select: { id: true, title: true, images: true, priceCents: true, currency: true },
      }),
      prisma.product.count({ where }),
    ]);

    return res.json({
      ok: true,
      total,
      truncated: total > rows.length,
      maxProducts: MAX_SELECTED_PRODUCTS,
      products: rows.map((product) => ({
        id: product.id,
        title: product.title,
        image: Array.isArray(product.images) ? product.images[0] || null : null,
        priceCents: product.priceCents,
        price: Number(product.priceCents || 0) / 100,
        currency: product.currency || "RON",
      })),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] POST /product-ids error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_product_ids_failed",
      message: "Nu am putut selecta rezultatele.",
    });
  }
});

/* =========================================================
   GET /api/vendor/discount-codes/:id
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const discountCode = await getOwnedDiscountCode(
      req.params.id,
      vendor.id
    );

    if (!discountCode) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    const statsByCodeId = await getDiscountCodeStats([discountCode.id]);

    if (discountCode.scope === SCOPE_SELECTED_PRODUCTS) {
      discountCode.selectedProducts = await loadSelectedProducts(discountCode.id, vendor.id);
    }

    return res.json({
      ok: true,
      maxArtfestDiscountPercent: MAX_ARTFEST_FUNDED_PERCENT,
      maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
      maxSelectedProducts: MAX_SELECTED_PRODUCTS,
      discountCode: serializeVendorDiscountCode(
        discountCode,
        statsByCodeId.get(discountCode.id)
      ),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] GET /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_load_failed",
      message: "Nu am putut încărca codul de reducere.",
    });
  }
});

/* =========================================================
   GET /api/vendor/discount-codes/:id/orders

   Comenzile/componentele generate de acest cod - filtrăm STRICT pe
   ShipmentItem.discountCodeId = acest cod, niciodată pe orderId, ca
   să NU expunem alte componente (ale altor vendori) din aceeași
   comandă multi-vendor care nu au folosit codul.
========================================================= */

router.get("/:id/orders", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const discountCode = await getOwnedDiscountCode(
      req.params.id,
      vendor.id
    );

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

    const where = { discountCodeId: discountCode.id };

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
          discountAmount: true,
          platformDiscountAmount: true,
          vendorDiscountAmount: true,

          shipment: {
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
            },
          },
        },
      }),

      prisma.shipmentItem.count({ where }),
    ]);

    /*
     * Net vendor pe COMPONENTĂ (shipment) - reutilizează
     * computeVendorEarningForShipment, aceeași sursă ca Order
     * Details. Poate fi net-ul vendorului care a vândut efectiv
     * produsul (nu neapărat proprietarul codului, dacă a fost folosit
     * cross-vendor pe scope ALL_PRODUCTS).
     */
    const uniqueShipments = [];
    const seenShipmentIds = new Set();

    for (const item of items) {
      const sh = item.shipment;
      if (sh?.id && !seenShipmentIds.has(sh.id)) {
        seenShipmentIds.add(sh.id);
        uniqueShipments.push({ shipmentId: sh.id, vendorId: sh.vendorId });
      }
    }

    const vendorNetByShipmentId = new Map(
      await Promise.all(
        uniqueShipments.map(async ({ shipmentId, vendorId }) => {
          try {
            const earning = await computeVendorEarningForShipment({
              vendorId,
              shipmentId,
            });
            return [shipmentId, Number(earning?.vendorNet || 0)];
          } catch {
            return [shipmentId, null];
          }
        })
      )
    );

    const rows = items.map((item) => ({
      shipmentItemId: item.id,
      orderId: item.shipment?.order?.id || null,
      orderNumber: item.shipment?.order?.orderNumber || null,
      orderDate: item.shipment?.order?.createdAt || null,
      shipmentStatus: item.shipment?.status || null,
      productTitle: item.title,
      qty: item.qty,
      lineValue: Number(item.price || 0) * Number(item.qty || 0),
      discountAmount: Number(item.discountAmount || 0),
      artfestFunded: Number(item.platformDiscountAmount || 0),
      vendorFunded: Number(item.vendorDiscountAmount || 0),
      vendorNet: item.shipment?.id
        ? vendorNetByShipmentId.get(item.shipment.id) ?? null
        : null,
    }));

    return res.json({
      ok: true,
      items: rows,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error(
      "[vendorDiscountCodes] GET /:id/orders error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_orders_load_failed",
      message: "Nu am putut încărca comenzile pentru acest cod.",
    });
  }
});

/* =========================================================
   POST /api/vendor/discount-codes

   Backendul controlează:
   ownerType = VENDOR
   discountType = PERCENT
   scope / fundingSource / platformFundingBps / vendorFundingBps -
     DERIVATE STRICT din promotionMode (vezi comentariul PROMOTION_MODE_*
     de la începutul fișierului), niciodată alese liber de vendor:
     - OWN_PRODUCTS -> VENDOR_ALL_PRODUCTS, fundingSource VENDOR
     - ALL_ARTFEST  -> ALL_PRODUCTS sau VENDOR_COLLECTION, fundingSource PLATFORM
========================================================= */

router.post("/", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    if (vendor.isActive === false) {
      return res.status(403).json({
        ok: false,
        error: "vendor_inactive",
        message: "Magazinul trebuie să fie activ pentru a crea coduri de reducere.",
      });
    }

    const parsed = CreateDiscountCodeSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        message: "Verifică datele introduse.",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;

    /* =====================================================
       MOD DE PROMOVARE -> discount + funding (NICIODATĂ SHARED
       pentru coduri noi - vezi comentariul de la PROMOTION_MODE_*)
    ===================================================== */

    const isOwnProducts = input.promotionMode === PROMOTION_MODE_OWN_PRODUCTS;
    const isSelectedProducts = input.promotionMode === PROMOTION_MODE_SELECTED_PRODUCTS;

    /*
     * VENDOR_COLLECTION (audit 2026-09-15, regula finală de business):
     * reducerea unei colecții proprii e suportată 100% de vendor, NU
     * de Artfest - identic ca finanțare cu OWN_PRODUCTS, dar scope-ul
     * rămâne strict pe produsele din colecție (nu "toate produsele
     * mele"). ALL_PRODUCTS (platformă-wide, fără colecție) rămâne
     * neschimbat: 100% Artfest, plafon 5%.
     */
    const isVendorFunded =
      isOwnProducts || isSelectedProducts || Boolean(input.vendorCollectionId);

    const maxDiscountForMode = isVendorFunded
      ? MAX_TOTAL_DISCOUNT_PERCENT
      : MAX_ARTFEST_FUNDED_PERCENT;

    if (input.discountPercent > maxDiscountForMode) {
      return res.status(400).json({
        ok: false,
        error: "invalid_discount_percent",
        message: isVendorFunded
          ? `Reducerea pentru clienții tăi nu poate depăși ${MAX_TOTAL_DISCOUNT_PERCENT}%.`
          : `Reducerea oferită de Artfest nu poate depăși ${MAX_ARTFEST_FUNDED_PERCENT}%.`,
      });
    }

    const funding = computeFundingFields(
      isVendorFunded
        ? { artfestDiscountPercent: 0, vendorDiscountPercent: input.discountPercent }
        : { artfestDiscountPercent: input.discountPercent, vendorDiscountPercent: 0 }
    );

    /* =====================================================
       CODE
    ===================================================== */

    const code = normalizeCode(input.code);

    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_discount_code",
        message:
          "Codul poate conține doar litere, cifre, _ și -. Minimum 3 caractere.",
      });
    }

    const existingCode = await prisma.discountCode.findUnique({
      where: { code },
      select: { id: true },
    });

    if (existingCode) {
      return res.status(409).json({
        ok: false,
        error: "discount_code_already_exists",
        message: "Acest cod este deja folosit. Alege alt cod.",
      });
    }

    /* =====================================================
       SCOPE + COLLECTION - determinat STRICT de promotionMode,
       nu ales liber de vendor (vezi comentariul PROMOTION_MODE_*)
    ===================================================== */

    let collection = null;
    let scope;
    let selectedProductIds = null;

    if (!isSelectedProducts && input.productIds !== undefined) {
      return res.status(400).json({
        ok: false,
        error: "products_not_allowed",
        message: "Produsele se aleg doar pentru «Doar anumite produse».",
      });
    }

    if (isSelectedProducts) {
      scope = SCOPE_SELECTED_PRODUCTS;

      if (input.vendorCollectionId) {
        return res.status(400).json({
          ok: false,
          error: "collection_not_allowed",
          message: "Un cod «Doar anumite produse» nu poate folosi o colecție.",
        });
      }

      const resolved = await resolveOwnedProductIds(input.productIds, vendor.id);
      if (!resolved.ok) {
        const { status, ok, ...body } = resolved;
        return res.status(status).json({ ok: false, ...body });
      }
      selectedProductIds = resolved.ids;
    } else if (isOwnProducts) {
      scope = SCOPE_OWN_PRODUCTS;

      if (input.vendorCollectionId) {
        return res.status(400).json({
          ok: false,
          error: "collection_not_allowed",
          message:
            "O colecție nu poate fi folosită pentru un cod «Doar produsele mele» - se aplică automat tuturor produselor tale.",
        });
      }
    } else if (input.vendorCollectionId) {
      scope = SCOPE_COLLECTION;

      collection = await getOwnedCollection(
        input.vendorCollectionId,
        vendor.id
      );

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error: "collection_not_found",
          message: "Colecția selectată nu a fost găsită.",
        });
      }
    } else {
      scope = SCOPE_ALL_PRODUCTS;
    }

    /* =====================================================
       DATES
    ===================================================== */

    const startsAt =
      input.startsAt === undefined ? null : parseNullableDate(input.startsAt);

    const endsAt =
      input.endsAt === undefined ? null : parseNullableDate(input.endsAt);

    if (input.startsAt && !startsAt) {
      return res.status(400).json({
        ok: false,
        error: "invalid_start_date",
        message: "Data de început nu este validă.",
      });
    }

    if (input.endsAt && !endsAt) {
      return res.status(400).json({
        ok: false,
        error: "invalid_end_date",
        message: "Data de expirare nu este validă.",
      });
    }

    if (startsAt && endsAt && endsAt <= startsAt) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_range",
        message: "Data de expirare trebuie să fie după data de început.",
      });
    }

    /* =====================================================
       CREATE
    ===================================================== */

    const createData = {
        code,
        name: normalizeString(input.name) || null,
        description: normalizeString(input.description) || null,

        ownerType: "VENDOR",
        vendorId: vendor.id,
        influencerId: null,

        scope,
        vendorCollectionId: scope === SCOPE_COLLECTION ? collection.id : null,

        discountType: "PERCENT",
        discountPercent: funding.totalDiscountPercent,
        discountAmountCents: null,
        currency: "RON",

        minimumOrderCents: input.minimumOrderCents ?? null,
        maxDiscountCents: input.maxDiscountCents ?? null,

        /*
         * Funding FORȚAT 100% pe o singură parte, calculat mai sus
         * din promotionMode (computeFundingFields cu o parte fixată
         * la 0) - niciodată SHARED pentru coduri noi.
         */
        fundingSource: funding.fundingSource,
        platformFundingBps: funding.platformFundingBps,
        vendorFundingBps: funding.vendorFundingBps,

        status: "ACTIVE",
        isActive: true,

        startsAt,
        endsAt,

        usageLimit: input.usageLimit ?? null,
        usageLimitPerUser: input.usageLimitPerUser ?? 1,
        usedCount: 0,

        createdByUserId: vendor.userId,
    };

    /*
     * Codul + produsele lui într-o singură tranzacție: niciodată un cod
     * SELECTED_PRODUCTS fără produse (ar fi un cod care nu se aplică nicăieri).
     */
    const discountCode = selectedProductIds
      ? await prisma.$transaction(async (tx) => {
          const created = await tx.discountCode.create({ data: createData, select: { id: true } });
          await tx.discountCodeProduct.createMany({
            data: selectedProductIds.map((productId) => ({ discountCodeId: created.id, productId })),
            skipDuplicates: true,
          });
          return tx.discountCode.findUnique({
            where: { id: created.id },
            include: vendorDiscountCodeInclude,
          });
        })
      : await prisma.discountCode.create({
          data: createData,
          include: vendorDiscountCodeInclude,
        });

    return res.status(201).json({
      ok: true,
      message: "Codul de reducere a fost creat.",
      maxArtfestDiscountPercent: MAX_ARTFEST_FUNDED_PERCENT,
      maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
      discountCode: serializeVendorDiscountCode(discountCode),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] POST / error:", error);

    if (error?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error: "discount_code_already_exists",
        message: "Acest cod este deja folosit. Alege alt cod.",
      });
    }

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_create_failed",
      message: "Nu am putut crea codul de reducere.",
    });
  }
});

/* =========================================================
   PATCH /api/vendor/discount-codes/:id

   Nu poate modifica: ownerType, influencerId, vendorId, promotionMode
   (scope-ul de bază VENDOR_ALL_PRODUCTS vs ALL_PRODUCTS/VENDOR_COLLECTION
   e fixat la creare - dacă vendorul vrea alt mod, creează un cod nou).

   fundingSource/platformFundingBps/vendorFundingBps SE POT schimba
   doar dacă discountPercent e retrimis, NUMAI ca rezultat calculat
   (computeFundingFields, cu o parte fixată la 0 după modul existent) -
   niciodată trimise/încrezute direct din request.
========================================================= */

router.patch("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const current = await getOwnedDiscountCode(req.params.id, vendor.id);

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    const parsed = UpdateDiscountCodeSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        message: "Verifică datele introduse.",
        details: parsed.error.flatten(),
      });
    }

    /*
     * Modul ("Ce vrei să promovezi?") NU se schimbă la editare -
     * derivat din scope-ul EXISTENT al codului, nu din input (vezi
     * UpdateDiscountCodeSchema, care nu mai acceptă `scope`). Dacă
     * vendorul vrea alt mod, creează un cod nou.
     */
    const currentMode = derivePromotionMode(current);
    const isOwnProducts = currentMode === PROMOTION_MODE_OWN_PRODUCTS;
    const isSelectedProducts = currentMode === PROMOTION_MODE_SELECTED_PRODUCTS;

    const input = parsed.data;
    const updateData = {};

    /*
     * Scope-ul EFECTIV după această editare (pentru decizia de
     * finanțare mai jos) - anticipează blocul COLLECTION de mai jos,
     * care poate schimba scope-ul SCOPE_ALL_PRODUCTS <-> SCOPE_COLLECTION
     * în ACEEAȘI cerere în care se schimbă și discountPercent. Dacă
     * `vendorCollectionId` nu e trimis, rămânem pe scope-ul curent.
     */
    const effectiveIsCollection =
      !isOwnProducts &&
      !isSelectedProducts &&
      (input.vendorCollectionId !== undefined
        ? input.vendorCollectionId !== null
        : current.scope === SCOPE_COLLECTION);

    /*
     * VENDOR_COLLECTION (audit 2026-09-15) - vezi comentariul identic
     * din POST /: finanțat 100% de vendor, ca OWN_PRODUCTS.
     */
    // SELECTED_PRODUCTS: finanțat de vendor (ca OWN_PRODUCTS), mereu - nu se schimbă la editare
    const isVendorFunded = isOwnProducts || isSelectedProducts || effectiveIsCollection;

    /* =====================================================
       CODE
    ===================================================== */

    if (input.code !== undefined) {
      const nextCode = normalizeCode(input.code);

      if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(nextCode)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_discount_code",
          message: "Codul poate conține doar litere, cifre, _ și -.",
        });
      }

      const conflict = await prisma.discountCode.findFirst({
        where: { code: nextCode, id: { not: current.id } },
        select: { id: true },
      });

      if (conflict) {
        return res.status(409).json({
          ok: false,
          error: "discount_code_already_exists",
          message: "Acest cod este deja folosit.",
        });
      }

      updateData.code = nextCode;
    }

    /* =====================================================
       NAME / DESCRIPTION
    ===================================================== */

    if (input.name !== undefined) {
      updateData.name = normalizeString(input.name) || null;
    }

    if (input.description !== undefined) {
      updateData.description = normalizeString(input.description) || null;
    }

    /* =====================================================
       DISCOUNT + FUNDING - doar dacă discountPercent e trimis;
       altfel rămân neatinse. Plafonul depinde de modul EXISTENT al
       codului (nu editabil).
    ===================================================== */

    if (input.discountPercent !== undefined) {
      const maxDiscountForMode = isVendorFunded
        ? MAX_TOTAL_DISCOUNT_PERCENT
        : MAX_ARTFEST_FUNDED_PERCENT;

      if (input.discountPercent > maxDiscountForMode) {
        return res.status(400).json({
          ok: false,
          error: "invalid_discount_percent",
          message: isVendorFunded
            ? `Reducerea pentru clienții tăi nu poate depăși ${MAX_TOTAL_DISCOUNT_PERCENT}%.`
            : `Reducerea oferită de Artfest nu poate depăși ${MAX_ARTFEST_FUNDED_PERCENT}%.`,
        });
      }

      const funding = computeFundingFields(
        isVendorFunded
          ? { artfestDiscountPercent: 0, vendorDiscountPercent: input.discountPercent }
          : { artfestDiscountPercent: input.discountPercent, vendorDiscountPercent: 0 }
      );

      updateData.discountPercent = funding.totalDiscountPercent;
      updateData.fundingSource = funding.fundingSource;
      updateData.platformFundingBps = funding.platformFundingBps;
      updateData.vendorFundingBps = funding.vendorFundingBps;
    }

    /* =====================================================
       COLLECTION - doar pentru ALL_ARTFEST; scope-ul propriu-zis nu
       se schimbă niciodată la editare (mereu SCOPE_OWN_PRODUCTS
       pentru OWN_PRODUCTS, SCOPE_ALL_PRODUCTS/SCOPE_COLLECTION pentru
       ALL_ARTFEST, decis o singură dată, la creare).
    ===================================================== */

    let nextSelectedProductIds = null;

    if (!isSelectedProducts && input.productIds !== undefined) {
      return res.status(400).json({
        ok: false,
        error: "products_not_allowed",
        message: "Produsele se aleg doar pentru codurile «Doar anumite produse».",
      });
    }

    if (isSelectedProducts) {
      if (input.vendorCollectionId) {
        return res.status(400).json({
          ok: false,
          error: "collection_not_allowed",
          message: "Un cod «Doar anumite produse» nu poate folosi o colecție.",
        });
      }

      // lista nouă - verificată STRICT și la editare
      if (input.productIds !== undefined) {
        const resolved = await resolveOwnedProductIds(input.productIds, vendor.id);
        if (!resolved.ok) {
          const { status, ok, ...body } = resolved;
          return res.status(status).json({ ok: false, ...body });
        }
        nextSelectedProductIds = resolved.ids;
      }
    } else if (isOwnProducts) {
      if (input.vendorCollectionId) {
        return res.status(400).json({
          ok: false,
          error: "collection_not_allowed",
          message:
            "Un cod «Doar produsele mele» nu poate folosi o colecție.",
        });
      }
    } else if (input.vendorCollectionId !== undefined) {
      if (input.vendorCollectionId === null) {
        updateData.scope = SCOPE_ALL_PRODUCTS;
        updateData.vendorCollectionId = null;
      } else {
        const collection = await getOwnedCollection(
          input.vendorCollectionId,
          vendor.id
        );

        if (!collection) {
          return res.status(404).json({
            ok: false,
            error: "collection_not_found",
            message: "Colecția selectată nu a fost găsită.",
          });
        }

        updateData.scope = SCOPE_COLLECTION;
        updateData.vendorCollectionId = collection.id;
      }
    }

    /* =====================================================
       DATES
    ===================================================== */

    let nextStartsAt = current.startsAt;
    let nextEndsAt = current.endsAt;

    if (input.startsAt !== undefined) {
      nextStartsAt = parseNullableDate(input.startsAt);

      if (input.startsAt && !nextStartsAt) {
        return res.status(400).json({
          ok: false,
          error: "invalid_start_date",
          message: "Data de început nu este validă.",
        });
      }

      updateData.startsAt = nextStartsAt;
    }

    if (input.endsAt !== undefined) {
      nextEndsAt = parseNullableDate(input.endsAt);

      if (input.endsAt && !nextEndsAt) {
        return res.status(400).json({
          ok: false,
          error: "invalid_end_date",
          message: "Data de expirare nu este validă.",
        });
      }

      updateData.endsAt = nextEndsAt;
    }

    if (nextStartsAt && nextEndsAt && nextEndsAt <= nextStartsAt) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_range",
        message: "Data de expirare trebuie să fie după data de început.",
      });
    }

    /* =====================================================
       LIMITS
    ===================================================== */

    if (input.usageLimit !== undefined) {
      if (
        input.usageLimit !== null &&
        input.usageLimit < current.usedCount
      ) {
        return res.status(400).json({
          ok: false,
          error: "usage_limit_below_used_count",
          message: `Codul a fost deja folosit de ${current.usedCount} ori. Limita nu poate fi mai mică decât acest număr.`,
        });
      }

      updateData.usageLimit = input.usageLimit;
    }

    if (input.usageLimitPerUser !== undefined) {
      updateData.usageLimitPerUser = input.usageLimitPerUser;
    }

    if (input.minimumOrderCents !== undefined) {
      updateData.minimumOrderCents = input.minimumOrderCents;
    }

    if (input.maxDiscountCents !== undefined) {
      updateData.maxDiscountCents = input.maxDiscountCents;
    }

    /* =====================================================
       UPDATE
    ===================================================== */

    /*
     * SELECTED_PRODUCTS: codul + înlocuirea listei de produse într-o singură
     * tranzacție (scoatem ce nu mai e ales, adăugăm ce e nou).
     */
    const updated = nextSelectedProductIds
      ? await prisma.$transaction(async (tx) => {
          await tx.discountCode.update({ where: { id: current.id }, data: updateData, select: { id: true } });
          await tx.discountCodeProduct.deleteMany({
            where: { discountCodeId: current.id, productId: { notIn: nextSelectedProductIds } },
          });
          await tx.discountCodeProduct.createMany({
            data: nextSelectedProductIds.map((productId) => ({ discountCodeId: current.id, productId })),
            skipDuplicates: true,
          });
          return tx.discountCode.findUnique({ where: { id: current.id }, include: vendorDiscountCodeInclude });
        })
      : await prisma.discountCode.update({
          where: { id: current.id },
          data: updateData,
          include: vendorDiscountCodeInclude,
        });

    return res.json({
      ok: true,
      message: "Codul de reducere a fost actualizat.",
      maxArtfestDiscountPercent: MAX_ARTFEST_FUNDED_PERCENT,
      maxTotalDiscountPercent: MAX_TOTAL_DISCOUNT_PERCENT,
      discountCode: serializeVendorDiscountCode(updated),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] PATCH /:id error:", error);

    if (error?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error: "discount_code_already_exists",
        message: "Acest cod este deja folosit.",
      });
    }

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_update_failed",
      message: "Nu am putut actualiza codul de reducere.",
    });
  }
});

/* =========================================================
   PATCH /api/vendor/discount-codes/:id/toggle
========================================================= */

router.patch("/:id/toggle", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const current = await getOwnedDiscountCode(req.params.id, vendor.id);

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
          "Codul este expirat. Modifică data de expirare înainte să îl reactivezi.",
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
          "Codul și-a atins limita de utilizări. Mărește limita înainte să îl reactivezi.",
      });
    }

    const nextActive = !current.isActive;

    const updated = await prisma.discountCode.update({
      where: { id: current.id },
      data: {
        isActive: nextActive,
        status: nextActive ? "ACTIVE" : "DISABLED",
      },
      include: vendorDiscountCodeInclude,
    });

    return res.json({
      ok: true,
      message: nextActive
        ? "Codul de reducere a fost activat."
        : "Codul de reducere a fost dezactivat.",
      discountCode: serializeVendorDiscountCode(updated),
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] PATCH /:id/toggle error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_toggle_failed",
      message: "Nu am putut modifica statusul codului.",
    });
  }
});

/* =========================================================
   DELETE /api/vendor/discount-codes/:id

   Nu ștergem codurile deja folosite.
========================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const current = await getOwnedDiscountCode(req.params.id, vendor.id);

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "discount_code_not_found",
        message: "Codul de reducere nu a fost găsit.",
      });
    }

    const redemptionsCount = Number(current?._count?.redemptions || 0);

    if (redemptionsCount > 0 || current.usedCount > 0) {
      return res.status(409).json({
        ok: false,
        error: "discount_code_has_redemptions",
        message:
          "Acest cod a fost deja folosit și nu mai poate fi șters. Îl poți dezactiva pentru a păstra istoricul comenzilor.",
      });
    }

    await prisma.discountCode.delete({ where: { id: current.id } });

    return res.json({
      ok: true,
      message: "Codul de reducere a fost șters.",
    });
  } catch (error) {
    console.error("[vendorDiscountCodes] DELETE /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_discount_code_delete_failed",
      message: "Nu am putut șterge codul de reducere.",
    });
  }
});

export default router;
