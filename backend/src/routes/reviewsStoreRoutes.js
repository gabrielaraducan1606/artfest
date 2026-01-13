import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  notifyVendorOnStoreReviewCreated,
  notifyUserOnStoreReviewReply,
} from "../services/notifications.js";

const router = Router();

/**
 * POST /api/store-reviews
 * Creează sau actualizează recenzia unui user pentru un MAGAZIN (Vendor).
 * Body:
 *  - vendorId (obligatoriu)
 *  - rating (1–5, obligatoriu)
 *  - comment (opțional)
 */
router.post("/store-reviews", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const vendorId = String(req.body?.vendorId || "").trim();
    const rating = Number(req.body?.rating);
    const comment =
      typeof req.body?.comment === "string" ? req.body.comment.trim() : null;

    if (!vendorId) {
      return res.status(400).json({ error: "invalid_vendor_id" });
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "invalid_rating" });
    }

    // verificăm că vendorul există și e activ
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, isActive: true },
    });

    if (!vendor || !vendor.isActive) {
      return res.status(404).json({ error: "vendor_not_found_or_inactive" });
    }

    // verificăm dacă există deja recenzie
    const existing = await prisma.storeReview.findUnique({
      where: { vendorId_userId: { vendorId, userId } },
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
      // 🌱 NU există recenzie → creare simplă
      review = await prisma.storeReview.create({
        data: {
          vendorId,
          userId,
          rating,
          comment,
          status: "APPROVED",
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, name: true },
          },
        },
      });

      // 🔔 notificare vendor (doar pe recenzie nouă)
      notifyVendorOnStoreReviewCreated(review.id).catch((e) => {
        console.warn("[notifyVendorOnStoreReviewCreated] failed:", e);
      });

      return res.json({ ok: true, review });
    }

    // există recenzie anterioară
    const isModeratedStatus =
      existing.status === "REJECTED" || existing.status === "HIDDEN";

    if (isModeratedStatus) {
      // 🧹 recenzie moderată anterior → o tratăm ca una NOUĂ
      review = await prisma.storeReview.update({
        where: { id: existing.id },
        data: {
          rating,
          comment,
          status: "APPROVED",
          createdAt: now,
          updatedAt: now,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, name: true },
          },
        },
      });

      // 🔔 notificare vendor (tratăm ca recenzie nouă)
      notifyVendorOnStoreReviewCreated(review.id).catch((e) => {
        console.warn("[notifyVendorOnStoreReviewCreated] failed:", e);
      });

      return res.json({ ok: true, review });
    }

    // ✏️ caz normal: recenzie APROBATĂ care este EDITATĂ
    review = await prisma.storeReview.update({
      where: { id: existing.id },
      data: {
        rating,
        comment,
        status: "APPROVED",
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, name: true },
        },
      },
    });

    // dacă s-a schimbat ceva → log de editare
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
        console.error("StoreReviewEditLog create failed for review", review.id, logErr);
      }
    }

    // ❗ NU notificăm vendorul la edit normal (anti-spam)
    return res.json({ ok: true, review });
  } catch (e) {
    console.error("POST /api/store-reviews error", e);
    return res.status(500).json({ error: "store_review_create_failed" });
  }
});

/**
 * GET /api/store-reviews?vendorId=...
 * Listă recenzii pentru un magazin (profil).
 */
router.get("/store-reviews", async (req, res) => {
  try {
    const vendorId = String(req.query.vendorId || "").trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    if (!vendorId) {
      return res.status(400).json({ error: "invalid_vendor_id" });
    }

    const [total, reviews] = await Promise.all([
      prisma.storeReview.count({
        where: { vendorId, status: "APPROVED" },
      }),
      prisma.storeReview.findMany({
        where: { vendorId, status: "APPROVED" },
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
              avatarUrl: true, // ✅ există pe User
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
 * User marchează / demarchează recenzia ca "utilă"
 */
router.post("/store-reviews/:id/helpful", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const userId = req.user.sub;

    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    const existing = await prisma.storeReviewHelpful.findUnique({
      where: { reviewId_userId: { reviewId, userId } },
    });

    if (existing) {
      await prisma.storeReviewHelpful.delete({
        where: { reviewId_userId: { reviewId, userId } },
      });
      return res.json({ ok: true, helpful: false });
    }

    await prisma.storeReviewHelpful.create({
      data: { reviewId, userId },
    });

    return res.json({ ok: true, helpful: true });
  } catch (e) {
    console.error("POST /api/store-reviews/:id/helpful error", e);
    res.status(500).json({ error: "store_review_helpful_failed" });
  }
});

/**
 * User raportează o recenzie de profil (store).
 */
router.post("/store-reviews/:id/report", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const reason = String(req.body?.reason || "").trim();
    if (!reviewId || !reason) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const review = await prisma.storeReview.findUnique({ where: { id: reviewId } });
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
 * User își șterge propria recenzie
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
      select: { id: true, userId: true },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (review.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    await prisma.storeReview.delete({ where: { id: reviewId } });
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/store-reviews/:id error", e);
    res.status(500).json({ error: "store_review_delete_failed" });
  }
});

/**
 * Vendor adaugă / editează răspunsul la o recenzie de profil
 */
router.post("/vendor/store-reviews/:id/reply", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();
    const editorUserId = req.user.sub;

    if (!reviewId || !text) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      include: { vendor: true, reply: true },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    const existingReply = review.reply || null;

    const reply = await prisma.storeReviewReply.upsert({
      where: { reviewId },
      update: { text },
      create: {
        reviewId,
        vendorId: review.vendorId,
        text,
      },
    });

    // log edit reply (dacă exista reply și s-a schimbat)
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
        console.error("StoreReviewEditLog create failed for vendor reply", review.id, logErr);
      }
    }

    // 🔔 notifică CLIENTUL că vendorul a răspuns la recenzie
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
 * Vendor șterge răspunsul la recenzie de profil
 */
router.delete("/vendor/store-reviews/:id/reply", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_input" });
    }

    await prisma.storeReviewReply
      .delete({ where: { reviewId } })
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
 * „Comentariile” mele – recenzii de magazin (storeReview) scrise de mine
 */
router.get("/comments/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const where = { userId, status: "APPROVED" };

    const [total, items] = await Promise.all([
      prisma.storeReview.count({ where }),
      prisma.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          vendor: {
            // ✅ în schema ta Vendor are logoUrl, nu avatarUrl/slug
            select: {
              id: true,
              displayName: true,
              logoUrl: true,
            },
          },
        },
      }),
    ]);

    const mapped = items.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: r.vendor?.displayName || "Magazin",
      productUrl: r.vendor ? `/magazin/${r.vendor.id}` : null,
      image: r.vendor?.logoUrl || null,
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/comments/my error", e);
    res.status(500).json({ error: "comments_my_failed" });
  }
});

/**
 * GET /api/comments/received
 * Comentarii primite pe profilul de magazin al VENDOR-ului curent
 */
router.get("/comments/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      select: {
        id: true,
        displayName: true,
        logoUrl: true,
      },
    });

    if (!vendor) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const where = { vendorId: vendor.id, status: "APPROVED" };

    const [total, items] = await Promise.all([
      prisma.storeReview.count({ where }),
      prisma.storeReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, name: true },
          },
        },
      }),
    ]);

    const mapped = items.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: vendor.displayName || "Magazinul meu",
      productUrl: `/magazin/${vendor.id}`,
      image: vendor.logoUrl || null,
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/comments/received error", e);
    res.status(500).json({ error: "comments_received_failed" });
  }
});

export default router;
