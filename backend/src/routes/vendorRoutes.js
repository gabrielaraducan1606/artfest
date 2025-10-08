// routes/vendors.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";

const router = Router();

/* ----------------------------- Utilitare mici ----------------------------- */
const toInt = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, message: code, ...extra });

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // scoate diacritice
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

// Helpers de normalizare pentru profile fields
const clean = (v) => (typeof v === "string" ? v.trim() : v);
const cleanOrNull = (v) => {
  const c = clean(v);
  return c ? c : null;
};

/** Helper: calculează statusul de onboarding + nextStep
 *  Consideră profil „existent” dacă există fie vendor.displayName,
 *  fie cel puțin un ServiceProfile cu displayName setat.
 */
async function computeOnboardingStatus(vendor) {
  if (!vendor) return { exists: false, nextStep: "createVendor" };

  const [drafts, actives, brandedCount] = await prisma.$transaction([
    prisma.vendorService.count({ where: { vendorId: vendor.id, status: "DRAFT" } }),
    prisma.vendorService.count({ where: { vendorId: vendor.id, status: "ACTIVE", isActive: true } }),
    prisma.serviceProfile.count({
      where: {
        service: { vendorId: vendor.id },
        displayName: { not: null },
      },
    }),
  ]);

  const hasProfile = !!vendor.displayName || brandedCount > 0;
  const hasServices = drafts + actives > 0;
  const hasDrafts = drafts > 0;
  const hasActive = actives > 0;

  let nextStep = "done";
  if (!hasProfile) nextStep = "profile";
  else if (!hasServices) nextStep = "selectServices";
  else if (!hasActive) nextStep = "fillDetails";

  return { exists: true, hasProfile, hasServices, hasDrafts, hasActive, nextStep };
}

/* ============================ BRAND CHECK PER SERVICIU ============================ */
/** GET /api/vendors/vendor-services/brand/check?name=...&slug=...&excludeServiceId=... */
router.get("/vendor-services/brand/check", async (req, res) => {
  const rawName = String(req.query.name || "").trim();
  const rawSlug = String(req.query.slug || "").trim();
  const excludeServiceId = req.query.excludeServiceId ? String(req.query.excludeServiceId) : null;

  const base = rawSlug || rawName;
  if (!base) return error(res, "invalid_input", 400);

  const slug = slugify(base);
  if (!slug) return error(res, "invalid_input", 400);

  const existing = await prisma.serviceProfile.findUnique({ where: { slug } });

  let available = true;
  if (existing) {
    // dacă e același serviciu, e OK (editare)
    if (!excludeServiceId || existing.serviceId !== excludeServiceId) {
      available = false;
    }
  }

  // Sugestie simplă when not available
  let suggestion = null;
  if (!available) {
    for (let i = 2; i <= 9; i++) {
      const s = `${slug}-${i}`;
      const e = await prisma.serviceProfile.findUnique({ where: { slug: s } });
      if (!e) { suggestion = s; break; }
    }
  }

  res.json({ ok: true, slug, available, suggestion });
});


/* ============================ Rute pentru /me/* ============================ */

/** GET /api/vendors/me/services (lista serviciilor mele) */
router.get(
  "/me/services",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const includeProfile = String(req.query.includeProfile || "") === "1";

    const list = await prisma.vendorService.findMany({
      where: { vendorId: meVendor.id },
      include: { type: true, ...(includeProfile ? { profile: true } : {}) },
      orderBy: { createdAt: "desc" },
    });

    res.json({ items: list });
  }
);

/** GET /api/vendors/me/onboarding-status (status + nextStep) */
router.get(
  "/me/onboarding-status",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!vendor) return res.json({ exists: false, nextStep: "createVendor" });
    const onboarding = await computeOnboardingStatus(vendor);
    res.json(onboarding);
  }
);

/** POST /api/vendors/me/onboarding/reset (șterge doar DRAFT-urile) */
router.post(
  "/me/onboarding/reset",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!vendor) return error(res, "vendor_profile_missing", 404);

    await prisma.vendorService.deleteMany({ where: { vendorId: vendor.id, status: "DRAFT" } });
    const onboarding = await computeOnboardingStatus(vendor);
    res.json({ ok: true, onboarding });
  }
);

/** (opțional) DELETE /api/vendors/me – permite ștergerea profilului dacă nu are servicii ACTIVE */
router.delete(
  "/me",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!vendor) return error(res, "vendor_profile_missing", 404);

    const activeCount = await prisma.vendorService.count({
      where: { vendorId: vendor.id, status: "ACTIVE", isActive: true },
    });
    if (activeCount > 0) return error(res, "cannot_delete_with_active_services", 409);

    await prisma.vendor.delete({ where: { id: vendor.id } });
    res.json({ ok: true });
  }
);

