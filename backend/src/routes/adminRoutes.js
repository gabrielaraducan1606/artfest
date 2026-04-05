// src/routes/adminRoutes.js
import { Router } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";

const router = Router();

// Toate rutele de aici sunt doar pentru ADMIN
router.use(authRequired, requireRole("ADMIN"));

// baza pentru link-urile către frontend
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");

// Stripe (folosit doar în endpoint-uri admin de sync)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

/**
 * SELECT comun pentru user în admin
 */
const adminUserSelect = {
  id: true,
  email: true,
  role: true,
  createdAt: true,

  firstName: true,
  lastName: true,
  name: true,

  emailVerifiedAt: true,
  tokenVersion: true,
  status: true,
  lastLoginAt: true,

  inactiveNotifiedAt: true,
  scheduledDeletionAt: true,

  vendor: {
    select: {
      id: true,
      displayName: true,
      isActive: true,
      createdAt: true,
    },
  },

  _count: {
    select: {
      Favorite: true,
      cartItems: true,
      reviews: true,
      comments: true,
      supportTickets: true,
      Notification: true,
      MessageThread: true,
    },
  },
};

/**
 * SELECT comun pentru vendor în acțiuni simple
 */
const adminVendorSelect = {
  id: true,
  displayName: true,
  about: true,
  isActive: true,
  createdAt: true,
  logoUrl: true,
  coverUrl: true,
  phone: true,
  email: true,
  website: true,
  socials: true,
  address: true,
  delivery: true,

  // entitate juridică + audit
  entitySelfDeclared: true,
  entitySelfDeclaredAt: true,
  entitySelfDeclaredIp: true,
  entitySelfDeclaredUa: true,
  entitySelfDeclaredMeta: true,

  // Stripe Connect fields
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeConnectStatus: true,
  stripeRequirementsDue: true,
  stripeDisabledReason: true,
  stripeOnboardedAt: true,

  user: {
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
    },
  },

  billing: {
    select: {
      id: true,
      legalType: true,
      vendorName: true,
      companyName: true,
      cui: true,
      regCom: true,
      address: true,
      iban: true,
      bank: true,
      email: true,
      contactPerson: true,
      phone: true,

      vatStatus: true,
      vatRate: true,
      vatResponsibilityConfirmed: true,
      vatLastResponsibilityConfirm: true,

      tvaActive: true,
      inactiv: true,
      insolvent: true,
      splitTva: true,
      tvaVerifiedAt: true,
      tvaSource: true,
      anafName: true,
      anafAddress: true,
      createdAt: true,
      updatedAt: true,
    },
  },

  _count: {
    select: {
      services: true,
      subscriptions: true,
      visitors: true,
      events: true,
      searches: true,
      ReviewReply: true,
      supportTickets: true,
      MessageThread: true,
      Notification: true,
    },
  },
};

function buildVendorAgreementsSummary(vendor, requiredDocs) {
  const acceptances = vendor?.VendorAcceptance || [];

  const acceptedDocs = acceptances.map((a) => a.document);
  const missingDocs = requiredDocs.filter((doc) => !acceptedDocs.includes(doc));

  const allRequired = requiredDocs.length > 0 && missingDocs.length === 0;

  let lastAcceptedAt = null;
  if (acceptances.length) {
    const latest = acceptances.reduce((acc, cur) => (!acc || cur.acceptedAt > acc.acceptedAt ? cur : acc));
    lastAcceptedAt = latest.acceptedAt.toISOString();
  }

  return { allRequired, acceptedDocs, missingDocs, lastAcceptedAt };
}

/* =========================================================
 *                      KPI / LISTE
 * ========================================================= */

router.get("/stats", async (_req, res) => {
  try {
    const [usersCount, vendorsCount, ordersCount, productsCount] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      prisma.order.count(),
      prisma.product.count(),
    ]);

    res.json({ usersCount, vendorsCount, ordersCount, productsCount });
  } catch (e) {
    console.error("ADMIN /stats error", e);
    res.status(500).json({ error: "admin_stats_failed" });
  }
});

router.get("/users", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: adminUserSelect,
    });
    res.json({ users });
  } catch (e) {
    console.error("ADMIN /users error", e);
    res.status(500).json({ error: "admin_users_failed" });
  }
});

