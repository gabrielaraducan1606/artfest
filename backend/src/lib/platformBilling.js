// server/lib/platformBilling.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function getPlatformBillingOrThrow() {
  const pb = await prisma.platformBilling.findUnique({ where: { id: "platform" } });
  if (!pb) {
    const err = new Error("PlatformBilling missing");
    err.code = "PLATFORM_BILLING_MISSING";
    throw err;
  }
  return pb;
}

export async function getPlatformVendorIdOrThrow() {
  const v = await prisma.vendor.findUnique({ where: { id: "platform" }, select: { id: true } });
  if (!v) {
    const err = new Error("Platform Vendor missing");
    err.code = "PLATFORM_VENDOR_MISSING";
    throw err;
  }
  return v.id;
}
