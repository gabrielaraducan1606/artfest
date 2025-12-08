// scripts/backfillCitySlugs.mjs
import { PrismaClient } from "@prisma/client";
import { normalizeCityName } from "../server/utils/cityUtils.js";

const prisma = new PrismaClient();

async function run() {
  console.log("Backfill Vendor.citySlug...");
  const vendors = await prisma.vendor.findMany();
  for (const v of vendors) {
    const slug = v.city ? normalizeCityName(v.city) : null;
    await prisma.vendor.update({
      where: { id: v.id },
      data: { citySlug: slug },
    });
  }

  console.log("Backfill ServiceProfile.citySlug...");
  const profiles = await prisma.serviceProfile.findMany();
  for (const p of profiles) {
    const slug = p.city ? normalizeCityName(p.city) : null;
    await prisma.serviceProfile.update({
      where: { id: p.id },
      data: { citySlug: slug },
    });
  }

  console.log("Gata ✅");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
