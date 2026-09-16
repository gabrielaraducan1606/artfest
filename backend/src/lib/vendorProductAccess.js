import { prisma } from "../db.js";

/*
 * (audit 2026-09-16) - fostă implementare LOCALĂ, cu același bug ca
 * celelalte copii găsite (accepta orice JWT cu role=VENDOR fără
 * verificare de isActive) - re-exportăm acum versiunea întărită din
 * middleware/vendorAccessRequired.js, ca sursă UNICĂ, fără să
 * schimbăm importurile existente (vendorProductAIRoutes.js,
 * assistantRoutes/assistant/vendorQuotesRoutes.js importă de aici).
 */
export { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

export async function getOwnedProductsServiceBySlug(
  slug,
  userSub
) {
  const profile = await prisma.serviceProfile.findUnique({
    where: {
      slug,
    },

    include: {
      service: {
        include: {
          type: true,
          vendor: true,
          profile: true,
        },
      },
    },
  });

  if (!profile) {
    return {
      error: "store_not_found",
      status: 404,
    };
  }

  const service = profile.service;

  if (
    !service ||
    service.type?.code !== "products"
  ) {
    return {
      error: "not_a_products_store",
      status: 404,
    };
  }

  if (
    !service.vendor ||
    service.vendor.userId !== userSub
  ) {
    return {
      error: "forbidden",
      status: 403,
    };
  }

  return {
    service,
    profile,
  };
}