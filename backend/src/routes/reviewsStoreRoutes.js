import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  notifyVendorOnStoreReviewCreated,
  notifyUserOnStoreReviewReply,
} from "../services/notifications.js";

const router = Router();

/* =========================================================
   Helpers: Store = VendorService + ServiceProfile
========================================================= */

async function getMyVendorWithServicesByUserId(userId) {
  return prisma.vendor.findUnique({
    where: { userId },
    select: {
      id: true,
      displayName: true,
      logoUrl: true,
      isActive: true,
      services: {
        select: {
          id: true,
          title: true,
          status: true,
          isActive: true,
          profile: {
            select: {
              slug: true,
              displayName: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });
}

function mapServiceDisplay(service, fallbackName = "Magazin") {
  const name =
    service?.profile?.displayName ||
    service?.title ||
    fallbackName;

  const slug = service?.profile?.slug || null;
  const image = service?.profile?.logoUrl || null;

  return {
    name,
    url: slug ? `/magazin/${slug}` : service?.id ? `/magazin/${service.id}` : null,
    image,
  };
}

/**
 * POST /api/store-reviews
 * Creează sau actualizează recenzia unui user pentru un MAGAZIN/SERVICE.
 * Body:
 *  - serviceId obligatoriu
 *  - rating 1–5 obligatoriu
 *  - comment opțional
 */
router.post("/store-reviews", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const serviceId = String(req.body?.serviceId || "").trim();
    const rating = Number(req.body?.rating);
    const comment =
      typeof req.body?.comment === "string" ? req.body.comment.trim() : null;

    if (!serviceId) {
      return res.status(400).json({ error: "invalid_service_id" });
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "invalid_rating" });
    }

    const service = await prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        vendorId: true,
        status: true,
        isActive: true,
        vendor: {
          select: {
            id: true,
            isActive: true,
          },
        },
      },
    });

    if (
      !service ||
      !service.isActive ||
      service.status !== "ACTIVE" ||
      !service.vendor?.isActive
    ) {
      return res.status(404).json({ error: "service_not_found_or_inactive" });
    }

    const vendorId = service.vendorId;

    const existing = await prisma.storeReview.findUnique({
      where: {
        serviceId_userId: {
          serviceId,
          userId,
        },
      },
      select: {
        id: true,
        rating: true,
        comment: true,
        status: true,
        createdAt: true,
      },
    });

    const now = new Date();
    let review;

    if (!existing) {
      review = await prisma.storeReview.create({
        data: {
          serviceId,
          vendorId,
          userId,
          rating,
          comment,
          status: "APPROVED",
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              name: true,
              avatarUrl: true,
            },
          },
          service: {
            select: {
              id: true,
              title: true,
              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      });

      notifyVendorOnStoreReviewCreated(review.id).catch((e) => {
        console.warn("[notifyVendorOnStoreReviewCreated] failed:", e);
      });

      return res.json({ ok: true, review });
    }

    const isModeratedStatus =
      existing.status === "REJECTED" || existing.status === "HIDDEN";

    review = await prisma.storeReview.update({
      where: { id: existing.id },
      data: {
        rating,
        comment,
        status: "APPROVED",
        ...(isModeratedStatus
          ? {
              createdAt: now,
              updatedAt: now,
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            name: true,
            avatarUrl: true,
          },
        },
        service: {
          select: {
            id: true,
            title: true,
            profile: {
              select: {
                slug: true,
                displayName: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    if (isModeratedStatus) {
      notifyVendorOnStoreReviewCreated(review.id).catch((e) => {
        console.warn("[notifyVendorOnStoreReviewCreated] failed:", e);
      });

      return res.json({ ok: true, review });
    }

    if (
      existing.rating !== rating ||
      (existing.comment || "") !== (comment || "")
    ) {
      try {
        const editorUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        let reason = "USER_EDIT";
        if (editorUser?.role === "VENDOR") reason = "VENDOR_EDIT";
        else if (editorUser?.role === "ADMIN") reason = "ADMIN_EDIT";

        await prisma.storeReviewEditLog.create({
          data: {
            reviewId: review.id,
            editorId: userId,
            oldRating: existing.rating,
            newRating: rating,
            oldComment: existing.comment,
            newComment: comment,
            reason,
          },
        });
      } catch (logErr) {
        console.error(
          "StoreReviewEditLog create failed for review",
          review.id,
          logErr
        );
      }
    }

    return res.json({ ok: true, review });
  } catch (e) {
    console.error("POST /api/store-reviews error", e);
    return res.status(500).json({ error: "store_review_create_failed" });
  }
});

/**
 * GET /api/store-reviews?serviceId=...
 * Listă recenzii pentru un magazin/service.
 */
router.get("/store-reviews", async (req, res) => {
  try {
    const serviceId = String(req.query.serviceId || "").trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    if (!serviceId) {
      return res.status(400).json({ error: "invalid_service_id" });
    }

    const where = {
      serviceId,
      status: "APPROVED",
    };

    const [total, reviews] = await Promise.all([
      prisma.storeReview.count({ where }),
      prisma.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              name: true,
              avatarUrl: true,
            },
          },
          reply: true,
          helpful: true,
        },
      }),
    ]);

    res.json({ total, page, limit, items: reviews });
  } catch (e) {
    console.error("GET /api/store-reviews error", e);
    res.status(500).json({ error: "store_reviews_list_failed" });
  }
});

/**
 * POST /api/store-reviews/:id/helpful
 */
router.post("/store-reviews/:id/helpful", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Trebuie să te autentifici pentru a marca o recenzie ca utilă.",
      });
    }

    if (!reviewId) {
      return res.status(400).json({
        error: "invalid_review_id",
        message: "Recenzia este invalidă.",
      });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });

    if (!review) {
      return res.status(404).json({
        error: "review_not_found",
        message: "Recenzia nu mai există.",
      });
    }

    const existing = await prisma.storeReviewHelpful.findUnique({
      where: {
        reviewId_userId: {
          reviewId,
          userId,
        },
      },
    });

    if (existing) {
      await prisma.storeReviewHelpful.delete({
        where: {
          reviewId_userId: {
            reviewId,
            userId,
          },
        },
      });

      return res.json({
        ok: true,
        helpful: false,
        message: "Ai eliminat aprecierea.",
      });
    }

    await prisma.storeReviewHelpful.create({
      data: {
        reviewId,
        userId,
      },
    });

    return res.json({
      ok: true,
      helpful: true,
      message: "Recenzia a fost marcată ca utilă.",
    });
  } catch (e) {
    console.error("POST /api/store-reviews/:id/helpful error", e);

    return res.status(500).json({
      error: "store_review_helpful_failed",
      message: "Nu am putut marca recenzia ca utilă. Încearcă din nou.",
    });
  }
});

