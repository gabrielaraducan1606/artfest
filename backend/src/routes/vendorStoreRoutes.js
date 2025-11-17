import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

/* Utils */
const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, message: code, ...extra });

const clean = (v) => (typeof v === "string" ? v.trim() : v);
const cleanOrNull = (v) => {
  const c = clean(v);
  return c ? c : null;
};

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

const buildOrderBy = (sort) => {
  switch ((sort || "new").toLowerCase()) {
    case "price_asc":
      return [{ priceCents: "asc" }, { createdAt: "desc" }];
    case "price_desc":
      return [{ priceCents: "desc" }, { createdAt: "desc" }];
    case "popular":
      return [{ createdAt: "desc" }];
    case "new":
    default:
      return [{ createdAt: "desc" }];
  }
};

/* ============== disponibilitate: normalizare payload ============== */
function normalizeAvailabilityPayload(body, current = null) {
  const raw =
    body?.availability != null
      ? String(body.availability).toUpperCase()
      : current?.availability
      ? String(current.availability).toUpperCase()
      : "READY";

  if (!["READY", "MADE_TO_ORDER", "PREORDER", "SOLD_OUT"].includes(raw)) {
    return { error: "invalid_availability" };
  }

  const out = {
    availability: raw,
    leadTimeDays: null,
    readyQty: 0,
    nextShipDate: null,
  };

  if (raw === "MADE_TO_ORDER") {
    const lt =
      body?.leadTimeDays != null
        ? Number(body.leadTimeDays)
        : current?.leadTimeDays ?? null;
    if (!Number.isFinite(lt) || lt <= 0) return { error: "invalid_lead_time" };
    out.leadTimeDays = Math.floor(lt);
  }

  if (raw === "READY") {
    const rq =
      body?.readyQty != null
        ? Number(body.readyQty)
        : current?.readyQty ?? 0;
    if (!Number.isFinite(rq) || rq < 0) return { error: "invalid_ready_qty" };
    out.readyQty = Math.floor(rq);
  }

  if (raw === "PREORDER") {
    const rawDate =
      body?.nextShipDate != null
        ? body.nextShipDate
        : current?.nextShipDate;
    if (!rawDate) return { error: "next_ship_date_required" };
    const dt = new Date(rawDate);
    if (Number.isNaN(dt.getTime()))
      return { error: "invalid_next_ship_date" };
    out.nextShipDate = dt;
  }

  return { ok: true, ...out };
}

const router = Router();

/* ============== Guard permisiv: vendorAccessRequired ============== */
async function vendorAccessRequired(req, res, next) {
  try {
    const role = req.user?.role || req.user?.roles?.[0];
    if (role === "VENDOR" || role === "ADMIN") return next();

    const v = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
    });
    if (v) {
      req.meVendor = v;
      return next();
    }

    return res.status(403).json({ error: "forbidden" });
  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}

/* Toate rutele sunt private (auth) + guard permisiv */
router.use(authRequired, vendorAccessRequired);

/** GET /api/vendors/store */
router.get("/store", async (req, res) => {
  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profiles = await prisma.serviceProfile.findMany({
    where: { service: { vendorId: meVendor.id, type: { code: "products" } } },
    include: { service: { include: { vendor: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const items = profiles.map((p) => {
    const svc = p.service;
    const vendor = svc.vendor;
    const isActive = svc.status === "ACTIVE" && svc.isActive && vendor.isActive;
    return {
      serviceId: svc.id,
      slug: p.slug,
      shopName: p.displayName || vendor.displayName || "Magazin",
      // opțional: poți expune și aici scurta descriere, dacă vrei
      shortDescription: p.shortDescription || "",
      status: isActive ? "active" : "inactive",
      city: p.city || vendor.city || "",
      phone: p.phone || vendor.phone || "",
      email: p.email || vendor.email || "",
      website: p.website || "",
      coverImageUrl: p.coverUrl || "",
      profileImageUrl: p.logoUrl || "",
      delivery: Array.isArray(p.delivery) ? p.delivery : [],
      updatedAt: p.updatedAt,
    };
  });

  res.json({ items });
});

/** GET /api/vendors/store/:slug */
router.get("/store/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) return error(res, "invalid_slug", 400);

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });

  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "store_not_found_or_forbidden", 404);
  }

  const svc = profile.service;
  const vendor = svc.vendor;
  const isActive = svc.status === "ACTIVE" && svc.isActive && vendor.isActive;

  res.json({
    serviceId: svc.id,
    slug: profile.slug,
    shopName: profile.displayName || vendor.displayName || "Magazin",

    // 👇 scurta descriere pentru front (ProfilMagazin)
    shortDescription: profile.shortDescription || "",

    tagline: profile.tagline || "",
    about: profile.about || "",
    city: profile.city || vendor.city || "",
    address: profile.address || "",
    phone: profile.phone || vendor.phone || "",
    email: profile.email || vendor.email || "",
    website: profile.website || "",
    coverImageUrl: profile.coverUrl || "",
    profileImageUrl: profile.logoUrl || "",
    delivery: Array.isArray(profile.delivery) ? profile.delivery : [],
    status: isActive ? "active" : "inactive",
    updatedAt: profile.updatedAt,
  });
});

