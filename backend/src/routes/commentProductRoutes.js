// src/api/productComments.routes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  notifyVendorOnProductCommentCreated,
  notifyUserOnProductCommentReply,
} from "../services/notifications.js";

const router = Router();

function sanitizeText(s, max = 2000) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
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

  if (!prod) return { prod: null, owns: false, vendorId: meVendor?.id || null };
  const owns = !!meVendor && prod.service.vendorId === meVendor.id;
  return { prod, owns, vendorId: meVendor?.id || null };
}

/* ========= PUBLIC: listă comentarii la produs ========= */
// GET /api/public/product/:id/comments?skip=&take=
router.get("/public/product/:id/comments", async (req, res) => {
  const { id } = req.params;
  const skip = Math.max(parseInt(req.query.skip || "0", 10), 0);
  const take = Math.min(Math.max(parseInt(req.query.take || "50", 10), 1), 100);

  const where = { productId: id };

  const [total, items] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: "asc" },
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
        vendor: { select: { displayName: true } }, // ✅ vendor name pentru reply
      },
    }),
  ]);

  res.json({
    total,
    items: items.map((c) => ({
      id: c.id,
      productId: c.productId,       // ✅ util pentru reply submit din UI
      text: c.text,
      createdAt: c.createdAt,
      userId: c.userId,
      parentId: c.parentId,         // ✅ pentru thread UI
      vendorId: c.vendorId,         // ✅ pt badge/vendor reply
      isVendorReply: !!c.vendorId,  // ✅ helper pt UI
      userName: c.vendorId
        ? (c.vendor?.displayName || "Vânzător")
        : (c.user.firstName || c.user.lastName
            ? [c.user.firstName, c.user.lastName].filter(Boolean).join(" ")
            : c.user.name || c.user.email.split("@")[0]),
    })),
  });
});

/* ========= USER/VENDOR: creare comentariu sau reply ========= */
// POST /api/comments
router.post("/comments", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId, text, parentId } = req.body || {};

    if (!productId) return res.status(400).json({ error: "productId_required" });

    const cleanText = sanitizeText(text, 2000);
    if (!cleanText) return res.status(400).json({ error: "text_required" });

    const { prod, owns, vendorId } = await isVendorOwnerOfProduct(userId, productId);
    if (!prod) return res.status(404).json({ error: "product_not_found" });

    const isReply = !!parentId;

    // Vendor owner NU poate posta comentariu nou, doar reply
    if (owns && !isReply) {
      return res.status(403).json({ error: "cannot_comment_own_product" });
    }

    // Dacă owner răspunde, validează parent-ul
    if (owns && isReply) {
      const parent = await prisma.comment.findUnique({
        where: { id: String(parentId) },
        select: { id: true, productId: true, parentId: true, vendorId: true },
      });

      if (!parent) return res.status(404).json({ error: "parent_comment_not_found" });
      if (parent.productId !== productId) return res.status(400).json({ error: "parent_mismatch" });

      // recomandat: răspunde doar la comentarii top-level
      if (parent.parentId) return res.status(400).json({ error: "cannot_reply_to_reply" });

      // recomandat: nu răspunde la un reply de vendor
      if (parent.vendorId) return res.status(400).json({ error: "cannot_reply_to_vendor_comment" });
    }

    const saved = await prisma.comment.create({
      data: {
        productId,
        userId,
        text: cleanText,
        parentId: parentId || null,
        vendorId: owns ? vendorId : null, // ✅ doar reply-urile owner-ului au vendorId
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            name: true,
            email: true,
          },
        },
        vendor: { select: { displayName: true } },
      },
    });

    // 🔔 notifică vendorul doar când e comentariu de la user (nu când vendorul răspunde)
    if (!owns) {
      notifyVendorOnProductCommentCreated(saved.id).catch((e) => {
        console.warn("[notifyVendorOnProductCommentCreated] failed:", e);
      });
    }

    // 🔔 dacă e reply: notifică user-ul părinte (inclusiv pentru vendor reply)
    if (saved.parentId) {
      notifyUserOnProductCommentReply(saved.id).catch((e) => {
        console.warn("[notifyUserOnProductCommentReply] failed:", e);
      });
    }

    res.json({
      ok: true,
      comment: {
        id: saved.id,
        productId: saved.productId,
        text: saved.text,
        createdAt: saved.createdAt,
        userId: saved.userId,
        parentId: saved.parentId,
        vendorId: saved.vendorId,
        isVendorReply: !!saved.vendorId,
        userName: saved.vendorId
          ? (saved.vendor?.displayName || "Vânzător")
          : (saved.user.firstName || saved.user.lastName
              ? [saved.user.firstName, saved.user.lastName].filter(Boolean).join(" ")
              : saved.user.name || saved.user.email.split("@")[0]),
      },
    });
  } catch (e) {
    console.error("POST /api/comments error", e);
    res.status(500).json({ error: "comment_create_failed" });
  }
});

/* ========= USER: edit comentariu ========= */
// PATCH /api/comments/:id
router.patch("/comments/:id", authRequired, async (req, res) => {
  try {
    const commentId = String(req.params.id || "").trim();
    const userId = req.user.sub;
    const text = sanitizeText(req.body?.text || "", 2000);

    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });
    if (!text) return res.status(400).json({ error: "text_required" });

    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, text: true },
    });

    if (!existing) return res.status(404).json({ error: "comment_not_found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "forbidden" });

    // dacă nu s-a schimbat nimic, nu facem update
    if ((existing.text || "") === text) return res.json({ ok: true });

    await prisma.$transaction([
      prisma.commentEditLog.create({
        data: {
          commentId,
          editorId: userId,
          oldText: existing.text || "",
          newText: text,
          reason: "USER_EDIT",
        },
      }),
      prisma.comment.update({
        where: { id: commentId },
        data: { text },
      }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/comments/:id error", e);
    res.status(500).json({ error: "comment_update_failed" });
  }
});

/* ========= USER: ștergere comentariu ========= */
// DELETE /api/comments/:id
router.delete("/comments/:id", authRequired, async (req, res) => {
  try {
    const commentId = String(req.params.id || "").trim();
    const userId = req.user.sub;

    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });

    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });

    if (!existing) return res.status(404).json({ error: "comment_not_found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "forbidden" });

    await prisma.$transaction([
      prisma.commentReport.deleteMany({ where: { commentId } }),
      prisma.comment.delete({ where: { id: commentId } }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/comments/:id error", e);
    res.status(500).json({ error: "comment_delete_failed" });
  }
});

/* ========= USER: raportare comentariu ========= */
// POST /api/comments/:id/report
router.post("/comments/:id/report", authRequired, async (req, res) => {
  try {
    const commentId = String(req.params.id || "").trim();
    const userId = req.user.sub;
    const reason = sanitizeText(req.body?.reason || "", 300);

    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });
    if (!reason) return res.status(400).json({ error: "reason_required" });

    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });

    if (!existing) return res.status(404).json({ error: "comment_not_found" });

    if (existing.userId === userId) {
      return res.status(400).json({ error: "cannot_report_own_comment" });
    }

    const saved = await prisma.commentReport.upsert({
      where: {
        commentId_reporterId: {
          commentId,
          reporterId: userId,
        },
      },
      update: { reason },
      create: {
        commentId,
        reporterId: userId,
        reason,
      },
    });

    res.json({ ok: true, reportId: saved.id });
  } catch (e) {
    console.error("POST /api/comments/:id/report error", e);
    res.status(500).json({ error: "comment_report_failed" });
  }
});

export default router;
