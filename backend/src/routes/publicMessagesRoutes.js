// backend/routes/publicContactRoutes.js
import express from "express";
import { PrismaClient } from "@prisma/client";
import { moderateMarketplaceMessage } from "../services/marketplaceMessageModeration.js";

const prisma = new PrismaClient();
const router = express.Router();

const MAX_MESSAGE_LENGTH = 5000;

// POST /public/contact-vendor
// body: { vendorId, name?, email?, phone?, userId?, message }
router.post("/contact-vendor", async (req, res) => {
  const { vendorId, name, email, phone, userId, message } = req.body || {};

  if (!vendorId) return res.status(400).json({ error: "vendorId lipsă" });
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  if (String(message).length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: "Mesajul este prea lung. Maxim 5000 de caractere.",
    });
  }

  // trebuie să știm cine e contactul:
  if (!userId && !email && !phone) {
    return res.status(400).json({
      error: "Lipsește identificatorul contactului (userId sau email sau phone)",
    });
  }

  const authorType = userId ? "USER" : "VISITOR";

  const moderation = await moderateMarketplaceMessage({
    text: message,
    senderType: authorType,
  });

  if (!moderation.allowed) {
    const technicalReasons = new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

    const isTechnicalError = technicalReasons.has(moderation.reason);

    return res.status(isTechnicalError ? 503 : 422).json({
      error: isTechnicalError ? "moderation_unavailable" : "message_blocked",
      reason: moderation.reason || "not_allowed",
      detections: moderation.detections || [],
      message: isTechnicalError
        ? "Mesajul nu a putut fi verificat momentan și nu a fost trimis. Încearcă din nou peste câteva secunde."
        : "Mesajul nu poate fi trimis deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
    });
  }

  // găsim thread existent pentru același contact sau creăm unul nou
  const whereBase = { vendorId };
  const existing = await prisma.messageThread.findFirst({
    where: {
      ...whereBase,
      OR: [
        userId ? { userId } : undefined,
        email ? { contactEmail: email } : undefined,
        phone ? { contactPhone: phone } : undefined,
      ].filter(Boolean),
    },
  });

  const thread =
    existing ||
    (await prisma.messageThread.create({
      data: {
        vendorId,
        userId: userId || null,
        contactName: name || null,
        contactEmail: email || null,
        contactPhone: phone || null,
      },
    }));

  const msg = await prisma.message.create({
    data: {
      threadId: thread.id,
      body: String(message).trim(),
      authorType,
      authorUserId: userId || null,
      authorName: !userId ? name || "Vizitator" : null,
    },
  });

  await prisma.messageThread.update({
    where: { id: thread.id },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      // vendorLastReadAt neschimbat -> are necitite
    },
  });

  res.status(201).json({ ok: true, threadId: thread.id });
});

export default router;
