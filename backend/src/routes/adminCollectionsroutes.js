import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/* ================= Helpers ================= */

async function adminRequired(req, res, next) {
  try {
    const roleFromToken = String(req.user?.role || "").toUpperCase();

    if (roleFromToken === "ADMIN") return next();

    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(403).json({ error: "forbidden" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (String(user?.role || "").toUpperCase() === "ADMIN") {
      req.user.role = "ADMIN";
      return next();
    }

    return res.status(403).json({
      error: "forbidden",
      currentRole: user?.role || req.user?.role || null,
    });
  } catch (e) {
    console.error("adminRequired error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

function noCache(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseBooleanQuery(value) {
  if (value === undefined) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function parseNullableDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeCollectionPayload(body = {}, { partial = false } = {}) {
  const data = {};

  if (!partial || body.title !== undefined) {
    data.title = String(body.title || "").trim();
  }

  if (!partial || body.slug !== undefined || body.title !== undefined) {
    data.slug = slugify(body.slug || body.title || "");
  }

  if (body.subtitle !== undefined) {
    data.subtitle = body.subtitle ? String(body.subtitle).trim() : null;
  }

  if (body.description !== undefined) {
    data.description = body.description ? String(body.description) : null;
  }

  if (body.seoTitle !== undefined) {
    data.seoTitle = body.seoTitle ? String(body.seoTitle).trim() : null;
  }

  if (body.seoDescription !== undefined) {
    data.seoDescription = body.seoDescription
      ? String(body.seoDescription).trim()
      : null;
  }

  if (body.heroImage !== undefined) {
    data.heroImage = body.heroImage ? String(body.heroImage).trim() : null;
  }

  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.showOnHomepage !== undefined) data.showOnHomepage = !!body.showOnHomepage;
  if (body.showInMenu !== undefined) data.showInMenu = !!body.showInMenu;

  if (body.rules !== undefined) {
    data.rules = body.rules && typeof body.rules === "object" ? body.rules : {};
  }

  if (body.sort !== undefined) {
    data.sort = body.sort ? String(body.sort) : "curated";
  }

  if (body.promoEnabled !== undefined) {
    data.promoEnabled = !!body.promoEnabled;
  }

  const promoEnabled =
    data.promoEnabled !== undefined ? data.promoEnabled : !!body.promoEnabled;

  if (body.promoPercent !== undefined || data.promoEnabled !== undefined) {
    const p = Number(body.promoPercent);
    data.promoPercent =
      promoEnabled && Number.isFinite(p) && p > 0
        ? Math.min(Math.max(Math.round(p), 1), 90)
        : null;
  }

  if (body.promoLabel !== undefined || data.promoEnabled !== undefined) {
    data.promoLabel =
      promoEnabled && body.promoLabel ? String(body.promoLabel).trim() : null;
  }

  if (body.promoStartsAt !== undefined || data.promoEnabled !== undefined) {
    data.promoStartsAt =
      promoEnabled && body.promoStartsAt ? parseNullableDate(body.promoStartsAt) : null;
  }

  if (body.promoEndsAt !== undefined || data.promoEnabled !== undefined) {
    data.promoEndsAt =
      promoEnabled && body.promoEndsAt ? parseNullableDate(body.promoEndsAt) : null;
  }

  if (body.promoFundingSource !== undefined || data.promoEnabled !== undefined) {
    data.promoFundingSource = promoEnabled
      ? String(body.promoFundingSource || "PLATFORM_COMMISSION")
      : "PLATFORM_COMMISSION";
  }

  return data;
}

function validateCollectionData(data = {}, { creating = false } = {}) {
  if ((creating || data.title !== undefined) && !String(data.title || "").trim()) {
    return "invalid_title";
  }

  if ((creating || data.slug !== undefined) && !String(data.slug || "").trim()) {
    return "invalid_slug";
  }

  if (
    data.promoStartsAt &&
    data.promoEndsAt &&
    new Date(data.promoStartsAt) > new Date(data.promoEndsAt)
  ) {
    return "invalid_promo_dates";
  }

  return null;
}

function mapCollection(c) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle || "",
    description: c.description || "",
    seoTitle: c.seoTitle || "",
    seoDescription: c.seoDescription || "",
    heroImage: c.heroImage || "",
    isActive: !!c.isActive,
    showOnHomepage: !!c.showOnHomepage,
    showInMenu: !!c.showInMenu,
    rules: c.rules || {},
    sort: c.sort || "curated",
    promoEnabled: !!c.promoEnabled,
    promoPercent: c.promoPercent ?? null,
    promoLabel: c.promoLabel || "",
    promoStartsAt: c.promoStartsAt || null,
    promoEndsAt: c.promoEndsAt || null,
    promoFundingSource: c.promoFundingSource || "PLATFORM_COMMISSION",
    itemsCount: c._count?.items ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function mapAdminProductLite(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: Math.round(p.priceCents || 0) / 100,
    priceCents: p.priceCents,
    currency: p.currency || "RON",
    images: Array.isArray(p.images) ? p.images : [],
    isActive: !!p.isActive,
    isHidden: !!p.isHidden,
    category: p.category || null,
    availability: p.availability || null,
    acceptsCustom: !!p.acceptsCustom,
    styleTags: Array.isArray(p.styleTags) ? p.styleTags : [],
    occasionTags: Array.isArray(p.occasionTags) ? p.occasionTags : [],
    moderationStatus: p.moderationStatus || "PENDING",
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    service: p.service
      ? {
          id: p.service.id,
          vendorId: p.service.vendorId,
          slug: p.service.profile?.slug || null,
          displayName:
            p.service.profile?.displayName ||
            p.service.vendor?.displayName ||
            "",
        }
      : null,
    vendor: p.service?.vendor
      ? {
          id: p.service.vendor.id,
          displayName: p.service.vendor.displayName || "",
          city: p.service.vendor.city || "",
        }
      : null,
  };
}

function mapCollectionItem(item) {
  return {
    collectionId: item.collectionId,
    productId: item.productId,
    position: item.position ?? null,
    pinned: !!item.pinned,
    excluded: !!item.excluded,
    createdAt: item.createdAt,
    product: item.product ? mapAdminProductLite(item.product) : null,
  };
}

function buildProductWhereFromRules(rules = {}) {
  const where = {
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    images: { isEmpty: false },
    service: {
      is: {
        isActive: true,
        status: "ACTIVE",
        vendor: { is: { isActive: true } },
        type: { is: { code: "products" } },
      },
    },
  };

  if (Array.isArray(rules.categories) && rules.categories.length) {
    where.category = {
      in: rules.categories.map((x) => String(x || "").trim()).filter(Boolean),
    };
  }

  if (rules.acceptsCustom === true) where.acceptsCustom = true;

  const minPriceCents = Number(rules.minPriceCents);
  const maxPriceCents = Number(rules.maxPriceCents);

  if (Number.isFinite(minPriceCents) || Number.isFinite(maxPriceCents)) {
    where.priceCents = {};
    if (Number.isFinite(minPriceCents)) where.priceCents.gte = minPriceCents;
    if (Number.isFinite(maxPriceCents)) where.priceCents.lte = maxPriceCents;
  }

  if (Array.isArray(rules.occasionTags) && rules.occasionTags.length) {
    where.occasionTags = { hasSome: rules.occasionTags.map(String) };
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    where.styleTags = { hasSome: rules.styleTags.map(String) };
  }

  return where;
}

function buildAdminProductPickerWhere(query = {}) {
  const {
    q = "",
    category = "",
    moderationStatus = "",
    isActive,
    isHidden,
    vendorId = "",
    serviceId = "",
  } = query || {};

  const where = {};

  const activeBool = parseBooleanQuery(isActive);
  if (activeBool !== undefined) where.isActive = activeBool;

  const hiddenBool = parseBooleanQuery(isHidden);
  if (hiddenBool !== undefined) where.isHidden = hiddenBool;

  if (category) where.category = { equals: String(category), mode: "insensitive" };
  if (moderationStatus) where.moderationStatus = String(moderationStatus).toUpperCase();
  if (serviceId) where.serviceId = String(serviceId);

  if (vendorId) {
    where.service = { is: { vendorId: String(vendorId) } };
  }

  const qstr = String(q || "").trim();
  if (qstr) {
    where.OR = [
      { title: { contains: qstr, mode: "insensitive" } },
      { description: { contains: qstr, mode: "insensitive" } },
      { category: { contains: qstr, mode: "insensitive" } },
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
    ];
  }

  return where;
}

/* ================= Collection handlers ================= */

async function adminListCollections(req, res) {
  try {
    noCache(res);

    const {
      q = "",
      isActive,
      showOnHomepage,
      showInMenu,
      promoEnabled,
      take = "100",
      skip = "0",
    } = req.query || {};

    const where = {};

    const activeBool = parseBooleanQuery(isActive);
    if (activeBool !== undefined) where.isActive = activeBool;

    const homepageBool = parseBooleanQuery(showOnHomepage);
    if (homepageBool !== undefined) where.showOnHomepage = homepageBool;

    const menuBool = parseBooleanQuery(showInMenu);
    if (menuBool !== undefined) where.showInMenu = menuBool;

    const promoBool = parseBooleanQuery(promoEnabled);
    if (promoBool !== undefined) where.promoEnabled = promoBool;

    const qstr = String(q || "").trim();
    if (qstr) {
      where.OR = [
        { title: { contains: qstr, mode: "insensitive" } },
        { slug: { contains: qstr, mode: "insensitive" } },
        { subtitle: { contains: qstr, mode: "insensitive" } },
        { seoTitle: { contains: qstr, mode: "insensitive" } },
      ];
    }

    const pageSize = Math.max(1, Math.min(200, Number(take) || 100));
    const offset = Math.max(0, Number(skip) || 0);

    const [items, total] = await Promise.all([
      prisma.collection.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: pageSize,
        include: { _count: { select: { items: true } } },
      }),
      prisma.collection.count({ where }),
    ]);

    return res.json({
      items: items.map(mapCollection),
      collections: items.map(mapCollection),
      total,
      take: pageSize,
      skip: offset,
    });
  } catch (e) {
    console.error("GET /admin/collections error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminCreateCollection(req, res) {
  try {
    noCache(res);

    const data = normalizeCollectionPayload(req.body);
    const validationError = validateCollectionData(data, { creating: true });

    if (validationError) return res.status(400).json({ error: validationError });

    const created = await prisma.collection.create({
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.status(201).json({
      ok: true,
      collection: mapCollection(created),
    });
  } catch (e) {
    console.error("POST /admin/collections error:", e);
    if (e?.code === "P2002") return res.status(409).json({ error: "slug_already_exists" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminGetCollection(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: { _count: { select: { items: true } } },
    });

    if (!collection) return res.status(404).json({ error: "not_found" });

    return res.json(mapCollection(collection));
  } catch (e) {
    console.error("GET /admin/collections/:id error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminUpdateCollection(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();
    const data = normalizeCollectionPayload(req.body);
    const validationError = validateCollectionData(data, { creating: true });

    if (validationError) return res.status(400).json({ error: validationError });

    const updated = await prisma.collection.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.json({
      ok: true,
      collection: mapCollection(updated),
    });
  } catch (e) {
    console.error("PATCH /admin/collections/:id error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    if (e?.code === "P2002") return res.status(409).json({ error: "slug_already_exists" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminPatchCollectionPartial(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();
    const data = normalizeCollectionPayload(req.body, { partial: true });
    const validationError = validateCollectionData(data, { creating: false });

    if (validationError) return res.status(400).json({ error: validationError });

    const updated = await prisma.collection.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.json({
      ok: true,
      collection: mapCollection(updated),
    });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/partial error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    if (e?.code === "P2002") return res.status(409).json({ error: "slug_already_exists" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminSetCollectionStatus(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();
    const isActive = !!req.body?.isActive;

    const updated = await prisma.collection.update({
      where: { id },
      data: { isActive },
      include: { _count: { select: { items: true } } },
    });

    return res.json({ ok: true, collection: mapCollection(updated) });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/status error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminSetCollectionVisibility(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();

    const data = {};
    if (req.body?.showOnHomepage !== undefined) {
      data.showOnHomepage = !!req.body.showOnHomepage;
    }
    if (req.body?.showInMenu !== undefined) {
      data.showInMenu = !!req.body.showInMenu;
    }

    const updated = await prisma.collection.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.json({ ok: true, collection: mapCollection(updated) });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/visibility error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminSetCollectionPromo(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();

    const data = normalizeCollectionPayload(
      {
        promoEnabled: req.body?.promoEnabled,
        promoPercent: req.body?.promoPercent,
        promoLabel: req.body?.promoLabel,
        promoStartsAt: req.body?.promoStartsAt,
        promoEndsAt: req.body?.promoEndsAt,
        promoFundingSource: req.body?.promoFundingSource,
      },
      { partial: true }
    );

    const validationError = validateCollectionData(data, { creating: false });
    if (validationError) return res.status(400).json({ error: validationError });

    const updated = await prisma.collection.update({
      where: { id },
      data,
      include: { _count: { select: { items: true } } },
    });

    return res.json({ ok: true, collection: mapCollection(updated) });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/promo error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminDuplicateCollection(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();

    const source = await prisma.collection.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!source) return res.status(404).json({ error: "not_found" });

    const title = String(req.body?.title || `${source.title} - copie`).trim();
    const slug = slugify(req.body?.slug || `${source.slug}-copie-${Date.now()}`);

    const duplicated = await prisma.collection.create({
      data: {
        title,
        slug,
        subtitle: source.subtitle,
        description: source.description,
        seoTitle: source.seoTitle,
        seoDescription: source.seoDescription,
        heroImage: source.heroImage,
        isActive: false,
        showOnHomepage: false,
        showInMenu: false,
        rules: source.rules || {},
        sort: source.sort || "curated",
        promoEnabled: false,
        promoPercent: null,
        promoLabel: null,
        promoStartsAt: null,
        promoEndsAt: null,
        promoFundingSource: source.promoFundingSource || "PLATFORM_COMMISSION",
        items: {
          create: source.items.map((item) => ({
            productId: item.productId,
            pinned: !!item.pinned,
            excluded: !!item.excluded,
            position: item.position ?? null,
          })),
        },
      },
      include: { _count: { select: { items: true } } },
    });

    return res.status(201).json({
      ok: true,
      collection: mapCollection(duplicated),
    });
  } catch (e) {
    console.error("POST /admin/collections/:id/duplicate error:", e);
    if (e?.code === "P2002") return res.status(409).json({ error: "slug_already_exists" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminDeleteCollection(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();

    await prisma.collection.delete({ where: { id } });

    return res.json({ ok: true, deletedId: id });
  } catch (e) {
    console.error("DELETE /admin/collections/:id error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminBulkDeleteCollections(req, res) {
  try {
    noCache(res);

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    if (!ids.length) return res.status(400).json({ error: "ids_required" });

    const result = await prisma.collection.deleteMany({
      where: { id: { in: ids } },
    });

    return res.json({ ok: true, deletedCount: result.count });
  } catch (e) {
    console.error("POST /admin/collections/bulk-delete error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminBulkSetCollectionStatus(req, res) {
  try {
    noCache(res);

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    if (!ids.length) return res.status(400).json({ error: "ids_required" });

    const result = await prisma.collection.updateMany({
      where: { id: { in: ids } },
      data: { isActive: !!req.body?.isActive },
    });

    return res.json({ ok: true, updatedCount: result.count });
  } catch (e) {
    console.error("POST /admin/collections/bulk-status error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

/* ================= Collection items ================= */

async function adminListCollectionItems(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();
    const q = String(req.query?.q || "").trim();

    const pinned = parseBooleanQuery(req.query?.pinned);
    const excluded = parseBooleanQuery(req.query?.excluded);

    const where = { collectionId };
    if (pinned !== undefined) where.pinned = pinned;
    if (excluded !== undefined) where.excluded = excluded;

    if (q) {
      where.product = {
        is: {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        },
      };
    }

    const items = await prisma.collectionItem.findMany({
      where,
      include: {
        product: {
          include: {
            service: {
              include: {
                vendor: true,
                profile: true,
              },
            },
          },
        },
      },
      orderBy: [{ pinned: "desc" }, { position: "asc" }, { createdAt: "desc" }],
    });

    return res.json({
      items: items.map(mapCollectionItem),
      total: items.length,
    });
  } catch (e) {
    console.error("GET /admin/collections/:id/items error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminUpsertCollectionItem(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();
    const productId = String(req.body?.productId || "").trim();

    if (!productId) return res.status(400).json({ error: "invalid_product_id" });

    const position =
      req.body?.position === null || req.body?.position === undefined
        ? null
        : Number(req.body.position);

    const item = await prisma.collectionItem.upsert({
      where: { collectionId_productId: { collectionId, productId } },
      update: {
        pinned: !!req.body?.pinned,
        excluded: !!req.body?.excluded,
        position: Number.isFinite(position) ? position : null,
      },
      create: {
        collectionId,
        productId,
        pinned: !!req.body?.pinned,
        excluded: !!req.body?.excluded,
        position: Number.isFinite(position) ? position : null,
      },
      include: {
        product: {
          include: {
            service: {
              include: {
                vendor: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      ok: true,
      item: mapCollectionItem(item),
    });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/items error:", e);
    if (e?.code === "P2003") {
      return res.status(400).json({ error: "invalid_collection_or_product" });
    }
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminUpdateCollectionItem(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();
    const productId = String(req.params.productId || "").trim();

    const data = {};

    if (req.body?.pinned !== undefined) data.pinned = !!req.body.pinned;
    if (req.body?.excluded !== undefined) data.excluded = !!req.body.excluded;

    if (req.body?.position !== undefined) {
      const position = Number(req.body.position);
      data.position = Number.isFinite(position) ? position : null;
    }

    const item = await prisma.collectionItem.update({
      where: { collectionId_productId: { collectionId, productId } },
      data,
      include: {
        product: {
          include: {
            service: {
              include: {
                vendor: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      ok: true,
      item: mapCollectionItem(item),
    });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/items/:productId error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminBulkUpsertCollectionItems(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();

    const items = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body?.productIds)
      ? req.body.productIds.map((productId) => ({ productId }))
      : [];

    const cleanItems = items
      .map((item, index) => ({
        productId: String(item.productId || item.id || "").trim(),
        pinned: !!item.pinned,
        excluded: !!item.excluded,
        position:
          item.position === null || item.position === undefined
            ? index
            : Number(item.position),
      }))
      .filter((item) => item.productId);

    if (!cleanItems.length) return res.status(400).json({ error: "items_required" });

    const result = await prisma.$transaction(
      cleanItems.map((item) =>
        prisma.collectionItem.upsert({
          where: {
            collectionId_productId: {
              collectionId,
              productId: item.productId,
            },
          },
          update: {
            pinned: item.pinned,
            excluded: item.excluded,
            position: Number.isFinite(item.position) ? item.position : null,
          },
          create: {
            collectionId,
            productId: item.productId,
            pinned: item.pinned,
            excluded: item.excluded,
            position: Number.isFinite(item.position) ? item.position : null,
          },
        })
      )
    );

    return res.json({
      ok: true,
      upsertedCount: result.length,
    });
  } catch (e) {
    console.error("POST /admin/collections/:id/items/bulk error:", e);
    if (e?.code === "P2003") {
      return res.status(400).json({ error: "invalid_collection_or_product" });
    }
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminReorderCollectionItems(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();

    const items = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body?.productIds)
      ? req.body.productIds.map((productId, index) => ({ productId, position: index }))
      : [];

    const cleanItems = items
      .map((item, index) => ({
        productId: String(item.productId || item.id || "").trim(),
        position:
          item.position === null || item.position === undefined
            ? index
            : Number(item.position),
      }))
      .filter((item) => item.productId && Number.isFinite(item.position));

    if (!cleanItems.length) return res.status(400).json({ error: "items_required" });

    await prisma.$transaction(
      cleanItems.map((item) =>
        prisma.collectionItem.update({
          where: {
            collectionId_productId: {
              collectionId,
              productId: item.productId,
            },
          },
          data: { position: item.position },
        })
      )
    );

    return res.json({
      ok: true,
      reorderedCount: cleanItems.length,
    });
  } catch (e) {
    console.error("PATCH /admin/collections/:id/items/reorder error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "item_not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminBulkRemoveCollectionItems(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();

    const productIds = Array.isArray(req.body?.productIds)
      ? req.body.productIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    if (!productIds.length) return res.status(400).json({ error: "product_ids_required" });

    const result = await prisma.collectionItem.deleteMany({
      where: {
        collectionId,
        productId: { in: productIds },
      },
    });

    return res.json({
      ok: true,
      deletedCount: result.count,
    });
  } catch (e) {
    console.error("POST /admin/collections/:id/items/bulk-remove error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminDeleteCollectionItem(req, res) {
  try {
    noCache(res);

    const collectionId = String(req.params.id || "").trim();
    const productId = String(req.params.productId || "").trim();

    await prisma.collectionItem.delete({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },
    });

    return res.json({ ok: true, deletedProductId: productId });
  } catch (e) {
    console.error("DELETE /admin/collections/:id/items/:productId error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: "server_error" });
  }
}

/* ================= Product picker / previews ================= */

async function adminListProductsForCollectionPicker(req, res) {
  try {
    noCache(res);

    const take = Math.max(1, Math.min(200, Number(req.query?.take) || 50));
    const skip = Math.max(0, Number(req.query?.skip) || 0);

    const where = buildAdminProductPickerWhere(req.query);

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          service: {
            include: {
              vendor: true,
              profile: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.product.count({ where }),
    ]);

    return res.json({
      items: items.map(mapAdminProductLite),
      products: items.map(mapAdminProductLite),
      total,
      take,
      skip,
    });
  } catch (e) {
    console.error("GET /admin/collections/products-picker error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminPreviewCollectionProductsFromRules(req, res) {
  try {
    noCache(res);

    const rules = req.body?.rules || {};
    const take = Math.max(1, Math.min(200, Number(req.query?.take) || 24));

    const products = await prisma.product.findMany({
      where: buildProductWhereFromRules(rules),
      include: {
        service: {
          include: {
            vendor: true,
            profile: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return res.json({
      items: products.map(mapAdminProductLite),
      products: products.map(mapAdminProductLite),
      total: products.length,
    });
  } catch (e) {
    console.error("POST /admin/collections/preview-products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

async function adminPreviewCollectionProducts(req, res) {
  try {
    noCache(res);

    const id = String(req.params.id || "").trim();
    const take = Math.max(1, Math.min(200, Number(req.query?.take) || 100));

    const collection = await prisma.collection.findUnique({ where: { id } });

    if (!collection) return res.status(404).json({ error: "not_found" });

    const excluded = await prisma.collectionItem.findMany({
      where: {
        collectionId: id,
        excluded: true,
      },
      select: { productId: true },
    });

    const excludedIds = excluded.map((x) => x.productId);

    const products = await prisma.product.findMany({
      where: {
        ...buildProductWhereFromRules(collection.rules || {}),
        ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
      },
      include: {
        service: {
          include: {
            vendor: true,
            profile: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return res.json({
      items: products.map(mapAdminProductLite),
      products: products.map(mapAdminProductLite),
      total: products.length,
    });
  } catch (e) {
    console.error("GET /admin/collections/:id/preview-products error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

/* ================= Mount routes ================= */

router.get("/collections", authRequired, adminRequired, adminListCollections);
router.post("/collections", authRequired, adminRequired, adminCreateCollection);

router.get(
  "/collections/products-picker",
  authRequired,
  adminRequired,
  adminListProductsForCollectionPicker
);

router.post(
  "/collections/preview-products",
  authRequired,
  adminRequired,
  adminPreviewCollectionProductsFromRules
);

router.post(
  "/collections/bulk-delete",
  authRequired,
  adminRequired,
  adminBulkDeleteCollections
);

router.post(
  "/collections/bulk-status",
  authRequired,
  adminRequired,
  adminBulkSetCollectionStatus
);

router.get("/collections/:id", authRequired, adminRequired, adminGetCollection);

router.patch(
  "/collections/:id",
  authRequired,
  adminRequired,
  adminUpdateCollection
);

router.patch(
  "/collections/:id/partial",
  authRequired,
  adminRequired,
  adminPatchCollectionPartial
);

router.patch(
  "/collections/:id/status",
  authRequired,
  adminRequired,
  adminSetCollectionStatus
);

router.patch(
  "/collections/:id/visibility",
  authRequired,
  adminRequired,
  adminSetCollectionVisibility
);

router.patch(
  "/collections/:id/promo",
  authRequired,
  adminRequired,
  adminSetCollectionPromo
);

router.post(
  "/collections/:id/duplicate",
  authRequired,
  adminRequired,
  adminDuplicateCollection
);

router.delete(
  "/collections/:id",
  authRequired,
  adminRequired,
  adminDeleteCollection
);

router.get(
  "/collections/:id/items",
  authRequired,
  adminRequired,
  adminListCollectionItems
);

router.patch(
  "/collections/:id/items",
  authRequired,
  adminRequired,
  adminUpsertCollectionItem
);

router.post(
  "/collections/:id/items/bulk",
  authRequired,
  adminRequired,
  adminBulkUpsertCollectionItems
);

router.patch(
  "/collections/:id/items/reorder",
  authRequired,
  adminRequired,
  adminReorderCollectionItems
);

router.post(
  "/collections/:id/items/bulk-remove",
  authRequired,
  adminRequired,
  adminBulkRemoveCollectionItems
);

router.patch(
  "/collections/:id/items/:productId",
  authRequired,
  adminRequired,
  adminUpdateCollectionItem
);

router.delete(
  "/collections/:id/items/:productId",
  authRequired,
  adminRequired,
  adminDeleteCollectionItem
);

router.get(
  "/collections/:id/preview-products",
  authRequired,
  adminRequired,
  adminPreviewCollectionProducts
);

export default router;