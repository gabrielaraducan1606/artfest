// server/routes/vendors.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired /*, requireRole*/ } from "../api/auth.js";

const router = Router();

/* ===================== Helpers ===================== */

const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({
    error: code,
    message: code,
    ...extra,
  });

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

const MULTI_INSTANCE_SERVICE_CODES = new Set(["products"]);

/* ===================== Legal constants ===================== */

const REQUIRED_VENDOR_DOCS = [
  "VENDOR_TERMS",
  "RETURNS_POLICY_ACK",
];

const VENDOR_DOC_LABELS = {
  VENDOR_TERMS: "Acordul Master pentru Vânzători",
  RETURNS_POLICY_ACK: "Politica de retur pentru vânzători",
};

const BILLING_ACTIVATION_AT = new Date(
  process.env.BILLING_ACTIVATION_AT || "2026-05-17T00:00:00.000Z"
);

function isBillingLocked(now = new Date()) {
  return now < BILLING_ACTIVATION_AT;
}

/* ===================== Inline middleware ===================== */

async function vendorAccessRequired(req, res, next) {
  try {
    if (req.user?.role === "VENDOR" || req.user?.role === "ADMIN") {
      return next();
    }

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

async function ensureVendorAndRole(userId) {
  let vendor = await prisma.vendor.findUnique({
    where: { userId },
  });

  if (!vendor) {
    vendor = await prisma.$transaction(async (tx) => {
      const v = await tx.vendor.create({
        data: {
          userId,
          isActive: false,
          displayName: "",
        },
      });

      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (u && u.role !== "VENDOR") {
        await tx.user.update({
          where: { id: userId },
          data: { role: "VENDOR" },
        });
      }

      return v;
    });
  } else {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (u && u.role !== "VENDOR") {
      await prisma.user.update({
        where: { id: userId },
        data: { role: "VENDOR" },
      });
    }
  }

  return vendor;
}

async function computeOnboardingStatus(vendor) {
  if (!vendor) {
    return { exists: false, nextStep: "createVendor" };
  }

  const [drafts, actives, brandedCount] = await prisma.$transaction([
    prisma.vendorService.count({
      where: { vendorId: vendor.id, status: "DRAFT" },
    }),
    prisma.vendorService.count({
      where: { vendorId: vendor.id, status: "ACTIVE", isActive: true },
    }),
    prisma.serviceProfile.count({
      where: {
        service: { vendorId: vendor.id },
        displayName: { not: null },
      },
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

async function getActiveVendorPolicies(documents = REQUIRED_VENDOR_DOCS) {
  const policies = await prisma.vendorPolicy.findMany({
    where: {
      isActive: true,
      isRequired: true,
      document: { in: documents },
    },
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });

  const latestByDoc = new Map();
  for (const p of policies) {
    if (!latestByDoc.has(p.document)) {
      latestByDoc.set(p.document, p);
    }
  }

  return Array.from(latestByDoc.values());
}

async function getVendorAcceptanceStatus(vendorId, documents = REQUIRED_VENDOR_DOCS) {
  const [policies, acceptances] = await Promise.all([
    getActiveVendorPolicies(documents),
    prisma.vendorAcceptance.findMany({
      where: {
        vendorId,
        document: { in: documents },
      },
      orderBy: [{ acceptedAt: "desc" }],
    }),
  ]);

  const acceptanceByDocVersion = new Map();
  for (const a of acceptances) {
    acceptanceByDocVersion.set(`${a.document}:${a.version}`, a);
  }

  const docs = policies.map((policy) => {
    const key = `${policy.document}:${policy.version}`;
    const acceptance = acceptanceByDocVersion.get(key) || null;

    return {
      doc_key: policy.document,
      label: VENDOR_DOC_LABELS[policy.document] || policy.title,
      version: policy.version,
      checksum: policy.checksum || null,
      url: policy.url,
      required: !!policy.isRequired,
      accepted: !!acceptance,
      acceptedAt: acceptance?.acceptedAt || null,
    };
  });

  const allOK = docs.every((d) => !d.required || d.accepted);

  return {
    docs,
    allOK,
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
  const meVendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: {
      id: true,
      displayName: true,
    },
  });

  if (!meVendor) return res.json({ items: [] });

  const includeProfile = String(req.query.includeProfile || "") === "1";

  const list = await prisma.vendorService.findMany({
    where: { vendorId: meVendor.id },
    include: {
      type: true,
      vendor: {
        select: {
          id: true,
          displayName: true,
        },
      },
      ...(includeProfile ? { profile: true } : {}),
      _count: {
        select: {
          ServiceFollow: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = list.map((svc) => ({
    ...svc,
    followersCount: svc._count?.ServiceFollow || 0,
    storeName:
      svc.profile?.displayName ||
      svc.title ||
      svc.vendor?.displayName ||
      "Magazin",
  }));

  res.json({ items });
});

router.get("/me/onboarding-status", authRequired, async (req, res) => {
  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
  });

  const billingLocked = isBillingLocked();

  if (!vendor) {
    return res.json({
      exists: false,
      nextStep: "createVendor",
      billing: {
        locked: billingLocked,
        activationAt: BILLING_ACTIVATION_AT.toISOString(),
      },
    });
  }

  const onboarding = await computeOnboardingStatus(vendor);

  return res.json({
    ...onboarding,
    billing: {
      locked: billingLocked,
      activationAt: BILLING_ACTIVATION_AT.toISOString(),
    },
  });
});

router.get("/me/dashboard", authRequired, vendorAccessRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const billingLocked = isBillingLocked();

    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId },
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
      }));

    if (!meVendor) {
      return res.json({
        ok: true,
        vendor: null,
        services: [],
        onboarding: {
          exists: false,
          nextStep: "createVendor",
        },
        stats: {
          visitors: 0,
          followers: 0,
          productReviewsTotal: 0,
          storeReviewsTotal: 0,
        },
        serviceStats: [],
        billing: {
          locked: billingLocked,
          activationAt: BILLING_ACTIVATION_AT.toISOString(),
          notice: billingLocked
            ? "Perioada de probă gratuită este activă. Facturarea și plățile online vor începe după data de activare."
            : null,
        },
      });
    }

    const vendorId = meVendor.id;

    const servicesPromise = prisma.vendorService.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      include: {
        type: true,
        profile: true,
        _count: {
          select: {
            ServiceFollow: true,
          },
        },
      },
    });

    const onboardingPromise = prisma
      .$transaction([
        prisma.vendorService.count({ where: { vendorId, status: "DRAFT" } }),
        prisma.vendorService.count({
          where: { vendorId, status: "ACTIVE", isActive: true },
        }),
        prisma.serviceProfile.count({
          where: {
            service: { vendorId },
            displayName: { not: null },
          },
        }),
      ])
      .then(([drafts, actives, brandedCount]) => {
        const hasProfile = !!meVendor.displayName || brandedCount > 0;
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
      });

    const statsPromise = Promise.all([
      prisma.review.count({
        where: {
          status: "APPROVED",
          product: {
            service: { vendorId },
          },
        },
      }),
      prisma.storeReview.count({
        where: { status: "APPROVED", vendorId },
      }),
      prisma.serviceFollow.count({
        where: { service: { vendorId } },
      }),
    ]).then(([productReviewsTotal, storeReviewsTotal, followers]) => ({
      visitors: 0,
      followers,
      productReviewsTotal,
      storeReviewsTotal,
    }));

    const [services, onboarding, stats] = await Promise.all([
      servicesPromise,
      onboardingPromise,
      statsPromise,
    ]);

    res.set("Cache-Control", "private, max-age=10");

    return res.json({
      ok: true,
      vendor: meVendor,
      services: services.map((svc) => ({
        ...svc,
        followersCount: svc._count?.ServiceFollow || 0,
        storeName:
          svc.profile?.displayName ||
          svc.title ||
          meVendor.displayName ||
          "Magazin",
      })),
      onboarding,
      stats,
      serviceStats: services.map((svc) => ({
        serviceId: svc.id,
        slug: svc.profile?.slug || null,
        name:
          svc.profile?.displayName ||
          svc.title ||
          meVendor.displayName ||
          "Magazin",
        followers: svc._count?.ServiceFollow || 0,
        isActive: !!svc.isActive,
        status: svc.status,
      })),
      billing: {
        locked: billingLocked,
        activationAt: BILLING_ACTIVATION_AT.toISOString(),
        notice: billingLocked
          ? "Perioada de probă gratuită este activă. Facturarea și plățile online vor începe după data de activare."
          : null,
      },
    });
  } catch (e) {
    console.error("GET /api/vendors/me/dashboard error:", e);
    return res.status(500).json({ ok: false, error: "dashboard_failed" });
  }
});