router.get("/vendors", async (_req, res) => {
  try {
    const basePublicUrl = APP_URL || "https://artfest.ro";

    const activePolicies = await prisma.vendorPolicy.findMany({
      where: { isActive: true, isRequired: true },
      select: { document: true },
    });
    const requiredDocs = activePolicies.map((p) => p.document);

    const vendors = await prisma.vendor.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true },
        },
        billing: {
          select: {
            id: true,
            legalType: true,
            vendorName: true,
            companyName: true,
            cui: true,
            regCom: true,
            address: true,
            iban: true,
            bank: true,
            email: true,
            contactPerson: true,
            phone: true,

            vatStatus: true,
            vatRate: true,
            vatResponsibilityConfirmed: true,
            vatLastResponsibilityConfirm: true,

            tvaActive: true,
            inactiv: true,
            insolvent: true,
            splitTva: true,
            tvaVerifiedAt: true,
            tvaSource: true,
            anafName: true,
            anafAddress: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        _count: { select: { services: true, visitors: true, supportTickets: true } },
        services: { include: { profile: true } },
        VendorAcceptance: { select: { document: true, version: true, acceptedAt: true } },
      },
    });

    const vendorsWithFollowers = await Promise.all(
      vendors.map(async (v) => {
        const followers = await prisma.serviceFollow.count({
          where: { service: { vendorId: v.id } },
        });
        return { vendor: v, followers };
      })
    );

    const dto = vendorsWithFollowers.map(({ vendor: v, followers }) => {
      const services = v.services || [];
      const mainService = services.find((s) => s.profile) || services[0] || null;
      const profile = mainService?.profile || null;

      const slug = profile?.slug || null;
      const publicProfileUrl = slug ? `${basePublicUrl.replace(/\/+$/, "")}/magazin/${slug}` : null;

      const hasMasterAgreement = services.some((s) => s.attributes?.masterAgreementAccepted === true);

      const acceptedDates = services
        .map((s) => s.attributes?.masterAgreementAcceptedAt)
        .filter(Boolean)
        .sort();

      const masterAgreementAcceptedAt = acceptedDates.length > 0 ? acceptedDates[0] : null;

      const profileComplete = Boolean(
        (v.displayName || profile?.displayName) &&
          slug &&
          (v.logoUrl || v.coverUrl || profile?.logoUrl || profile?.coverUrl) &&
          (v.address || profile?.address) &&
          Array.isArray(v.delivery) &&
          v.delivery.length > 0 &&
          hasMasterAgreement
      );

      const onboardingStatus = profileComplete ? "done" : "profile";
      const agreementsSummary = buildVendorAgreementsSummary(v, requiredDocs);

      return {
        id: v.id,
        displayName: v.displayName,
        about: v.about,
        isActive: v.isActive,
        createdAt: v.createdAt.toISOString(),
        logoUrl: v.logoUrl,
        coverUrl: v.coverUrl,
        phone: v.phone,
        email: v.email,
        website: v.website,
        socials: v.socials,
        address: v.address,
        delivery: v.delivery,

        entitySelfDeclared: v.entitySelfDeclared,
        entitySelfDeclaredAt: v.entitySelfDeclaredAt ? v.entitySelfDeclaredAt.toISOString() : null,
        entitySelfDeclaredIp: v.entitySelfDeclaredIp || null,
        entitySelfDeclaredUa: v.entitySelfDeclaredUa || null,
        entitySelfDeclaredMeta: v.entitySelfDeclaredMeta ?? null,

        stripeAccountId: v.stripeAccountId || null,
        stripeConnectStatus: v.stripeConnectStatus || "not_started",
        stripePayoutsEnabled: !!v.stripePayoutsEnabled,
        stripeChargesEnabled: !!v.stripeChargesEnabled,
        stripeDetailsSubmitted: !!v.stripeDetailsSubmitted,
        stripeOnboardedAt: v.stripeOnboardedAt ? v.stripeOnboardedAt.toISOString() : null,
        stripeDisabledReason: v.stripeDisabledReason || null,
        stripeRequirementsDue: v.stripeRequirementsDue ?? null,

        slug,
        publicProfileUrl,
        profileComplete,
        onboardingStatus,
        followers,

        user: v.user
          ? {
              id: v.user.id,
              email: v.user.email,
              role: v.user.role,
              createdAt: v.user.createdAt.toISOString(),
              lastLoginAt: v.user.lastLoginAt ? v.user.lastLoginAt.toISOString() : null,
            }
          : null,

        billing: v.billing
          ? {
              ...v.billing,
              vatLastResponsibilityConfirm: v.billing.vatLastResponsibilityConfirm
                ? v.billing.vatLastResponsibilityConfirm.toISOString()
                : null,
              tvaVerifiedAt: v.billing.tvaVerifiedAt ? v.billing.tvaVerifiedAt.toISOString() : null,
              createdAt: v.billing.createdAt.toISOString(),
              updatedAt: v.billing.updatedAt.toISOString(),
            }
          : null,

        hasMasterAgreement,
        masterAgreementAcceptedAt,
        agreementsSummary,

        _count: {
          services: v._count?.services || 0,
          visitors: v._count?.visitors || 0,
          supportTickets: v._count?.supportTickets || 0,
        },
      };
    });

    res.json({ vendors: dto });
  } catch (e) {
    console.error("ADMIN /vendors error", e);
    res.status(500).json({ error: "admin_vendors_failed" });
  }
});

