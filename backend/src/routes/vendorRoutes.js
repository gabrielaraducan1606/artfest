// server/routes/vendors.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired /*, requireRole*/ } from "../api/auth.js";
import { normalizeCityName } from "../utils/cityUtils.js";

const router = Router();

/* ===================== Helpers ===================== */
const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, message: code, ...extra });

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

const clean = (v) => (typeof v === "string" ? v.trim() : v);
const cleanOrNull = (v) => {
  const c = clean(v);
  return c ? c : null;
};

/* ===================== Inline middleware ===================== */
/**
 * Permite accesul dacă:
 * - tokenul are rol VENDOR/ADMIN, sau
 * - userul are deja un Vendor în DB (chiar dacă role-ul din JWT e încă USER).
 * Pune vendorul în req.meVendor pentru a evita query-uri duplicate.
 */
async function vendorAccessRequired(req, res, next) {
  try {
    console.log("=== vendorAccessRequired ===");
    console.log("req.user =", req.user);

    if (req.user?.role === "VENDOR" || req.user?.role === "ADMIN") {
      console.log("Role ok:", req.user.role, "-> next()");
      return next();
    }

    const v = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (v) {
      req.meVendor = v;
      console.log("Vendor found by userId -> next()");
      return next();
    }

    console.log("No vendor + role not VENDOR/ADMIN -> 403");
    return res.status(403).json({ error: "forbidden" });
  } catch (e) {
    console.error("vendorAccessRequired error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

/* Auto-crează Vendor pentru user și ridică rolul la VENDOR dacă e nevoie */
async function ensureVendorAndRole(userId) {
  let vendor = await prisma.vendor.findUnique({ where: { userId } });
  if (!vendor) {
    vendor = await prisma.$transaction(async (tx) => {
      const v = await tx.vendor.create({
        data: { userId, isActive: false, displayName: "" },
      });
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (u && u.role !== "VENDOR") {
        await tx.user.update({ where: { id: userId }, data: { role: "VENDOR" } });
      }
      return v;
    });
  } else {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (u && u.role !== "VENDOR") {
      await prisma.user.update({ where: { id: userId }, data: { role: "VENDOR" } });
    }
  }
  return vendor;
}

async function computeOnboardingStatus(vendor) {
  if (!vendor) return { exists: false, nextStep: "createVendor" };
  const [drafts, actives, brandedCount] = await prisma.$transaction([
    prisma.vendorService.count({ where: { vendorId: vendor.id, status: "DRAFT" } }),
    prisma.vendorService.count({
      where: { vendorId: vendor.id, status: "ACTIVE", isActive: true },
    }),
    prisma.serviceProfile.count({
      where: { service: { vendorId: vendor.id }, displayName: { not: null } },
    }),
  ]);
  const hasProfile = !!vendor.displayName || brandedCount > 0;
  const hasServices = drafts + actives > 0;
  const hasActive = actives > 0;
  let nextStep = "done";
  if (!hasProfile) nextStep = "profile";
  else if (!hasServices) nextStep = "selectServices";
  else if (!hasActive) nextStep = "fillDetails";
  return {
    exists: true,
    hasProfile,
    hasServices,
    hasDrafts: drafts > 0,
    hasActive,
    nextStep,
  };
}

/* ===================== Brand checks (public) ===================== */
router.get("/vendor-services/brand/check", async (req, res) => {
  const rawName = String(req.query.name || "").trim();
  const rawSlug = String(req.query.slug || "").trim();
  const excludeServiceId = req.query.excludeServiceId
    ? String(req.query.excludeServiceId)
    : null;

  const base = rawSlug || rawName;
  if (!base) return error(res, "invalid_input", 400);
  const slug = slugify(base);
  if (!slug) return error(res, "invalid_input", 400);

  const existing = await prisma.serviceProfile.findMany({
    where: { slug: { startsWith: slug } },
    select: { slug: true, serviceId: true },
    take: 50,
  });

  let available = true;
  for (const e of existing) {
    if (e.slug === slug && (!excludeServiceId || e.serviceId !== excludeServiceId)) {
      available = false;
      break;
    }
  }

  let suggestion = null;
  if (!available) {
    const set = new Set(existing.map((e) => e.slug));
    for (let i = 2; i < 100; i++) {
      const s = `${slug}-${i}`;
      if (!set.has(s)) {
        suggestion = s;
        break;
      }
    }
  }

  res.json({ ok: true, slug, available, suggestion });
});

router.get("/vendor-services/brand/check-name", async (req, res) => {
  const name = String(req.query.name || "").trim();
  const excludeServiceId = req.query.excludeServiceId
    ? String(req.query.excludeServiceId)
    : null;
  if (!name) return error(res, "invalid_input", 400);
  const clash = await prisma.serviceProfile.findFirst({
    where: {
      displayName: { equals: name, mode: "insensitive" },
      ...(excludeServiceId ? { NOT: { serviceId: excludeServiceId } } : {}),
    },
    select: { serviceId: true, slug: true, displayName: true },
  });
  res.json({ ok: true, nameClash: !!clash, conflict: clash || null });
});

/* ===================== /me dashboards ===================== */
router.get("/me/services", authRequired, async (req, res) => {
  const meVendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
  if (!meVendor) return res.json({ items: [] });
  const includeProfile = String(req.query.includeProfile || "") === "1";
  const list = await prisma.vendorService.findMany({
    where: { vendorId: meVendor.id },
    include: { type: true, ...(includeProfile ? { profile: true } : {}) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items: list });
});

router.get("/me/onboarding-status", authRequired, async (req, res) => {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
  if (!vendor) return res.json({ exists: false, nextStep: "createVendor" });
  const onboarding = await computeOnboardingStatus(vendor);
  res.json(onboarding);
});

// Abonamentul curent al vendorului logat (pentru sidebar etc.)
router.get(
  "/me/subscription",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));

      if (!meVendor) {
        return res.json({ subscription: null });
      }

      const sub = await prisma.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      });

      return res.json({ subscription: sub });
    } catch (e) {
      console.error("GET /api/vendors/me/subscription error:", e);
      return res.status(500).json({
        error: "subscription_fetch_failed",
        message: "Nu am putut încărca abonamentul curent.",
      });
    }
  }
);