/* ===================== Subscription ===================== */

router.get("/me/subscription", authRequired, vendorAccessRequired, async (req, res) => {
  try {
    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) {
      return res.json({
        subscription: null,
        billing: {
          locked: isBillingLocked(),
          activationAt: BILLING_ACTIVATION_AT.toISOString(),
        },
      });
    }

    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: {
        vendorId: meVendor.id,
        OR: [
          { status: "active", endAt: { gt: now } },
          { trialEndsAt: { gt: now } },
        ],
      },
      orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
      include: { plan: true },
    });

    const latest =
      current ||
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id },
        orderBy: [{ createdAt: "desc" }],
        include: { plan: true },
      }));

    return res.json({
      subscription: latest || null,
      billing: {
        locked: isBillingLocked(),
        activationAt: BILLING_ACTIVATION_AT.toISOString(),
      },
    });
  } catch (e) {
    console.error("GET /api/vendors/me/subscription error:", e);
    return res.status(500).json({
      error: "subscription_fetch_failed",
      message: "Nu am putut încărca abonamentul curent.",
    });
  }
});

router.get(
  "/me/subscription/status",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));

      if (!meVendor) {
        return res.json({
          ok: false,
          code: "vendor_missing",
          upgradeUrl: "/abonament",
          billingLocked: isBillingLocked(),
          billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
        });
      }

      const now = new Date();

      const sub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          OR: [
            { status: "active", endAt: { gt: now } },
            { trialEndsAt: { gt: now } },
          ],
        },
        orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
        include: { plan: true },
      });

      if (!sub) {
        const trialPlan = await prisma.subscriptionPlan.findFirst({
          where: {
            isActive: true,
            trialDays: { not: null },
          },
          orderBy: [{ trialDays: "desc" }, { priceCents: "asc" }],
          select: {
            code: true,
            name: true,
            trialDays: true,
          },
        });

        return res.json({
          ok: false,
          code: "subscription_required",
          upgradeUrl: "/onboarding/details?tab=plata&solo=1",
          trialOfferDays: trialPlan?.trialDays ?? null,
          trialPlan: trialPlan
            ? {
                code: trialPlan.code,
                name: trialPlan.name,
              }
            : null,
          billingLocked: isBillingLocked(),
          billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
        });
      }

      const isTrial = !!(sub.trialEndsAt && sub.trialEndsAt > now);

      return res.json({
        ok: true,
        kind: isTrial ? "trial" : "paid",
        plan: {
          code: sub.plan?.code || sub.planId || "custom",
          name: sub.plan?.name || sub.plan?.code || "Plan activ",
        },
        status: sub.status,
        endAt: sub.endAt ? sub.endAt.toISOString() : null,
        trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
        billingLocked: isBillingLocked(),
        billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
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

/* ===================== Onboarding ===================== */

router.post("/me/onboarding/reset", authRequired, vendorAccessRequired, async (req, res) => {
  const vendor =
    req.meVendor ??
    (await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
    }));

  if (!vendor) return error(res, "vendor_profile_missing", 404);

  await prisma.vendorService.deleteMany({
    where: { vendorId: vendor.id, status: "DRAFT" },
  });

  const onboarding = await computeOnboardingStatus(vendor);
  res.json({ ok: true, onboarding });
});

