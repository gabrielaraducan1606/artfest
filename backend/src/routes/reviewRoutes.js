import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/**
 * POST /api/reviews
 * body: { productId, rating (1-5), comment? }
 * – blochează recenziile pentru propriul produs
 * – upsert: 1 recenzie / user / produs
 */
router.post("/reviews", authRequired, async (req, res) => {
  const { productId, rating, comment } = req.body || {};
  if (!productId) return res.status(400).json({ error: "productId_required" });

  const r = parseInt(rating, 10);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: "invalid_rating" });
  }

  const prod = await prisma.product.findUnique({
    where: { id: productId },
    include: { service: { select: { vendorId: true } } },
  });
  if (!prod) return res.status(404).json({ error: "product_not_found" });

  const meVendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  if (meVendor && prod.service.vendorId === meVendor.id) {
    return res.status(403).json({ error: "cannot_review_own_product" });
  }

  const saved = await prisma.review.upsert({
    where: { productId_userId: { productId, userId: req.user.sub } },
    update: { rating: r, comment: (comment || "").trim() || null },
    create: { productId, userId: req.user.sub, rating: r, comment: (comment || "").trim() || null },
  });

  res.json({ ok: true, review: saved });
});

/** GET /api/public/product/:id/reviews  (lista publică) */
router.get("/public/product/:id/reviews", async (req, res) => {
  const { id } = req.params;
  const items = await prisma.review.findMany({
    where: { productId: id },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { firstName: true, lastName: true, name: true, email: true } } },
  });

  const map = items.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment || "",
    createdAt: r.createdAt,
    userName:
      r.user.firstName || r.user.lastName
        ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ")
        : r.user.name || r.user.email.split("@")[0],
  }));

  res.json(map);
});

/** GET /api/public/product/:id/reviews/average */
router.get("/public/product/:id/reviews/average", async (req, res) => {
  const { id } = req.params;
  const [agg, count] = await Promise.all([
    prisma.review.aggregate({ where: { productId: id }, _avg: { rating: true } }),
    prisma.review.count({ where: { productId: id } }),
  ]);
  res.json({ average: agg._avg.rating || 0, count });
});

export default router;
