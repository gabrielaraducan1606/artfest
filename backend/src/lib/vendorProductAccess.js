import { prisma } from "../db.js";

export async function vendorAccessRequired(req, res, next) {
  try {
    if (
      req.user?.role === "VENDOR" ||
      req.user?.role === "ADMIN"
    ) {
      return next();
    }

    const vendor = await prisma.vendor.findUnique({
      where: {
        userId: req.user.sub,
      },
    });

    if (!vendor) {
      return res.status(403).json({
        error: "forbidden",
      });
    }

    req.meVendor = vendor;

    return next();
  } catch (error) {
    console.error(
      "vendorAccessRequired error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

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