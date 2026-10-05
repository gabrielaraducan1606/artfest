// backend/src/routes/vendorCollectionsRoutes.js

/*
 * CRUD colecții VENDOR - mirror STRUCTURAL al
 * influencerCollectionRoutes.js (același model de bază, VendorCollection
 * în loc de InfluencerCollection).
 *
 * Diferență conceptuală IMPORTANTĂ (clarificată explicit de user):
 * o VendorCollection poate conține produse ale ALTOR vendori, nu doar
 * ale proprietarului colecției - de-aia getOwnedCollection verifică
 * DOAR că însăși colecția aparține vendorului curent, NICIODATĂ
 * proprietatea produselor adăugate (spre deosebire de VendorCampaign,
 * care e strict promovarea propriului magazin).
 *
 * Nu includem AI-recommend (feature specific influencerilor, nu a
 * fost cerut aici - scop minim și controlat).
 */

import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  signVendorCollectionAttributionToken,
  VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS,
} from "../services/vendorCollectionAttributionToken.js";
import {
  applyPromotionPricingToProduct,
  getPromotionPricingForProducts,
} from "../services/productPromotionPrice.js";
import { withOwnCollectionPromotions } from "../services/vendorCollectionPricing.js";
import { vendorCollectionStatus } from "../services/vendorCollectionRules.js";

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

const MAX_TITLE_LENGTH = 160;
const MAX_SLUG_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_COLLECTION_PRODUCTS = 100;
// același plafon ca reducerile vendorului (MAX_TOTAL_DISCOUNT_PERCENT, vendorDiscountCodesRoutes.js)
const MAX_COLLECTION_DISCOUNT_PERCENT = 50;

/* =========================================================
   AUTH - identic cu vendorDiscountCodesRoutes.js
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

function slugify(value = "") {
  return normalizeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

function randomSlugSuffix() {
  return crypto.randomBytes(3).toString("hex");
}

async function buildUniqueSlug(title, excludeCollectionId = null) {
  const base = slugify(title) || `colectie-${randomSlugSuffix()}`;

  let candidate = base;
  let attempt = 0;

  while (attempt < 20) {
    const existing = await prisma.vendorCollection.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing || existing.id === excludeCollectionId) {
      return candidate;
    }

    attempt += 1;

    candidate = `${base}-${randomSlugSuffix()}`.slice(0, MAX_SLUG_LENGTH);
  }

  return `${base}-${Date.now()}`.slice(0, MAX_SLUG_LENGTH);
}

async function getOwnedCollection(collectionId, vendorId) {
  if (!collectionId || !vendorId) return null;

  return prisma.vendorCollection.findFirst({
    where: { id: collectionId, vendorId },
  });
}

export function formatVendorCollection(collection) {
  return {
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    description: collection.description,
    coverImage: collection.coverImage,
    isActive: collection.isActive,
    sort: collection.sort,
    visits: collection.visits,
    clicks: collection.clicks,

    // preluate din VendorCampaign (Colecții unice)
    discountPercent: Number(collection.discountPercent || 0),
    startsAt: collection.startsAt || null,
    endsAt: collection.endsAt || null,
    allOwnProducts: Boolean(collection.allOwnProducts),
    status: vendorCollectionStatus(collection),
    publicPath: `/colectie-vendor/${collection.slug}`,

    productsCount:
      collection._count?.items ?? collection.items?.length ?? 0,

    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

/* =========================================================
   VALIDATION
========================================================= */

/*
 * Câmpuri preluate din VendorCampaign: reducere (DOAR produse proprii,
 * finanțată de vendor), perioadă opțională, includerea automată a tuturor
 * produselor proprii. Datele vin ca ISO string sau null (fără perioadă).
 */
const optionalDate = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .refine((v) => v == null || !Number.isNaN(new Date(v).getTime()), "Dată invalidă.");

const campaignLikeFields = {
  discountPercent: z.number().int().min(0).max(MAX_COLLECTION_DISCOUNT_PERCENT).optional(),
  startsAt: optionalDate,
  endsAt: optionalDate,
  allOwnProducts: z.boolean().optional(),
};

function toDateOrNull(value) {
  return value == null ? null : new Date(value);
}

// endsAt trebuie să fie după startsAt (ambele, dacă sunt setate - inclusiv cele existente)
function invalidPeriod(startsAt, endsAt) {
  return Boolean(startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime());
}

