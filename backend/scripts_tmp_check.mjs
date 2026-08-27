import { prisma } from "./src/db.js";
async function main() {
  const u = await prisma.user.findUnique({ where: { email: "test.vendorA@artfest.local" } });
  console.log(JSON.stringify({ found: !!u, id: u?.id }));
  await prisma.$disconnect();
}
main();
