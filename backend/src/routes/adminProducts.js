import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { CATEGORY_SET } from "../constants/categories.js";
import { COLOR_SET } from "../constants/colors.js";

const router = Router();

/* ================= Guards ================= */

function adminRequired(req, res, next) {
  if (req.user?.role === "ADMIN") return next();
  return res.status(403).json({ error: "forbidden" });
}

/* ================= Helpers ================= */

function mapAdminProduct(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: (p.priceCents ?? 0) / 100,
    priceCents: p.priceCents ?? 0,
    images: Array.isArray(p.images) ? p.images : [],
    currency: p.currency || "RON",

    isActive: !!p.isActive,
    isHidden: !!p.isHidden,
    category: p.category || null,
    color: p.color || null,

    availability: p.availability ? String(p.availability).toUpperCase() : null,
    leadTimeDays: p.leadTimeDays ?? null,
    readyQty: p.readyQty ?? null,
    nextShipDate: p.nextShipDate ?? null,
    acceptsCustom: !!p.acceptsCustom,

    materialMain: p.materialMain || null,
    technique: p.technique || null,
    styleTags: Array.isArray(p.styleTags) ? p.styleTags : [],
    occasionTags: Array.isArray(p.occasionTags) ? p.occasionTags : [],

    dimensions: p.dimensions || null,
    careInstructions: p.careInstructions || null,
    specialNotes: p.specialNotes || null,

    moderationStatus: p.moderationStatus || null,
    moderationMessage: p.moderationMessage || null,
    submittedAt: p.submittedAt ?? null,
    reviewedAt: p.reviewedAt ?? null,
    reviewedByUserId: p.reviewedByUserId ?? null,
    approvedAt: p.approvedAt ?? null,

    createdAt: p.createdAt,
    updatedAt: p.updatedAt,

    service: p.service
      ? {
          id: p.service.id,
          isActive: !!p.service.isActive,
          status: p.service.status || null,
          typeCode: p.service.type?.code || null,
          profile: p.service.profile
            ? {
                slug: p.service.profile.slug || null,
                displayName: p.service.profile.displayName || "",
                city: p.service.profile.city || "",
              }
            : null,
        }
      : null,

    vendor: p.service?.vendor
      ? {
          id: p.service.vendor.id,
          userId: p.service.vendor.userId,
          displayName: p.service.vendor.displayName || "",
          email: p.service.vendor.email || "",
          city: p.service.vendor.city || "",
          isActive: !!p.service.vendor.isActive,
        }
      : null,
  };
}

