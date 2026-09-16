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

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

const MAX_TITLE_LENGTH = 160;
const MAX_SLUG_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_COLLECTION_PRODUCTS = 100;

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

    productsCount:
      collection._count?.items ?? collection.items?.length ?? 0,

    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

/* =========================================================
   VALIDATION
========================================================= */

const CreateCollectionSchema = z.object({
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

    const { title, description, coverImage, isActive } = parsed.data;

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

    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
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
          where: {
            product: {
              isActive: true,
              isHidden: false,
              moderationStatus: "APPROVED",
            },
          },

          orderBy: [{ position: "asc" }, { createdAt: "asc" }],

          include: {
            product: {
              select: {
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
      return res.status(404).json({ ok: false, error: "collection_not_found" });
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
     * PERSISTENT ATTRIBUTION (audit 2026-09-15, regula finală de
     * business) - emis la FIECARE încărcare a paginii publice a
     * colecției (echivalentul "vizitării linkului"). Semnat
     * server-side, revalidat fresh din DB la checkout
     * (resolveVendorCollectionAttribution, vendorAttribution.js) -
     * NU e sursă de adevăr singură. NU face produsele eligibile la
     * discount - asta rămâne strict legat de VendorCollectionItem.
     */
    const attributionToken = signVendorCollectionAttributionToken({
      collectionId: collection.id,
      ownerVendorId: collection.vendorId,
    });

    return res.json({
      ok: true,

      collection: {
        id: collection.id,
        title: collection.title,
        slug: collection.slug,
        description: collection.description,
        coverImage: collection.coverImage,
        visits: collection.visits,

        vendor: {
          id: collection.vendor.id,
          displayName: collection.vendor.displayName,
          referralCode: collection.vendor.referralCode,
        },

        products: collection.items.map((item) => item.product),
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

export { publicRouter as vendorCollectionsPublicRouter };
export default router;
