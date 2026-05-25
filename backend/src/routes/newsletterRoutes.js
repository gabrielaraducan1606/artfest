import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

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

router.get("/me/status", authRequired, async (req, res) => {
  try {
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        marketingOptIn: true,
      },
    });

    if (!user?.email) {
      return res.status(404).json({
        ok: false,
        error: "user_not_found",
      });
    }

    const email = user.email.trim().toLowerCase();

    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { email },
      select: {
        id: true,
        status: true,
      },
    });

    return res.json({
      ok: true,
      loggedIn: true,
      email,
      subscribed:
        user.marketingOptIn === true ||
        subscriber?.status === "SUBSCRIBED",
    });
  } catch (e) {
    console.error("GET /api/newsletter/me/status error:", e);

    return res.status(500).json({
      ok: false,
      error: "newsletter_status_failed",
    });
  }
});

export default router;