/** PUT /api/vendors/store/:slug */
router.put("/store/:slug", async (req, res) => {
  const currSlug = String(req.params.slug || "").trim().toLowerCase();
  if (!currSlug) return error(res, "invalid_slug", 400);

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug: currSlug },
    include: { service: { include: { type: true, vendor: true } } },
  });
  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "store_not_found_or_forbidden", 404);
  }

  const {
    displayName,
    tagline,
    about,
    city,
    address,
    phone,
    email,
    website,
    shortDescription,
    coverUrl,
    logoUrl,
    delivery,
    nextSlug,
    mirrorVendor = true,
  } = req.body || {};

  const data = {
    ...(displayName !== undefined
      ? { displayName: cleanOrNull(displayName) }
      : {}),
    ...(tagline !== undefined ? { tagline: cleanOrNull(tagline) } : {}),
    ...(about !== undefined ? { about: cleanOrNull(about) } : {}),
    ...(city !== undefined ? { city: cleanOrNull(city) } : {}),
    ...(address !== undefined ? { address: cleanOrNull(address) } : {}),
    ...(phone !== undefined ? { phone: cleanOrNull(phone) } : {}),
    ...(email !== undefined ? { email: cleanOrNull(email) } : {}),
    ...(website !== undefined ? { website: cleanOrNull(website) } : {}),
    ...(shortDescription !== undefined
      ? { shortDescription: cleanOrNull(shortDescription) }
      : {}),
    ...(coverUrl !== undefined ? { coverUrl: cleanOrNull(coverUrl) } : {}),
    ...(logoUrl !== undefined ? { logoUrl: cleanOrNull(logoUrl) } : {}),
    ...(Array.isArray(delivery) ? { delivery } : {}),
  };

  if (typeof nextSlug === "string" && nextSlug.trim()) {
    const s = slugify(nextSlug);
    if (!s) return error(res, "invalid_next_slug", 400);
    const clash = await prisma.serviceProfile.findFirst({
      where: { slug: s, NOT: { serviceId: profile.serviceId } },
    });
    if (clash) return error(res, "service_brand_unavailable", 409, { slug: s });
    data.slug = s;
  }

  const saved = await prisma.serviceProfile.update({
    where: { serviceId: profile.serviceId },
    data,
  });

  if (mirrorVendor) {
    const vendorPatch = {
      ...(data.city !== undefined ? { city: data.city ?? "" } : {}),
      ...(data.phone !== undefined ? { phone: data.phone ?? "" } : {}),
      ...(data.email !== undefined ? { email: data.email ?? "" } : {}),
      ...(data.address !== undefined ? { address: data.address ?? "" } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl ?? "" } : {}),
      ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl ?? "" } : {}),
      ...(data.about !== undefined ? { about: data.about ?? "" } : {}),
      ...(data.displayName !== undefined
        ? { displayName: data.displayName ?? "" }
        : {}),
      ...(data.website !== undefined ? { website: data.website ?? "" } : {}),
    };
    if (Object.keys(vendorPatch).length) {
      await prisma.vendor
        .update({ where: { id: meVendor.id }, data: vendorPatch })
        .catch(() => null);
    }
  }

  res.json({ ok: true, profile: saved });
});

