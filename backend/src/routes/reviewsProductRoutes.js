// backend/src/routes/productReviews.routes.js
import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../db.js";
import { authRequired, optionalAuth } from "../api/auth.js";
import {
  notifyVendorOnProductReviewCreated,
  notifyUserOnProductReviewReply, // notifică clientul când vendor răspunde la review produs
} from "../services/notifications.js";

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

/*
 * Ca sanitizeText, dar păstrează rândurile/paragrafele (folosit pentru
 * răspunsul vânzătorului, afișat cu white-space: pre-wrap): normalizează
 * CRLF, elimină caracterele de control, comprimă spațiile din interiorul
 * rândului și maxim o linie goală între paragrafe. Textul e afișat de
 * React ca text simplu (escapat), nu ca HTML.
 */
function sanitizeMultilineText(s, max = 2000) {
  return String(s || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();
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

const PUBLIC_REVIEW_INCLUDE = {
  user: {
    select: {
      firstName: true,
      lastName: true,
      name: true,
      email: true,
    },
  },
  _count: { select: { helpful: true } },
  reply: {
    select: {
      text: true,
      createdAt: true,
      updatedAt: true,
      vendor: { select: { displayName: true } },
    },
  },
  images: { select: { id: true, url: true } },
};

function serializePublicReview(r, likedIds) {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment || "",
    createdAt: r.createdAt,
    helpfulCount: r._count.helpful,
    verified: r.verified,
    likedByMe: likedIds.has(r.id),
    reply: r.reply
      ? {
          text: r.reply.text,
          createdAt: r.reply.createdAt,
          updatedAt: r.reply.updatedAt,
          vendorName: r.reply.vendor?.displayName || null,
        }
      : null,
    images:
      r.images?.map((img) => ({
        id: img.id,
        url: img.url,
      })) || [],
    userName:
      r.user.firstName || r.user.lastName
        ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ")
        : r.user.name || r.user.email.split("@")[0],
    userId: r.userId,
  };
}

// GET /api/public/product/:id/reviews?sort=&skip=&take=&verified=&star=&include=
//
// include=<reviewId> (opțional): link direct către o recenzie (ex. notificarea
// "Vânzătorul a răspuns...", /produs/:id#rev-<id>). Dacă recenzia nu e în
// pagina curentă, e întoarsă separat în `target` (doar dacă aparține acestui
// produs și e APPROVED) - paginarea, `items` și `total` rămân neschimbate.
router.get("/public/product/:id/reviews", optionalAuth, async (req, res) => {
  const { id } = req.params;
  const includeId = String(req.query.include || "").trim().slice(0, 64);
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
      include: PUBLIC_REVIEW_INCLUDE,
    }),
    prisma.review.count({ where }),
    prisma.productRatingStats.findUnique({ where: { productId: id } }),
  ]);

  // Recenzia țintă, doar dacă nu e deja în pagina curentă. Filtrele de
  // listă (verified/star) nu se aplică - linkul cere explicit acea recenzie.
  let target = null;
  if (includeId && !items.some((r) => r.id === includeId)) {
    target = await prisma.review.findFirst({
      where: { id: includeId, productId: id, status: "APPROVED" },
      include: PUBLIC_REVIEW_INCLUDE,
    });
  }

  // likedByMe - calculat pe server pentru userul autentificat, ca starea
  // butonului "Utilă" să rămână corectă după refresh.
  const viewerId = req.user?.sub || null;
  const likedIds = new Set();
  const reviewIds = [...items, ...(target ? [target] : [])].map((r) => r.id);
  if (viewerId && reviewIds.length) {
    const liked = await prisma.reviewHelpful.findMany({
      where: { userId: viewerId, reviewId: { in: reviewIds } },
      select: { reviewId: true },
    });
    for (const l of liked) likedIds.add(l.reviewId);
  }

  res.json({
    total,
    stats: stats || { avg: "0.00", c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 },
    items: items.map((r) => serializePublicReview(r, likedIds)),
    target: target ? serializePublicReview(target, likedIds) : null,
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

        // 🔔 notifică vendorul DOAR la recenzie nouă
        notifyVendorOnProductReviewCreated(saved.id).catch((e) => {
          console.warn("[notifyVendorOnProductReviewCreated] failed:", e);
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

          // 🔔 notifică vendorul (tratăm ca recenzie nouă)
          notifyVendorOnProductReviewCreated(saved.id).catch((e) => {
            console.warn("[notifyVendorOnProductReviewCreated] failed:", e);
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

          // ❗ nu notificăm vendorul la edit normal (anti-spam)
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
// Autorul recenziei și vendorul produsului NU pot vota "Utilă" (verificat
// aici, nu doar ascuns în UI). Voturile existente rămân neatinse.
router.post("/reviews/:id/helpful", authRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const userId = req.user.sub;

    const review = await prisma.review.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
        product: { select: { service: { select: { vendorId: true } } } },
      },
    });

    if (!review || review.status !== "APPROVED") {
      return res.status(404).json({ error: "review_not_found" });
    }

    if (review.userId === userId) {
      return res.status(403).json({ error: "cannot_vote_own_review" });
    }

    const meVendor = await prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    });
    const productVendorId = review.product?.service?.vendorId || null;

    if (meVendor && productVendorId && meVendor.id === productVendorId) {
      return res.status(403).json({ error: "vendor_cannot_vote_own_product" });
    }

    try {
      await prisma.reviewHelpful.create({
        data: { reviewId: id, userId },
      });
    } catch (e) {
      // vot duplicat - ignorăm
      if (e?.code !== "P2002") throw e;
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/reviews/:id/helpful error", e);
    return res.status(500).json({ error: "helpful_create_failed" });
  }
});

// DELETE /api/reviews/:id/helpful
router.delete("/reviews/:id/helpful", authRequired, async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.reviewHelpful.deleteMany({
      where: {
        reviewId: id,
        userId: req.user.sub,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/reviews/:id/helpful error", e);
    return res.status(500).json({ error: "helpful_delete_failed" });
  }
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

    await recalcProductStats(existing.productId);

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/reviews/:id error", e);
    res.status(500).json({ error: "product_review_delete_failed" });
  }
});

/* ===== Vendor actions – reply la recenzie PRODUS ===== */

/*
 * Un singur răspuns oficial per recenzie (ReviewReply.reviewId @unique),
 * separat complet de ProductComment (Întrebări & comentarii).
 *
 * Verifică: review existent, produs existent, vendorul logat e
 * proprietarul produsului. Întoarce { review } sau { status, error }.
 */
async function loadReviewForVendorReply(reviewId, vendorId) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      status: true,
      product: { select: { id: true, service: { select: { vendorId: true } } } },
      reply: { select: { id: true, vendorId: true } },
    },
  });

  if (!review) return { status: 404, error: "not_found" };
  if (!review.product) return { status: 404, error: "product_not_found" };
  if (review.product.service?.vendorId !== vendorId) {
    return { status: 403, error: "not_vendor_owner" };
  }

  return { review };
}

const REPLY_VENDOR_INCLUDE = { vendor: { select: { displayName: true } } };

// Aceeași formă ca `reply` din GET /public/product/:id/reviews.
function serializeReply(reply) {
  return {
    text: reply.text,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    vendorName: reply.vendor?.displayName || null,
  };
}

// POST /api/vendor/reviews/:id/reply
router.post(
  "/vendor/reviews/:id/reply",
  authRequired,
  requireVendor(true),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const text = sanitizeMultilineText(req.body?.text || "", 1000);
      if (!text) return res.status(400).json({ error: "invalid_input" });

      const { review, status, error } = await loadReviewForVendorReply(
        id,
        req.vendorId
      );
      if (error) return res.status(status).json({ error });

      if (review.status !== "APPROVED") {
        return res.status(409).json({ error: "review_not_approved" });
      }

      if (review.reply && review.reply.vendorId !== req.vendorId) {
        return res.status(403).json({ error: "not_reply_owner" });
      }

      const reply = await prisma.reviewReply.upsert({
        where: { reviewId: id },
        update: { text },
        create: { reviewId: id, vendorId: req.vendorId, text },
        include: REPLY_VENDOR_INCLUDE,
      });

      // 🔔 notifică CLIENTUL - doar la primul răspuns (dedupeKey per
      // review în notifyUserOnProductReviewReply), nu la editări.
      if (!review.reply) {
        notifyUserOnProductReviewReply(review.id).catch((e) => {
          console.warn("[notifyUserOnProductReviewReply] failed:", e);
        });
      }

      res.json({ ok: true, reply: serializeReply(reply) });
    } catch (e) {
      console.error("POST /api/vendor/reviews/:id/reply error", e);
      res.status(500).json({ error: "review_reply_failed" });
    }
  }
);

