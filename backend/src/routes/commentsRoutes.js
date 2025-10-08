import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/**
 * POST /api/comments
 * body: { productId, text }
 * – blochează comentariile pentru propriul produs
 */
router.post("/comments", authRequired, async (req, res) => {
  const { productId, text } = req.body || {};
  if (!productId || !text?.trim()) {
    return res.status(400).json({ error: "invalid_input" });
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
    return res.status(403).json({ error: "cannot_comment_own_product" });
  }

  const saved = await prisma.comment.create({
    data: { productId, userId: req.user.sub, text: text.trim() },
  });

  res.json({ ok: true, comment: saved });
});

/** GET /api/public/product/:id/comments  (lista publică) */
router.get("/public/product/:id/comments", async (req, res) => {
  const { id } = req.params;
  const items = await prisma.comment.findMany({
    where: { productId: id },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { firstName: true, lastName: true, name: true, email: true } } },
  });

  const map = items.map((c) => ({
    id: c.id,
    text: c.text,
    createdAt: c.createdAt,
    userName:
      c.user.firstName || c.user.lastName
        ? [c.user.firstName, c.user.lastName].filter(Boolean).join(" ")
        : c.user.name || c.user.email.split("@")[0],
  }));

  res.json(map);
});

export default router;
