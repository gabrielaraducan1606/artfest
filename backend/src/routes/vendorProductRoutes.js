import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { CATEGORY_SET } from "../constants/categories.js";
import { COLOR_SET } from "../constants/colors.js";

const router = Router();

/* ================= Helpers comune ================= */

async function vendorAccessRequired(req, res, next) {
  try {
    if (req.user?.role === "VENDOR" || req.user?.role === "ADMIN") return next();

    const v = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
    });

    if (v) {
      req.meVendor = v;
      return next();
    }

    return res.status(403).json({ error: "forbidden" });
  } catch (e) {
    console.error("vendorAccessRequired error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function getOwnedProductsServiceBySlug(slug, userSub) {
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

  if (!profile) return { error: "store_not_found", status: 404 };

  const svc = profile.service;

  if (!svc || svc.type?.code !== "products") {
    return { error: "not_a_products_store", status: 404 };
  }

  if (!svc.vendor || svc.vendor.userId !== userSub) {
    return { error: "forbidden", status: 403 };
  }

  return { service: svc, profile };
}

function mapProduct(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: Math.round(p.priceCents) / 100,
    images: Array.isArray(p.images) ? p.images : [],
    currency: p.currency || "RON",
    isActive: p.isActive,
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

    moderationStatus: p.moderationStatus || "PENDING",
    moderationMessage: p.moderationMessage || null,
    submittedAt: p.submittedAt || null,
    reviewedAt: p.reviewedAt || null,
    reviewedByUserId: p.reviewedByUserId || null,
    approvedAt: p.approvedAt || null,

    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function parseBooleanQuery(value) {
  if (value === undefined) return undefined;

  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;

  return undefined;
}

function buildProductOrderBy(sort = "new") {
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

function applyProductFilters(where, query = {}) {
  const {
    q = "",
    category = "",
    availability = "",
    isActive,
    isHidden,
    moderationStatus = "",
  } = query;

  if (category) where.category = String(category).trim();

  const av = String(availability || "").trim().toUpperCase();
  if (av) where.availability = av;

  const mod = String(moderationStatus || "").trim().toUpperCase();
  if (["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(mod)) {
    where.moderationStatus = mod;
  }

  const activeBool = parseBooleanQuery(isActive);
  if (activeBool !== undefined) where.isActive = activeBool;

  const hiddenBool = parseBooleanQuery(isHidden);
  if (hiddenBool !== undefined) where.isHidden = hiddenBool;

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

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  return [];
}

/* ================= Subscription / plan helpers ================= */

async function getActivePlanForVendor(vendorId) {
  const now = new Date();

  const sub = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      OR: [
        { status: "active", endAt: { gt: now } },
        { trialEndsAt: { gt: now } },
      ],
    },
    include: { plan: true },
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
  });

  if (sub?.plan) return sub.plan;

  const basic = await prisma.subscriptionPlan.findUnique({
    where: { code: "basic" },
  });

  return (
    basic ?? {
      code: "basic",
      name: "Basic",
      maxProducts: 15,
      commissionBps: 1200,
    }
  );
}

async function resolveProductLimitForVendor({ vendorId }) {
  const [plan, vendor] = await Promise.all([
    getActivePlanForVendor(vendorId),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { productLimitOverride: true },
    }),
  ]);

  let limit;

  if (vendor?.productLimitOverride === -1) {
    limit = null;
  } else if (typeof vendor?.productLimitOverride === "number") {
    limit = vendor.productLimitOverride;
  } else {
    limit = plan?.maxProducts ?? null;
  }

  return {
    plan,
    limit,
    override: vendor?.productLimitOverride ?? null,
  };
}

async function checkProductLimitForService({ serviceId, vendorId }) {
  const { plan, limit, override } = await resolveProductLimitForVendor({ vendorId });

  const current = await prisma.product.count({
    where: { serviceId },
  });

  if (limit == null) {
    return {
      ok: true,
      plan: { code: plan.code, name: plan.name },
      limit: null,
      current,
      override,
    };
  }

  if (current >= limit) {
    return {
      ok: false,
      error: "upgrade_required",
      reason: "products_limit_reached",
      plan: { code: plan.code, name: plan.name },
      limit,
      current,
      override,
    };
  }

  return {
    ok: true,
    plan: { code: plan.code, name: plan.name },
    limit,
    current,
    override,
  };
}

/* ============== Public & vendor handlers ============== */

