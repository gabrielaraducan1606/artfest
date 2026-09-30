// src/api/productComments.routes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  notifyVendorOnProductCommentCreated,
  notifyUserOnProductCommentReply,
} from "../services/notifications.js";
import { deleteProductCommentWithReplies } from "../services/productCommentDelete.js";

const router = Router();

/*
 * Întrebări & comentarii la PRODUS (model Comment) - complet separat de
 * Reviews. Reguli:
 * - un mesaj principal (parentId = null) poate fi postat de orice user
 *   autentificat, în afară de proprietarul produsului, doar dacă produsul
 *   acceptă mesaje noi (activ, vizibil, aprobat);
 * - răspunsurile (parentId != null) sunt permise DOAR vendorului
 *   proprietar, un singur nivel (fără nesting), un singur răspuns oficial
 *   per întrebare (răspunsurile multiple vechi rămân afișate);
 * - public se afișează doar mesajele ACTIVE.
 */

function sanitizeText(s, max = 2000) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function loadProductForComments(userId, productId) {
  const [meVendor, prod] = await Promise.all([
    prisma.vendor.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        isActive: true,
        isHidden: true,
        moderationStatus: true,
        service: { select: { vendorId: true } },
      },
    }),
  ]);

  if (!prod) return { prod: null, owns: false, vendorId: meVendor?.id || null };
  const owns = !!meVendor && prod.service?.vendorId === meVendor.id;
  return { prod, owns, vendorId: meVendor?.id || null };
}

// produs inactiv / ascuns / neaprobat -> fără mesaje noi (lista rămâne vizibilă)
function productAcceptsNewComments(prod) {
  return (
    !!prod &&
    prod.isActive !== false &&
    prod.isHidden !== true &&
    prod.moderationStatus === "APPROVED"
  );
}

const COMMENT_INCLUDE = {
  user: {
    select: {
      firstName: true,
      lastName: true,
      name: true,
      email: true,
    },
  },
  vendor: { select: { displayName: true } },
};

function serializeComment(c) {
  return {
    id: c.id,
    productId: c.productId,
    text: c.text,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    userId: c.userId,
    parentId: c.parentId,
    vendorId: c.vendorId,
    isVendorReply: !!c.vendorId,
    // pentru răspunsurile vânzătorului: numele magazinului, nu numele personal
    userName: c.vendorId
      ? c.vendor?.displayName || "Vânzător"
      : c.user?.firstName || c.user?.lastName
      ? [c.user.firstName, c.user.lastName].filter(Boolean).join(" ")
      : c.user?.name || (c.user?.email ? c.user.email.split("@")[0] : "Client"),
  };
}

/* ========= PUBLIC: listă întrebări (cu răspunsurile lor) ========= */
// GET /api/public/product/:id/comments?skip=&take=&include=
//
// Paginare pe mesajele PRINCIPALE (cele mai noi primele); răspunsurile
// fiecărui mesaj vin împreună cu el (`replies`). `total` = nr. de mesaje
// principale ACTIVE.
//
// include=<commentId> (opțional): link direct (#comment-<id>, ex. din
// notificare). Dacă firul (întrebarea țintă sau întrebarea căreia îi
// aparține răspunsul țintă) nu e în pagina curentă, e întors separat în
// `target` - paginarea și `items` rămân neschimbate.
router.get("/public/product/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const skip = Math.max(parseInt(req.query.skip || "0", 10) || 0, 0);
    const take = Math.min(
      Math.max(parseInt(req.query.take || "20", 10) || 20, 1),
      50
    );
    const includeId = String(req.query.include || "").trim().slice(0, 64);

    const where = { productId: id, parentId: null, status: "ACTIVE" };

    const [total, questions, product] = await Promise.all([
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        include: COMMENT_INCLUDE,
      }),
      prisma.product.findUnique({
        where: { id },
        select: { isActive: true, isHidden: true, moderationStatus: true },
      }),
    ]);

    // firul țintă, doar dacă nu e deja în pagină
    let targetQuestion = null;
    if (includeId) {
      const targetComment = await prisma.comment.findFirst({
        where: { id: includeId, productId: id, status: "ACTIVE" },
        include: COMMENT_INCLUDE,
      });

      let root = targetComment;
      if (targetComment?.parentId) {
        root = await prisma.comment.findFirst({
          where: {
            id: targetComment.parentId,
            productId: id,
            parentId: null,
            status: "ACTIVE",
          },
          include: COMMENT_INCLUDE,
        });
      }

      if (root && !root.parentId && !questions.some((q) => q.id === root.id)) {
        targetQuestion = root;
      }
    }

    const questionIds = [
      ...questions.map((q) => q.id),
      ...(targetQuestion ? [targetQuestion.id] : []),
    ];

    const replies = questionIds.length
      ? await prisma.comment.findMany({
          where: { parentId: { in: questionIds }, status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: COMMENT_INCLUDE,
        })
      : [];

    const repliesByParent = new Map();
    for (const r of replies) {
      const arr = repliesByParent.get(r.parentId) || [];
      arr.push(serializeComment(r));
      repliesByParent.set(r.parentId, arr);
    }

    const toThread = (q) => ({
      ...serializeComment(q),
      replies: repliesByParent.get(q.id) || [],
    });

    res.json({
      total,
      skip,
      take,
      acceptsNewComments: productAcceptsNewComments(product),
      items: questions.map(toThread),
      target: targetQuestion ? toThread(targetQuestion) : null,
    });
  } catch (e) {
    console.error("GET /api/public/product/:id/comments error", e);
    res.status(500).json({ error: "comments_list_failed" });
  }
});