/* ====== Stats pentru Desktop ====== */

router.get("/me/stats", authRequired, vendorAccessRequired, async (req, res) => {
  try {
    const window = String(req.query.window || "7d");
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;
    const userId = req.user.sub;

    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId },
        select: { id: true },
      }));

    if (!meVendor) {
      return res.json({
        visitors: 0,
        leads: 0,
        messages: 0,
        productReviewsTotal: 0,
        storeReviewsTotal: 0,
        followers: 0,
        window,
        serviceId: serviceId || null,
      });
    }

    const vendorId = meVendor.id;

    if (serviceId) {
      const svc = await prisma.vendorService.findFirst({
        where: {
          id: serviceId,
          vendorId,
        },
        select: { id: true },
      });

      if (!svc) {
        return res.status(404).json({
          error: "service_not_found",
          message: "Magazinul nu a fost găsit.",
        });
      }
    }

    const [productReviewsTotal, followers, messages] = await Promise.all([
      prisma.review.count({
        where: {
          status: "APPROVED",
          product: {
            service: serviceId ? { id: serviceId } : { vendorId },
          },
        },
      }),
      prisma.serviceFollow.count({
        where: serviceId ? { serviceId } : { service: { vendorId } },
      }),
      prisma.messageThread.count({
        where: serviceId ? { vendorId, serviceId } : { vendorId },
      }),
    ]);

    return res.json({
      visitors: 0,
      leads: 0,
      messages,
      productReviewsTotal,
      storeReviewsTotal: serviceId ? null : 0,
      followers,
      window,
      serviceId: serviceId || null,
    });
  } catch (e) {
    console.error("GET /api/vendors/me/stats error:", e);
    return res.status(500).json({
      error: "vendor_stats_failed",
      message: "Nu am putut încărca statisticile.",
    });
  }
});