const CreateCollectionSchema = z.object({
  ...campaignLikeFields,
  title: z
    .string()
    .trim()
    .min(2, "Titlul trebuie să aibă minimum 2 caractere.")
    .max(MAX_TITLE_LENGTH),

  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH)
    .optional()
    .nullable(),

  coverImage: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const UpdateCollectionSchema = z.object({
  ...campaignLikeFields,
  title: z.string().trim().min(2).max(MAX_TITLE_LENGTH).optional(),

  description: z
    .string()
    .trim()
    .max(MAX_DESCRIPTION_LENGTH)
    .optional()
    .nullable(),

  coverImage: z.string().trim().optional().nullable(),
  isActive: z.boolean().optional(),
  sort: z.string().trim().max(32).optional(),
});

const AddProductsSchema = z.object({
  productIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(MAX_COLLECTION_PRODUCTS),
});

const ReorderProductsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        position: z.number().int().min(0),
      })
    )
    .min(1)
    .max(MAX_COLLECTION_PRODUCTS),
});

/*
 * Lista colecțiilor unui vendor - extrasă ca funcție reutilizabilă
 * (aceeași convenție ca listInfluencerCollectionsSummary/
 * listInfluencerDiscountCodesSummary), folosită de GET / de mai jos
 * și disponibilă pentru orice alt consumator intern (ex. asistent AI).
 */
export async function listVendorCollectionsSummary(vendorId) {
  const collections = await prisma.vendorCollection.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });

  return collections.map(formatVendorCollection);
}

/* =========================================================
   GET /api/vendor/collections
========================================================= */

router.get("/", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collections = await listVendorCollectionsSummary(vendor.id);

    return res.json({ ok: true, collections });
  } catch (error) {
    console.error("[vendorCollections] GET / error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collections_failed",
    });
  }
});

/* =========================================================
   POST /api/vendor/collections
========================================================= */

router.post("/", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    if (vendor.isActive === false) {
      return res.status(403).json({
        ok: false,
        error: "vendor_inactive",
        message: "Magazinul trebuie să fie activ pentru a crea colecții.",
      });
    }

    const parsed = CreateCollectionSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const { title, description, coverImage, isActive, discountPercent, startsAt, endsAt, allOwnProducts } =
      parsed.data;

    if (invalidPeriod(startsAt, endsAt)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_period",
        message: "Data de final trebuie să fie după data de început.",
      });
    }

    const slug = await buildUniqueSlug(title);

    const collection = await prisma.vendorCollection.create({
      data: {
        vendorId: vendor.id,
        title,
        slug,
        description: description || null,
        coverImage: coverImage || null,
        isActive,
        sort: "curated",
        discountPercent: discountPercent ?? 0,
        startsAt: toDateOrNull(startsAt),
        endsAt: toDateOrNull(endsAt),
        allOwnProducts: allOwnProducts ?? false,
      },

      include: { _count: { select: { items: true } } },
    });

    return res.status(201).json({
      ok: true,
      collection: formatVendorCollection(collection),
    });
  } catch (error) {
    console.error("[vendorCollections] POST / error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_create_failed",
    });
  }
});

/* =========================================================
   GET /api/vendor/collections/:id
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);

    const collection = await prisma.vendorCollection.findFirst({
      where: { id: collectionId, vendorId: vendor.id },

      include: {
        items: {
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],

          include: {
            product: {
              select: {
                id: true,
                title: true,
                priceCents: true,
                currency: true,
                images: true,
                isActive: true,
                isHidden: true,
                moderationStatus: true,
                availability: true,

                service: {
                  select: {
                    id: true,
                    title: true,

                    vendor: {
                      select: { id: true, displayName: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!collection) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    return res.json({
      ok: true,

      collection: {
        ...formatVendorCollection(collection),

        items: collection.items.map((item) => ({
          productId: item.productId,
          position: item.position,
          createdAt: item.createdAt,
          product: item.product,
        })),
      },
    });
  } catch (error) {
    console.error("[vendorCollections] GET /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_failed",
    });
  }
});

/* =========================================================
   PATCH /api/vendor/collections/:id
========================================================= */