/* ========= USER: întrebare nouă / VENDOR: răspuns oficial ========= */
// POST /api/comments
router.post("/comments", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId, text, parentId } = req.body || {};

    if (!productId) return res.status(400).json({ error: "productId_required" });

    const cleanText = sanitizeText(text, 2000);
    if (!cleanText) return res.status(400).json({ error: "text_required" });

    const { prod, owns, vendorId } = await loadProductForComments(
      userId,
      String(productId)
    );
    if (!prod) return res.status(404).json({ error: "product_not_found" });

    const isReply = parentId != null && parentId !== "";

    if (isReply) {
      // răspunsurile sunt permise DOAR vendorului proprietar
      if (!owns) return res.status(403).json({ error: "reply_vendor_only" });

      const parent = await prisma.comment.findUnique({
        where: { id: String(parentId) },
        select: {
          id: true,
          productId: true,
          parentId: true,
          vendorId: true,
          status: true,
        },
      });

      if (!parent) return res.status(404).json({ error: "parent_comment_not_found" });
      if (parent.productId !== prod.id) {
        return res.status(400).json({ error: "parent_mismatch" });
      }
      if (parent.parentId) {
        return res.status(400).json({ error: "cannot_reply_to_reply" });
      }
      if (parent.vendorId) {
        return res.status(400).json({ error: "cannot_reply_to_vendor_comment" });
      }
      if (parent.status !== "ACTIVE") {
        return res.status(404).json({ error: "parent_comment_not_found" });
      }

      // un singur răspuns oficial per întrebare (orice status - un răspuns
      // ascuns de admin nu poate fi "ocolit" postând altul)
      const existingReply = await prisma.comment.findFirst({
        where: { parentId: parent.id, vendorId: { not: null } },
        select: { id: true },
      });
      if (existingReply) {
        return res.status(409).json({ error: "vendor_reply_exists" });
      }
    } else {
      if (owns) {
        return res.status(403).json({ error: "cannot_comment_own_product" });
      }
      if (!productAcceptsNewComments(prod)) {
        return res.status(409).json({ error: "product_not_accepting_comments" });
      }
    }

    const saved = await prisma.comment.create({
      data: {
        productId: prod.id,
        userId,
        text: cleanText,
        parentId: isReply ? String(parentId) : null,
        vendorId: isReply ? vendorId : null,
      },
      include: COMMENT_INCLUDE,
    });

    if (isReply) {
      // 🔔 clientul - vânzătorul i-a răspuns
      notifyUserOnProductCommentReply(saved.id).catch((e) => {
        console.warn("[notifyUserOnProductCommentReply] failed:", e);
      });
    } else {
      // 🔔 vendorul - întrebare nouă
      notifyVendorOnProductCommentCreated(saved.id).catch((e) => {
        console.warn("[notifyVendorOnProductCommentCreated] failed:", e);
      });
    }

    res.json({
      ok: true,
      comment: {
        ...serializeComment(saved),
        ...(isReply ? {} : { replies: [] }),
      },
    });
  } catch (e) {
    console.error("POST /api/comments error", e);
    res.status(500).json({ error: "comment_create_failed" });
  }
});

/* ========= AUTOR: editare (întrebare sau răspunsul vendorului) ========= */
// PATCH /api/comments/:id - fără notificări noi la editare
router.patch("/comments/:id", authRequired, async (req, res) => {
  try {
    const commentId = String(req.params.id || "").trim();
    const userId = req.user.sub;
    const text = sanitizeText(req.body?.text || "", 2000);

    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });
    if (!text) return res.status(400).json({ error: "text_required" });

    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, text: true, status: true },
    });

    if (!existing) return res.status(404).json({ error: "comment_not_found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "forbidden" });
    if (existing.status !== "ACTIVE") {
      return res.status(409).json({ error: "comment_not_active" });
    }

    let updated;
    if ((existing.text || "") === text) {
      updated = await prisma.comment.findUnique({
        where: { id: commentId },
        include: COMMENT_INCLUDE,
      });
    } else {
      [, updated] = await prisma.$transaction([
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
          include: COMMENT_INCLUDE,
        }),
      ]);
    }

    res.json({ ok: true, comment: serializeComment(updated) });
  } catch (e) {
    console.error("PATCH /api/comments/:id error", e);
    res.status(500).json({ error: "comment_update_failed" });
  }
});

/* ========= AUTOR: ștergere ========= */
// DELETE /api/comments/:id - ștergerea unei întrebări șterge și răspunsurile
router.delete("/comments/:id", authRequired, async (req, res) => {
  try {
    const commentId = String(req.params.id || "").trim();
    const userId = req.user.sub;

    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });

    const existing = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, parentId: true },
    });

    if (!existing) return res.status(404).json({ error: "comment_not_found" });
    if (existing.userId !== userId) return res.status(403).json({ error: "forbidden" });

    const { deletedReplies } = await deleteProductCommentWithReplies(
      prisma,
      existing
    );

    res.json({ ok: true, deletedReplies });
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
      select: { id: true, userId: true, status: true },
    });

    if (!existing || existing.status !== "ACTIVE") {
      return res.status(404).json({ error: "comment_not_found" });
    }

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