/* ====== Activity feed ====== */

router.get("/me/activity", authRequired, vendorAccessRequired, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  void limit;
  res.json({ items: [] });
});

/* ===================== Service core ===================== */

router.post("/me/services", authRequired, async (req, res) => {
  try {
    if (!req.user?.sub) {
      return res.status(401).json({ error: "unauthorized" });
    }

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

      if (!allCodes.length) {
        return res.status(400).json({
          error: "no_service_types",
          message: "trimite typeCode sau codes[]",
        });
      }

      types = await prisma.serviceType.findMany({
        where: { code: { in: allCodes } },
      });
    }

    if (!types.length) {
      return res.status(404).json({ error: "service_types_not_found" });
    }

    const items = [];

    for (const t of types) {
      let draft;

      if (MULTI_INSTANCE_SERVICE_CODES.has(t.code)) {
        draft = await prisma.vendorService.create({
          data: {
            vendorId: meVendor.id,
            typeId: t.id,
            status: "DRAFT",
            isActive: false,
            coverageAreas: [],
            mediaUrls: [],
            attributes: {},
          },
          include: { type: true, profile: true },
        });
      } else {
        const existing = await prisma.vendorService.findFirst({
          where: {
            vendorId: meVendor.id,
            typeId: t.id,
          },
          include: { type: true, profile: true },
          orderBy: { createdAt: "desc" },
        });

        if (existing) {
          draft = existing;
        } else {
          draft = await prisma.vendorService.create({
            data: {
              vendorId: meVendor.id,
              typeId: t.id,
              status: "DRAFT",
              isActive: false,
              coverageAreas: [],
              mediaUrls: [],
              attributes: {},
            },
            include: { type: true, profile: true },
          });
        }
      }

      items.push({
        id: draft.id,
        typeId: draft.typeId,
        typeCode: draft.type.code,
        typeName: draft.type.name,
        status: draft.status,
        profile: draft.profile || null,
        storeName:
          draft.profile?.displayName ||
          draft.title ||
          meVendor.displayName ||
          "Magazin",
      });
    }

    return res.status(200).json({ items });
  } catch (e) {
    console.error("POST /api/vendors/me/services error:", e);
    return res.status(500).json({
      error: "create_vendor_services_failed",
      detail: e?.message || String(e),
      code: e?.code || null,
      meta: e?.meta || null,
    });
  }
});

