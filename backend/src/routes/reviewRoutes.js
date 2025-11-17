import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/* ===== Helpers ===== */
function sanitizeText(s, max = 2000) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function requireRole(roleOrRoles) {
  const roles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return async (req, res, next) => {
    try {
      const me = await prisma.user.findUnique({ where: { id: req.user?.sub }, select: { id: true, role: true } });
      if (!me) return res.status(401).json({ error: "unauthorized" });
      if (!roles.includes(me.role)) return res.status(403).json({ error: "forbidden" });
      req.me = me; next();
    } catch (e) { next(e); }
  };
}
function requireVendor(mandatory = false) {
  return async (req, res, next) => {
    try {
      const v = await prisma.vendor.findUnique({ where: { userId: req.user?.sub }, select: { id: true } });
      if (mandatory && !v) return res.status(403).json({ error: "vendor_only" });
      req.vendorId = v?.id || null; next();
    } catch (e) { next(e); }
  };
}
async function isVendorOwnerOfProduct(userId, productId) {
  const [meVendor, prod] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId }, select: { id: true } }),
    prisma.product.findUnique({ where: { id: productId }, include: { service: { select: { vendorId: true } } } }),
  ]);
  if (!prod) return { prod: null, owns: false, vendorId: meVendor?.id || null };
  const owns = !!meVendor && prod.service.vendorId === meVendor.id;
  return { prod, owns, vendorId: meVendor?.id || null };
}
async function recalcStats(productId) {
  const approved = await prisma.review.findMany({ where: { productId, status: "APPROVED" }, select: { rating: true } });
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of approved) counts[r.rating] = (counts[r.rating] || 0) + 1;
  const total = approved.length;
  const sum = 1 * counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5];
  const avg = total ? (sum / total).toFixed(2) : "0.00";
  await prisma.productRatingStats.upsert({
    where: { productId },
    update: { avg, c1: counts[1], c2: counts[2], c3: counts[3], c4: counts[4], c5: counts[5] },
    create: { productId, avg, c1: counts[1], c2: counts[2], c3: counts[3], c4: counts[4], c5: counts[5] },
  });
}

/* ===== Public ===== */
router.get("/public/product/:id/reviews", async (req, res) => {
  const { id } = req.params;
  const sort = String(req.query.sort || "relevant");
  const skip = Math.max(parseInt(req.query.skip || "0", 10), 0);
  const take = Math.min(Math.max(parseInt(req.query.take || "20", 10), 1), 50);
  const verified = req.query.verified === "1";
  const star = Math.max(parseInt(req.query.star || "0", 10), 0);

  const orderBy =
    sort === "recent" ? [{ createdAt: "desc" }] :
    sort === "rating_desc" ? [{ rating: "desc" }] :
    sort === "rating_asc" ? [{ rating: "asc" }] :
    [{ helpful: { _count: "desc" } }, { createdAt: "desc" }];

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
        user: { select: { firstName: true, lastName: true, name: true, email: true } },
        _count: { select: { helpful: true } },
        reply: { select: { text: true, createdAt: true } },
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
      userName:
        r.user.firstName || r.user.lastName
          ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ")
          : r.user.name || r.user.email.split("@")[0],
    })),
  });
});

router.get("/public/product/:id/reviews/average", async (req, res) => {
  const { id } = req.params;
  const stats = await prisma.productRatingStats.findUnique({ where: { productId: id } });
  if (!stats) return res.json({ average: 0, count: 0 });
  const count = stats.c1 + stats.c2 + stats.c3 + stats.c4 + stats.c5;
  res.json({ average: Number(stats.avg), count });
});

