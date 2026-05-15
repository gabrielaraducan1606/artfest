// src/routes/vendors.stripeConnect.js
import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const RETURN_URL = process.env.STRIPE_CONNECT_RETURN_URL;
const REFRESH_URL = process.env.STRIPE_CONNECT_REFRESH_URL || RETURN_URL;

router.use(authRequired, vendorAccessRequired);

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

async function getVendor(req) {
  if (req.meVendor?.id) {
    return prisma.vendor.findUnique({
      where: { id: req.meVendor.id },
      include: { billing: true, user: { select: { email: true } } },
    });
  }

  const userId = getUserId(req);
  if (!userId) return null;

  return prisma.vendor.findUnique({
    where: { userId },
    include: { billing: true, user: { select: { email: true } } },
  });
}

function computeConnectStatus(acct) {
  if (acct.payouts_enabled) return "enabled";
  if (acct.requirements?.disabled_reason) return "restricted";
  if (acct.details_submitted || acct.id) return "pending";
  return "not_started";
}

function getRequirementsDue(acct) {
  return [
    ...(acct.requirements?.currently_due || []),
    ...(acct.requirements?.past_due || []),
  ];
}

async function persistStripeStatus(vendor, acct) {
  const due = getRequirementsDue(acct);
  const connectStatus = computeConnectStatus(acct);

  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      stripeAccountId: acct.id,
      stripeChargesEnabled: !!acct.charges_enabled,
      stripePayoutsEnabled: !!acct.payouts_enabled,
      stripeDetailsSubmitted: !!acct.details_submitted,
      stripeConnectStatus: connectStatus,
      stripeRequirementsDue: due,
      stripeDisabledReason: acct.requirements?.disabled_reason || null,
      stripeOnboardedAt: acct.details_submitted
        ? vendor.stripeOnboardedAt || new Date()
        : vendor.stripeOnboardedAt,
    },
  });

  return { updated, due, connectStatus };
}

function mapBillingToStripe(vendor) {
  const b = vendor?.billing;

  const companyName = b?.companyName || b?.vendorName || vendor?.displayName || undefined;
  const legalType = (b?.legalType || "").toUpperCase();

  const base = {
    business_profile: {
      name: companyName,
      url: vendor?.website || undefined,
      support_email: b?.email || vendor?.email || vendor?.user?.email || undefined,
      support_phone: b?.phone || vendor?.phone || undefined,
    },
  };

  if (["SRL", "SA", "SRL-D"].includes(legalType)) {
    return {
      ...base,
      business_type: "company",
      company: {
        name: companyName,
        tax_id: b?.cui || undefined,
      },
    };
  }

  if (["PFA", "II", "IF"].includes(legalType)) {
    return {
      ...base,
      business_type: "individual",
    };
  }

  return base;
}

function mapStatusResponse({ vendor, acct = null, due = [], connectStatus = null }) {
  if (!acct && !vendor?.stripeAccountId) {
    return {
      hasAccount: false,
      accountId: null,
      status: "not_started",
      payouts_enabled: false,
      details_submitted: false,
      charges_enabled: false,
      requirements_due: [],
      disabled_reason: null,
    };
  }

  return {
    hasAccount: true,
    accountId: acct?.id || vendor.stripeAccountId,
    status: connectStatus || vendor.stripeConnectStatus || "pending",
    payouts_enabled: !!(acct?.payouts_enabled ?? vendor.stripePayoutsEnabled),
    details_submitted: !!(acct?.details_submitted ?? vendor.stripeDetailsSubmitted),
    charges_enabled: !!(acct?.charges_enabled ?? vendor.stripeChargesEnabled),
    requirements_due: due || vendor.stripeRequirementsDue || [],
    disabled_reason: acct?.requirements?.disabled_reason || vendor.stripeDisabledReason || null,
  };
}

/**
 * GET /api/vendors/stripe/connect/status
 */
router.get("/status", async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(403).json({ message: "Nu ești vendor." });

    if (!vendor.stripeAccountId) {
      return res.json(mapStatusResponse({ vendor }));
    }

    const acct = await stripe.accounts.retrieve(vendor.stripeAccountId);
    const { updated, due, connectStatus } = await persistStripeStatus(vendor, acct);

    return res.json(mapStatusResponse({ vendor: updated, acct, due, connectStatus }));
  } catch (e) {
    console.error("stripe connect status error:", e);
    return res.status(400).json({
      message: e?.message || "Status Stripe Connect eșuat",
    });
  }
});

/**
 * POST /api/vendors/stripe/connect/start
 */
router.post("/start", async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(403).json({ message: "Nu ești vendor." });

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ message: "STRIPE_SECRET_KEY lipsește din env." });
    }

    if (!RETURN_URL) {
      return res.status(500).json({ message: "STRIPE_CONNECT_RETURN_URL lipsește din env." });
    }

    let accountId = vendor.stripeAccountId;
    const prefill = mapBillingToStripe(vendor);

    if (!accountId) {
      const acct = await stripe.accounts.create({
  type: "express",
  country: "RO",
  email: vendor.user?.email || vendor.email || undefined,
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  ...prefill,
});
      accountId = acct.id;
      await persistStripeStatus(vendor, acct);
    } else {
      await stripe.accounts.update(accountId, prefill);
      const acct = await stripe.accounts.retrieve(accountId);
      await persistStripeStatus(vendor, acct);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: "account_onboarding",
    });

    return res.json({ url: link.url });
  } catch (e) {
    console.error("stripe connect start error:", e);
    return res.status(400).json({
      message: e?.message || "Start Stripe Connect eșuat",
    });
  }
});

/**
 * POST /api/vendors/stripe/connect/continue
 */
router.post("/continue", async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(403).json({ message: "Nu ești vendor." });

    if (!vendor.stripeAccountId) {
      return res.status(400).json({
        message: "Nu există cont Stripe încă. Apasă Activează încasări.",
      });
    }

    const acct = await stripe.accounts.retrieve(vendor.stripeAccountId);
    await persistStripeStatus(vendor, acct);

    const link = await stripe.accountLinks.create({
      account: vendor.stripeAccountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: "account_onboarding",
    });

    return res.json({ url: link.url });
  } catch (e) {
    console.error("stripe connect continue error:", e);
    return res.status(400).json({
      message: e?.message || "Continue Stripe Connect eșuat",
    });
  }
});

export default router;