router.post(
  "/me/services/products/new",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));

      if (!meVendor) {
        return error(res, "vendor_profile_missing", 404);
      }

      const now = new Date();

      const sub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          OR: [
            { status: "active", endAt: { gt: now } },
            { trialEndsAt: { gt: now } },
          ],
        },
        include: { plan: true },
        orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
      });

      if (!sub) {
        return error(res, "subscription_required", 402, {
          hint: "Ai nevoie de abonament activ pentru a crea magazine.",
        });
      }

      const maxStores = sub.plan?.meta?.limits?.stores ?? sub.plan?.maxStores ?? 1;

      const currentStores = await prisma.vendorService.count({
        where: {
          vendorId: meVendor.id,
          type: { code: "products" },
        },
      });

      if (currentStores >= maxStores) {
        return res.status(403).json({
          ok: false,
          error: "store_limit_reached",
          title: "Ai atins limita de magazine",
          message: `Planul tău permite maximum ${
            maxStores === 1 ? "1 magazin" : `${maxStores} magazine`
          }. Ai deja ${currentStores}.`,
          hint: "Pentru a adăuga mai multe magazine, trebuie să faci upgrade la un plan superior.",
          current: currentStores,
          limit: maxStores,
          cta: {
            label: "Vezi abonamente",
            url: "/onboarding/details?tab=plata&solo=1",
          },
        });
      }

      const productType = await prisma.serviceType.findUnique({
        where: { code: "products" },
      });

      if (!productType) {
        return res.status(404).json({
          error: "service_type_not_found",
          message: 'ServiceType "products" nu există.',
        });
      }

      const created = await prisma.vendorService.create({
        data: {
          vendorId: meVendor.id,
          typeId: productType.id,
          status: "DRAFT",
          isActive: false,
          coverageAreas: [],
          mediaUrls: [],
          attributes: {},
        },
        include: { type: true, profile: true },
      });

      return res.status(201).json({
        ok: true,
        item: {
          id: created.id,
          typeId: created.typeId,
          typeCode: created.type?.code || "products",
          typeName: created.type?.name || "Magazin / Produse",
          status: created.status,
          profile: created.profile || null,
          storeName:
            created.profile?.displayName ||
            created.title ||
            meVendor.displayName ||
            "Magazin",
        },
      });
    } catch (e) {
      console.error("POST /api/vendors/me/services/products/new error:", e);
      return res.status(500).json({
        error: "create_products_service_failed",
        message: "Nu am putut crea un magazin nou.",
        detail: e?.message || String(e),
      });
    }
  }
);

router.patch("/me/services/:id", authRequired, vendorAccessRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;
    const meVendor = req.meVendor ?? (await ensureVendorAndRole(userId));

    const svc = await prisma.vendorService.findUnique({
      where: { id },
    });

    if (!svc || svc.vendorId !== meVendor.id) {
      return error(res, "service_not_found", 404);
    }

    const {
      title,
      description,
      basePriceCents,
      currency,
      city,
      coverageAreas,
      mediaUrls,
      attributes,
      estimatedShippingFeeCents,
      freeShippingThresholdCents,
      shippingNotes,
    } = req.body || {};

    const data = {};

    if (typeof title === "string") data.title = title.trim();
    if (typeof description === "string") data.description = description;

    if (basePriceCents != null) {
      const n = Number(basePriceCents);
      if (!Number.isFinite(n) || n < 0) {
        return error(res, "invalid_base_price", 400);
      }
      data.basePriceCents = Math.round(n);
    }

    if (estimatedShippingFeeCents !== undefined) {
      if (estimatedShippingFeeCents === null || estimatedShippingFeeCents === "") {
        data.estimatedShippingFeeCents = null;
      } else {
        const n = Number(estimatedShippingFeeCents);
        if (!Number.isFinite(n) || n < 0) {
          return error(res, "invalid_estimated_shipping_fee", 400);
        }
        data.estimatedShippingFeeCents = Math.round(n);
      }
    }

    if (freeShippingThresholdCents !== undefined) {
      if (freeShippingThresholdCents === null || freeShippingThresholdCents === "") {
        data.freeShippingThresholdCents = null;
      } else {
        const n = Number(freeShippingThresholdCents);
        if (!Number.isFinite(n) || n < 0) {
          return error(res, "invalid_free_shipping_threshold", 400);
        }
        data.freeShippingThresholdCents = Math.round(n);
      }
    }

    if (shippingNotes !== undefined) {
      data.shippingNotes =
        typeof shippingNotes === "string" && shippingNotes.trim()
          ? shippingNotes.trim()
          : null;
    }

    if (typeof currency === "string") data.currency = currency;
    if (typeof city === "string") data.city = city.trim();

    if (Array.isArray(coverageAreas)) {
      data.coverageAreas = coverageAreas.map(String);
    }

    if (Array.isArray(mediaUrls)) {
      data.mediaUrls = mediaUrls.map(String);
    }

    if (attributes && typeof attributes === "object") {
      const attrs = { ...(svc.attributes || {}), ...attributes };
      data.attributes = attrs;
    }

    const updated = await prisma.vendorService.update({
      where: { id },
      data,
      include: {
        type: true,
        profile: true,
        vendor: {
          select: {
            displayName: true,
          },
        },
      },
    });

    res.json({
      ...updated,
      storeName:
        updated.profile?.displayName ||
        updated.title ||
        updated.vendor?.displayName ||
        "Magazin",
    });
  } catch (e) {
    console.error("PATCH /api/vendors/me/services/:id error:", e);
    res.status(500).json({ error: "service_update_failed" });
  }
});

