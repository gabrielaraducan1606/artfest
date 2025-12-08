// src/services/notifications/newProductNotification.js
import { prisma } from "../../db.js";
import { sendEmail } from "../../emails/sendEmail.js"; // adaptează la helperul tău real

export async function notifyFollowersOnNewProduct(serviceId, product) {
  // 1) luăm magazinul + vendorul (pt nume, email etc.)
  const service = await prisma.vendorService.findUnique({
    where: { id: serviceId },
    include: {
      vendor: true,
      profile: true,
    },
  });

  if (!service) return;

  const shopName =
    service.profile?.displayName ||
    service.title ||
    service.vendor?.displayName ||
    "Magazin";

  // 2) luăm followerii magazinului
  const followers = await prisma.serviceFollow.findMany({
    where: { serviceId },
    include: { user: true },
  });

  if (!followers.length) return;

  const productUrl = `${process.env.APP_ORIGIN || "https://artfest.ro"}/produs/${product.id}`;
  const shopUrl = `${process.env.APP_ORIGIN || "https://artfest.ro"}/magazin/${service.profile?.slug || service.id}`;

  // 3) inserăm notificări în tabelul Notification
  const notificationsData = followers
    .filter((f) => f.userId) // safety
    .map((f) => ({
      userId: f.userId,
      vendorId: service.vendorId,
      type: "system",
      title: `Produs nou în ${shopName}`,
      body: `„${product.title}” a fost adăugat în ${shopName}.`,
      link: productUrl,
      meta: {
        kind: "new_product",
        serviceId,
        productId: product.id,
      },
    }));

  if (notificationsData.length) {
    await prisma.notification.createMany({
      data: notificationsData,
      skipDuplicates: true,
    });
  }

  // 4) opțional: trimitem email-uri
  // (poți avea un flag user-level "marketingOptIn" sau ceva dedicat pentru astfel de emailuri)
  await Promise.all(
    followers.map(async (f) => {
      const user = f.user;
      if (!user?.email) return;

      // aici poți filtra: doar dacă user-ul a dat accept pentru emailuri promo
      // if (!user.marketingOptIn) return;

      try {
        await sendEmail({
          to: user.email,
          subject: `Produs nou în ${shopName}: ${product.title}`,
          template: "new-product-follow", // dacă folosești un templating engine
          variables: {
            userName: user.firstName || user.name || "",
            shopName,
            productTitle: product.title,
            productUrl,
            shopUrl,
          },
          // sau direct text/html dacă nu ai templating:
          // text: `Salut! ${shopName} a adăugat un produs nou: ${product.title}. Vezi aici: ${productUrl}`,
        });
      } catch (e) {
        console.error("Email new product failed", e);
      }
    })
  );
}