/** POST /api/vendors/store/:slug/activate */
router.post("/store/:slug/activate", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });
  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "store_not_found_or_forbidden", 404);
  }

  const svc = await prisma.vendorService.update({
    where: { id: profile.serviceId },
    data: { status: "ACTIVE", isActive: true },
  });

  res.json({
    ok: true,
    service: { id: svc.id, status: svc.status, isActive: svc.isActive },
  });
});

/** POST /api/vendors/store/:slug/deactivate */
router.post("/store/:slug/deactivate", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });
  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "store_not_found_or_forbidden", 404);
  }

  const svc = await prisma.vendorService.update({
    where: { id: profile.serviceId },
    data: { status: "INACTIVE", isActive: false },
  });

  res.json({
    ok: true,
    service: { id: svc.id, status: svc.status, isActive: svc.isActive },
  });
});

/** GET /api/vendors/store/:slug/products */
router.get("/store/:slug/products", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) return error(res, "invalid_slug", 400);

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true, vendor: true } } },
  });
  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "store_not_found_or_forbidden", 404);
  }

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(
    60,
    Math.max(1, parseInt(req.query.limit || "24", 10))
  );
  const skip = (page - 1) * limit;
  const sort = (req.query.sort || "new").trim();
  const status = (req.query.status || "all").trim(); // all | active | inactive

  const where = {
    serviceId: profile.serviceId,
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: buildOrderBy(sort),
    }),
  ]);

  res.json({
    total,
    page,
    limit,
    items: items.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || "",
      price: Number.isFinite(p.priceCents) ? p.priceCents / 100 : null,
      images: Array.isArray(p.images) ? p.images : [],
      currency: p.currency || "RON",
      category: p.category || null,
      isActive: p.isActive,
      isHidden: !!p.isHidden,

      availability: p.availability || "READY",
      leadTimeDays: p.leadTimeDays ?? null,
      readyQty: p.readyQty ?? 0,
      nextShipDate: p.nextShipDate || null,
      acceptsCustom: !!p.acceptsCustom,

      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
});

/** POST /api/vendors/store/:slug/products */
router.post("/store/:slug/products", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const {
    title,
    description,
    price,
    images,
    category,
    availability = "READY",
    leadTimeDays,
    readyQty,
    nextShipDate,
    acceptsCustom = false,
    isHidden = false,
    isActive = true,
    currency = "RON",
  } = req.body || {};

  if (!slug) return error(res, "invalid_slug", 400);
  if (!title || typeof title !== "string" || !title.trim())
    return error(res, "invalid_title", 400);

  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0)
    return error(res, "invalid_price", 400);

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { type: true } } },
  });
  if (
    !profile ||
    profile.service.vendorId !== meVendor.id ||
    profile.service.type?.code !== "products"
  ) {
    return error(res, "service_not_found_or_forbidden", 404);
  }

  const imgs = Array.isArray(images)
    ? images.filter((u) => typeof u === "string" && u.trim())
    : [];

  const avail = normalizeAvailabilityPayload(
    { availability, leadTimeDays, readyQty, nextShipDate },
    null
  );
  if (avail.error) return error(res, avail.error, 400);

  const created = await prisma.product.create({
    data: {
      serviceId: profile.serviceId,
      title: title.trim(),
      description: (description || "").trim(),
      priceCents: Math.round(priceNum * 100),
      images: imgs,
      currency: currency || "RON",
      isActive: !!isActive,
      isHidden: !!isHidden,
      category: category ? String(category).trim().slice(0, 64) : null,

      availability: avail.availability,
      leadTimeDays: avail.leadTimeDays,
      readyQty: avail.readyQty,
      nextShipDate: avail.nextShipDate,
      acceptsCustom: !!acceptsCustom,
    },
  });

  res.json({
    id: created.id,
    title: created.title,
    description: created.description || "",
    price: created.priceCents / 100,
    images: created.images || [],
    currency: created.currency,
    category: created.category || null,
    isActive: created.isActive,
    isHidden: !!created.isHidden,

    availability: created.availability,
    leadTimeDays: created.leadTimeDays ?? null,
    readyQty: created.readyQty ?? 0,
    nextShipDate: created.nextShipDate || null,
    acceptsCustom: !!created.acceptsCustom,

    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
});

