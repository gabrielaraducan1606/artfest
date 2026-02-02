// scripts/make-admin.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;

  if (!email) {
    throw new Error("❌ Missing ADMIN_EMAIL environment variable");
  }

  console.log("🔍 Looking for user:", email);

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error(`❌ No user found with email: ${email}`);
  }

  if (user.role === "ADMIN") {
    console.log(`ℹ️ User ${email} is already ADMIN`);
    return;
  }

  await prisma.user.update({
    where: { email },
    data: { role: "ADMIN" }, // ajustează dacă enum-ul tău are alt nume
  });

  console.log(`✅ User promoted to ADMIN: ${email}`);
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