router.delete("/me/services/:id", authRequired, vendorAccessRequired, async (req, res) => {
  try {
    const { id } = req.params;

    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
    });

    if (!svc || svc.vendorId !== meVendor.id) {
      return error(res, "service_not_found", 404);
    }

    if (svc.isActive && svc.status === "ACTIVE") {
      return error(res, "service_active_cannot_delete", 400, {
        hint: "Dezactivează serviciul înainte de a-l șterge.",
      });
    }

    await prisma.vendorService.delete({ where: { id } });

    res.json({ ok: true, deletedId: id });
  } catch (e) {
    console.error("DELETE /api/vendors/me/services/:id error:", e);
    res.status(500).json({ error: "service_delete_failed" });
  }
});

/* ===================== ServiceProfile CRUD ===================== */

router.put(
  "/vendor-services/:id/profile",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const { id } = req.params;

      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));

      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const svc = await prisma.vendorService.findUnique({
        where: { id },
        select: { id: true, vendorId: true },
      });

      if (!svc || svc.vendorId !== meVendor.id) {
        return error(res, "service_not_found", 404);
      }

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
        shortDescription,
        mirrorVendor = false,
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

      if (typeof displayName === "string" && displayName.trim()) {
        payload.displayName = displayName.trim();
      }

      let nextSlug = null;

      if (typeof slug === "string" && slug.trim()) {
        nextSlug = slugify(slug);
      } else if (
        typeof payload.displayName === "string" &&
        payload.displayName.trim()
      ) {
        nextSlug = slugify(payload.displayName);
      }

      if (nextSlug) {
        const clash = await prisma.serviceProfile.findFirst({
          where: {
            slug: nextSlug,
            NOT: { serviceId: id },
          },
          select: { serviceId: true },
        });

        if (clash) {
          return error(res, "service_brand_unavailable", 409, {
            slug: nextSlug,
          });
        }

        payload.slug = nextSlug;
      }

      const saved = await prisma.serviceProfile.upsert({
        where: { serviceId: id },
        create: { serviceId: id, ...payload },
        update: { ...payload },
      });

      if (mirrorVendor) {
        const vendorPatch = {
          ...(payload.phone !== undefined ? { phone: payload.phone ?? "" } : {}),
          ...(payload.email !== undefined ? { email: payload.email ?? "" } : {}),
          ...(payload.logoUrl !== undefined
            ? { logoUrl: payload.logoUrl ?? "" }
            : {}),
          ...(payload.coverUrl !== undefined
            ? { coverUrl: payload.coverUrl ?? "" }
            : {}),
          ...(payload.about !== undefined ? { about: payload.about ?? "" } : {}),
          ...(payload.displayName !== undefined
            ? { displayName: payload.displayName ?? "" }
            : {}),
          ...(payload.website !== undefined
            ? { website: payload.website ?? "" }
            : {}),
        };

        if (Object.keys(vendorPatch).length) {
          await prisma.vendor
            .update({
              where: { id: meVendor.id },
              data: vendorPatch,
            })
            .catch((e) => console.error("mirror vendor error", e));
        }
      }

      const svcPatch = {};
      if (payload.displayName) svcPatch.title = payload.displayName;

      if (Object.keys(svcPatch).length) {
        await prisma.vendorService
          .update({
            where: { id },
            data: svcPatch,
          })
          .catch((e) => console.error("patch service from profile error", e));
      }

      res.json({ ok: true, profile: saved });
    } catch (e) {
      if (e?.code === "P2002") {
        return res.status(409).json({
          error: "unique_constraint_failed",
          message: "Numele (slug) este deja folosit.",
          target: e?.meta?.target,
        });
      }

      if (e?.code === "P2025") {
        return res.status(404).json({
          error: "record_not_found",
          message: "Înregistrarea nu a fost găsită.",
        });
      }

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
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
      select: { id: true, vendorId: true },
    });

    if (!svc || svc.vendorId !== meVendor.id) {
      return error(res, "service_not_found", 404);
    }

    await prisma.serviceProfile.delete({ where: { serviceId: id } }).catch(() => null);

    res.json({ ok: true });
  }
);