// Status simplificat pentru Desktop (ok / nu ok)
router.get(
  "/me/subscription/status",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));

      if (!meVendor) {
        return res.json({
          ok: false,
          code: "vendor_missing",
          upgradeUrl: "/abonament",
        });
      }

      const sub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          status: "active", // SubscriptionStatus.active
        },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      });

      if (!sub) {
        return res.json({
          ok: false,
          code: "subscription_required",
          upgradeUrl: "/abonament",
        });
      }

      return res.json({
        ok: true,
        plan: {
          code: sub.plan?.code || sub.planId || "custom",
          name: sub.plan?.name || sub.plan?.code || "Plan activ",
        },
        endAt: sub.endAt ? sub.endAt.toISOString() : null,
      });
    } catch (e) {
      console.error("GET /api/vendors/me/subscription/status error:", e);
      return res.status(500).json({
        ok: false,
        code: "subscription_status_failed",
        message: "Nu am putut verifica abonamentul.",
      });
    }
  }
);

router.post(
  "/me/onboarding/reset",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const vendor =
      req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!vendor) return error(res, "vendor_profile_missing", 404);
    await prisma.vendorService.deleteMany({
      where: { vendorId: vendor.id, status: "DRAFT" },
    });
    const onboarding = await computeOnboardingStatus(vendor);
    res.json({ ok: true, onboarding });
  }
);

/* ====== Stats pentru Desktop (vizitatori/leaduri etc) ====== */
router.get("/me/stats", authRequired, vendorAccessRequired, async (req, res) => {
  const window = String(req.query.window || "7d");
  // Deocamdată, returnăm 0 peste tot ca să nu dea 404 / să nu pice UI-ul.
  res.json({
    visitors: 0,
    leads: 0,
    messages: 0,
    reviews: 0,
    window,
  });
});

/* ====== Activity feed pentru Desktop (placeholder) ====== */
router.get("/me/activity", authRequired, vendorAccessRequired, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  // Momentan nu avem un model de activity; întoarcem listă goală ca să nu dea 404.
  res.json({ items: [] });
});

