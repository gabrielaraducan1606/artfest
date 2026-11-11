// backend/src/routes/productContactRoutes.js
//
// POST /api/product-contact/threads - „Ai întrebări? Întreabă vânzătorul”
// din pagina produsului. DOAR autentificat; utilizatorul vine din token,
// vânzătorul din produs (nu din body). Conversația e una per
// client + produs (conversațiile existente nu sunt atinse), cu motivul
// contactării. Sesizările de siguranță deschid un tichet către Admin și nu
// consumă cota lunară de mesaje a vânzătorului.
import express from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { moderateMarketplaceMessage } from "../services/marketplaceMessageModeration.js";
import { createUserNotification, createVendorNotification } from "../services/notifications.js";
import { queueNewMessageEmail } from "../services/messageEmailNotifications.js";
import {
  PRODUCT_CONTACT_LIMITS,
  PRODUCT_CONTACT_MESSAGE_MAX,
  PRODUCT_CONTACT_MESSAGE_MIN,
  SAFETY_TICKET_CATEGORY,
  buildSafetyTicketBody,
  contactReasonLabel,
  isProductContactSchemaMissing,
  isSafetyReason,
  normalizeContactReason,
  publicProductWhere,
} from "../lib/productContact.js";

const router = express.Router();
router.use(authRequired, enforceTokenVersion);

const CLIENT_MESSAGE_ID_REGEX = /^[A-Za-z0-9_-]{1,100}$/;
const TECHNICAL_MODERATION_REASONS = new Set([
  "text_moderation_failed",
  "text_moderation_invalid_response",
  "text_moderation_ambiguous_response",
]);

const HOUR = 60 * 60 * 1000;

function isClientMessageIdConflict(err) {
  if (!err || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return (
    fields.some((f) => String(f).toLowerCase().includes("threadid")) &&
    fields.some((f) => String(f).toLowerCase().includes("clientmessageid"))
  );
}

function tooMany(res, message) {
  return res.status(429).json({ error: "rate_limited", message });
}

async function checkRateLimits(userId, { artfestOnly, now }) {
  const L = PRODUCT_CONTACT_LIMITS;
  if (artfestOnly) {
    const tickets = await prisma.supportTicket.count({
      where: { requesterId: userId, category: SAFETY_TICKET_CATEGORY, createdAt: { gte: new Date(now - HOUR) } },
    });
    return tickets >= L.artfestOnlyPerHour;
  }
  const [hourThreads, dayThreads, recentMessages] = await Promise.all([
    prisma.messageThread.count({ where: { userId, productId: { not: null }, createdAt: { gte: new Date(now - HOUR) } } }),
    prisma.messageThread.count({ where: { userId, productId: { not: null }, createdAt: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.message.count({ where: { authorUserId: userId, authorType: "USER", createdAt: { gte: new Date(now - 10 * 60 * 1000) } } }),
  ]);
  return hourThreads >= L.newThreadsPerHour || dayThreads >= L.newThreadsPerDay || recentMessages >= L.messagesPer10Min;
}

/*
 * Tichet Admin pentru o sesizare de siguranță: unul per conversație
 * (mesajele ulterioare se adaugă la același tichet) sau unul nou pentru o
 * sesizare trimisă doar către Artfest. Adminii primesc notificare.
 */
async function escalateSafety({ userId, requesterName, product, storeName, threadId, existingTicketId, message, artfestOnly }) {
  const body = buildSafetyTicketBody({ product, storeName, threadId, message, artfestOnly });
  const now = new Date();
  let ticketId = existingTicketId || null;
  let supportMessageId = null;

  if (ticketId) {
    const sm = await prisma.supportMessage.create({
      data: { ticketId, authorId: userId, body, system: false },
      select: { id: true },
    });
    supportMessageId = sm.id;
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { lastMessageAt: now, lastRequesterMessageAt: now, status: "OPEN", archivedByAdminAt: null },
    });
  } else {
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: `Siguranța produsului: ${product.title || "produs"}`.slice(0, 190),
        category: SAFETY_TICKET_CATEGORY,
        status: "OPEN",
        priority: "HIGH",
        audience: "USER",
        requesterId: userId,
        requesterName: requesterName || null,
        lastMessageAt: now,
        lastRequesterMessageAt: now,
        messages: { create: { body, authorId: userId, system: false } },
      },
      select: { id: true, subject: true, messages: { select: { id: true }, take: 1 } },
    });
    ticketId = ticket.id;
    supportMessageId = ticket.messages?.[0]?.id || ticket.id;
  }

  if (threadId) {
    await prisma.messageThread.update({
      where: { id: threadId },
      data: { supportTicketId: ticketId, safetyEscalatedAt: now },
    });
  }

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
    take: 50,
  });
  const link = `/admin/support?${new URLSearchParams({ ticket: ticketId }).toString()}`;
  await Promise.all(
    (admins || []).map((admin) =>
      createUserNotification(admin.id, {
        dedupeKey: `product_safety:${supportMessageId}:${admin.id}`,
        type: "support",
        title: `Sesizare de siguranță: „${product.title || "produs"}”`,
        body: String(message || "").slice(0, 160),
        link,
        meta: { kind: "product_safety", productId: product.id, ticketId, threadId: threadId || null },
      }).catch((e) => {
        console.error("[productContact] notificare admin:", e?.message || e);
        return null;
      })
    )
  );

  return { ticketId };
}

