// src/routes/vendors.stripeConnect.js
import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const RETURN_URL = process.env.STRIPE_CONNECT_RETURN_URL;
const REFRESH_URL = process.env.STRIPE_CONNECT_REFRESH_URL || RETURN_URL;

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

async function getVendor(req) {
  if (req.meVendor?.id) {
    return prisma.vendor.findUnique({
      where: { id: req.meVendor.id },
      include: { billing: true },
    });
  }

  const userId = getUserId(req);
  if (!userId) return null;

  return prisma.vendor.findUnique({
    where: { userId },
    include: { billing: true },
  });
}
function mapBillingToStripe(vendor) {
  const b = vendor?.billing;

  const companyName =
    b?.companyName ||
    b?.vendorName ||
    vendor?.displayName ||
    undefined;

  const legalType = (b?.legalType || "").toUpperCase(); // ex: "SRL", "PFA"

  const base = {
    business_profile: {
      name: companyName,
      url: vendor?.website || undefined,
      support_email: b?.email || vendor?.email || undefined,
      support_phone: b?.phone || vendor?.phone || undefined,
    },
  };

  if (legalType === "SRL" || legalType === "SA" || legalType === "SRL-D") {
    return {
      ...base,
      business_type: "company",
      company: {
        name: companyName,
        tax_id: b?.cui || undefined,
      },
    };
  }

  if (legalType === "PFA" || legalType === "II" || legalType === "IF") {
    return {
      ...base,
      business_type: "individual",
      // individual: { ... }  // aici poți adăuga doar dacă ai date structurate (prenume/nume etc.)
    };
  }

  // fallback: nu trimitem company/individual dacă nu știm sigur
  return base;
}


/**
 * GET /api/vendors/stripe/connect/status
 */
router.get("/status", vendorAccessRequired, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(403).json({ message: "Nu ești vendor." });

    if (!vendor.stripeAccountId) {
      return res.json({
        hasAccount: false,
        payouts_enabled: false,
        details_submitted: false,
        charges_enabled: false,
        requirements_due: [],
      });
    }

    const acct = await stripe.accounts.retrieve(vendor.stripeAccountId);

    const due = [
      ...(acct.requirements?.currently_due || []),
      ...(acct.requirements?.past_due || []),
    ];

    // Persistă status (opțional)
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        stripeChargesEnabled: !!acct.charges_enabled,
        stripePayoutsEnabled: !!acct.payouts_enabled,
        stripeDetailsSubmitted: !!acct.details_submitted,
        stripeOnboardedAt: acct.details_submitted ? new Date() : vendor.stripeOnboardedAt,
      },
    });

    return res.json({
      hasAccount: true,
      payouts_enabled: !!acct.payouts_enabled,
      details_submitted: !!acct.details_submitted,
      charges_enabled: !!acct.charges_enabled,
      requirements_due: due,
    });
  } catch (e) {
    console.error("stripe connect status error:", e);
    return res.status(400).json({ message: e?.message || "Status Stripe Connect eșuat" });
  }
});

/**
 * POST /api/vendors/stripe/connect/start
 */
router.post("/start", vendorAccessRequired, async (req, res) => {
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
        email: vendor.email || undefined,
        capabilities: { transfers: { requested: true } },
        ...prefill,
      });

      accountId = acct.id;

      await prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          stripeAccountId: accountId,
          stripeChargesEnabled: !!acct.charges_enabled,
          stripePayoutsEnabled: !!acct.payouts_enabled,
          stripeDetailsSubmitted: !!acct.details_submitted,
        },
      });
    } else {
      // update prefill înainte de link
      await stripe.accounts.update(accountId, prefill);
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
    return res.status(400).json({ message: e?.message || "Start Stripe Connect eșuat" });
  }
});

/**
 * POST /api/vendors/stripe/connect/continue
 */
router.post("/continue", vendorAccessRequired, async (req, res) => {
  try {
    const vendor = await getVendor(req);
    if (!vendor) return res.status(403).json({ message: "Nu ești vendor." });

    if (!vendor.stripeAccountId) {
      return res.status(400).json({ message: "Nu există cont Stripe încă. Apasă Start." });
    }

    const link = await stripe.accountLinks.create({
      account: vendor.stripeAccountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: "account_onboarding",
    });

    return res.json({ url: link.url });
  } catch (e) {
    console.error("stripe connect continue error:", e);
    return res.status(400).json({ message: e?.message || "Continue Stripe Connect eșuat" });
  }
});

export default router;