router.patch("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);

    const existing = await getOwnedCollection(collectionId, vendor.id);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    const parsed = UpdateCollectionSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const data = {};

    if (parsed.data.title !== undefined) {
      data.title = parsed.data.title;

      if (parsed.data.title !== existing.title) {
        data.slug = await buildUniqueSlug(parsed.data.title, existing.id);
      }
    }

    if (parsed.data.description !== undefined) {
      data.description = parsed.data.description || null;
    }

    if (parsed.data.coverImage !== undefined) {
      data.coverImage = parsed.data.coverImage || null;
    }

    if (parsed.data.isActive !== undefined) {
      data.isActive = parsed.data.isActive;
    }

    if (parsed.data.sort !== undefined) {
      data.sort = parsed.data.sort;
    }

    if (parsed.data.discountPercent !== undefined) {
      data.discountPercent = parsed.data.discountPercent;
    }

    if (parsed.data.startsAt !== undefined) {
      data.startsAt = toDateOrNull(parsed.data.startsAt);
    }

    if (parsed.data.endsAt !== undefined) {
      data.endsAt = toDateOrNull(parsed.data.endsAt);
    }

    if (parsed.data.allOwnProducts !== undefined) {
      data.allOwnProducts = parsed.data.allOwnProducts;
    }

    const nextStartsAt = data.startsAt !== undefined ? data.startsAt : existing.startsAt;
    const nextEndsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt;

    if (invalidPeriod(nextStartsAt, nextEndsAt)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_period",
        message: "Data de final trebuie să fie după data de început.",
      });
    }

    const collection = await prisma.vendorCollection.update({
      where: { id: existing.id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.json({
      ok: true,
      collection: formatVendorCollection(collection),
    });
  } catch (error) {
    console.error("[vendorCollections] PATCH /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_update_failed",
    });
  }
});

/* =========================================================
   DELETE /api/vendor/collections/:id

   Item-urile sunt șterse automat prin Cascade. Codurile de
   reducere legate rămân (vendorCollectionId -> SetNull) - la
   fel ca la influencer.
========================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);

    const existing = await getOwnedCollection(collectionId, vendor.id);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    await prisma.vendorCollection.delete({ where: { id: existing.id } });

    return res.json({ ok: true, deletedId: existing.id });
  } catch (error) {
    console.error("[vendorCollections] DELETE /:id error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_delete_failed",
    });
  }
});

/* =========================================================
   Eligibilitate PUBLICĂ a unui produs pentru o VendorCollection -
   aceleași reguli ca listarea publică a marketplace-ului
   (GET /api/public/products, publicProductRoutes.js): produs activ,
   vizibil, aprobat; magazin (serviciu de tip "products") activ și
   publicat; vendor activ. De la ORICE vendor - ownerul colecției NU
   devine seller, produsul rămâne al vendorului real.
========================================================= */

const PUBLIC_COLLECTION_PRODUCT_WHERE = {
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  service: {
    is: {
      type: { is: { code: "products" } },
      isActive: true,
      status: "ACTIVE",
      vendor: { is: { isActive: true } },
    },
  },
};

const PRODUCT_SEARCH_MAX_LIMIT = 48;

/* =========================================================
   GET /api/vendor/collections/:id/product-search
     ?q=<titlu>&store=<magazin/vendor>&category=<cod>&page=1&limit=24

   Selectorul de produse al editorului de colecție: produse publice
   eligibile din TOT marketplace-ul (nu doar ale vendorului curent).
   Doar ownerul colecției (getOwnedCollection). Read-only.
   Fiecare rezultat: vendorul REAL (vendorId / magazin), isOwn
   (produs propriu vs alt vendor), inCollection (deja adăugat).
========================================================= */