/* ===================== Service core ===================== */
// Creează / upsertează servicii și (dacă e cazul) promovează rolul la VENDOR
router.post("/me/services", authRequired, async (req, res) => {
  try {
    if (!req.user?.sub) return res.status(401).json({ error: "unauthorized" });
    const userId = req.user.sub;

    const meVendor = await ensureVendorAndRole(userId);

    const { typeCode, codes, typeIds } = req.body || {};
    let types = [];
    if (Array.isArray(typeIds) && typeIds.length) {
      types = await prisma.serviceType.findMany({
        where: { id: { in: typeIds } },
      });
    } else {
      const allCodes = [
        ...(typeCode ? [String(typeCode)] : []),
        ...(Array.isArray(codes) ? codes.map(String) : []),
      ].filter(Boolean);
      if (!allCodes.length)
        return res
          .status(400)
          .json({ error: "no_service_types", message: "trimite typeCode sau codes[]" });
      types = await prisma.serviceType.findMany({
        where: { code: { in: allCodes } },
      });
    }
    if (!types.length) return res.status(404).json({ error: "service_types_not_found" });

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
          coverageAreas: [],
          mediaUrls: [],
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

    res.status(200).json({ items });
  } catch (e) {
    console.error("POST /api/vendors/me/services error:", e);
    res.status(500).json({
      error: "create_vendor_services_failed",
      detail: e?.message || String(e),
      code: e?.code || null,
      meta: e?.meta || null,
    });
  }
});

// Update service — folosește vendorAccessRequired ca să eviți 403 când rolul încă e USER
router.patch(
  "/me/services/:id",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.sub;

      const meVendor = req.meVendor ?? (await ensureVendorAndRole(userId));

      const svc = await prisma.vendorService.findUnique({ where: { id } });
      if (!svc || svc.vendorId !== meVendor.id)
        return error(res, "service_not_found", 404);

      const {
        title,
        description,
        basePriceCents,
        currency,
        city,
        coverageAreas,
        mediaUrls,
        attributes,
      } = req.body || {};

      const data = {};
      if (typeof title === "string") data.title = title.trim();
      if (typeof description === "string") data.description = description;
      if (basePriceCents != null) {
        const n = Number(basePriceCents);
        if (!Number.isFinite(n) || n < 0)
          return error(res, "invalid_base_price", 400);
        data.basePriceCents = Math.round(n);
      }
      if (typeof currency === "string") data.currency = currency;
      if (typeof city === "string") data.city = city.trim();
      if (Array.isArray(coverageAreas)) data.coverageAreas = coverageAreas.map(String);
      if (Array.isArray(mediaUrls)) data.mediaUrls = mediaUrls.map(String);
      if (attributes && typeof attributes === "object") data.attributes = attributes;

      const updated = await prisma.vendorService.update({
        where: { id },
        data,
        include: { type: true, profile: true },
      });
      res.json(updated);
    } catch (e) {
      console.error("PATCH /api/vendors/me/services/:id error:", e);
      res.status(500).json({ error: "service_update_failed" });
    }
  }
);

// DELETE /me/services/:id – folosit în Desktop.onDelete
router.delete(
  "/me/services/:id",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const { id } = req.params;
      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const svc = await prisma.vendorService.findUnique({ where: { id } });
      if (!svc || svc.vendorId !== meVendor.id)
        return error(res, "service_not_found", 404);

      if (svc.isActive && svc.status === "ACTIVE") {
        return error(
          res,
          "service_active_cannot_delete",
          400,
          { hint: "Dezactivează serviciul înainte de a-l șterge." }
        );
      }

      await prisma.vendorService.delete({ where: { id } });
      res.json({ ok: true, deletedId: id });
    } catch (e) {
      console.error("DELETE /api/vendors/me/services/:id error:", e);
      res.status(500).json({ error: "service_delete_failed" });
    }
  }
);

