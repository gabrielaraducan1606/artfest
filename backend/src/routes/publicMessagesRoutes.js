// backend/routes/publicContactRoutes.js
import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

// POST /public/contact-vendor
// body: { vendorId, name?, email?, phone?, userId?, message }
router.post("/contact-vendor", async (req, res) => {
  const { vendorId, name, email, phone, userId, message } = req.body || {};

  if (!vendorId) return res.status(400).json({ error: "vendorId lipsă" });
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: "Mesajul nu poate fi gol" });
  }

  // trebuie să știm cine e contactul:
  if (!userId && !email && !phone) {
    return res.status(400).json({
      error: "Lipsește identificatorul contactului (userId sau email sau phone)",
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

  const authorType = userId ? "USER" : "VISITOR";

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
