// server/routes/productReviews.routes.js
import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/* ===== R2 (Cloudflare) config ===== */

const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL; // ex: https://cdn.artfest.ro

if (!R2_BUCKET_NAME || !R2_ACCOUNT_ID) {
  console.warn(
    "[productReviews.routes] R2_BUCKET_NAME sau R2_ACCOUNT_ID lipsesc din env. Upload-ul de imagini recenzii nu va funcționa."
  );
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Key în bucket: reviews/<reviewId>/<timestamp>-<random>-<safe-name>.jpg
 */
function makeR2Key(reviewId, originalName = "image.jpg") {
  const random = crypto.randomBytes(8).toString("hex");
  const safeName = originalName
    .toLowerCase()
    .replace(/[^a-z0-9\.\-_]+/gi, "-")
    .slice(0, 80);

  return `reviews/${reviewId}/${Date.now()}-${random}-${safeName}`;
}

/**
 * URL public al fișierului
 * Dacă R2_PUBLIC_BASE_URL = https://cdn.artfest.ro,
 * rezultatul va fi: https://cdn.artfest.ro/<key>
 */
function makeR2PublicUrl(key) {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
  }
  // fallback direct din R2, dacă nu ai custom domain
  return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${key}`;
}

/* ===== Multer – upload imagini recenzii produs (în memorie) ===== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
});

/* ===== Helpers ===== */
function sanitizeText(s, max = 2000) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requireRole(roleOrRoles) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return async (req, res, next) => {
    try {
      const me = await prisma.user.findUnique({
        where: { id: req.user?.sub },
        select: { id: true, role: true },
      });
      if (!me) return res.status(401).json({ error: "unauthorized" });
      if (!roles.includes(me.role))
        return res.status(403).json({ error: "forbidden" });
      req.me = me;
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireVendor(mandatory = false) {
  return async (req, res, next) => {
    try {
      const v = await prisma.vendor.findUnique({
        where: { userId: req.user?.sub },
        select: { id: true },
      });
      if (mandatory && !v) {
        return res.status(403).json({ error: "vendor_only" });
      }
      req.vendorId = v?.id || null;
      next();
    } catch (e) {
      next(e);
    }
  };
}

async function isVendorOwnerOfProduct(userId, productId) {
  const [meVendor, prod] = await Promise.all([
    prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.product.findUnique({
      where: { id: productId },
      include: { service: { select: { vendorId: true } } },
    }),
  ]);
  if (!prod)
    return { prod: null, owns: false, vendorId: meVendor?.id || null };
  const owns = !!meVendor && prod.service.vendorId === meVendor.id;
  return { prod, owns, vendorId: meVendor?.id || null };
}

async function recalcProductStats(productId) {
  const approved = await prisma.review.findMany({
    where: { productId, status: "APPROVED" },
    select: { rating: true },
  });
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of approved) counts[r.rating] = (counts[r.rating] || 0) + 1;

  const total = approved.length;
  const sum =
    1 * counts[1] +
    2 * counts[2] +
    3 * counts[3] +
    4 * counts[4] +
    5 * counts[5];
  const avg = total ? (sum / total).toFixed(2) : "0.00";

  await prisma.productRatingStats.upsert({
    where: { productId },
    update: {
      avg,
      c1: counts[1],
      c2: counts[2],
      c3: counts[3],
      c4: counts[4],
      c5: counts[5],
    },
    create: {
      productId,
      avg,
      c1: counts[1],
      c2: counts[2],
      c3: counts[3],
      c4: counts[4],
      c5: counts[5],
    },
  });
}

/* ===== Public – recenzii de PRODUS ===== */

// GET /api/public/product/:id/reviews?sort=&skip=&take=&verified=&star=
router.get("/public/product/:id/reviews", async (req, res) => {
  const { id } = req.params;
  const sort = String(req.query.sort || "relevant");
  const skip = Math.max(parseInt(req.query.skip || "0", 10), 0);
  const take = Math.min(Math.max(parseInt(req.query.take || "20", 10), 1), 50);
  const verified = req.query.verified === "1";
  const star = Math.max(parseInt(req.query.star || "0", 10), 0);

  const orderBy =
    sort === "recent"
      ? [{ createdAt: "desc" }]
      : sort === "rating_desc"
      ? [{ rating: "desc" }]
      : sort === "rating_asc"
      ? [{ rating: "asc" }]
      : [{ helpful: { _count: "desc" } }, { createdAt: "desc" }];

  const where = {
    productId: id,
    status: "APPROVED",
    ...(verified ? { verified: true } : {}),
    ...(star >= 1 && star <= 5 ? { rating: star } : {}),
  };

  const [items, total, stats] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            name: true,
            email: true,
          },
        },
        _count: { select: { helpful: true } },
        reply: { select: { text: true, createdAt: true } },
        images: { select: { id: true, url: true } },
      },
    }),
    prisma.review.count({ where }),
    prisma.productRatingStats.findUnique({ where: { productId: id } }),
  ]);

  res.json({
    total,
    stats: stats || { avg: "0.00", c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 },
    items: items.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment || "",
      createdAt: r.createdAt,
      helpfulCount: r._count.helpful,
      verified: r.verified,
      reply: r.reply || null,
      images:
        r.images?.map((img) => ({
          id: img.id,
          url: img.url,
        })) || [],
      userName:
        r.user.firstName || r.user.lastName
          ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ")
          : r.user.name || r.user.email.split("@")[0],
      userId: r.userId, // util dacă vrei să recunoști recenzia userului curent pe front
    })),
  });
});

// GET /api/public/product/:id/reviews/average
router.get("/public/product/:id/reviews/average", async (req, res) => {
  const { id } = req.params;
  const stats = await prisma.productRatingStats.findUnique({
    where: { productId: id },
  });
  if (!stats) return res.json({ average: 0, count: 0 });
  const count = stats.c1 + stats.c2 + stats.c3 + stats.c4 + stats.c5;
  res.json({ average: Number(stats.avg), count });
});

/* ===== User actions – scriere + helpful + report pentru PRODUS ===== */

// POST /api/reviews  (cu imagini) – CU LOGICĂ NOUĂ PENTRU EDIT-LOG & RECENZII MODERATE
router.post(
  "/reviews",
  authRequired,
  upload.array("images", 5),
  async (req, res) => {
    try {
      const { productId, rating, comment } = req.body || {};
      const userId = req.user.sub;

      if (!productId) {
        return res.status(400).json({ error: "productId_required" });
      }

      const r = parseInt(rating, 10);
      if (!Number.isFinite(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: "invalid_rating" });
      }

      // mic rate-limit: max 10 recenzii / 24h
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const count24h = await prisma.review.count({
        where: { userId, createdAt: { gte: since } },
      });
      if (count24h >= 10) {
        return res.status(429).json({ error: "rate_limited" });
      }

      const cleanComment = sanitizeText(comment);

      // blocăm link-uri suspecte foarte scurte
      if (/https?:\/\//i.test(cleanComment) && cleanComment.length < 60) {
        return res.status(400).json({ error: "suspicious_content" });
      }

      // nu lăsăm vendorul să-și recenzeze propriul produs
      const { prod, owns } = await isVendorOwnerOfProduct(userId, productId);
      if (!prod) {
        return res.status(404).json({ error: "product_not_found" });
      }
      if (owns) {
        return res
          .status(403)
          .json({ error: "cannot_review_own_product" });
      }

      // badge „verificat” dacă userul a avut o comandă cu acest produs
      const hasCompleted = await prisma.order.findFirst({
        where: {
          userId,
          status: { in: ["PAID", "FULFILLED"] },
          shipments: { some: { items: { some: { productId } } } },
        },
        select: { id: true },
      });

      // verificăm dacă există deja recenzie (pentru log de editare / moderare)
      const existing = await prisma.review.findUnique({
        where: { productId_userId: { productId, userId } },
        select: {
          id: true,
          rating: true,
          comment: true,
          status: true,
          createdAt: true,
        },
      });

      const now = new Date();
      let saved;

      if (!existing) {
        // 🌱 NU există recenzie → creare simplă
        saved = await prisma.review.create({
          data: {
            productId,
            userId,
            rating: r,
            comment: cleanComment,
            verified: !!hasCompleted,
            status: "APPROVED",
          },
        });
      } else {
        // există recenzie anterioară
        const isModeratedStatus =
          existing.status === "REJECTED" || existing.status === "HIDDEN";

        if (isModeratedStatus) {
          // 🧹 recenzie moderată anterior → o tratăm ca una NOUĂ
          saved = await prisma.review.update({
            where: { id: existing.id },
            data: {
              rating: r,
              comment: cleanComment,
              verified: !!hasCompleted,
              status: "APPROVED",
              createdAt: now,
              updatedAt: now,
            },
          });
        } else {
          // ✏️ caz normal: recenzie APROBATĂ care este EDITATĂ
          saved = await prisma.review.update({
            where: { id: existing.id },
            data: {
              rating: r,
              comment: cleanComment,
              verified: !!hasCompleted,
              status: "APPROVED", // rămâne / revine aprobată
            },
          });

          // dacă s-a schimbat ceva → log de editare
          if (
            existing.rating !== r ||
            (existing.comment || "") !== (cleanComment || "")
          ) {
            try {
              // aflăm rolul editorului (USER / VENDOR / ADMIN)
              const editorUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
              });

              let reason = "USER_EDIT";
              if (editorUser?.role === "VENDOR") {
                reason = "VENDOR_EDIT";
              } else if (editorUser?.role === "ADMIN") {
                reason = "ADMIN_EDIT";
              }

              await prisma.productReviewEditLog.create({
                data: {
                  reviewId: saved.id,
                  editorId: userId,
                  oldRating: existing.rating,
                  newRating: r,
                  oldComment: existing.comment,
                  newComment: cleanComment,
                  reason,
                },
              });
            } catch (logErr) {
              console.error(
                "ProductReviewEditLog create failed for review",
                saved.id,
                logErr
              );
            }
          }
        }
      }

      // gestionare imagini – ștergem vechile și urcăm noile imagini în R2
      if (req.files && req.files.length) {
        // ștergem referințele vechi din DB (nu și din R2 – cleanup separat, dacă vrei)
        await prisma.reviewImage.deleteMany({ where: { reviewId: saved.id } });

        const uploaded = [];

        for (const file of req.files) {
          if (!file.buffer || !R2_BUCKET_NAME) continue;

          const key = makeR2Key(saved.id, file.originalname || "image.jpg");

          const putCmd = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || "image/jpeg",
            // pentru R2 public bucket poți lăsa sau scoate ACL, nu contează
          });

          try {
            await r2.send(putCmd);
            uploaded.push({
              reviewId: saved.id,
              url: makeR2PublicUrl(key),
            });
          } catch (uploadErr) {
            console.error(
              "R2 upload failed for review image",
              saved.id,
              uploadErr
            );
          }
        }

        if (uploaded.length) {
          await prisma.reviewImage.createMany({ data: uploaded });
        }
      }

      // recalculează stats produs
      await recalcProductStats(productId);

      const full = await prisma.review.findUnique({
        where: { id: saved.id },
        include: {
          images: { select: { id: true, url: true } },
        },
      });

      return res.json({ ok: true, review: full });
    } catch (e) {
      console.error("POST /api/reviews error", e);
      return res
        .status(500)
        .json({ error: "product_review_create_failed" });
    }
  }
);

// POST /api/reviews/:id/helpful
router.post("/reviews/:id/helpful", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.reviewHelpful.create({
      data: { reviewId: id, userId: req.user.sub },
    });
  } catch {
    // ignore duplicate
  }
  res.json({ ok: true });
});

// POST /api/reviews/:id/report
router.post("/reviews/:id/report", authRequired, async (req, res) => {
  const { id } = req.params;
  const reason = sanitizeText(req.body?.reason || "", 300);
  if (!reason) return res.status(400).json({ error: "reason_required" });

  await prisma.reviewReport.create({
    data: { reviewId: id, reporterId: req.user.sub, reason },
  });

  res.json({ ok: true });
});

/* ===== Vendor actions – reply la recenzie PRODUS ===== */

// POST /api/vendor/reviews/:id/reply
router.post(
  "/vendor/reviews/:id/reply",
  authRequired,
  requireVendor(true),
  async (req, res) => {
    const { id } = req.params;
    const text = sanitizeText(req.body?.text || "", 1000);
    if (!text) return res.status(400).json({ error: "invalid_input" });

    const review = await prisma.review.findUnique({
      where: { id },
      include: { product: { include: { service: true } } },
    });
    if (!review) return res.status(404).json({ error: "not_found" });
    if (review.product.service.vendorId !== req.vendorId) {
      return res.status(403).json({ error: "not_vendor_owner" });
    }

    const reply = await prisma.reviewReply.upsert({
      where: { reviewId: id },
      update: { text },
      create: { reviewId: id, vendorId: req.vendorId, text },
    });

    res.json({ ok: true, reply });
  }
);

// DELETE /api/vendor/reviews/:id/reply
router.delete(
  "/vendor/reviews/:id/reply",
  authRequired,
  requireVendor(true),
  async (req, res) => {
    const { id } = req.params;

    const review = await prisma.review.findUnique({
      where: { id },
      include: { product: { include: { service: true } } },
    });
    if (!review) return res.status(404).json({ error: "not_found" });
    if (review.product.service.vendorId !== req.vendorId) {
      return res.status(403).json({ error: "not_vendor_owner" });
    }

    await prisma.reviewReply.delete({ where: { reviewId: id } });
    res.json({ ok: true });
  }
);

/* ===== Admin pentru recenzii PRODUS ===== */

// PATCH /api/admin/reviews/:id/status
router.patch(
  "/admin/reviews/:id/status",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const { id } = req.params;
    const status = String(req.body?.status || "").toUpperCase();
    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ error: "invalid_status" });
    }

    const r = await prisma.review.update({
      where: { id },
      data: { status },
      select: { productId: true },
    });

    await recalcProductStats(r.productId);
    res.json({ ok: true });
  }
);

// DELETE /api/admin/reviews/:id
router.delete(
  "/admin/reviews/:id",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const { id } = req.params;
    const existing = await prisma.review.findUnique({
      where: { id },
      select: { productId: true },
    });
    if (!existing) return res.json({ ok: true });

    await prisma.$transaction([
      prisma.reviewHelpful.deleteMany({ where: { reviewId: id } }),
      prisma.reviewReport.deleteMany({ where: { reviewId: id } }),
      prisma.reviewReply.deleteMany({ where: { reviewId: id } }),
      prisma.reviewImage.deleteMany({ where: { reviewId: id } }),
      prisma.review.delete({ where: { id } }),
    ]);

    await recalcProductStats(existing.productId);
    res.json({ ok: true });
  }
);
/* ================== LISTE PENTRU CONT UTILIZATOR ================== */
/**
 * GET /api/reviews/my
 * Recenziile mele de produs (USER)
 * query: page, limit
 */
router.get("/reviews/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      prisma.review.count({
        where: { userId },
      }),
      prisma.review.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
          images: { select: { url: true } },
        },
      }),
    ]);

    const mapped = items.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: r.product?.title || "Produs",
      productUrl: r.product ? `/produs/${r.product.id}` : null,
      image:
        (r.images && r.images[0]?.url) ||
        (Array.isArray(r.product?.images) ? r.product.images[0] : null) ||
        null,
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/reviews/my error", e);
    res.status(500).json({ error: "reviews_my_failed" });
  }
});

/**
 * GET /api/reviews/received
 * Recenzii primite pentru produsele unui VENDOR
 * query: page, limit
 */
router.get("/reviews/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    // aflăm vendorId pentru user
    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const where = {
      status: "APPROVED",
      product: {
        service: { vendorId: vendor.id },
      },
    };

    const [total, items] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
          images: { select: { url: true } },
        },
      }),
    ]);

    const mapped = items.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      rating: r.rating,
      text: r.comment || "",
      productTitle: r.product?.title || "Produs",
      productUrl: r.product ? `/produs/${r.product.id}` : null,
      image:
        (r.images && r.images[0]?.url) ||
        (Array.isArray(r.product?.images) ? r.product.images[0] : null) ||
        null,
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/reviews/received error", e);
    res.status(500).json({ error: "reviews_received_failed" });
  }
});
/**
 * DELETE /api/reviews/:id
 * User își șterge propria recenzie de PRODUS
 */
router.delete("/reviews/:id", authRequired, async (req, res) => {
  try {
    const reviewId = String(req.params.id || "").trim();
    const userId = req.user.sub;

    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, userId: true, productId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (existing.userId !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }

    await prisma.$transaction([
      prisma.reviewHelpful.deleteMany({ where: { reviewId } }),
      prisma.reviewReport.deleteMany({ where: { reviewId } }),
      prisma.reviewReply.deleteMany({ where: { reviewId } }),
      prisma.reviewImage.deleteMany({ where: { reviewId } }),
      prisma.review.delete({ where: { id: reviewId } }),
    ]);

    // recalculează stats produs
    await recalcProductStats(existing.productId);

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/reviews/:id error", e);
    res.status(500).json({ error: "product_review_delete_failed" });
  }
});

export default router;
