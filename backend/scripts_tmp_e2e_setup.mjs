// TEMPORARY — DEV DB ONLY. Full campaigns E2E test fixtures, clearly
// marked TEST_DELETE_ME. Deleted after use by scripts_tmp_e2e_cleanup.mjs.
import bcrypt from "bcrypt";
import { prisma } from "./src/db.js";

const PASSWORD = "TestCrud!2026";

async function main() {
  const serviceType = await prisma.serviceType.findFirst({ select: { id: true, name: true } });
  if (!serviceType) throw new Error("No ServiceType found in dev DB — cannot create VendorService.");

  async function makeVendor(tag, displayName) {
    const email = `test.${tag}@artfest.local`;
    await prisma.user.deleteMany({ where: { email } });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "VENDOR", status: "ACTIVE", emailVerifiedAt: new Date(), name: `TEST_DELETE_ME ${tag}` },
    });
    const vendor = await prisma.vendor.create({
      data: { userId: user.id, displayName: `TEST_DELETE_ME ${displayName}`, isActive: true },
    });
    const service = await prisma.vendorService.create({
      data: {
        vendorId: vendor.id,
        typeId: serviceType.id,
        title: `TEST_DELETE_ME Service ${tag}`,
        status: "ACTIVE",
        isActive: true,
        estimatedShippingFeeCents: 0,
      },
    });
    return { email, user, vendor, service };
  }

  async function makeProduct(serviceId, title, priceCents) {
    return prisma.product.create({
      data: {
        serviceId,
        title: `TEST_DELETE_ME ${title}`,
        priceCents,
        currency: "RON",
        images: [],
        isActive: true,
        isHidden: false,
        moderationStatus: "APPROVED",
        availability: "READY",
        readyQty: 50,
      },
    });
  }

  const vendorA = await makeVendor("vendorA", "Vendor A (campaign)");
  const vendorB = await makeVendor("vendorB", "Vendor B (no campaign)");

  const pAll = await makeProduct(vendorA.service.id, "Product ALL_PRODUCTS", 10000); // 100 RON
  const pSelEligible = await makeProduct(vendorA.service.id, "Product SELECTED eligible", 20000); // 200 RON
  const pSelNotEligible = await makeProduct(vendorA.service.id, "Product SELECTED not-eligible", 15000); // 150 RON
  const pVendorB = await makeProduct(vendorB.service.id, "Product Vendor B", 30000); // 300 RON

  const buyerEmail = "test.buyer@artfest.local";
  await prisma.user.deleteMany({ where: { email: buyerEmail } });
  const buyer = await prisma.user.create({
    data: {
      email: buyerEmail,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "USER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      name: "TEST_DELETE_ME Buyer",
    },
  });

  console.log(JSON.stringify({
    password: PASSWORD,
    vendorA: { email: vendorA.email, vendorId: vendorA.vendor.id, serviceId: vendorA.service.id },
    vendorB: { email: vendorB.email, vendorId: vendorB.vendor.id, serviceId: vendorB.service.id },
    products: {
      pAll: pAll.id,
      pSelEligible: pSelEligible.id,
      pSelNotEligible: pSelNotEligible.id,
      pVendorB: pVendorB.id,
    },
    buyer: { email: buyer.email },
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