async function publicListProducts(req, res) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();

    const profile = await prisma.serviceProfile.findUnique({
      where: { slug },
      include: { service: { include: { type: true } } },
    });

    if (!profile || profile.service?.type?.code !== "products") {
      return res.status(404).json({ error: "not_found" });
    }

    const {
      q = "",
      category = "",
      availability = "",
      pmin = "",
      pmax = "",
      color = "",
      sort = "new",
      cursor,
      take = "24",
    } = req.query || {};

    const where = {
      serviceId: profile.serviceId,
      isActive: true,
      isHidden: false,
      moderationStatus: "APPROVED",
    };

    if (category) where.category = String(category);
    if (color) where.color = String(color).trim();

    const av = String(availability || "").toUpperCase();
    if (av) {
      if (av === "READY") {
        where.AND = [
          { availability: "READY" },
          { OR: [{ readyQty: null }, { readyQty: { gt: 0 } }] },
        ];
      } else if (av === "SOLD_OUT") {
        where.OR = [
          { availability: "SOLD_OUT" },
          { AND: [{ availability: "READY" }, { readyQty: { lte: 0 } }] },
        ];
      } else if (["MADE_TO_ORDER", "PREORDER"].includes(av)) {
        where.availability = av;
      }
    }

    const priceMin = Number(pmin);
    const priceMax = Number(pmax);

    if (Number.isFinite(priceMin) || Number.isFinite(priceMax)) {
      where.priceCents = {};
      if (Number.isFinite(priceMin)) where.priceCents.gte = Math.round(priceMin * 100);
      if (Number.isFinite(priceMax)) where.priceCents.lte = Math.round(priceMax * 100);
    }

    const qstr = String(q || "").trim();
    if (qstr) {
      where.OR = (where.OR || []).concat([
        { title: { contains: qstr, mode: "insensitive" } },
        { description: { contains: qstr, mode: "insensitive" } },
        { category: { contains: qstr, mode: "insensitive" } },
        { color: { contains: qstr, mode: "insensitive" } },
        { styleTags: { has: qstr } },
        { occasionTags: { has: qstr } },
      ]);
    }

    const pageSize = Math.max(1, Math.min(48, Number(take) || 24));
    const cursorObj = cursor ? { id: String(cursor) } : undefined;

    const items = await prisma.product.findMany({
      where,
      orderBy: buildProductOrderBy(sort),
      take: pageSize + 1,
      ...(cursorObj ? { cursor: cursorObj, skip: 1 } : {}),
    });

    const hasMore = items.length > pageSize;
    const slice = hasMore ? items.slice(0, pageSize) : items;

    res.set("Cache-Control", "public, max-age=0, must-revalidate");

    return res.json({
      items: slice.map(mapProduct),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    });
  } catch (e) {
    console.error("GET /public/store/:slug/products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function listVendorProducts(req, res) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { service, error, status } = await getOwnedProductsServiceBySlug(slug, req.user.sub);

    if (error) return res.status(status).json({ error });

    const { sort = "new", take = "100" } = req.query || {};

    const where = { serviceId: service.id };
    applyProductFilters(where, req.query);

    const pageSize = Math.max(1, Math.min(200, Number(take) || 100));

    const items = await prisma.product.findMany({
      where,
      orderBy: buildProductOrderBy(sort),
      take: pageSize,
    });

    return res.json({
      store: {
        id: service.id,
        vendorId: service.vendorId,
        slug,
        status: service.status,
        isActive: !!service.isActive,
      },
      items: items.map(mapProduct),
      total: items.length,
    });
  } catch (e) {
    console.error("GET /vendors/store/:slug/products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function getProduct(req, res) {
  try {
    const id = String(req.params.id);

    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            vendor: true,
            type: true,
            profile: true,
          },
        },
      },
    });

    if (!p) return res.status(404).json({ error: "not_found" });

    if (p.service?.vendor?.userId !== req.user.sub) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (p.service?.type?.code !== "products") {
      return res.status(400).json({ error: "not_a_products_store" });
    }

    return res.json({
      ...mapProduct(p),
      ownerVendorId: p.service.vendorId,
      vendor: {
        id: p.service.vendor.id,
        displayName: p.service.profile?.displayName || p.service.vendor.displayName || "",
        slug: p.service.profile?.slug || null,
        city: p.service.profile?.city || p.service.vendor.city || "",
      },
      service: {
        id: p.service.id,
        status: p.service.status,
        isActive: !!p.service.isActive,
      },
    });
  } catch (e) {
    console.error("GET /vendors/products/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function getProductLimits(req, res) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { service, error, status } = await getOwnedProductsServiceBySlug(slug, req.user.sub);

    if (error) return res.status(status).json({ error });

    const limitCheck = await checkProductLimitForService({
      serviceId: service.id,
      vendorId: service.vendorId,
    });

    return res.json({
      plan: limitCheck.plan,
      maxProducts: limitCheck.limit,
      currentProducts: limitCheck.current,
      canAdd: limitCheck.ok,
      override: limitCheck.override,
    });
  } catch (e) {
    console.error("GET /vendors/store/:slug/products/limits error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function getProductPricing(req, res) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { service, error, status } = await getOwnedProductsServiceBySlug(slug, req.user.sub);

    if (error) return res.status(status).json({ error });

    const plan = await getActivePlanForVendor(service.vendorId);
    const commissionBps = plan?.commissionBps != null ? Number(plan.commissionBps) : 0;

    return res.json({
      plan: {
        code: plan?.code || "basic",
        name: plan?.name || "Basic",
      },
      commissionBps: Number.isFinite(commissionBps) ? commissionBps : 0,
    });
  } catch (e) {
    console.error("GET /vendors/store/:slug/products/pricing error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function createProduct(req, res) {
  try {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { service, error, status } = await getOwnedProductsServiceBySlug(slug, req.user.sub);

    if (error) return res.status(status).json({ error });

    const limitCheck = await checkProductLimitForService({
      serviceId: service.id,
      vendorId: service.vendorId,
    });

    if (!limitCheck.ok) {
      return res.status(402).json(limitCheck);
    }

    const {
      title,
      description = "",
      price,
      images = [],
      currency = "RON",
      category = null,
      color = null,
      availability,
      leadTimeDays,
      readyQty,
      nextShipDate,
      acceptsCustom = false,
      materialMain,
      technique,
      styleTags,
      occasionTags,
      dimensions,
      careInstructions,
      specialNotes,
    } = req.body || {};

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "invalid_title" });
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: "invalid_price" });
    }

    const priceCents = Math.round(priceNum * 100);
    const imgs = Array.isArray(images) ? images.slice(0, 12).map((s) => String(s)) : [];

    let cat = null;
    if (category != null && String(category).trim() !== "") {
      const c = String(category).trim();
      if (!CATEGORY_SET.has(c)) {
        return res.status(400).json({ error: "invalid_category" });
      }
      cat = c;
    }

    let colorCode = null;
    if (color != null && String(color).trim() !== "") {
      const c = String(color).trim();
      if (COLOR_SET.has(c)) {
        colorCode = c;
      } else {
        console.warn("Unknown color code from payload:", c);
        colorCode = null;
      }
    }

    const availNorm = normalizeAvailabilityPayload(
      { availability, leadTimeDays, readyQty, nextShipDate },
      null
    );

    if (availNorm.error) {
      return res.status(400).json({ error: availNorm.error });
    }

    const created = await prisma.product.create({
      data: {
        serviceId: service.id,
        title: title.trim(),
        description: String(description || ""),
        priceCents,
        currency: String(currency || "RON"),
        images: imgs,

        isActive: req.body.isActive !== false, // default true
isHidden: !!req.body.isHidden,         // default false
moderationStatus: "PENDING",
        moderationMessage: null,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
        approvedAt: null,

        category: cat,
        color: colorCode,
        availability: availNorm.availability,
        leadTimeDays: availNorm.leadTimeDays,
        readyQty: availNorm.readyQty,
        nextShipDate: availNorm.nextShipDate,
        acceptsCustom: !!acceptsCustom,
        materialMain: materialMain ? String(materialMain).trim() : null,
        technique: technique ? String(technique).trim() : null,
        styleTags: normalizeTags(styleTags),
        occasionTags: normalizeTags(occasionTags),
        dimensions: dimensions ? String(dimensions).trim() : null,
        careInstructions: careInstructions ? String(careInstructions) : null,
        specialNotes: specialNotes ? String(specialNotes) : null,
      },
    });

    return res.status(201).json(mapProduct(created));
  } catch (e) {
    console.error("POST /vendors/store/:slug/products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function updateProduct(req, res) {
  try {
    const id = String(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            vendor: true,
            type: true,
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "not_found" });

    if (product.service?.vendor?.userId !== req.user.sub) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (product.service?.type?.code !== "products") {
      return res.status(400).json({ error: "not_a_products_store" });
    }

    const patch = {};

    if (typeof req.body.title === "string") {
      if (!req.body.title.trim()) return res.status(400).json({ error: "invalid_title" });
      patch.title = req.body.title.trim();
    }

    if (typeof req.body.description === "string") patch.description = req.body.description;

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

    if (req.body.category !== undefined) {
      const v = req.body.category;
      if (v == null || String(v).trim() === "") {
        patch.category = null;
      } else {
        const c = String(v).trim();
        if (!CATEGORY_SET.has(c)) return res.status(400).json({ error: "invalid_category" });
        patch.category = c;
      }
    }

    if (req.body.color !== undefined) {
      const v = req.body.color;
      if (v == null || String(v).trim() === "") {
        patch.color = null;
      } else {
        const c = String(v).trim();
        patch.color = COLOR_SET.has(c) ? c : null;
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

    if (req.body.styleTags !== undefined) patch.styleTags = normalizeTags(req.body.styleTags);
    if (req.body.occasionTags !== undefined) patch.occasionTags = normalizeTags(req.body.occasionTags);

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

    const availNorm = normalizeAvailabilityPayload(req.body, product);
    if (availNorm.error) return res.status(400).json({ error: availNorm.error });

    patch.availability = availNorm.availability;
    patch.leadTimeDays = availNorm.leadTimeDays;
    patch.readyQty = availNorm.readyQty;
    patch.nextShipDate = availNorm.nextShipDate;

    if (typeof req.body.acceptsCustom === "boolean") {
      patch.acceptsCustom = req.body.acceptsCustom;
    }

    // ===== VISIBILITY CONTROL =====
if (typeof req.body.isActive === "boolean") {
  patch.isActive = req.body.isActive;
}

if (typeof req.body.isHidden === "boolean") {
  patch.isHidden = req.body.isHidden;
}

// ===== MODERATION ONLY IF CONTENT CHANGED =====
const contentFieldsChanged =
  req.body.title !== undefined ||
  req.body.description !== undefined ||
  req.body.price !== undefined ||
  req.body.images !== undefined ||
  req.body.category !== undefined ||
  req.body.color !== undefined ||
  req.body.materialMain !== undefined ||
  req.body.technique !== undefined ||
  req.body.styleTags !== undefined ||
  req.body.occasionTags !== undefined ||
  req.body.dimensions !== undefined ||
  req.body.careInstructions !== undefined ||
  req.body.specialNotes !== undefined;

if (contentFieldsChanged) {
  patch.moderationStatus = "PENDING";
  patch.moderationMessage = null;
  patch.submittedAt = new Date();
  patch.reviewedAt = null;
  patch.reviewedByUserId = null;
  patch.approvedAt = null;
}

    const updated = await prisma.product.update({
      where: { id },
      data: patch,
    });

    return res.json(mapProduct(updated));
  } catch (e) {
    console.error("PUT /vendors/products/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function deleteProduct(req, res) {
  try {
    const id = String(req.params.id);

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        service: {
          include: {
            vendor: true,
            type: true,
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "not_found" });

    if (product.service?.vendor?.userId !== req.user.sub) {
      return res.status(403).json({ error: "forbidden" });
    }

    if (product.service?.type?.code !== "products") {
      return res.status(400).json({ error: "not_a_products_store" });
    }

    await prisma.product.delete({ where: { id } });

    return res.json({ ok: true, deletedId: id });
  } catch (e) {
    console.error("DELETE /vendors/products/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

/* ================= Mount routes ================= */

router.get("/public/store/:slug/products", publicListProducts);

function registerProductRoutes(prefix) {
  router.get(
    `/${prefix}/store/:slug/products`,
    authRequired,
    vendorAccessRequired,
    listVendorProducts
  );

  router.get(`/${prefix}/products/:id`, authRequired, vendorAccessRequired, getProduct);

  router.post(`/${prefix}/store/:slug/products`, authRequired, vendorAccessRequired, createProduct);

  router.get(
    `/${prefix}/store/:slug/products/limits`,
    authRequired,
    vendorAccessRequired,
    getProductLimits
  );

  router.get(
    `/${prefix}/store/:slug/products/pricing`,
    authRequired,
    vendorAccessRequired,
    getProductPricing
  );

  router.put(`/${prefix}/products/:id`, authRequired, vendorAccessRequired, updateProduct);

  router.delete(`/${prefix}/products/:id`, authRequired, vendorAccessRequired, deleteProduct);
}

registerProductRoutes("vendors");
registerProductRoutes("vendor");

router.get("/products/:id", authRequired, vendorAccessRequired, getProduct);

export default router;