/**
 * POST /vendors/:id/stripe/sync
 * Re-trage statusul contului Stripe Connect și persistă în DB
 */
router.post("/vendors/:id/stripe/sync", async (req, res) => {
  const { id } = req.params;

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "stripe_missing_key", message: "STRIPE_SECRET_KEY lipsește." });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true, stripeAccountId: true, stripeOnboardedAt: true },
    });

    if (!vendor) return res.status(404).json({ error: "vendor_not_found" });
    if (!vendor.stripeAccountId) {
      return res.status(400).json({ error: "stripe_not_connected", message: "Vendorul nu are cont Stripe." });
    }

    const acct = await stripe.accounts.retrieve(vendor.stripeAccountId);

    const due = [
      ...(acct.requirements?.currently_due || []),
      ...(acct.requirements?.past_due || []),
    ];

    const connectStatus = acct.payouts_enabled
      ? "enabled"
      : acct.requirements?.disabled_reason
      ? "restricted"
      : "pending";

    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        stripeChargesEnabled: !!acct.charges_enabled,
        stripePayoutsEnabled: !!acct.payouts_enabled,
        stripeDetailsSubmitted: !!acct.details_submitted,
        stripeOnboardedAt: acct.details_submitted ? new Date() : vendor.stripeOnboardedAt,
        stripeConnectStatus: connectStatus,
        stripeRequirementsDue: due,
        stripeDisabledReason: acct.requirements?.disabled_reason || null,
      },
      select: {
        id: true,
        stripeAccountId: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
        stripeChargesEnabled: true,
        stripeDetailsSubmitted: true,
        stripeOnboardedAt: true,
        stripeDisabledReason: true,
        stripeRequirementsDue: true,
      },
    });

    return res.json({
      vendor: {
        ...updated,
        stripeOnboardedAt: updated.stripeOnboardedAt ? updated.stripeOnboardedAt.toISOString() : null,
      },
    });
  } catch (e) {
    console.error("ADMIN /vendors/:id/stripe/sync error:", e);
    return res.status(500).json({
      error: "admin_vendor_stripe_sync_failed",
      message: e?.message || "Stripe sync failed",
    });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const orders = await prisma.order.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        shipments: {
          include: {
            vendor: { select: { id: true, displayName: true } },
            items: true,
          },
        },
      },
    });

    res.json({ orders });
  } catch (e) {
    console.error("ADMIN /orders error", e);
    res.status(500).json({ error: "admin_orders_failed" });
  }
});

router.get("/products", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const activePolicies = await prisma.vendorPolicy.findMany({
      where: { isActive: true, isRequired: true },
      select: { document: true },
    });
    const requiredDocs = activePolicies.map((p) => p.document);

    const products = await prisma.product.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        service: {
          select: {
            id: true,
            title: true,
            city: true,
            status: true,
            isActive: true,
            vendor: {
              select: {
                id: true,
                displayName: true,
                VendorAcceptance: { select: { document: true, version: true, acceptedAt: true } },
              },
            },
          },
        },
        ProductRatingStats: true,
        _count: { select: { Favorite: true, comments: true, reviews: true, cartItems: true } },
      },
    });

    const productsWithAgreements = products.map((p) => {
      const vendor = p.service?.vendor;
      if (!vendor) return p;

      const agreementsSummary = buildVendorAgreementsSummary(vendor, requiredDocs);
      return {
        ...p,
        service: {
          ...p.service,
          vendor: { ...vendor, agreementsSummary },
        },
      };
    });

    res.json({ products: productsWithAgreements });
  } catch (e) {
    console.error("ADMIN /products error", e);
    res.status(500).json({ error: "admin_products_failed" });
  }
});

/* =========================================================
 *        ACȚIUNI ADMIN PE USER
 * ========================================================= */

