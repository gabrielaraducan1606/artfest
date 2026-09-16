import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const BILLING_ID = "platform";

  await prisma.platformBilling.upsert({
    where: { id: BILLING_ID },

    update: {
      companyName: "ARTFEST MARKETPLACE SRL",
      legalType: "SRL",
      cui: "RO53489510",
      regCom: "J2026005369007",
      address: "Strada Rândunelelor 3, Șarânga, Buzău",
      iban: "RO59BTRLRONCRT0DC9784101",
      bank: "Banca Transilvania",
      email: "billing@artfest.ro",
      phone: "+40 760 565 147",
      vatPayer: false,
      invoiceSeries: "AF",
      updatedAt: new Date(),
    },

    create: {
      id: BILLING_ID,
      companyName: "ARTFEST MARKETPLACE SRL",
      legalType: "SRL",
      cui: "RO53489510",
      regCom: "J2026005369007",
      address: "Strada Rândunelelor 3, Șarânga, Buzău",
      iban: "RO59BTRLRONCRT0DC9784101",
      bank: "Banca Transilvania",
      email: "billing@artfest.ro",
      phone: "+40 760 565 147",
      vatPayer: false,
      invoiceSeries: "AF",
      lastInvoiceSeq: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  console.log("Seed done: PlatformBilling");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });