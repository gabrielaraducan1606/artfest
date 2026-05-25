import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

const router = Router();

const NewsletterSourceEnum = z.enum([
  "FOOTER",
  "HOME_MODAL",
  "ADMIN",
  "IMPORT",
  "CHECKOUT",
  "CONTACT",
  "OTHER",
]);

const SubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  source: NewsletterSourceEnum.optional().default("FOOTER"),
  sourceLabel: z.string().trim().max(120).optional().nullable(),
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

    const { email, source, sourceLabel } = parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    const item = await prisma.newsletterSubscriber.upsert({
      where: { email },
      update: {
        status: "SUBSCRIBED",
        unsubscribedAt: null,
        source,
        sourceLabel: sourceLabel || null,
        userId: existingUser?.id ?? null,
      },
      create: {
        email,
        status: "SUBSCRIBED",
        source,
        sourceLabel: sourceLabel || null,
        userId: existingUser?.id ?? null,
      },
    });

    if (existingUser?.id) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          marketingOptIn: true,
        },
      });
    }

    return res.json({
      ok: true,
      item: {
        id: item.id,
        email: item.email,
        status: item.status,
        source: item.source,
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