import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

const router = Router();

const SubscribeSchema = z.object({
  email: z.string().email(),
  source: z
    .enum(["FOOTER", "ADMIN", "IMPORT", "CHECKOUT", "CONTACT", "OTHER"])
    .optional(),
  sourceLabel: z.string().optional(),
});

router.post("/subscribe", async (req, res) => {
  try {
    const parsed = SubscribeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    const item = await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: {
        status: "SUBSCRIBED",
        unsubscribedAt: null,
        source: parsed.data.source || "FOOTER",
        sourceLabel: parsed.data.sourceLabel || null,
        userId: existingUser?.id ?? null,
      },
      create: {
        email,
        status: "SUBSCRIBED",
        source: parsed.data.source || "FOOTER",
        sourceLabel: parsed.data.sourceLabel || null,
        userId: existingUser?.id ?? null,
      },
    });

    if (existingUser?.id) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { marketingOptIn: true },
      });
    }

    return res.json({
      ok: true,
      item: {
        id: item.id,
        email: item.email,
        status: item.status,
      },
    });
  } catch (e) {
    console.error("POST /api/newsletter/subscribe error:", e);
    return res.status(500).json({
      ok: false,
      error: "newsletter_subscribe_failed",
    });
  }
});

export default router;