/**
 * POST /api/store-reviews/:id/report
 */
router.post("/store-reviews/:id/report", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();

    if (!reviewId || !reason) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    await prisma.storeReviewReport.create({
      data: {
        reviewId,
        reporterId: req.user.sub,
        reason,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/store-reviews/:id/report error", e);
    res.status(500).json({ error: "store_review_report_failed" });
  }
});

/**
 * DELETE /api/store-reviews/:id
 */
router.delete("/store-reviews/:id", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const userId = req.user.sub;

    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (review.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    await prisma.storeReview.delete({
      where: { id: reviewId },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/store-reviews/:id error", e);
    res.status(500).json({ error: "store_review_delete_failed" });
  }
});

/**
 * POST /api/vendor/store-reviews/:id/reply
 * Vendor adaugă / editează răspunsul la o recenzie.
 */
router.post("/vendor/store-reviews/:id/reply", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();
    const editorUserId = req.user.sub;

    if (!reviewId || !text) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const myVendor = await prisma.vendor.findUnique({
      where: { userId: editorUserId },
      select: { id: true },
    });

    if (!myVendor) {
      return res.status(403).json({ error: "forbidden" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      include: {
        vendor: true,
        service: true,
        reply: true,
      },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (review.vendorId !== myVendor.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const existingReply = review.reply || null;

    const reply = await prisma.storeReviewReply.upsert({
      where: { reviewId },
      update: {
        text,
        serviceId: review.serviceId,
        vendorId: review.vendorId,
      },
      create: {
        reviewId,
        vendorId: review.vendorId,
        serviceId: review.serviceId,
        text,
      },
    });

    if (existingReply && (existingReply.text || "") !== text) {
      try {
        await prisma.storeReviewEditLog.create({
          data: {
            reviewId: review.id,
            editorId: editorUserId,
            oldRating: null,
            newRating: null,
            oldComment: existingReply.text,
            newComment: text,
            reason: "VENDOR_REPLY_EDIT",
          },
        });
      } catch (logErr) {
        console.error(
          "StoreReviewEditLog create failed for vendor reply",
          review.id,
          logErr
        );
      }
    }

    notifyUserOnStoreReviewReply(review.id).catch((e) => {
      console.warn("[notifyUserOnStoreReviewReply] failed:", e);
    });

    return res.json({ ok: true, reply });
  } catch (e) {
    console.error("POST /vendor/store-reviews/:id/reply error", e);
    res.status(500).json({ error: "store_review_reply_save_failed" });
  }
});

/**
 * DELETE /api/vendor/store-reviews/:id/reply
 */
router.delete("/vendor/store-reviews/:id/reply", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const editorUserId = req.user.sub;

    if (!reviewId) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const myVendor = await prisma.vendor.findUnique({
      where: { userId: editorUserId },
      select: { id: true },
    });

    if (!myVendor) {
      return res.status(403).json({ error: "forbidden" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        vendorId: true,
      },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (review.vendorId !== myVendor.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    await prisma.storeReviewReply
      .delete({
        where: { reviewId },
      })
      .catch(() => null);

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /vendor/store-reviews/:id/reply error", e);
    res.status(500).json({ error: "store_review_reply_delete_failed" });
  }
});

/* ================== LISTE PENTRU CONT UTILIZATOR ================== */

/**
 * GET /api/comments/my
 */
router.get("/comments/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    const where = {
      userId,
      status: "APPROVED",
    };

    const [total, items] = await Promise.all([
      prisma.storeReview.count({ where }),
      prisma.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          service: {
            select: {
              id: true,
              title: true,
              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = items.map((r) => {
      const display = mapServiceDisplay(r.service, "Magazin");

      return {
        id: r.id,
        createdAt: r.createdAt,
        rating: r.rating,
        text: r.comment || "",
        productTitle: display.name,
        productUrl: display.url,
        image: display.image,
      };
    });

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/comments/my error", e);
    res.status(500).json({ error: "comments_my_failed" });
  }
});

/**
 * GET /api/comments/received
 */
router.get("/comments/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await getMyVendorWithServicesByUserId(userId);

    if (!vendor) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const serviceIds = vendor.services.map((s) => s.id);

    if (!serviceIds.length) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    const where = {
      serviceId: { in: serviceIds },
      status: "APPROVED",
    };

    const [total, items] = await Promise.all([
      prisma.storeReview.count({ where }),
      prisma.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              name: true,
            },
          },
          service: {
            select: {
              id: true,
              title: true,
              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = items.map((r) => {
      const display = mapServiceDisplay(
        r.service,
        vendor.displayName || "Magazinul meu"
      );

      return {
        id: r.id,
        createdAt: r.createdAt,
        rating: r.rating,
        text: r.comment || "",
        productTitle: display.name,
        productUrl: display.url,
        image: display.image || vendor.logoUrl || null,
      };
    });

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/comments/received error", e);
    res.status(500).json({ error: "comments_received_failed" });
  }
});

/**
 * GET /api/desktop-reviews/my
 */
router.get("/desktop-reviews/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    const [prodItems, storeItems] = await Promise.all([
      prisma.review.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 200,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
          images: {
            select: {
              url: true,
            },
          },
        },
      }),
      prisma.storeReview.findMany({
        where: {
          userId,
          status: "APPROVED",
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 200,
        include: {
          service: {
            select: {
              id: true,
              title: true,
              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const prodMapped = prodItems.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: r.product?.title || "Produs",
      productUrl: r.product ? `/produs/${r.product.id}` : null,
      image:
        r.images?.[0]?.url ||
        (Array.isArray(r.product?.images) ? r.product.images[0] : null) ||
        null,
      kind: "PRODUCT_REVIEW",
    }));

    const storeMapped = storeItems.map((r) => {
      const display = mapServiceDisplay(r.service, "Magazin");

      return {
        id: r.id,
        createdAt: r.createdAt,
        rating: r.rating,
        text: r.comment || "",
        productTitle: display.name,
        productUrl: display.url,
        image: display.image,
        kind: "STORE_REVIEW",
      };
    });

    const all = [...prodMapped, ...storeMapped].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = all.length;
    const items = all.slice(skip, skip + limit);

    res.json({ total, page, limit, items });
  } catch (e) {
    console.error("GET /api/desktop-reviews/my error", e);
    res.status(500).json({ error: "desktop_reviews_my_failed" });
  }
});

/**
 * GET /api/desktop-reviews/received
 */
router.get("/desktop-reviews/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await getMyVendorWithServicesByUserId(userId);

    if (!vendor) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const serviceIds = vendor.services.map((s) => s.id);

    if (!serviceIds.length) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    const [prodItems, storeItems] = await Promise.all([
      prisma.review.findMany({
        where: {
          status: "APPROVED",
          product: {
            serviceId: {
              in: serviceIds,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 200,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
          images: {
            select: {
              url: true,
            },
          },
        },
      }),
      prisma.storeReview.findMany({
        where: {
          serviceId: {
            in: serviceIds,
          },
          status: "APPROVED",
        },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 200,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              name: true,
            },
          },
          service: {
            select: {
              id: true,
              title: true,
              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  logoUrl: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const prodMapped = prodItems.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: r.product?.title || "Produs",
      productUrl: r.product ? `/produs/${r.product.id}` : null,
      image:
        r.images?.[0]?.url ||
        (Array.isArray(r.product?.images) ? r.product.images[0] : null) ||
        null,
      kind: "PRODUCT_REVIEW",
    }));

    const storeMapped = storeItems.map((r) => {
      const display = mapServiceDisplay(
        r.service,
        vendor.displayName || "Magazinul meu"
      );

      return {
        id: r.id,
        createdAt: r.createdAt,
        rating: r.rating,
        text: r.comment || "",
        productTitle: display.name,
        productUrl: display.url,
        image: display.image || vendor.logoUrl || null,
        reviewer: {
          name:
            r.user?.firstName || r.user?.lastName
              ? [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ")
              : r.user?.name || "Client",
        },
        kind: "STORE_REVIEW",
      };
    });

    const all = [...prodMapped, ...storeMapped].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = all.length;
    const items = all.slice(skip, skip + limit);

    res.json({ total, page, limit, items });
  } catch (e) {
    console.error("GET /api/desktop-reviews/received error", e);
    res.status(500).json({ error: "desktop_reviews_received_failed" });
  }
});

/**
 * GET /api/vendors/me/reviews/kpi
 * KPI recenzii pentru dashboard (desktop)
 */
router.get("/vendors/me/reviews/kpi", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      select: {
        id: true,
        services: {
          select: { id: true },
        },
      },
    });

    if (!vendor) {
      return res.json({
        ok: true,
        data: { product: 0, store: 0, byService: {} },
      });
    }

    const serviceIds = vendor.services.map((s) => s.id);

    if (!serviceIds.length) {
      return res.json({
        ok: true,
        data: { product: 0, store: 0, byService: {} },
      });
    }

    // STORE REVIEWS (direct pe service)
    const storeGroups = await prisma.storeReview.groupBy({
      by: ["serviceId"],
      where: {
        status: "APPROVED",
        serviceId: { in: serviceIds },
      },
      _count: { _all: true },
    });

    // PRODUCT REVIEWS (via product -> serviceId)
    const productReviews = await prisma.review.findMany({
      where: {
        status: "APPROVED",
        product: {
          serviceId: { in: serviceIds },
        },
      },
      select: {
        id: true,
        product: {
          select: {
            serviceId: true,
          },
        },
      },
    });

    const byService = {};

    // init
    for (const id of serviceIds) {
      byService[id] = { product: 0, store: 0 };
    }

    let storeTotal = 0;
    let productTotal = 0;

    // STORE
    for (const g of storeGroups) {
      const count = g._count._all || 0;

      byService[g.serviceId] ??= { product: 0, store: 0 };
      byService[g.serviceId].store += count;

      storeTotal += count;
    }

    // PRODUCT
    for (const r of productReviews) {
      const sid = r.product?.serviceId;
      if (!sid) continue;

      byService[sid] ??= { product: 0, store: 0 };
      byService[sid].product += 1;

      productTotal += 1;
    }

    return res.json({
      ok: true,
      data: {
        product: productTotal,
        store: storeTotal,
        byService,
      },
    });
  } catch (e) {
    console.error("GET /api/vendors/me/reviews/kpi error", e);
    res.status(500).json({ error: "reviews_kpi_failed" });
  }
});

export default router;