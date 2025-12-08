// routes/comments.routes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/* Helpers */
function sanitizeText(s, max = 1000) {
  const noHtml = String(s || "").replace(/<[^>]*>/g, "");
  return noHtml.replace(/\s+/g, " ").trim().slice(0, max);
}
function nowMinus(ms) {
  return new Date(Date.now() - ms);
}
function displayName(u) {
  if (!u) return "Utilizator";
  if (u.firstName || u.lastName)
    return [u.firstName, u.lastName].filter(Boolean).join(" ");
  return u.name || (u.email ? u.email.split("@")[0] : "Utilizator");
}
function buildTree(items) {
  const byId = new Map(items.map((c) => [c.id, { ...c, replies: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId).replies.push(c);
    } else {
      roots.push(c);
    }
  }
  const sortDesc = (a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt);
  roots.sort(sortDesc);
  for (const r of roots) r.replies.sort(sortDesc);
  return roots;
}

/* ===== Create ===== */
// POST /api/comments { productId, text, parentId? }
router.post("/comments", authRequired, async (req, res) => {
  const { productId, text, parentId } = req.body || {};
  const clean = sanitizeText(text);
  if (!productId || !clean)
    return res.status(400).json({ error: "invalid_input" });

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
    return res
      .status(403)
      .json({ error: "cannot_comment_own_product" });
  }

  const since24h = nowMinus(24 * 3600 * 1000);
  const countTotal = await prisma.comment.count({
    where: { userId: req.user.sub, createdAt: { gte: since24h } },
  });
  if (countTotal > 50)
    return res.status(429).json({ error: "rate_limited" });

  const countPerProduct = await prisma.comment.count({
    where: {
      userId: req.user.sub,
      productId,
      createdAt: { gte: since24h },
    },
  });
  if (countPerProduct > 10)
    return res.status(429).json({ error: "rate_limited_product" });

  if (/https?:\/\//i.test(clean) && clean.length < 60) {
    return res.status(400).json({ error: "suspicious_content" });
  }

  const since2m = nowMinus(2 * 60 * 1000);
  const duplicate = await prisma.comment.findFirst({
    where: {
      userId: req.user.sub,
      productId,
      text: clean,
      createdAt: { gte: since2m },
    },
    select: { id: true },
  });
  if (duplicate) return res.status(409).json({ error: "duplicate" });

  if (parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { productId: true },
    });
    if (!parent || parent.productId !== productId) {
      return res.status(400).json({ error: "invalid_parent" });
    }
  }

  const saved = await prisma.comment.create({
    data: {
      productId,
      userId: req.user.sub,
      text: clean,
      parentId: parentId || null,
    },
  });

  res.json({ ok: true, comment: saved });
});

/* ===== Read (threaded) ===== */
// GET /api/public/product/:id/comments?skip=&take=&mode=thread|flat
router.get("/public/product/:id/comments", async (req, res) => {
  const { id } = req.params;
  const mode = (req.query.mode || "thread").toString();
  const skip = Math.max(parseInt(req.query.skip || "0", 10), 0);
  const take = Math.min(Math.max(parseInt(req.query.take || "20", 10), 1), 50);

  const totalRoots = await prisma.comment.count({
    where: { productId: id, parentId: null },
  });

  const parents = await prisma.comment.findMany({
    where: { productId: id, parentId: null },
    orderBy: { createdAt: "desc" },
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
    },
  });

  const parentIds = parents.map((p) => p.id);

  const replies = parentIds.length
    ? await prisma.comment.findMany({
        where: { productId: id, parentId: { in: parentIds } },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              name: true,
              email: true,
            },
          },
        },
      })
    : [];

  const all = [...parents, ...replies];

  const shaped = all.map((c) => ({
    id: c.id,
    text: c.text,
    createdAt: c.createdAt,
    parentId: c.parentId,
    userName: displayName(c.user),
  }));

  if (mode === "flat") {
    shaped.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    return res.json({ total: totalRoots, items: shaped });
  }

  const tree = buildTree(shaped);
  res.json({ total: totalRoots, items: tree });
});

/* ===== Report ===== */
// POST /api/comments/:id/report
router.post("/comments/:id/report", authRequired, async (req, res) => {
  const { id } = req.params;
  const reason = sanitizeText(req.body?.reason || "", 300);
  if (!reason) return res.status(400).json({ error: "reason_required" });

  // aici ai folosit RequestLog în codul original; îl las așa
  await prisma.requestLog.create({
    data: {
      idempotencyKey: `comment-report:${id}:${req.user.sub}:${Date.now()}`,
      responseJson: { commentId: id, userId: req.user.sub, reason },
    },
  });

  res.json({ ok: true });
});

/* ===== Edit ===== */
// PATCH /api/comments/:id
router.patch("/comments/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const text = sanitizeText(req.body?.text || "", 1000);
  if (!text) return res.status(400).json({ error: "invalid_input" });

  const comment = await prisma.comment.findUnique({ where: { id } });
  if (!comment) return res.status(404).json({ error: "not_found" });

  const me = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { role: true, id: true },
  });
  const isOwner = comment.userId === me.id;
  const within15 =
    Date.now() -
      new Date(comment.createdAt).getTime() <
    15 * 60 * 1000;

  if (!(me.role === "ADMIN" || (isOwner && within15))) {
    return res.status(403).json({ error: "forbidden" });
  }

  const updated = await prisma.comment.update({
    where: { id },
    data: { text },
  });
  res.json({ ok: true, comment: updated });
});

/* ===== Delete ===== */
// DELETE /api/comments/:id
router.delete("/comments/:id", authRequired, async (req, res) => {
  const { id } = req.params;

  const comment = await prisma.comment.findUnique({ where: { id } });
  if (!comment) return res.json({ ok: true });

  const me = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { role: true, id: true },
  });
  const isOwner = comment.userId === me.id;
  const within24h =
    Date.now() -
      new Date(comment.createdAt).getTime() <
    24 * 3600 * 1000;

  if (!(me.role === "ADMIN" || (isOwner && within24h))) {
    return res.status(403).json({ error: "forbidden" });
  }

  await prisma.comment.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