/**
 * POST /api/vendors/me/services (creează DRAFT pentru unu/multiple typeCode/ids)
 */
router.post(
  "/me/services",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const { typeCode, codes, typeIds } = req.body || {};

      let types = [];
      if (Array.isArray(typeIds) && typeIds.length) {
        types = await prisma.serviceType.findMany({ where: { id: { in: typeIds } } });
      } else {
        const allCodes = [
          ...(typeCode ? [String(typeCode)] : []),
          ...(Array.isArray(codes) ? codes.map(String) : []),
        ].filter(Boolean);
        if (!allCodes.length) {
          return error(res, "no_service_types", 400, { hint: "trimite typeCode sau codes[]" });
        }
        types = await prisma.serviceType.findMany({ where: { code: { in: allCodes } } });
      }

      if (!types.length) return error(res, "service_types_not_found", 404);

      const items = [];
      for (const t of types) {
        const draft = await prisma.vendorService.upsert({
          where: { vendor_type_unique: { vendorId: meVendor.id, typeId: t.id } },
          update: {},
          create: {
            vendorId: meVendor.id,
            typeId: t.id,
            status: "DRAFT",
            isActive: false,
            title: null,
            description: null,
            basePriceCents: null,
            mediaUrls: [],
            coverageAreas: [],
          },
          include: { type: true, profile: true },
        });

        items.push({
          id: draft.id,
          typeId: draft.typeId,
          typeCode: draft.type.code,
          typeName: draft.type.name,
          status: draft.status,
          profile: draft.profile || null,
        });
      }

      return res.status(200).json({ items });
    } catch (e) {
      console.error("POST /api/vendors/me/services error:", e);
      if (e?.code === "P2003") return error(res, "invalid_service_type_id", 400);
      if (e?.code === "P2025") return error(res, "service_type_not_found", 404);
      return error(res, "create_vendor_services_failed", 500);
    }
  }
);

/** PATCH /api/vendors/me/services/:id (câmpuri de bază ale serviciului) */
router.patch(
  "/me/services/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;
    const {
      title, description, basePriceCents, currency, city, coverageAreas, mediaUrls, attributes,
    } = req.body || {};

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({ where: { id } });
    if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

    const updated = await prisma.vendorService.update({
      where: { id },
      data: {
        title,
        description,
        basePriceCents,
        currency,
        city,
        coverageAreas,
        mediaUrls,
        attributes,
      },
      include: { type: true },
    });

    res.json(updated);
  }
);

/** PUT /api/vendors/vendor-services/:id/profile  (upsert ServiceProfile, cu nume + slug) */
router.put(
  "/vendor-services/:id/profile",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const svc = await prisma.vendorService.findUnique({
        where: { id },
        select: { id: true, vendorId: true },
      });
      if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

      const {
        displayName,
        slug,          // 👈 acceptăm explicit
        // imagini + contact + adresă
        logoUrl, coverUrl, phone, email,
        address, delivery, city,
        // descrieri
        tagline, about,
      } = req.body || {};

      const payload = {
        logoUrl:  cleanOrNull(logoUrl),
        coverUrl: cleanOrNull(coverUrl),
        phone:    cleanOrNull(phone),
        email:    cleanOrNull(email),
        address:  cleanOrNull(address),
        delivery: Array.isArray(delivery) ? delivery : [],
        city:     cleanOrNull(city),
        tagline:  cleanOrNull(tagline),
        about:    cleanOrNull(about),
      };

      // 1) displayName opțional
      if (typeof displayName === "string" && displayName.trim()) {
        payload.displayName = displayName.trim();
      }

      // 2) slug: dacă vine explicit, îl normalizăm; altfel derivăm din displayName (dacă e setat acum)
      let nextSlug = null;
      if (typeof slug === "string" && slug.trim()) {
        nextSlug = slugify(slug);
        if (!nextSlug) return error(res, "invalid_slug", 400);
      } else if (typeof payload.displayName === "string" && payload.displayName.trim()) {
        nextSlug = slugify(payload.displayName);
        if (!nextSlug) return error(res, "invalid_service_display_name", 400);
      }

      if (nextSlug) {
        // verifică conflict slug (alt serviciu)
        const clash = await prisma.serviceProfile.findFirst({
          where: { slug: nextSlug, NOT: { serviceId: id } },
          select: { serviceId: true }
        });
        if (clash) return error(res, "service_brand_unavailable", 409, { slug: nextSlug });
        payload.slug = nextSlug;
      }

      const saved = await prisma.serviceProfile.upsert({
        where: { serviceId: id },
        create: { serviceId: id, ...payload },
        update: { ...payload },
      });

      return res.json({ ok: true, profile: saved });
    } catch (e) {
      console.error("PUT /vendor-services/:id/profile error:", e);
      if (e?.code === "P2002") {
        return res.status(409).json({
          error: "unique_constraint_failed",
          message: "Numele (slug) este deja folosit.",
          target: e?.meta?.target,
        });
      }
      if (e?.code === "P2025") {
        return res.status(404).json({ error: "record_not_found", message: "Înregistrarea nu a fost găsită." });
      }
      return res.status(500).json({ error: "profile_upsert_failed", message: "Eroare internă la salvarea profilului." });
    }
  }
);