/* ===================== Activate / Deactivate service ===================== */

router.post(
  "/me/services/:id/activate",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const { id } = req.params;

    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
      include: {
        type: true,
        profile: true,
        vendor: {
          select: {
            displayName: true,
            isActive: true,
          },
        },
      },
    });

    if (!svc || svc.vendorId !== meVendor.id) {
      return error(res, "service_not_found", 404);
    }

    const billingLocked = isBillingLocked();

    if (!billingLocked) {
      const billing = await prisma.vendorBilling.findUnique({
        where: { vendorId: meVendor.id },
      });

      const missingBilling = [];
      const isEmpty = (v) => !v || !String(v).trim();

      if (!billing) {
        missingBilling.push('datele de facturare (tab "Plată & facturare")');
      } else {
        if (isEmpty(billing.legalType)) {
          missingBilling.push("tip entitate (SRL / PFA / II / IF)");
        }
        if (isEmpty(billing.companyName)) {
          missingBilling.push("denumirea entității (facturare)");
        }
        if (isEmpty(billing.cui)) {
          missingBilling.push("CUI-ul pentru facturare");
        }
        if (isEmpty(billing.regCom)) {
          missingBilling.push("Nr. Registrul Comerțului");
        }
        if (isEmpty(billing.address)) {
          missingBilling.push("adresa de facturare");
        }
        if (isEmpty(billing.email)) {
          missingBilling.push("emailul de facturare");
        }
        if (isEmpty(billing.contactPerson)) {
          missingBilling.push("persoana de contact (facturare)");
        }
        if (isEmpty(billing.phone)) {
          missingBilling.push("telefonul de contact (facturare)");
        }
        if (isEmpty(billing.vatStatus)) {
          missingBilling.push("status TVA (plătitor / neplătitor)");
        }
        if (billing.vatStatus === "payer" && isEmpty(billing.vatRate)) {
          missingBilling.push("cota de TVA aplicată");
        }
        if (!billing.vatResponsibilityConfirmed) {
          missingBilling.push("confirmarea responsabilității pentru informațiile TVA");
        }
      }

      if (missingBilling.length) {
        return error(res, "missing_required_fields_billing", 400, {
          missing: missingBilling,
          billingLocked: false,
          billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
        });
      }
    }

    const p = svc.profile || {};
    const missing = [];

    if (!p.displayName?.trim()) missing.push("Nume brand");
    if (!p.slug?.trim()) missing.push("Slug");
    if (!p.address?.trim()) missing.push("Adresă retururi / punct de lucru");
    if (!p.logoUrl && !p.coverUrl) missing.push("O imagine (logo/copertă)");
    if (!Array.isArray(p.delivery) || p.delivery.length === 0) {
      missing.push("Zonă acoperire");
    }

    const hasEstimatedShipping =
      svc.estimatedShippingFeeCents !== null &&
      svc.estimatedShippingFeeCents !== undefined;

    const hasFreeShippingThreshold =
      svc.freeShippingThresholdCents !== null &&
      svc.freeShippingThresholdCents !== undefined;

    if (!hasEstimatedShipping) {
      missing.push("Cost estimativ livrare");
    }

    if (!hasFreeShippingThreshold) {
      missing.push("Prag transport gratuit");
    }

    const { docs: legalDocs } = await getVendorAcceptanceStatus(meVendor.id);
    const legalByKey = new Map(legalDocs.map((d) => [d.doc_key, d]));

    if (!legalByKey.get("VENDOR_TERMS")?.accepted) {
      missing.push("Acceptarea Acordului Master pentru Vânzători");
    }

    if (!legalByKey.get("RETURNS_POLICY_ACK")?.accepted) {
      missing.push("Acceptarea Politicii de retur pentru vânzători");
    }

    if (missing.length) {
      return error(res, "missing_required_fields_profile", 400, {
        missing,
        billingLocked,
        billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
      });
    }

    const activated = await prisma.$transaction(async (tx) => {
      const updatedSvc = await tx.vendorService.update({
        where: { id },
        data: { status: "ACTIVE", isActive: true },
        include: {
          type: true,
          profile: true,
          vendor: {
            select: {
              displayName: true,
            },
          },
        },
      });

      if (!meVendor.isActive) {
        await tx.vendor.update({
          where: { id: meVendor.id },
          data: { isActive: true },
        });
      }

      return updatedSvc;
    });

    res.json({
      ...activated,
      billingLocked,
      billingActivationAt: BILLING_ACTIVATION_AT.toISOString(),
      storeName:
        activated.profile?.displayName ||
        activated.title ||
        activated.vendor?.displayName ||
        "Magazin",
    });
  }
);

