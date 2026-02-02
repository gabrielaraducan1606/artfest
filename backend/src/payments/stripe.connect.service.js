import { stripe } from "./stripe.client.js";
import { prisma } from "../lib/prisma.js";

export async function createVendorStripeAccount(vendorId, email) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (vendor?.stripeAccountId) return vendor.stripeAccountId;

  const account = await stripe.accounts.create({
    type: "express",
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  await prisma.vendor.update({
    where: { id: vendorId },
    data: { stripeAccountId: account.id },
  });

  return account.id;
}

export async function createOnboardingLink(accountId) {
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${process.env.APP_URL}/stripe/refresh`,
    return_url: `${process.env.APP_URL}/stripe/return`,
    type: "account_onboarding",
  });
}