/** POST /api/vendors/me/services/:id/activate (validează minim & activează) */
router.post(
  "/me/services/:id/activate",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
      include: { type: true, profile: true },
    });
    if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

    // minim: titlu/pachet + oraș
    if (!svc.title || !svc.city) {
      return error(res, "missing_required_fields_core", 400, { hint: "Completează titlul și orașul." });
    }

    // validare atribute dinamice conform serviceType.fields
    let fields = [];
    if (Array.isArray(svc.type?.fields)) fields = svc.type.fields;
    else if (typeof svc.type?.fields === "string") {
      try { fields = JSON.parse(svc.type.fields) || []; } catch { fields = []; }
    }

    const attrs = svc.attributes || {};
    const missing = [];

    for (const f of fields) {
      if (f && f.required) {
        const v = attrs[f.key];
        const isEmptyArray = Array.isArray(v) && v.length === 0;
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          isEmptyArray ||
          (f.type === "checkbox_with_details" && !(v?.checked && v?.details));
        if (empty) missing.push(f.label || f.key);
      }
    }
    if (missing.length) return error(res, "missing_required_fields_specs", 400, { missing });

    const activated = await prisma.vendorService.update({
      where: { id },
      data: { status: "ACTIVE", isActive: true },
      include: { type: true },
    });

    res.json(activated);
  }
);

/* ============================= Rute generale ============================== */

/** GET /api/vendors  (listare publică) */
router.get("/", async (req, res) => {
  const q = req.query.q ? String(req.query.q) : undefined;
  const city = req.query.city ? String(req.query.city) : undefined;

  const takeRaw = toInt(req.query.take ?? "20", 20);
  const take = clamp(takeRaw, 1, 100);
  const skipRaw = toInt(req.query.skip ?? "0", 0);
  const skip = Math.max(0, skipRaw);

  const where = {
    isActive: true,
    ...(city ? { city } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        services: {
          where: { isActive: true, status: "ACTIVE" },
          select: {
            id: true,
            title: true,
            city: true,
            type: { select: { code: true, name: true } },
          },
        },
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  res.json({ items, total, skip, take });
});

/** GET /api/vendors/:id (public) */
router.get("/:id", async (req, res) => {
  const v = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      // ⚠️ NU expune user.email / role în public
      services: { include: { type: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!v) return error(res, "vendor_not_found", 404);
  res.json(v);
});

/** DELETE /api/vendors/vendor-services/:id/profile (șterge doar ServiceProfile) */
router.delete(
  "/vendor-services/:id/profile",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    // vendor-ul curent
    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    // verificăm că serviciul îi aparține
    const svc = await prisma.vendorService.findUnique({ where: { id }, select: { id: true, vendorId: true } });
    if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

    // șterge profilul dacă există (nu aruncă dacă nu există)
    await prisma.serviceProfile.delete({ where: { serviceId: id } }).catch(() => null);

    return res.json({ ok: true });
  }
);

/** POST /api/vendors/me/services/:id/deactivate (dezactivează un serviciu activ) */
router.post(
  "/me/services/:id/deactivate",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({ where: { id } });
    if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

    const updated = await prisma.vendorService.update({
      where: { id },
      data: { isActive: false, status: "INACTIVE" },
      include: { type: true },
    });

    res.json({ ok: true, service: updated });
  }
);

/** DELETE /api/vendors/me/services/:id (șterge complet serviciul) */
router.delete(
  "/me/services/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
      select: { id: true, vendorId: true, status: true, isActive: true },
    });
    if (!svc || svc.vendorId !== meVendor.id) return error(res, "service_not_found", 404);

    if (svc.status === "ACTIVE" && svc.isActive) {
      return error(res, "cannot_delete_active_service", 409, {
        hint: "Dezactivează serviciul înainte de a-l șterge.",
      });
    }

    // Ștergerea va cascada și pe ServiceProfile (onDelete: Cascade în schema)
    await prisma.vendorService.delete({ where: { id } });

    return res.json({ ok: true, deletedId: id });
  }
);

// GET /api/vendors/me/stats?window=7d
router.get(
  "/me/stats",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    // TODO: înlocuiește cu real analytics
    const window = String(req.query.window || "7d");
    // returnez ceva dummy
    res.json({ window, visitors: 42, leads: 3, messages: 1, reviews: 2 });
  }
);