router.post("/users/:id/suspend", async (req, res) => {
  const { id } = req.params;

  try {
    if (req.user?.id === id) {
      return res.status(400).json({ error: "cannot_suspend_self", message: "Nu îți poți suspenda propriul cont." });
    }

    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "user_not_found" });

    const user = await prisma.user.update({
      where: { id },
      data: { status: "SUSPENDED", tokenVersion: { increment: 1 } },
      select: adminUserSelect,
    });

    res.json({ user });
  } catch (e) {
    console.error("ADMIN /users/:id/suspend error", e);
    res.status(500).json({ error: "admin_user_suspend_failed" });
  }
});

router.post("/users/:id/unsuspend", async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "user_not_found" });

    const user = await prisma.user.update({
      where: { id },
      data: { status: "ACTIVE" },
      select: adminUserSelect,
    });

    res.json({ user });
  } catch (e) {
    console.error("ADMIN /users/:id/unsuspend error", e);
    res.status(500).json({ error: "admin_user_unsuspend_failed" });
  }
});

router.post("/users/:id/verify-email", async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, emailVerifiedAt: true },
    });
    if (!existing) return res.status(404).json({ error: "user_not_found" });

    const user = await prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: existing.emailVerifiedAt || new Date() },
      select: adminUserSelect,
    });

    res.json({ user });
  } catch (e) {
    console.error("ADMIN /users/:id/verify-email error", e);
    res.status(500).json({ error: "admin_user_verify_email_failed" });
  }
});

router.post("/users/:id/send-password-reset", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) return res.status(404).json({ error: "user_not_found" });

    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const resetLink = APP_URL ? `${APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}` : undefined;

    if (resetLink) {
      await sendPasswordResetEmail({ to: user.email, link: resetLink });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN /users/:id/send-password-reset error", e);
    res.status(500).json({ error: "admin_user_reset_password_failed" });
  }
});

/* =========================================================
 *        ACȚIUNI ADMIN PE VENDOR
 * ========================================================= */

router.post("/vendors/:id/activate", async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "vendor_not_found" });

    const vendor = await prisma.vendor.update({
      where: { id },
      data: { isActive: true },
      select: adminVendorSelect,
    });

    res.json({
      vendor: {
        ...vendor,
        createdAt: vendor.createdAt?.toISOString?.() || vendor.createdAt,
        stripeOnboardedAt: vendor.stripeOnboardedAt ? vendor.stripeOnboardedAt.toISOString() : null,
      },
    });
  } catch (e) {
    console.error("ADMIN /vendors/:id/activate error", e);
    res.status(500).json({ error: "admin_vendor_activate_failed" });
  }
});

router.post("/vendors/:id/deactivate", async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "vendor_not_found" });

    const vendor = await prisma.vendor.update({
      where: { id },
      data: { isActive: false },
      select: adminVendorSelect,
    });

    res.json({
      vendor: {
        ...vendor,
        createdAt: vendor.createdAt?.toISOString?.() || vendor.createdAt,
        stripeOnboardedAt: vendor.stripeOnboardedAt ? vendor.stripeOnboardedAt.toISOString() : null,
      },
    });
  } catch (e) {
    console.error("ADMIN /vendors/:id/deactivate error", e);
    res.status(500).json({ error: "admin_vendor_deactivate_failed" });
  }
});

router.post("/vendors/:id/send-password-reset", async (req, res) => {
  const { id } = req.params;

  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: { user: { select: { id: true, email: true } } },
    });

    if (!vendor?.user) return res.status(404).json({ error: "vendor_user_not_found" });

    await prisma.passwordResetToken.updateMany({
      where: { userId: vendor.user.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await prisma.passwordResetToken.create({
      data: { userId: vendor.user.id, tokenHash, expiresAt },
    });

    const resetLink = APP_URL ? `${APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}` : undefined;

    if (resetLink) {
      await sendPasswordResetEmail({ to: vendor.user.email, link: resetLink });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN /vendors/:id/send-password-reset error", e);
    res.status(500).json({ error: "admin_vendor_reset_password_failed" });
  }
});

router.post("/vendors/:id/reset-agreements", async (req, res) => {
  const { id } = req.params;

  try {
    const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
    if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

    await prisma.vendorAcceptance.deleteMany({ where: { vendorId: id } });
    return res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN /vendors/:id/reset-agreements error", e);
    return res.status(500).json({ error: "admin_vendor_reset_agreements_failed" });
  }
});

export default router;