router.post(
  "/me/services/:id/deactivate",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const { id } = req.params;

    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return error(res, "vendor_profile_missing", 404);

    const svc = await prisma.vendorService.findUnique({
      where: { id },
    });

    if (!svc || svc.vendorId !== meVendor.id) {
      return error(res, "service_not_found", 404);
    }

    const updated = await prisma.vendorService.update({
      where: { id },
      data: { isActive: false },
      include: {
        type: true,
        profile: true,
        vendor: {
          select: {
            displayName: true,
          },
        },
      },
    });

    res.json({
      ...updated,
      storeName:
        updated.profile?.displayName ||
        updated.title ||
        updated.vendor?.displayName ||
        "Magazin",
    });
  }
);

/* ===================== Debug: products vs servicii ===================== */

router.get("/debug/products", async (req, res, next) => {
  try {
    const items = await prisma.product.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
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
      select: {
        productId: true,
        createdAt: true,
      },
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
    const p = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!p || !p.isActive) {
      return res.status(409).json({ error: "product_inactive_or_missing" });
    }

    await prisma.favorite.create({
      data: { userId: req.user.sub, productId },
    });

    return res.json({ ok: true, favored: true });
  } catch (e) {
    if (e?.code === "P2002") {
      await prisma.favorite
        .delete({
          where: {
            userId_productId: {
              userId: req.user.sub,
              productId,
            },
          },
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

  res.json({
    vendor: v,
    billing: {
      locked: isBillingLocked(),
      activationAt: BILLING_ACTIVATION_AT.toISOString(),
    },
  });
});

router.patch("/me", authRequired, vendorAccessRequired, async (req, res) => {
  const v = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
  });

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

/* ===================== Subscription cancel /me ===================== */

router.post(
  "/me/subscription/cancel",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const userId = req.user.sub;

      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId },
        }));

      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const now = new Date();

      const activeSub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          OR: [
            { status: "active", endAt: { gt: now } },
            { trialEndsAt: { gt: now } },
          ],
        },
        orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
        include: { plan: true },
      });

      if (!activeSub) {
        return res.status(409).json({
          error: "no_active_subscription",
          message: "Nu există un abonament activ de anulat.",
        });
      }

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
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));

      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const review = await prisma.storeReview.findUnique({
        where: { id: reviewId },
      });

      if (!review) return error(res, "review_not_found", 404);
      if (review.vendorId !== meVendor.id) return error(res, "forbidden", 403);

      const reply = await prisma.storeReviewReply.upsert({
        where: { reviewId },
        update: { text },
        create: {
          reviewId,
          vendorId: meVendor.id,
          serviceId: review.serviceId,
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

router.delete(
  "/store-reviews/:id/reply",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const reviewId = String(req.params.id || "").trim();

      if (!reviewId) return error(res, "invalid_input", 400);

      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));

      if (!meVendor) return error(res, "vendor_profile_missing", 404);

      const review = await prisma.storeReview.findUnique({
        where: { id: reviewId },
      });

      if (!review) return error(res, "review_not_found", 404);
      if (review.vendorId !== meVendor.id) return error(res, "forbidden", 403);

      await prisma.storeReviewReply.delete({ where: { reviewId } }).catch(() => null);

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