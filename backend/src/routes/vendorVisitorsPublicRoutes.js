// ./src/routes/vendorVisitorsPublicRoutes.js
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * POST /api/visitors/track — înregistrează PAGEVIEW/CTA_CLICK/MESSAGE (PUBLIC)
 */
router.post("/track", async (req, res) => {
  const schema = z.object({
    vendorId: z.string().min(1),
    type: z.enum(["PAGEVIEW", "CTA_CLICK", "MESSAGE"]),
    pageUrl: z.string().optional(),
    ctaLabel: z.string().optional(),
    referrer: z.string().optional(),
    sessionId: z.string().optional(),
    userAgent: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_payload" });

  try {
    const d = parsed.data;

    await prisma.event.create({
      data: {
        vendorId: d.vendorId,
        type: d.type,
        pageUrl: d.pageUrl,
        ctaLabel: d.ctaLabel,
        referrer: d.referrer,
        sessionId: d.sessionId,
        userAgent: d.userAgent || req.headers["user-agent"]?.toString(),
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/visitors/track error", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/visitors/search — log public al căutărilor interne (PUBLIC)
 */
router.post("/search", async (req, res) => {
  const schema = z.object({
    vendorId: z.string().min(1),
    query: z.string().min(1),
    hits: z.number().int().min(1).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_payload" });

  try {
    await prisma.search.create({
      data: {
        vendorId: parsed.data.vendorId,
        query: parsed.data.query,
        hits: parsed.data.hits || 1,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/visitors/search error", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