/* ===== User actions ===== */
router.post("/reviews", authRequired, async (req, res) => {
  const { productId, rating, comment } = req.body || {};
  if (!productId) return res.status(400).json({ error: "productId_required" });
  const r = parseInt(rating, 10);
  if (!Number.isFinite(r) || r < 1 || r > 5) return res.status(400).json({ error: "invalid_rating" });

  // mic rate-limit: max 10 recenzii / 24h
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const count24h = await prisma.review.count({ where: { userId: req.user.sub, createdAt: { gte: since } } });
  if (count24h >= 10) return res.status(429).json({ error: "rate_limited" });

  // anti link-spam pentru comentarii foarte scurte
  const cleanComment = sanitizeText(comment);
  if (/https?:\/\//i.test(cleanComment) && cleanComment.length < 60) {
    return res.status(400).json({ error: "suspicious_content" });
  }

  const { prod, owns } = await isVendorOwnerOfProduct(req.user.sub, productId);
  if (!prod) return res.status(404).json({ error: "product_not_found" });
  if (owns) return res.status(403).json({ error: "cannot_review_own_product" });

  const hasCompleted = await prisma.order.findFirst({
    where: {
      userId: req.user.sub,
      status: { in: ["PAID", "FULFILLED"] },
      shipments: { some: { items: { some: { productId } } } },
    },
    select: { id: true },
  });

  const autoApprove = !!hasCompleted; // verified => APPROVED
  const saved = await prisma.review.upsert({
    where: { productId_userId: { productId, userId: req.user.sub } },
    update: { rating: r, comment: cleanComment, verified: !!hasCompleted, status: autoApprove ? "APPROVED" : "PENDING" },
    create: { productId, userId: req.user.sub, rating: r, comment: cleanComment, verified: !!hasCompleted, status: autoApprove ? "APPROVED" : "PENDING" },
  });

  if (autoApprove) await recalcStats(productId);
  res.json({ ok: true, review: saved });
});

router.post("/reviews/:id/helpful", authRequired, async (req, res) => {
  const { id } = req.params;
  try { await prisma.reviewHelpful.create({ data: { reviewId: id, userId: req.user.sub } }); } catch {}
  res.json({ ok: true });
});

router.post("/reviews/:id/report", authRequired, async (req, res) => {
  const { id } = req.params;
  const reason = sanitizeText(req.body?.reason || "", 300);
  if (!reason) return res.status(400).json({ error: "reason_required" });
  await prisma.reviewReport.create({ data: { reviewId: id, reporterId: req.user.sub, reason } });
  res.json({ ok: true });
});

/* ===== Vendor actions ===== */
router.post("/reviews/:id/reply", authRequired, requireVendor(true), async (req, res) => {
  const { id } = req.params;
  const text = sanitizeText(req.body?.text || "", 1000);
  if (!text) return res.status(400).json({ error: "invalid_input" });

  const review = await prisma.review.findUnique({ where: { id }, include: { product: { include: { service: true } } } });
  if (!review) return res.status(404).json({ error: "not_found" });
  if (review.product.service.vendorId !== req.vendorId) return res.status(403).json({ error: "not_vendor_owner" });

  const reply = await prisma.reviewReply.upsert({ where: { reviewId: id }, update: { text }, create: { reviewId: id, vendorId: req.vendorId, text } });
  res.json({ ok: true, reply });
});

router.delete("/reviews/:id/reply", authRequired, requireVendor(true), async (req, res) => {
  const { id } = req.params;
  const review = await prisma.review.findUnique({ where: { id }, include: { product: { include: { service: true } } } });
  if (!review) return res.status(404).json({ error: "not_found" });
  if (review.product.service.vendorId !== req.vendorId) return res.status(403).json({ error: "not_vendor_owner" });
  await prisma.reviewReply.delete({ where: { reviewId: id } });
  res.json({ ok: true });
});

/* ===== Admin ===== */
router.patch("/admin/reviews/:id/status", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || "").toUpperCase();
  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) return res.status(400).json({ error: "invalid_status" });
  const r = await prisma.review.update({ where: { id }, data: { status }, select: { productId: true } });
  await recalcStats(r.productId);
  res.json({ ok: true });
});

router.delete("/admin/reviews/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.review.findUnique({ where: { id }, select: { productId: true } });
  if (!existing) return res.json({ ok: true });
  await prisma.$transaction([
    prisma.reviewHelpful.deleteMany({ where: { reviewId: id } }),
    prisma.reviewReport.deleteMany({ where: { reviewId: id } }),
    prisma.reviewReply.deleteMany({ where: { reviewId: id } }),
    prisma.review.delete({ where: { id } }),
  ]);
  await recalcStats(existing.productId);
  res.json({ ok: true });
});

export default router;
