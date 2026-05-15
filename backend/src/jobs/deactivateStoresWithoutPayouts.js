// src/jobs/deactivateStoresWithoutPayouts.js
import Stripe from "stripe";
import { prisma } from "../db.js";
import { notifyVendorStripePayoutsRequired } from "../services/notifications.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const PAYOUTS_ACTIVATION_AT = new Date(
  process.env.PAYOUTS_ACTIVATION_AT || "2026-05-17T00:00:00.000Z"
);

const PAYOUTS_REQUIRED_AT = new Date(
  process.env.PAYOUTS_REQUIRED_AT || "2026-06-01T00:00:00.000Z"
);

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

function isGracePeriod(now = new Date()) {
  return now >= PAYOUTS_ACTIVATION_AT && now < PAYOUTS_REQUIRED_AT;
}

async function refreshStripeStatusForVendor(vendor) {
  if (!vendor?.stripeAccountId || !process.env.STRIPE_SECRET_KEY) {
    return vendor;
  }

  try {
    const acct = await stripe.accounts.retrieve(vendor.stripeAccountId);

    return prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        stripeChargesEnabled: !!acct.charges_enabled,
        stripePayoutsEnabled: !!acct.payouts_enabled,
        stripeDetailsSubmitted: !!acct.details_submitted,
        stripeConnectStatus: computeConnectStatus(acct),
        stripeRequirementsDue: getRequirementsDue(acct),
        stripeDisabledReason: acct.requirements?.disabled_reason || null,
        stripeOnboardedAt: acct.details_submitted
          ? vendor.stripeOnboardedAt || new Date()
          : vendor.stripeOnboardedAt,
      },
      select: {
        id: true,
        stripePayoutsEnabled: true,
        stripeConnectStatus: true,
      },
    });
  } catch (e) {
    console.error("refreshStripeStatusForVendor failed", {
      vendorId: vendor.id,
      stripeAccountId: vendor.stripeAccountId,
      message: e?.message,
    });

    return vendor;
  }
}

async function getActiveProductVendors() {
  return prisma.vendor.findMany({
    where: {
      isActive: true,
      services: {
        some: {
          isActive: true,
          status: "ACTIVE",
          type: { code: "products" },
        },
      },
    },
    select: {
      id: true,
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
      stripeConnectStatus: true,
      stripeRequirementsDue: true,
      stripeDisabledReason: true,
      stripeOnboardedAt: true,
    },
  });
}

async function getVendorsWithoutPayouts() {
  const candidateVendors = await getActiveProductVendors();

  if (!candidateVendors.length) {
    return {
      checkedVendors: 0,
      vendorsWithoutPayouts: [],
    };
  }

  const refreshedVendors = [];

  for (const vendor of candidateVendors) {
    const refreshed = await refreshStripeStatusForVendor(vendor);
    refreshedVendors.push(refreshed);
  }

  return {
    checkedVendors: candidateVendors.length,
    vendorsWithoutPayouts: refreshedVendors.filter(
      (vendor) => !vendor.stripePayoutsEnabled
    ),
  };
}

async function notifyGracePeriodVendors() {
  const { checkedVendors, vendorsWithoutPayouts } =
    await getVendorsWithoutPayouts();

  for (const vendor of vendorsWithoutPayouts) {
    await notifyVendorStripePayoutsRequired(vendor.id, "grace").catch((e) =>
      console.error("notifyVendorStripePayoutsRequired grace failed", {
        vendorId: vendor.id,
        message: e?.message,
      })
    );
  }

  return {
    skipped: false,
    phase: "grace",
    checkedVendors,
    notifiedVendors: vendorsWithoutPayouts.length,
    deactivatedStores: 0,
    deactivatedVendors: 0,
  };
}

export async function deactivateStoresWithoutPayouts() {
  const now = new Date();

  if (Number.isNaN(PAYOUTS_ACTIVATION_AT.getTime())) {
    throw new Error("PAYOUTS_ACTIVATION_AT este invalid.");
  }

  if (Number.isNaN(PAYOUTS_REQUIRED_AT.getTime())) {
    throw new Error("PAYOUTS_REQUIRED_AT este invalid.");
  }

  if (now < PAYOUTS_ACTIVATION_AT) {
    return {
      skipped: true,
      reason: "before_activation_date",
      activationAt: PAYOUTS_ACTIVATION_AT.toISOString(),
      requiredAt: PAYOUTS_REQUIRED_AT.toISOString(),
    };
  }

  if (isGracePeriod(now)) {
    return notifyGracePeriodVendors();
  }

  const { checkedVendors, vendorsWithoutPayouts } =
    await getVendorsWithoutPayouts();

  if (!vendorsWithoutPayouts.length) {
    return {
      skipped: false,
      phase: "required",
      checkedVendors,
      vendorsWithoutPayouts: 0,
      deactivatedStores: 0,
      deactivatedVendors: 0,
    };
  }

  const vendorIdsToDeactivate = vendorsWithoutPayouts.map((vendor) => vendor.id);

for (const vendorId of vendorIdsToDeactivate) {
  await notifyVendorStripePayoutsRequired(vendorId, "deactivated").catch((e) =>
    console.error("notifyVendorStripePayoutsRequired deactivated failed", {
      vendorId,
      message: e?.message,
    })
  );
}

  const result = await prisma.$transaction(async (tx) => {
    const stores = await tx.vendorService.updateMany({
      where: {
        vendorId: { in: vendorIdsToDeactivate },
        isActive: true,
        status: "ACTIVE",
        type: { code: "products" },
      },
      data: {
        isActive: false,
        status: "INACTIVE",
      },
    });

    const vendorsUpdated = await tx.vendor.updateMany({
      where: {
        id: { in: vendorIdsToDeactivate },
      },
      data: {
        isActive: false,
      },
    });

    return {
      deactivatedStores: stores.count,
      deactivatedVendors: vendorsUpdated.count,
    };
  });

  return {
    skipped: false,
    phase: "required",
    checkedVendors,
    vendorsWithoutPayouts: vendorIdsToDeactivate.length,
    ...result,
  };
}