router.get("/:id/product-search", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collection = await getOwnedCollection(
      normalizeString(req.params.id),
      vendor.id
    );

    if (!collection) {
      return res.status(404).json({ ok: false, error: "collection_not_found" });
    }

    const q = normalizeString(req.query?.q).slice(0, 120);
    const store = normalizeString(req.query?.store).slice(0, 120);
    const category = normalizeString(req.query?.category).slice(0, 80);
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(
      PRODUCT_SEARCH_MAX_LIMIT,
      Math.max(1, Number.parseInt(req.query?.limit, 10) || 24)
    );

    const and = [];

    if (q) {
      and.push({ title: { contains: q, mode: "insensitive" } });
    }

    if (store) {
      and.push({
        OR: [
          { service: { is: { profile: { is: { displayName: { contains: store, mode: "insensitive" } } } } } },
          { service: { is: { vendor: { is: { displayName: { contains: store, mode: "insensitive" } } } } } },
        ],
      });
    }

    if (category) {
      and.push({ category });
    }

    const where = {
      ...PUBLIC_COLLECTION_PRODUCT_WHERE,
      ...(and.length ? { AND: and } : {}),
    };

    const [rows, collectionItems] = await Promise.all([
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
          service: {
            select: {
              vendorId: true,
              title: true,
              profile: { select: { displayName: true, slug: true } },
              vendor: { select: { id: true, displayName: true } },
            },
          },
        },
      }),

      prisma.vendorCollectionItem.findMany({
        where: { collectionId: collection.id },
        select: { productId: true },
      }),
    ]);

    const inCollection = new Set(collectionItems.map((item) => item.productId));
    const hasMore = rows.length > limit;

    const products = rows.slice(0, limit).map((product) => {
      const sellerVendorId = product.service?.vendor?.id || product.service?.vendorId || null;

      return {
        id: product.id,
        title: product.title,
        image: Array.isArray(product.images) ? product.images[0] || null : null,
        priceCents: product.priceCents,
        price: Number(product.priceCents || 0) / 100,
        currency: product.currency || "RON",
        category: product.category || null,

        // vendorul REAL (seller) - ownerul colecției nu devine seller
        vendorId: sellerVendorId,
        vendorName: product.service?.vendor?.displayName || null,
        storeName:
          product.service?.profile?.displayName ||
          product.service?.title ||
          product.service?.vendor?.displayName ||
          null,
        storeSlug: product.service?.profile?.slug || null,

        isOwn: String(sellerVendorId) === String(vendor.id),
        inCollection: inCollection.has(product.id),
      };
    });

    return res.json({ ok: true, page, limit, hasMore, products });
  } catch (error) {
    console.error("[vendorCollections] GET /:id/product-search error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_product_search_failed",
    });
  }
});

/* =========================================================
   POST /api/vendor/collections/:id/products

   Body: { productIds: ["...", "..."] }

   IMPORTANT: spre deosebire de VendorCampaign, NU verificăm
   proprietatea produselor - o colecție de vendor poate conține
   produse ale altor vendori (decizie explicită a userului).
========================================================= */

router.post("/:id/products", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);

    const collection = await getOwnedCollection(collectionId, vendor.id);

    if (!collection) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    const parsed = AddProductsSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const productIds = [
      ...new Set(
        parsed.data.productIds.map(normalizeString).filter(Boolean)
      ),
    ];

    const existingCount = await prisma.vendorCollectionItem.count({
      where: { collectionId: collection.id },
    });

    if (existingCount + productIds.length > MAX_COLLECTION_PRODUCTS) {
      return res.status(400).json({
        ok: false,
        error: "collection_product_limit",
        message: `O colecție poate avea maximum ${MAX_COLLECTION_PRODUCTS} produse.`,
      });
    }

    /*
     * Permitem doar produse publicabile - de la ORICE vendor.
     */

    /*
     * Revalidare server-side la FIECARE adăugare: produs public eligibil
     * (aceleași reguli ca listarea publică - produs activ / vizibil /
     * aprobat, magazin activ și publicat, vendor activ), de la ORICE vendor.
     */
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        ...PUBLIC_COLLECTION_PRODUCT_WHERE,
      },

      select: { id: true },
    });

    const validProductIds = products.map((product) => product.id);

    if (!validProductIds.length) {
      return res.status(400).json({
        ok: false,
        error: "no_valid_products",
        message: "Nu am găsit produse eligibile pentru colecție.",
      });
    }

    const currentItems = await prisma.vendorCollectionItem.findMany({
      where: { collectionId: collection.id },
      select: { productId: true },
    });

    const existingIds = new Set(currentItems.map((item) => item.productId));

    const idsToAdd = validProductIds.filter(
      (productId) => !existingIds.has(productId)
    );

    if (!idsToAdd.length) {
      return res.json({
        ok: true,
        added: 0,
        message: "Produsele sunt deja în colecție.",
      });
    }

    const lastItem = await prisma.vendorCollectionItem.findFirst({
      where: { collectionId: collection.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const startPosition = Number(lastItem?.position ?? -1) + 1;

    await prisma.vendorCollectionItem.createMany({
      data: idsToAdd.map((productId, index) => ({
        collectionId: collection.id,
        productId,
        position: startPosition + index,
      })),

      skipDuplicates: true,
    });

    return res.json({
      ok: true,
      added: idsToAdd.length,
      productIds: idsToAdd,
    });
  } catch (error) {
    console.error("[vendorCollections] POST /:id/products error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_add_products_failed",
    });
  }
});

