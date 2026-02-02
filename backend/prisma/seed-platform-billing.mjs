import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const BILLING_ID = "platform";
  const VENDOR_ID = "platform";
  const PLATFORM_EMAIL = "platform@artfest.ro";

  // PlatformBilling
  await prisma.platformBilling.upsert({
    where: { id: BILLING_ID },
    update: {
      companyName: "ARTFEST MARKETPLACE SRL",
      legalType: "SRL",
      cui: "RO12345678",
      regCom: "J40/1234/2024",
      address: "București, Str. Exemplu 1",
      iban: "RO49AAAA1B31007593840000",
      bank: "Banca Exemplu",
      email: "facturi@artfest.ro",
      phone: "+40 700 000 000",
      vatPayer: true,
      invoiceSeries: "AF",
      updatedAt: new Date(),
    },
    create: {
      id: BILLING_ID,
      companyName: "ARTFEST MARKETPLACE SRL",
      legalType: "SRL",
      cui: "RO12345678",
      regCom: "J40/1234/2024",
      address: "București, Str. Exemplu 1",
      iban: "RO49AAAA1B31007593840000",
      bank: "Banca Exemplu",
      email: "facturi@artfest.ro",
      phone: "+40 700 000 000",
      vatPayer: true,
      invoiceSeries: "AF",
      lastInvoiceSeq: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // User (pentru Vendor.userId)
  const platformUser = await prisma.user.upsert({
    where: { email: PLATFORM_EMAIL },
    update: { name: "Platform", role: "ADMIN" },
    create: {
      email: PLATFORM_EMAIL,
      passwordHash: "not-used",
      tokenVersion: 0,
      name: "Platform",
      role: "ADMIN",
    },
    select: { id: true },
  });

  // Vendor "platform"
  await prisma.vendor.upsert({
    where: { id: VENDOR_ID },
    update: {
      displayName: "Platform",
      isActive: true,
      email: "facturi@artfest.ro",
      phone: "+40 700 000 000",
      address: "București, Str. Exemplu 1",
    },
    create: {
      id: VENDOR_ID,
      userId: platformUser.id,
      displayName: "Platform",
      isActive: true,
      email: "facturi@artfest.ro",
      phone: "+40 700 000 000",
      address: "București, Str. Exemplu 1",
    },
  });

  console.log("Seed done: PlatformBilling + Vendor(platform)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