/* ============================ PRODUCTS CRUD (vendor) ============================ */

/** POST /api/vendors/store/:slug/products
 * Body: { title, description, price, images[] }
 */
router.post(
  "/store/:slug/products",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const slug = String(req.params.slug || "").trim().toLowerCase();
    const { title, description, price, images } = req.body || {};

    if (!slug) return error(res, "invalid_slug", 400);
    if (!title || typeof title !== "string" || !title.trim()) {
      return error(res, "invalid_title", 400);
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return error(res, "invalid_price", 400);
    }

    // vendor-ul curent
    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    // profilul service-ului (slug) + confirmăm că aparține vendorului și e de tip "products"
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

    const created = await prisma.product.create({
      data: {
        serviceId: profile.serviceId,
        title: title.trim(),
        description: (description || "").trim(),
        priceCents: Math.round(priceNum * 100),
        images: imgs,
        currency: "RON",
        isActive: true,
      },
    });

    return res.json({
      id: created.id,
      title: created.title,
      description: created.description || "",
      price: created.priceCents / 100,
      images: created.images || [],
      currency: created.currency,
      createdAt: created.createdAt,
    });
  }
);

/** PUT /api/vendors/products/:id
 * Body: { title?, description?, price?, images?, isActive? }
 */
router.put(
  "/products/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;
    const { title, description, price, images, isActive } = req.body || {};

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    // luăm produsul + legătura până la vendor
    const prod = await prisma.product.findUnique({
      where: { id },
      include: { service: { select: { vendorId: true, type: true } } },
    });
    if (!prod || prod.service.vendorId !== meVendor.id || prod.service.type?.code !== "products") {
      return error(res, "product_not_found_or_forbidden", 404);
    }

    const data = {};
    if (typeof title === "string") data.title = title.trim();
    if (typeof description === "string") data.description = description.trim();
    if (price !== undefined) {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return error(res, "invalid_price", 400);
      }
      data.priceCents = Math.round(priceNum * 100);
    }
    if (Array.isArray(images)) {
      data.images = images.filter((u) => typeof u === "string" && u.trim());
    }
    if (isActive !== undefined) {
      data.isActive = !!isActive;
    }

    const updated = await prisma.product.update({ where: { id }, data });
    return res.json({
      id: updated.id,
      title: updated.title,
      description: updated.description || "",
      price: updated.priceCents / 100,
      images: updated.images || [],
      currency: updated.currency,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  }
);

/** DELETE /api/vendors/products/:id */
router.delete(
  "/products/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const prod = await prisma.product.findUnique({
      where: { id },
      include: { service: { select: { vendorId: true, type: true } } },
    });
    if (!prod || prod.service.vendorId !== meVendor.id || prod.service.type?.code !== "products") {
      return error(res, "product_not_found_or_forbidden", 404);
    }

    await prisma.product.delete({ where: { id } });
    return res.json({ ok: true, deletedId: id });
  }
);

// GET /api/vendors/products/:id  (autentificat) – acces doar pentru vendorul proprietar
router.get(
  "/products/:id",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    const meVendor = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
    });
    if (!meVendor) {
      return res.status(404).json({ error: "vendor_profile_missing" });
    }

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
      return res
        .status(404)
        .json({ error: "product_not_found_or_forbidden" });
    }

    return res.json({
      id: p.id,
      title: p.title,
      description: p.description || "",
      price: Math.round(p.priceCents) / 100,
      images: Array.isArray(p.images) ? p.images : [],
      currency: p.currency || "RON",
      ownerVendorId: p.service.vendorId, // ➜ îl poți folosi pe front pentru isOwner
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
  }
);

// GET /api/vendors/me (profil vendor curent)
router.get(
  "/me",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const v = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
      select: {
        id: true, displayName: true, city: true, logoUrl: true, coverUrl: true,
        phone: true, email: true, address: true
      }
    });
    if (!v) return error(res, "vendor_profile_missing", 404);
    res.json({ vendor: v });
  }
);

// PATCH /api/vendors/me (actualizează brand & oraș)
router.patch(
  "/me",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const v = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!v) return error(res, "vendor_profile_missing", 404);

    const displayName = typeof req.body.displayName === "string" ? req.body.displayName.trim() : undefined;
    const city        = typeof req.body.city === "string" ? req.body.city.trim() : undefined;

    if (!displayName && !city) return error(res, "nothing_to_update", 400);

    const updated = await prisma.vendor.update({
      where: { id: v.id },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(city !== undefined ? { city } : {}),
      },
      select: { id: true, displayName: true, city: true }
    });

    res.json({ ok: true, vendor: updated });
  }
);

export default router;