/* =========================================================
   DELETE /api/vendor/collections/:id/products/:productId
========================================================= */

router.delete("/:id/products/:productId", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);
    const productId = normalizeString(req.params.productId);

    const collection = await getOwnedCollection(collectionId, vendor.id);

    if (!collection) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    const item = await prisma.vendorCollectionItem.findUnique({
      where: {
        collectionId_productId: { collectionId: collection.id, productId },
      },
    });

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "collection_product_not_found",
      });
    }

    await prisma.vendorCollectionItem.delete({
      where: {
        collectionId_productId: { collectionId: collection.id, productId },
      },
    });

    return res.json({ ok: true, productId });
  } catch (error) {
    console.error(
      "[vendorCollections] DELETE /:id/products/:productId error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_remove_product_failed",
    });
  }
});

/* =========================================================
   PATCH /api/vendor/collections/:id/products/reorder

   Body: { items: [{ productId, position }, ...] }
========================================================= */

router.patch("/:id/products/reorder", async (req, res) => {
  try {
    const vendor = await requireVendor(req, res);
    if (!vendor) return;

    const collectionId = normalizeString(req.params.id);

    const collection = await getOwnedCollection(collectionId, vendor.id);

    if (!collection) {
      return res.status(404).json({
        ok: false,
        error: "collection_not_found",
      });
    }

    const parsed = ReorderProductsSchema.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const currentItems = await prisma.vendorCollectionItem.findMany({
      where: { collectionId: collection.id },
      select: { productId: true },
    });

    const allowedIds = new Set(currentItems.map((item) => item.productId));

    for (const item of parsed.data.items) {
      if (!allowedIds.has(item.productId)) {
        return res.status(400).json({
          ok: false,
          error: "product_not_in_collection",
        });
      }
    }

    await prisma.$transaction(
      parsed.data.items.map((item) =>
        prisma.vendorCollectionItem.update({
          where: {
            collectionId_productId: {
              collectionId: collection.id,
              productId: item.productId,
            },
          },

          data: { position: item.position },
        })
      )
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error("[vendorCollections] PATCH reorder error:", error);

    return res.status(500).json({
      ok: false,
      error: "vendor_collection_reorder_failed",
    });
  }
});

/* =========================================================
   GET /api/public/vendor-collections/:slug

   Endpoint public - NU necesită autentificare, deci NU poate sta
   pe router-ul de mai sus (are un router.use(authRequired,...)
   blanket la nivel de tot fișierul). De-aia e definit pe un
   router SEPARAT, exportat separat și montat separat, la
   "/api/public/vendor-collections", ÎNAINTEA routerelor care
   aplică autentificare (vezi server.js - același loc unde e
   montat publicInfluencerRoutes/publicVendorReferralRoutes).
========================================================= */

const publicRouter = Router();

// select-ul produselor afișate pe pagina publică (compatibil ProductCard + motorul de pricing)
const PUBLIC_COLLECTION_PRODUCT_SELECT = {
  id: true,
  title: true,
  description: true,
  priceCents: true,
  currency: true,
  images: true,
  availability: true,
  category: true,
  color: true,

  isActive: true,
  isHidden: true,
  moderationStatus: true,

  orderMode: true,
  acceptsCustom: true,
  optionsSchema: true,
  customSchema: true,
  repeatedGroups: true,
  quoteSchema: true,
  readyQty: true,
  leadTimeDays: true,
  nextShipDate: true,
  createdAt: true,
  serviceId: true,

  service: {
    select: {
      id: true,
      title: true,
      vendorId: true,

      // sellerul REAL (poate fi alt vendor decât ownerul colecției)
      profile: {
        select: { displayName: true, slug: true },
      },

      vendor: {
        select: { id: true, displayName: true },
      },
    },
  },
};

// plafon pentru allOwnProducts pe pagina publică (pagina nu e paginată încă)
const PUBLIC_ALL_OWN_PRODUCTS_LIMIT = 200;

publicRouter.get("/:slug", async (req, res) => {
  try {
    const slug = normalizeString(req.params.slug);

    if (!slug) {
      return res.status(400).json({ ok: false, error: "slug_required" });
    }

    const collection = await prisma.vendorCollection.findFirst({
      where: {
        slug,
        isActive: true,
        vendor: { isActive: true },
      },

      include: {
        vendor: {
          select: { id: true, displayName: true, referralCode: true },
        },

        items: {
          // aceeași eligibilitate publică ca selectorul / adăugarea (magazin + vendor activ)
          where: {
            product: PUBLIC_COLLECTION_PRODUCT_WHERE,
          },

          orderBy: [{ position: "asc" }, { createdAt: "asc" }],

          include: {
            product: { select: PUBLIC_COLLECTION_PRODUCT_SELECT },
          },
        },
      },
    });

    if (!collection) {
      return res.status(404).json({ ok: false, error: "collection_not_found" });
    }

    /*
     * Starea pentru pricing / atribuire nouă (startsAt / endsAt):
     * LIVE | SCHEDULED | EXPIRED. În afara intervalului pagina se afișează,
     * dar fără reducere, iar frontend-ul nu pornește atribuirea.
     */
    const status = vendorCollectionStatus(collection);
    const isLive = status === "LIVE";

    /*
     * allOwnProducts: TOATE produsele publice eligibile ale ownerului
     * (inclusiv cele publicate ulterior), după selecțiile explicite
     * (VendorCollectionItem - inclusiv produsele altor vendori).
     */
    const explicitProducts = collection.items.map((item) => item.product).filter(Boolean);
    let products = explicitProducts;

    if (collection.allOwnProducts) {
      const ownProducts = await prisma.product.findMany({
        where: {
          ...PUBLIC_COLLECTION_PRODUCT_WHERE,
          service: {
            is: { ...PUBLIC_COLLECTION_PRODUCT_WHERE.service.is, vendorId: collection.vendorId },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: PUBLIC_ALL_OWN_PRODUCTS_LIMIT,
        select: PUBLIC_COLLECTION_PRODUCT_SELECT,
      });

      const seen = new Set(explicitProducts.map((p) => p.id));
      products = [...explicitProducts, ...ownProducts.filter((p) => !seen.has(p.id))];
    }

    /*
     * Prețuri: aceleași surse ca restul site-ului (getPromotionPricingForProducts)
     * + reducerea COLECȚIEI, doar pe produsele proprii ale ownerului și doar
     * când colecția e activă în interval (finanțată de vendor, Artfest = 0).
     * Fail-open: la eroare se afișează prețul de listă.
     */
    let pricedProducts = products;

    try {
      const ownCollections = isLive
        ? new Map([
            [
              String(collection.vendorId),
              {
                collectionId: collection.id,
                slug: collection.slug,
                title: collection.title,
                vendorId: String(collection.vendorId),
                discountPercent: Number(collection.discountPercent || 0),
                allOwnProducts: Boolean(collection.allOwnProducts),
                selectedProductIds: new Set(explicitProducts.map((p) => String(p.id))),
              },
            ],
          ])
        : new Map();

      const pricingByProductId = await getPromotionPricingForProducts(products, {
        campaignPromotionsByProductId: withOwnCollectionPromotions(new Map(), products, ownCollections),
      });

      pricedProducts = products.map((product) =>
        applyPromotionPricingToProduct(product, pricingByProductId.get(product.id))
      );
    } catch (pricingError) {
      console.error("[vendorCollections] public pricing failed:", pricingError);
    }

    /*
     * Contorizare simplă a vizitei - non-blocantă.
     */
    prisma.vendorCollection
      .update({
        where: { id: collection.id },
        data: { visits: { increment: 1 } },
      })
      .catch((error) => {
        console.error(
          "[vendorCollections] visit counter error:",
          error
        );
      });

    /*
     * TRANZIȚIE - DE ELIMINAT: attributionToken e emis doar pentru
     * bundle-urile vechi (localStorage). Frontend-ul nou păstrează slug-ul
     * colecției în memoria aplicației / URL (?vcol=) și îl trimite la
     * checkout ca `vendorCollectionSlugs` (services/referralAttribution.js
     * -> resolveVendorCollectionAttributionBySlug).
     */
    const attributionToken = isLive
      ? signVendorCollectionAttributionToken({
          collectionId: collection.id,
          ownerVendorId: collection.vendorId,
        })
      : null;

    return res.json({
      ok: true,

      collection: {
        id: collection.id,
        title: collection.title,
        slug: collection.slug,
        description: collection.description,
        coverImage: collection.coverImage,
        visits: collection.visits,

        discountPercent: Number(collection.discountPercent || 0),
        allOwnProducts: Boolean(collection.allOwnProducts),
        startsAt: collection.startsAt || null,
        endsAt: collection.endsAt || null,
        status,
        isLive,

        vendor: {
          id: collection.vendor.id,
          displayName: collection.vendor.displayName,
          referralCode: collection.vendor.referralCode,
        },

        products: pricedProducts,
      },

      attributionToken,
      attributionWindowHours: VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS,
    });
  } catch (error) {
    console.error("[vendorCollections] GET public/:slug error:", error);

    return res.status(500).json({
      ok: false,
      error: "public_vendor_collection_failed",
    });
  }
});

/* =========================================================
   GET /api/public/vendor-collections/store/:storeSlug

   „Colecțiile magazinului” din profilul public: colecțiile ACTIVE ÎN
   INTERVAL ale vendorului magazinului (owner), cele mai noi întâi.
========================================================= */

const STORE_COLLECTIONS_LIMIT = 12;

publicRouter.get("/store/:storeSlug", async (req, res) => {
  try {
    const storeSlug = normalizeString(req.params.storeSlug);
    if (!storeSlug) return res.status(400).json({ ok: false, error: "store_slug_required" });

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug: storeSlug },
      select: { service: { select: { vendorId: true, vendor: { select: { isActive: true } } } } },
    });

    const vendorId = profile?.service?.vendorId;
    if (!vendorId || profile.service.vendor?.isActive === false) {
      return res.json({ ok: true, collections: [] });
    }

    const rows = await prisma.vendorCollection.findMany({
      where: { vendorId, isActive: true },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { items: true } } },
    });

    const collections = rows
      .filter((c) => vendorCollectionStatus(c) === "LIVE")
      .slice(0, STORE_COLLECTIONS_LIMIT)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        description: c.description,
        coverImage: c.coverImage,
        discountPercent: Number(c.discountPercent || 0),
        allOwnProducts: Boolean(c.allOwnProducts),
        productsCount: c._count?.items ?? 0,
        publicPath: `/colectie-vendor/${c.slug}`,
      }));

    return res.json({ ok: true, collections });
  } catch (error) {
    console.error("[vendorCollections] GET public/store/:storeSlug error:", error);
    return res.status(500).json({ ok: false, error: "public_store_collections_failed" });
  }
});