/* ===================== ServiceProfile CRUD ===================== */
router.put(
  "/vendor-services/:id/profile",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const { id } = req.params;
      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const svc = await prisma.vendorService.findUnique({
        where: { id },
        select: { id: true, vendorId: true },
      });
      if (!svc || svc.vendorId !== meVendor.id)
        return error(res, "service_not_found", 404);

      const {
        displayName,
        slug,
        logoUrl,
        coverUrl,
        phone,
        email,
        address,
        delivery,
        city,
        tagline,
        about,
        website,
        shortDescription, // vine din frontend (ProfileTab)
        mirrorVendor = true,
      } = req.body || {};

      const payload = {
        logoUrl: cleanOrNull(logoUrl),
        coverUrl: cleanOrNull(coverUrl),
        phone: cleanOrNull(phone),
        email: cleanOrNull(email),
        address: cleanOrNull(address),
        delivery: Array.isArray(delivery) ? delivery : [],
        city: cleanOrNull(city),
        tagline: cleanOrNull(tagline),
        about: cleanOrNull(about),
        website: cleanOrNull(website),
        shortDescription: cleanOrNull(shortDescription),
      };
      if (typeof displayName === "string" && displayName.trim())
        payload.displayName = displayName.trim();

      // setăm și citySlug pe profil, dacă avem city
      if (payload.city) {
        const citySlug = normalizeCityName(payload.city);
        if (citySlug) {
          payload.citySlug = citySlug;
        }
      }

      let nextSlug = null;
      if (typeof slug === "string" && slug.trim()) nextSlug = slugify(slug);
      else if (typeof payload.displayName === "string" && payload.displayName.trim())
        nextSlug = slugify(payload.displayName);

      if (nextSlug) {
        const clash = await prisma.serviceProfile.findFirst({
          where: { slug: nextSlug, NOT: { serviceId: id } },
          select: { serviceId: true },
        });
        if (clash) return error(res, "service_brand_unavailable", 409, { slug: nextSlug });
        payload.slug = nextSlug;
      }

      const saved = await prisma.serviceProfile.upsert({
        where: { serviceId: id },
        create: { serviceId: id, ...payload },
        update: { ...payload },
      });

      // sincronizăm câteva câmpuri pe Vendor (inclusiv city)
      if (mirrorVendor) {
        const vendorPatch = {
          ...(payload.phone !== undefined ? { phone: payload.phone ?? "" } : {}),
          ...(payload.email !== undefined ? { email: payload.email ?? "" } : {}),
          ...(payload.address !== undefined ? { address: payload.address ?? "" } : {}),
          ...(payload.logoUrl !== undefined ? { logoUrl: payload.logoUrl ?? "" } : {}),
          ...(payload.coverUrl !== undefined ? { coverUrl: payload.coverUrl ?? "" } : {}),
          ...(payload.about !== undefined ? { about: payload.about ?? "" } : {}),
          ...(payload.displayName !== undefined
            ? { displayName: payload.displayName ?? "" }
            : {}),
          ...(payload.website !== undefined ? { website: payload.website ?? "" } : {}),
          ...(payload.city !== undefined ? { city: payload.city ?? "" } : {}),
        };

        // dacă avem city în payload, derivăm și citySlug pe Vendor
        if (payload.city !== undefined) {
          const vendorCitySlug = normalizeCityName(payload.city || "");
          vendorPatch.citySlug = vendorCitySlug || null;
        }

        if (Object.keys(vendorPatch).length) {
          await prisma.vendor
            .update({ where: { id: meVendor.id }, data: vendorPatch })
            .catch((e) => console.error("mirror vendor error", e));
        }
      }

      // opțional: aliniază titlul/orașul pe VendorService
      const svcPatch = {};
      if (payload.displayName) svcPatch.title = payload.displayName;
      if (payload.city) svcPatch.city = payload.city;
      if (Object.keys(svcPatch).length) {
        await prisma.vendorService
          .update({ where: { id }, data: svcPatch })
          .catch((e) => console.error("patch service from profile error", e));
      }

      res.json({ ok: true, profile: saved });
    } catch (e) {
      if (e?.code === "P2002")
        return res.status(409).json({
          error: "unique_constraint_failed",
          message: "Numele (slug) este deja folosit.",
          target: e?.meta?.target,
        });
      if (e?.code === "P2025")
        return res
          .status(404)
          .json({ error: "record_not_found", message: "Înregistrarea nu a fost găsită." });
      console.error("profile_upsert_failed", e);
      res.status(500).json({
        error: "profile_upsert_failed",
        message: "Eroare internă la salvarea profilului.",
      });
    }
  }
);

router.delete(
  "/vendor-services/:id/profile",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const { id } = req.params;
    const meVendor =
      req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return error(res, "vendor_profile_missing", 404);
    const svc = await prisma.vendorService.findUnique({
      where: { id },
      select: { id: true, vendorId: true },
    });
    if (!svc || svc.vendorId !== meVendor.id)
      return error(res, "service_not_found", 404);
    await prisma.serviceProfile.delete({ where: { serviceId: id } }).catch(() => null);
    res.json({ ok: true });
  }
);

/* ===================== Activate / Deactivate service ===================== */