// DELETE /api/vendor/reviews/:id/reply
router.delete(
  "/vendor/reviews/:id/reply",
  authRequired,
  requireVendor(true),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();

      const { review, status, error } = await loadReviewForVendorReply(
        id,
        req.vendorId
      );
      if (error) return res.status(status).json({ error });

      if (!review.reply) {
        return res.status(404).json({ error: "reply_not_found" });
      }
      if (review.reply.vendorId !== req.vendorId) {
        return res.status(403).json({ error: "not_reply_owner" });
      }

      await prisma.reviewReply.delete({ where: { reviewId: id } });
      res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /api/vendor/reviews/:id/reply error", e);
      res.status(500).json({ error: "review_reply_delete_failed" });
    }
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
 */
router.get("/reviews/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
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
 */
router.get("/reviews/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) {
      return res.json({ total: 0, page: 1, limit: 10, items: [] });
    }

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
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

// PATCH /api/vendor/reviews/:id/reply
router.patch(
  "/vendor/reviews/:id/reply",
  authRequired,
  requireVendor(true),
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const text = sanitizeMultilineText(req.body?.text || "", 1000);
      if (!text) return res.status(400).json({ error: "invalid_input" });

      const { review, status, error } = await loadReviewForVendorReply(
        id,
        req.vendorId
      );
      if (error) return res.status(status).json({ error });

      if (!review.reply) {
        return res.status(404).json({ error: "reply_not_found" });
      }
      if (review.reply.vendorId !== req.vendorId) {
        return res.status(403).json({ error: "not_reply_owner" });
      }

      // editare - fără notificare nouă către client
      const reply = await prisma.reviewReply.update({
        where: { reviewId: id },
        data: { text },
        include: REPLY_VENDOR_INCLUDE,
      });

      res.json({ ok: true, reply: serializeReply(reply) });
    } catch (e) {
      console.error("PATCH /api/vendor/reviews/:id/reply error", e);
      res.status(500).json({ error: "review_reply_update_failed" });
    }
  }
);
// GET /api/product-comments/my
router.get("/product-comments/my", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const where = {
      userId,
      // dacă vrei strict “comentarii”: doar cele cu text
      comment: { not: "" },
    };

    const [total, items] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          product: { select: { id: true, title: true, images: true } },
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
      kind: "PRODUCT_COMMENT",
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/product-comments/my error", e);
    res.status(500).json({ error: "product_comments_my_failed" });
  }
});

// GET /api/product-comments/received (pt vendor: comentarii la produse din magazinul lui)
router.get("/product-comments/received", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vendor) return res.json({ total: 0, page: 1, limit: 10, items: [] });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    const where = {
      status: "APPROVED",
      comment: { not: "" }, // dacă vrei strict “comentarii”
      product: { service: { vendorId: vendor.id } },
    };

    const [total, items] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          product: { select: { id: true, title: true, images: true } },
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
      kind: "PRODUCT_COMMENT",
    }));

    res.json({ total, page, limit, items: mapped });
  } catch (e) {
    console.error("GET /api/product-comments/received error", e);
    res.status(500).json({ error: "product_comments_received_failed" });
  }
});
/**
 * GET /api/vendors/me/reviews/kpi
 * KPI recenzii produs + magazin pentru dashboard vendor
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
        data: {
          product: 0,
          store: 0,
          byService: {},
        },
      });
    }

    const serviceIds = vendor.services.map((s) => s.id);

    if (!serviceIds.length) {
      return res.json({
        ok: true,
        data: {
          product: 0,
          store: 0,
          byService: {},
        },
      });
    }

    const [storeGroups, productReviews] = await Promise.all([
      prisma.storeReview.groupBy({
        by: ["serviceId"],
        where: {
          status: "APPROVED",
          serviceId: { in: serviceIds },
        },
        _count: { _all: true },
      }),

      prisma.review.findMany({
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
      }),
    ]);

    const byService = {};

    for (const serviceId of serviceIds) {
      byService[serviceId] = {
        product: 0,
        store: 0,
      };
    }

    let storeTotal = 0;
    let productTotal = 0;

    for (const g of storeGroups) {
      const count = g._count._all || 0;

      byService[g.serviceId] ??= { product: 0, store: 0 };
      byService[g.serviceId].store += count;

      storeTotal += count;
    }

    for (const r of productReviews) {
      const serviceId = r.product?.serviceId;
      if (!serviceId) continue;

      byService[serviceId] ??= { product: 0, store: 0 };
      byService[serviceId].product += 1;

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
    return res.status(500).json({ error: "reviews_kpi_failed" });
  }
});
export default router;