function buildAdminOrderBy(sort) {
  switch (String(sort || "new")) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "old":
      return [{ createdAt: "asc" }];
    case "title_asc":
      return [{ title: "asc" }];
    case "title_desc":
      return [{ title: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
}

function parseBooleanQuery(v) {
  if (v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

function normalizeAvailabilityPayload(body, currentProduct = null) {
  let availabilityRaw = null;

  if (body.availability != null) {
    availabilityRaw = String(body.availability).toUpperCase();
  } else if (currentProduct?.availability) {
    availabilityRaw = String(currentProduct.availability).toUpperCase();
  } else {
    return { error: "availability_required" };
  }

  if (!["READY", "MADE_TO_ORDER", "PREORDER", "SOLD_OUT"].includes(availabilityRaw)) {
    return { error: "invalid_availability" };
  }

  const out = {
    availability: availabilityRaw,
    leadTimeDays: null,
    readyQty: null,
    nextShipDate: null,
  };

  if (availabilityRaw === "MADE_TO_ORDER") {
    const lt =
      body.leadTimeDays != null
        ? Number(body.leadTimeDays)
        : currentProduct?.leadTimeDays ?? null;

    if (!Number.isFinite(lt) || lt <= 0) {
      return { error: "invalid_lead_time" };
    }

    out.leadTimeDays = Math.floor(lt);
  }

  if (availabilityRaw === "READY") {
    if (body.readyQty != null) {
      const rq = Number(body.readyQty);
      if (!Number.isFinite(rq) || rq < 0) {
        return { error: "invalid_ready_qty" };
      }
      out.readyQty = Math.floor(rq);
    } else if (currentProduct) {
      out.readyQty = currentProduct.readyQty ?? null;
    }
  }

  if (availabilityRaw === "PREORDER") {
    if (body.nextShipDate != null) {
      const dt = new Date(body.nextShipDate);
      if (Number.isNaN(dt.getTime())) {
        return { error: "invalid_next_ship_date" };
      }
      out.nextShipDate = dt;
    } else if (currentProduct?.nextShipDate) {
      out.nextShipDate = currentProduct.nextShipDate;
    }
  }

  if (availabilityRaw === "SOLD_OUT") {
    out.readyQty = 0;
  }

  return { ok: true, ...out };
}

/* ================= GET all admin products ================= */

/**
 * GET /admin/products
 * Listă globală pentru admin
 */
router.get("/products", authRequired, adminRequired, async (req, res) => {
  try {
    const {
      q = "",
      category = "",
      color = "",
      availability = "",
      moderationStatus = "",
      isActive,
      isHidden,
      vendorId = "",
      vendorUserId = "",
      storeSlug = "",
      serviceId = "",
      sort = "new",
      take = "100",
    } = req.query || {};

    const where = {
      service: {
        is: {
          type: { is: { code: "products" } },
        },
      },
    };

    if (category) {
      where.category = String(category).trim();
    }

    if (color) {
      where.color = String(color).trim();
    }

    const av = String(availability || "").trim().toUpperCase();
    if (av) {
      where.availability = av;
    }

    const mod = String(moderationStatus || "").trim().toUpperCase();
    if (mod) {
      where.moderationStatus = mod;
    }

    const activeVal = parseBooleanQuery(isActive);
    if (typeof activeVal === "boolean") {
      where.isActive = activeVal;
    }

    const hiddenVal = parseBooleanQuery(isHidden);
    if (typeof hiddenVal === "boolean") {
      where.isHidden = hiddenVal;
    }

    if (serviceId) {
      where.serviceId = String(serviceId).trim();
    }

    if (storeSlug) {
      where.service = {
        is: {
          ...(where.service?.is || {}),
          profile: { is: { slug: String(storeSlug).trim().toLowerCase() } },
        },
      };
    }

    if (vendorId) {
      where.service = {
        is: {
          ...(where.service?.is || {}),
          vendorId: String(vendorId).trim(),
        },
      };
    }

    if (vendorUserId) {
      where.service = {
        is: {
          ...(where.service?.is || {}),
          vendor: { is: { userId: String(vendorUserId).trim() } },
        },
      };
    }

    const qstr = String(q || "").trim();
    if (qstr) {
      where.OR = [
        { title: { contains: qstr, mode: "insensitive" } },
        { description: { contains: qstr, mode: "insensitive" } },
        { category: { contains: qstr, mode: "insensitive" } },
        { color: { contains: qstr, mode: "insensitive" } },
        { materialMain: { contains: qstr, mode: "insensitive" } },
        { technique: { contains: qstr, mode: "insensitive" } },
        { styleTags: { has: qstr } },
        { occasionTags: { has: qstr } },
        {
          service: {
            is: {
              profile: {
                is: {
                  displayName: { contains: qstr, mode: "insensitive" },
                },
              },
            },
          },
        },
        {
          service: {
            is: {
              vendor: {
                is: {
                  displayName: { contains: qstr, mode: "insensitive" },
                },
              },
            },
          },
        },
      ];
    }

    const pageSize = Math.max(1, Math.min(200, Number(take) || 100));

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: buildAdminOrderBy(sort),
        take: pageSize,
        include: {
          service: {
            include: {
              type: true,
              profile: true,
              vendor: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      items: items.map(mapAdminProduct),
      total,
    });
  } catch (e) {
    console.error("GET /admin/products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ================= GET products by store ================= */

/**
 * GET /admin/store/:slug/products
 * Toate produsele dintr-un store
 */
router.get("/store/:slug/products", authRequired, adminRequired, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "invalid_slug" });

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: {
        service: {
          include: {
            type: true,
            vendor: true,
            profile: true,
          },
        },
      },
    });

    if (!profile) return res.status(404).json({ error: "store_not_found" });
    if (!profile.service || profile.service.type?.code !== "products") {
      return res.status(404).json({ error: "not_a_products_store" });
    }

    const {
      q = "",
      category = "",
      availability = "",
      moderationStatus = "",
      isActive,
      isHidden,
      sort = "new",
      take = "100",
    } = req.query || {};

    const where = {
      serviceId: profile.serviceId,
    };

    if (category) where.category = String(category).trim();

    const av = String(availability || "").trim().toUpperCase();
    if (av) where.availability = av;

    const mod = String(moderationStatus || "").trim().toUpperCase();
    if (mod) where.moderationStatus = mod;

    const activeVal = parseBooleanQuery(isActive);
    if (typeof activeVal === "boolean") where.isActive = activeVal;

    const hiddenVal = parseBooleanQuery(isHidden);
    if (typeof hiddenVal === "boolean") where.isHidden = hiddenVal;

    const qstr = String(q || "").trim();
    if (qstr) {
      where.OR = [
        { title: { contains: qstr, mode: "insensitive" } },
        { description: { contains: qstr, mode: "insensitive" } },
        { category: { contains: qstr, mode: "insensitive" } },
        { color: { contains: qstr, mode: "insensitive" } },
        { materialMain: { contains: qstr, mode: "insensitive" } },
        { technique: { contains: qstr, mode: "insensitive" } },
        { styleTags: { has: qstr } },
        { occasionTags: { has: qstr } },
      ];
    }

    const pageSize = Math.max(1, Math.min(200, Number(take) || 100));

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: buildAdminOrderBy(sort),
        take: pageSize,
        include: {
          service: {
            include: {
              type: true,
              profile: true,
              vendor: true,
            },
          },
        },
      }),
    ]);

    return res.json({
      store: {
        id: profile.service.id,
        slug: profile.slug,
        displayName: profile.displayName || profile.service.vendor?.displayName || "",
        vendorId: profile.service.vendorId,
      },
      items: items.map(mapAdminProduct),
      total,
    });
  } catch (e) {
    console.error("GET /admin/store/:slug/products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ================= GET one admin product ================= */

/**
 * GET /admin/products/:id
 */
router.get("/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            type: true,
            profile: true,
            vendor: true,
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "not_found" });

    return res.json(mapAdminProduct(product));
  } catch (e) {
    console.error("GET /admin/products/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ================= PATCH moderation ================= */

/**
 * PATCH /admin/products/:id/moderation
 * Approve / reject / request changes / hide / deactivate
 */
router.patch("/products/:id/moderation", authRequired, adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            type: true,
            profile: true,
            vendor: true,
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "not_found" });

    const patch = {};
    const now = new Date();

    if (typeof req.body.isHidden === "boolean") {
      patch.isHidden = req.body.isHidden;
    }

    if (typeof req.body.isActive === "boolean") {
      patch.isActive = req.body.isActive;
    }

    if (req.body.moderationMessage !== undefined) {
      patch.moderationMessage =
        req.body.moderationMessage == null || String(req.body.moderationMessage).trim() === ""
          ? null
          : String(req.body.moderationMessage).trim();
    }

    if (req.body.moderationStatus !== undefined) {
      const nextStatus = String(req.body.moderationStatus).trim().toUpperCase();

      if (!["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(nextStatus)) {
        return res.status(400).json({ error: "invalid_moderation_status" });
      }

      patch.moderationStatus = nextStatus;
      patch.reviewedAt = now;
      patch.reviewedByUserId = req.user.sub;

      if (nextStatus === "APPROVED") {
        patch.isHidden = false;
        patch.isActive = true;
        patch.approvedAt = now;
        if (patch.moderationMessage === undefined) patch.moderationMessage = null;
      } else if (nextStatus === "REJECTED") {
        patch.isHidden = true;
        patch.isActive = false;
        patch.approvedAt = null;
      } else if (nextStatus === "CHANGES_REQUESTED") {
        patch.isHidden = true;
        patch.isActive = false;
        patch.approvedAt = null;
      } else if (nextStatus === "PENDING") {
        patch.isHidden = true;
        patch.approvedAt = null;
        patch.reviewedAt = null;
        patch.reviewedByUserId = null;
      }
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "nothing_to_update" });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: patch,
      include: {
        service: {
          include: {
            type: true,
            profile: true,
            vendor: true,
          },
        },
      },
    });

    return res.json(mapAdminProduct(updated));
  } catch (e) {
    console.error("PATCH /admin/products/:id/moderation error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ================= Optional full admin edit ================= */

/**
 * PUT /admin/products/:id
 * Dacă vrei ca adminul să poată edita complet produsul
 */
router.put("/products/:id", authRequired, adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();

    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) return res.status(404).json({ error: "not_found" });

    const patch = {};

    if (typeof req.body.title === "string") {
      if (!req.body.title.trim()) {
        return res.status(400).json({ error: "invalid_title" });
      }
      patch.title = req.body.title.trim();
    }

    if (typeof req.body.description === "string") {
      patch.description = req.body.description;
    }

    if (req.body.price !== undefined) {
      const priceNum = Number(req.body.price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ error: "invalid_price" });
      }
      patch.priceCents = Math.round(priceNum * 100);
    }

    if (Array.isArray(req.body.images)) {
      patch.images = req.body.images.slice(0, 12).map((s) => String(s));
    }

    if (typeof req.body.isActive === "boolean") patch.isActive = req.body.isActive;
    if (typeof req.body.isHidden === "boolean") patch.isHidden = req.body.isHidden;

    if (req.body.category !== undefined) {
      const v = req.body.category;
      if (v == null || String(v).trim() === "") {
        patch.category = null;
      } else {
        const c = String(v).trim();
        if (!CATEGORY_SET.has(c)) {
          return res.status(400).json({ error: "invalid_category" });
        }
        patch.category = c;
      }
    }

    if (req.body.color !== undefined) {
      const v = req.body.color;
      if (v == null || String(v).trim() === "") {
        patch.color = null;
      } else {
        const c = String(v).trim();
        if (!COLOR_SET.has(c)) {
          return res.status(400).json({ error: "invalid_color" });
        }
        patch.color = c;
      }
    }

    if (req.body.materialMain !== undefined) {
      const v = req.body.materialMain;
      patch.materialMain = v == null || String(v).trim() === "" ? null : String(v).trim();
    }

    if (req.body.technique !== undefined) {
      const v = req.body.technique;
      patch.technique = v == null || String(v).trim() === "" ? null : String(v).trim();
    }

    if (req.body.styleTags !== undefined) {
      patch.styleTags = Array.isArray(req.body.styleTags)
        ? req.body.styleTags.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 20)
        : [];
    }

    if (req.body.occasionTags !== undefined) {
      patch.occasionTags = Array.isArray(req.body.occasionTags)
        ? req.body.occasionTags.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 20)
        : [];
    }

    if (req.body.dimensions !== undefined) {
      const v = req.body.dimensions;
      patch.dimensions = v == null || String(v).trim() === "" ? null : String(v).trim();
    }

    if (req.body.careInstructions !== undefined) {
      const v = req.body.careInstructions;
      patch.careInstructions = v == null || String(v).trim() === "" ? null : String(v);
    }

    if (req.body.specialNotes !== undefined) {
      const v = req.body.specialNotes;
      patch.specialNotes = v == null || String(v).trim() === "" ? null : String(v);
    }

    const needsAvailabilityUpdate =
      req.body.availability !== undefined ||
      req.body.leadTimeDays !== undefined ||
      req.body.readyQty !== undefined ||
      req.body.nextShipDate !== undefined;

    if (needsAvailabilityUpdate) {
      const availNorm = normalizeAvailabilityPayload(req.body, product);
      if (availNorm.error) {
        return res.status(400).json({ error: availNorm.error });
      }

      patch.availability = availNorm.availability;
      patch.leadTimeDays = availNorm.leadTimeDays;
      patch.readyQty = availNorm.readyQty;
      patch.nextShipDate = availNorm.nextShipDate;
    }

    if (typeof req.body.acceptsCustom === "boolean") {
      patch.acceptsCustom = req.body.acceptsCustom;
    }

    if (req.body.moderationStatus !== undefined) {
      const nextStatus = String(req.body.moderationStatus).trim().toUpperCase();

      if (!["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(nextStatus)) {
        return res.status(400).json({ error: "invalid_moderation_status" });
      }

      patch.moderationStatus = nextStatus;
    }

    if (req.body.moderationMessage !== undefined) {
      patch.moderationMessage =
        req.body.moderationMessage == null || String(req.body.moderationMessage).trim() === ""
          ? null
          : String(req.body.moderationMessage).trim();
    }

    const updated = await prisma.product.update({
      where: { id },
      data: patch,
      include: {
        service: {
          include: {
            type: true,
            profile: true,
            vendor: true,
          },
        },
      },
    });

    return res.json(mapAdminProduct(updated));
  } catch (e) {
    console.error("PUT /admin/products/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;