// ACTIVARE – verifică doar câmpurile din tab-ul „Profil vendor”
router.post(
  "/me/services/:id/activate",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const { id } = req.params;

    const meVendor =
      req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
      include: { type: true, profile: true },
    });
    if (!svc || svc.vendorId !== meVendor.id)
      return error(res, "service_not_found", 404);

    const p = svc.profile || {};
    const attrs = svc.attributes || {};
    const missing = [];

    if (!p.displayName?.trim()) missing.push("Nume brand");
    if (!p.slug?.trim()) missing.push("Slug");
    if (!p.city?.trim()) missing.push("Oraș");
    if (!p.address?.trim()) missing.push("Adresă completă pentru retur");
    if (!p.logoUrl && !p.coverUrl) missing.push("O imagine (logo/copertă)");
    if (!Array.isArray(p.delivery) || p.delivery.length === 0) {
      missing.push("Zonă acoperire");
    }
    if (!attrs.masterAgreementAccepted) {
      missing.push("Acordul Master");
    }

    if (missing.length) {
      return error(res, "missing_required_fields_profile", 400, { missing });
    }

    const activated = await prisma.$transaction(async (tx) => {
      const updatedSvc = await tx.vendorService.update({
        where: { id },
        data: { status: "ACTIVE", isActive: true },
        include: { type: true, profile: true },
      });

      if (!meVendor.isActive) {
        await tx.vendor.update({
          where: { id: meVendor.id },
          data: { isActive: true },
        });
      }

      return updatedSvc;
    });

    res.json(activated);
  }
);

// DEZACTIVARE – nu șterge, doar scoate din active
router.post(
  "/me/services/:id/deactivate",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const { id } = req.params;
    const meVendor =
      req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
    });
    if (!svc || svc.vendorId !== meVendor.id)
      return error(res, "service_not_found", 404);

    const updated = await prisma.vendorService.update({
      where: { id },
      data: { isActive: false },
      include: { type: true, profile: true },
    });

    res.json(updated);
  }
);

/* ===================== Debug: products vs servicii ===================== */
router.get("/debug/products", async (req, res, next) => {
  try {
    const items = await prisma.product.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        service: { include: { type: true, vendor: true, profile: true } },
      },
    });

    res.json(
      items.map((p) => ({
        id: p.id,
        title: p.title,
        isActive: p.isActive,
        isHidden: p.isHidden,
        serviceType: p.service?.type?.code,
        serviceCity: p.service?.city,
        storeName:
          p?.service?.profile?.displayName ||
          p?.service?.vendor?.displayName ||
          "",
      }))
    );
  } catch (e) {
    next(e);
  }
});

/* ===================== Favorites ===================== */
router.get("/favorites", authRequired, async (req, res) => {
  try {
    const items = await prisma.favorite.findMany({
      where: { userId: req.user.sub },
      select: { productId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

router.post("/favorites/toggle", authRequired, async (req, res) => {
  const productId = String(req.body?.productId || "");
  if (!productId) return error(res, "invalid_product_id", 400);

  try {
    const p = await prisma.product.findUnique({ where: { id: productId } });
    if (!p || !p.isActive)
      return res
        .status(409)
        .json({ error: "product_inactive_or_missing" });

    await prisma.favorite.create({
      data: { userId: req.user.sub, productId },
    });
    return res.json({ ok: true, favored: true });
  } catch (e) {
    if (e?.code === "P2002") {
      await prisma.favorite
        .delete({
          where: { userId_productId: { userId: req.user.sub, productId } },
        })
        .catch(() => null);
      return res.json({ ok: true, favored: false });
    }
    return res.status(500).json({ error: "favorite_toggle_failed" });
  }
});

/* ===================== Vendor /me ===================== */
router.get("/me", authRequired, vendorAccessRequired, async (req, res) => {
  const v = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: {
      id: true,
      displayName: true,
      logoUrl: true,
      coverUrl: true,
      phone: true,
      email: true,
      address: true,
      about: true,
      website: true,
      entitySelfDeclared: true,
      entitySelfDeclaredAt: true,
    },
  });
  if (!v) return error(res, "vendor_profile_missing", 404);
  res.json({ vendor: v });
});

router.patch("/me", authRequired, vendorAccessRequired, async (req, res) => {
  const v = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
  if (!v) return error(res, "vendor_profile_missing", 404);

  const displayName =
    typeof req.body.displayName === "string"
      ? req.body.displayName.trim()
      : undefined;

  if (!displayName) return error(res, "nothing_to_update", 400);

  const updated = await prisma.vendor.update({
    where: { id: v.id },
    data: {
      ...(displayName !== undefined ? { displayName } : {}),
    },
    select: {
      id: true,
      displayName: true,
    },
  });
  res.json({ ok: true, vendor: updated });
});

/* ===================== Confirmare entitate juridică /me ===================== */
router.post(
  "/me/entity-confirm",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      });
      if (!vendor) return error(res, "vendor_profile_missing", 404);

      if (vendor.entitySelfDeclared) {
        return res.json({
          ok: true,
          already: true,
          vendor: {
            id: vendor.id,
            entitySelfDeclared: vendor.entitySelfDeclared,
            entitySelfDeclaredAt: vendor.entitySelfDeclaredAt,
          },
        });
      }

      const updated = await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          entitySelfDeclared: true,
          entitySelfDeclaredAt: new Date(),
        },
        select: {
          id: true,
          entitySelfDeclared: true,
          entitySelfDeclaredAt: true,
        },
      });

      return res.json({ ok: true, vendor: updated });
    } catch (e) {
      console.error("POST /api/vendors/me/entity-confirm error:", e);
      return res.status(500).json({
        error: "entity_confirm_failed",
        message: "Nu am putut salva confirmarea.",
      });
    }
  }
);