/** PUT /api/vendors/products/:id */
router.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    price,
    images,
    isActive,
    category,
    isHidden,
    availability,
    leadTimeDays,
    readyQty,
    nextShipDate,
    acceptsCustom,
    currency,
  } = req.body || {};

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const prod = await prisma.product.findUnique({
    where: { id },
    include: { service: { select: { vendorId: true, type: true } } },
  });
  if (
    !prod ||
    prod.service.vendorId !== meVendor.id ||
    prod.service.type?.code !== "products"
  ) {
    return error(res, "product_not_found_or_forbidden", 404);
  }

  const data = {};
  if (typeof title === "string") data.title = title.trim();
  if (typeof description === "string") data.description = description.trim();
  if (price !== undefined) {
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0)
      return error(res, "invalid_price", 400);
    data.priceCents = Math.round(priceNum * 100);
  }
  if (Array.isArray(images))
    data.images = images.filter((u) => typeof u === "string" && u.trim());
  if (isActive !== undefined) data.isActive = !!isActive;
  if (isHidden !== undefined) data.isHidden = !!isHidden;
  if (category !== undefined)
    data.category = category ? String(category).trim().slice(0, 64) : null;
  if (typeof currency === "string" && currency.trim())
    data.currency = currency.trim();

  // disponibilitate
  const avail = normalizeAvailabilityPayload(
    { availability, leadTimeDays, readyQty, nextShipDate },
    prod
  );
  if (avail.error) return error(res, avail.error, 400);
  data.availability = avail.availability;
  data.leadTimeDays = avail.leadTimeDays;
  data.readyQty = avail.readyQty;
  data.nextShipDate = avail.nextShipDate;

  if (typeof acceptsCustom === "boolean")
    data.acceptsCustom = acceptsCustom;

  const updated = await prisma.product.update({ where: { id }, data });
  res.json({
    id: updated.id,
    title: updated.title,
    description: updated.description || "",
    price: updated.priceCents / 100,
    images: updated.images || [],
    currency: updated.currency,
    isActive: updated.isActive,
    isHidden: !!updated.isHidden,
    category: updated.category || null,

    availability: updated.availability || "READY",
    leadTimeDays: updated.leadTimeDays ?? null,
    readyQty: updated.readyQty ?? 0,
    nextShipDate: updated.nextShipDate || null,
    acceptsCustom: !!updated.acceptsCustom,

    updatedAt: updated.updatedAt,
  });
});

/** DELETE /api/vendors/products/:id */
router.delete("/products/:id", async (req, res) => {
  const { id } = req.params;

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const prod = await prisma.product.findUnique({
    where: { id },
    include: { service: { select: { vendorId: true, type: true } } },
  });
  if (
    !prod ||
    prod.service.vendorId !== meVendor.id ||
    prod.service.type?.code !== "products"
  ) {
    return error(res, "product_not_found_or_forbidden", 404);
  }

  await prisma.product.delete({ where: { id } });
  res.json({ ok: true, deletedId: id });
});

/** GET /api/vendors/products/:id */
router.get("/products/:id", async (req, res) => {
  const { id } = req.params;

  const meVendor =
    req.meVendor ||
    (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return error(res, "vendor_profile_missing", 404);

  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      service: { include: { vendor: true, type: true, profile: true } },
    },
  });
  if (
    !p ||
    p.service.vendorId !== meVendor.id ||
    p.service.type?.code !== "products"
  ) {
    return error(res, "product_not_found_or_forbidden", 404);
  }

  res.json({
    id: p.id,
    title: p.title,
    description: p.description || "",
    price: Math.round(p.priceCents) / 100,
    images: Array.isArray(p.images) ? p.images : [],
    currency: p.currency || "RON",
    category: p.category || null,
    isActive: p.isActive,
    isHidden: !!p.isHidden,

    availability: p.availability || "READY",
    leadTimeDays: p.leadTimeDays ?? null,
    readyQty: p.readyQty ?? 0,
    nextShipDate: p.nextShipDate || null,
    acceptsCustom: !!p.acceptsCustom,

    ownerVendorId: p.service.vendorId,
    vendor: {
      id: p.service.vendor.id,
      displayName:
        p.service.profile?.displayName || p.service.vendor.displayName || "",
      slug: p.service.profile?.slug || null,
      city: p.service.profile?.city || p.service.vendor.city || "",
    },
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });
});

export default router;