router.post("/threads", async (req, res) => {
  const userId = req.user?.sub;
  const { productId, reason: rawReason, message, clientMessageId: rawClientMessageId, artfestOnly: rawArtfestOnly } =
    req.body || {};

  const reason = normalizeContactReason(rawReason);
  if (!reason) return res.status(400).json({ error: "invalid_reason", message: "Alege motivul contactării." });

  if (typeof productId !== "string" || !productId.trim() || productId.length > 64) {
    return res.status(400).json({ error: "invalid_product" });
  }

  const text = typeof message === "string" ? message.trim() : "";
  if (text.length < PRODUCT_CONTACT_MESSAGE_MIN) {
    return res.status(400).json({ error: "message_too_short", message: "Scrie întrebarea ta (minimum 5 caractere)." });
  }
  if (text.length > PRODUCT_CONTACT_MESSAGE_MAX) {
    return res.status(400).json({ error: "message_too_long", message: `Maximum ${PRODUCT_CONTACT_MESSAGE_MAX} de caractere.` });
  }

  let clientMessageId = null;
  if (rawClientMessageId !== undefined && rawClientMessageId !== null) {
    if (typeof rawClientMessageId !== "string" || !CLIENT_MESSAGE_ID_REGEX.test(rawClientMessageId)) {
      return res.status(400).json({ error: "invalid_client_message_id" });
    }
    clientMessageId = rawClientMessageId;
  }

  const artfestOnly = rawArtfestOnly === true;
  if (artfestOnly && !isSafetyReason(reason)) {
    return res.status(400).json({ error: "artfest_only_requires_safety" });
  }

  try {
    const product = await prisma.product.findFirst({
      where: publicProductWhere(productId.trim()),
      select: {
        id: true,
        title: true,
        serviceId: true,
        service: {
          select: {
            vendorId: true,
            profile: { select: { displayName: true } },
            vendor: { select: { userId: true, displayName: true } },
          },
        },
      },
    });

    if (!product?.service?.vendorId) {
      return res.status(404).json({ error: "product_not_found", message: "Produsul nu este disponibil." });
    }
    if (product.service.vendor?.userId && String(product.service.vendor.userId) === String(userId)) {
      return res.status(403).json({ error: "own_product", message: "Nu poți trimite întrebări propriului produs." });
    }

    const vendorId = product.service.vendorId;
    const storeName = product.service.profile?.displayName || product.service.vendor?.displayName || "Magazin";

    // retry al aceluiași mesaj (dublu-click / rețea): răspuns idempotent, fără efecte noi
    if (clientMessageId && !artfestOnly) {
      const existing = await prisma.message.findFirst({
        where: { clientMessageId, authorUserId: userId, thread: { productId: product.id, userId } },
        select: { id: true, threadId: true, createdAt: true },
      });
      if (existing) {
        return res.status(201).json({
          ok: true,
          threadId: existing.threadId,
          messageId: existing.id,
          reason,
          deliveredToVendor: true,
          duplicate: true,
          link: `/cont/mesaje?threadId=${encodeURIComponent(existing.threadId)}`,
        });
      }
    }

    const now = Date.now();
    if (await checkRateLimits(userId, { artfestOnly, now })) {
      return tooMany(res, "Ai trimis multe întrebări într-un timp scurt. Încearcă din nou puțin mai târziu.");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const requesterName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

    // Doar către Artfest (sesizare de siguranță): nu ajunge la vânzător.
    if (artfestOnly) {
      const { ticketId } = await escalateSafety({
        userId, requesterName, product, storeName, threadId: null, existingTicketId: null, message: text, artfestOnly: true,
      });
      return res.status(201).json({ ok: true, threadId: null, reason, escalated: true, deliveredToVendor: false, ticketId });
    }

    const moderation = await moderateMarketplaceMessage({ text, senderType: "USER" });
    if (!moderation?.allowed) {
      const technical = TECHNICAL_MODERATION_REASONS.has(moderation?.reason);

      if (technical && isSafetyReason(reason)) {
        // Sesizarea de siguranță nu se pierde: ajunge la Artfest chiar dacă verificarea automată e indisponibilă.
        const { ticketId } = await escalateSafety({
          userId, requesterName, product, storeName, threadId: null, existingTicketId: null, message: text, artfestOnly: true,
        });
        return res.status(202).json({
          ok: true, threadId: null, reason, escalated: true, deliveredToVendor: false, ticketId,
          message: "Verificarea automată a mesajelor este momentan indisponibilă. Sesizarea ta a fost trimisă echipei Artfest.",
        });
      }

      return res.status(technical ? 503 : 422).json({
        error: technical ? "moderation_unavailable" : "message_blocked",
        reason: moderation?.reason || "not_allowed",
        detections: moderation?.detections || [],
        canSendToArtfest: !technical && isSafetyReason(reason),
        message: technical
          ? "Mesajul nu a putut fi verificat momentan și nu a fost trimis. Încearcă din nou peste câteva secunde."
          : "Mesajul nu poate fi trimis vânzătorului deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
      });
    }

    let out;
    try {
      out = await prisma.$transaction(async (tx) => {
        let thread = await tx.messageThread.findFirst({
          where: { userId, vendorId, productId: product.id, type: "CUSTOMER" },
          orderBy: { createdAt: "desc" },
          select: { id: true, contactReason: true, supportTicketId: true, deletedByUserAt: true },
        });

        if (!thread) {
          thread = await tx.messageThread.create({
            data: {
              userId,
              vendorId,
              serviceId: product.serviceId || null,
              productId: product.id,
              contactReason: reason,
              contactName: requesterName,
              contactEmail: null,
              contactPhone: null,
            },
            select: { id: true, contactReason: true, supportTicketId: true, deletedByUserAt: true },
          });
        }

        const msg = await tx.message.create({
          data: { threadId: thread.id, vendorId, authorType: "USER", authorUserId: userId, body: text, clientMessageId },
          select: { id: true, body: true, createdAt: true },
        });

        // SAFETY rămâne SAFETY (nu se „retrogradează” la o întrebare obișnuită)
        const nextReason = isSafetyReason(thread.contactReason) ? thread.contactReason : reason;
        await tx.messageThread.update({
          where: { id: thread.id },
          data: {
            lastMsg: msg.body,
            lastAt: msg.createdAt,
            userLastReadAt: new Date(),
            contactReason: nextReason,
            deletedByUserAt: null,
            archivedByUser: false,
            deletedByVendorAt: null,
            archived: false,
          },
        });

        return { thread: { ...thread, contactReason: nextReason }, msg };
      });
    } catch (e) {
      if (clientMessageId && isClientMessageIdConflict(e)) {
        const existing = await prisma.message.findFirst({
          where: { clientMessageId, authorUserId: userId },
          select: { id: true, threadId: true },
        });
        if (existing) {
          return res.status(201).json({ ok: true, threadId: existing.threadId, messageId: existing.id, reason, deliveredToVendor: true, duplicate: true });
        }
      }
      throw e;
    }

    const { thread, msg } = out;

    try {
      await createVendorNotification(vendorId, {
        type: "message",
        title: isSafetyReason(reason)
          ? `Sesizare de siguranță: „${product.title || "produs"}”`
          : `Întrebare despre „${product.title || "produs"}”`,
        body: `${contactReasonLabel(reason)}: ${msg.body.slice(0, 120)}`,
        link: `/mesaje?threadId=${thread.id}`,
        threadId: thread.id,
        meta: { kind: "product_contact", productId: product.id, reason },
      });
    } catch (e) {
      console.error("[productContact] notificare vânzător:", e?.message || e);
    }

    queueNewMessageEmail(msg.id);

    let escalated = false;
    if (isSafetyReason(reason)) {
      try {
        await escalateSafety({
          userId, requesterName, product, storeName, threadId: thread.id,
          existingTicketId: thread.supportTicketId || null, message: text, artfestOnly: false,
        });
        escalated = true;
      } catch (e) {
        // mesajul a ajuns la vânzător și conversația rămâne marcată SAFETY (vizibilă în filtre)
        console.error("[productContact] escaladare Admin eșuată:", e?.message || e);
      }
    }

    return res.status(201).json({
      ok: true,
      threadId: thread.id,
      messageId: msg.id,
      reason,
      deliveredToVendor: true,
      escalated,
      link: `/cont/mesaje?threadId=${encodeURIComponent(thread.id)}`,
    });
  } catch (e) {
    if (isProductContactSchemaMissing(e)) {
      // prima interogare pe coloanele noi rulează ÎNAINTEA oricărei scrieri: nimic nu a fost salvat
      console.error("[productContact] lipsesc coloanele noi (migrația 20261111120000 / prisma generate):", e?.code || e?.name);
      return res.status(503).json({
        error: "feature_unavailable",
        message: "Trimiterea întrebărilor nu este încă disponibilă. Încearcă din nou mai târziu.",
      });
    }
    console.error("[productContact] eroare:", e?.message || e);
    return res.status(500).json({
      error: "server_error",
      message: "Nu am putut trimite mesajul. Încearcă din nou în câteva secunde.",
    });
  }
});

export default router;