/* =========================================================
   GET /api/public/vendor-collections/legacy-campaign/:slug

   Compatibilitate /c/:slug: dacă VendorCampaign cu acest slug a fost
   MIGRATĂ (VendorCollection.legacyCampaignId), întoarce slug-ul colecției
   -> frontend-ul face redirect la /colectie-vendor/:slug. Campanie nemigrată
   (sau inexistentă) -> 404, iar /c/:slug păstrează comportamentul vechi.
========================================================= */

publicRouter.get("/legacy-campaign/:slug", async (req, res) => {
  try {
    const slug = normalizeString(req.params.slug);
    if (!slug) return res.status(400).json({ ok: false, error: "slug_required" });

    const campaign = await prisma.vendorCampaign.findUnique({
      where: { slug },
      select: { id: true },
    });

    const collection = campaign
      ? await prisma.vendorCollection.findUnique({
          where: { legacyCampaignId: campaign.id },
          select: { slug: true },
        })
      : null;

    if (!collection) {
      return res.status(404).json({ ok: false, error: "not_migrated" });
    }

    return res.json({ ok: true, collectionSlug: collection.slug });
  } catch (error) {
    console.error("[vendorCollections] GET public/legacy-campaign/:slug error:", error);
    return res.status(500).json({ ok: false, error: "legacy_campaign_lookup_failed" });
  }
});

export { publicRouter as vendorCollectionsPublicRouter };
export default router;