/* ===================== Subscription cancel /me ===================== */
// Anulează abonamentul vendorului curent, dezactivează vendorul și toate serviciile lui.
router.post(
  "/me/subscription/cancel",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const userId = req.user.sub;

      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId } }));

      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const activeSub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          status: "active",
        },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      });

      if (!activeSub) {
        return res.status(409).json({
          error: "no_active_subscription",
          message: "Nu există un abonament activ de anulat.",
        });
      }

      const now = new Date();

      const result = await prisma.$transaction(async (tx) => {
        const updatedSub = await tx.vendorSubscription.update({
          where: { id: activeSub.id },
          data: {
            status: "canceled",
            endAt: now,
            meta: {
              ...(activeSub.meta || {}),
              canceledAt: now.toISOString(),
              canceledBy: userId,
            },
          },
          include: { plan: true },
        });

        await tx.vendorService.updateMany({
          where: {
            vendorId: meVendor.id,
            isActive: true,
          },
          data: {
            isActive: false,
            status: "INACTIVE",
          },
        });

        await tx.vendor.update({
          where: { id: meVendor.id },
          data: { isActive: false },
        });

        return updatedSub;
      });

      return res.json({ ok: true, subscription: result });
    } catch (e) {
      console.error("POST /api/vendors/me/subscription/cancel error:", e);
      return res.status(500).json({
        error: "subscription_cancel_failed",
        message: "Eroare internă la anularea abonamentului.",
      });
    }
  }
);

/* ===================== Store profile reviews – vendor side ===================== */
/**
 * Vendor adaugă / editează răspuns la o recenzie de PROFIL (StoreReview),
 * separat de recenziile de PRODUSE (Review).
 */
router.post(
  "/store-reviews/:id/reply",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const reviewId = String(req.params.id || "").trim();
      const text = String(req.body?.text || "").trim();
      if (!reviewId || !text) {
        return error(res, "invalid_input", 400);
      }

      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const review = await prisma.storeReview.findUnique({
        where: { id: reviewId },
      });
      if (!review) return error(res, "review_not_found", 404);
      if (review.vendorId !== meVendor.id)
        return error(res, "forbidden", 403);

      const reply = await prisma.storeReviewReply.upsert({
        where: { reviewId },
        update: { text },
        create: {
          reviewId,
          vendorId: meVendor.id,
          text,
        },
      });

      return res.json({ ok: true, reply });
    } catch (e) {
      console.error("POST /api/vendors/store-reviews/:id/reply error:", e);
      return res.status(500).json({
        error: "store_review_reply_failed",
        message: "Nu am putut salva răspunsul.",
      });
    }
  }
);

/**
 * Vendor șterge răspunsul la o recenzie de PROFIL (StoreReview)
 */
router.delete(
  "/store-reviews/:id/reply",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const reviewId = String(req.params.id || "").trim();
      if (!reviewId) return error(res, "invalid_input", 400);

      const meVendor =
        req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const review = await prisma.storeReview.findUnique({
        where: { id: reviewId },
      });
      if (!review) return error(res, "review_not_found", 404);
      if (review.vendorId !== meVendor.id)
        return error(res, "forbidden", 403);

      await prisma.storeReviewReply
        .delete({ where: { reviewId } })
        .catch(() => null);

      return res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /api/vendors/store-reviews/:id/reply error:", e);
      return res.status(500).json({
        error: "store_review_reply_delete_failed",
        message: "Nu am putut șterge răspunsul.",
      });
    }
  }
);

export default router;
