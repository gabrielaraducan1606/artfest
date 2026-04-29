// ./src/routes/vendorVisitorsPublicRoutes.js
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();
function anonymizeUserAgent(userAgent = "") {
  const ua = String(userAgent || "").toLowerCase();

  if (!ua) return null;
  if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) return "bot";
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) return "mobile";

  return "desktop";
}
/**
 * POST /api/visitors/track — înregistrează PAGEVIEW/CTA_CLICK/MESSAGE (PUBLIC)
 */
router.post("/track", async (req, res) => {
  const schema = z.object({
    vendorId: z.string().min(1),
    serviceId: z.string().min(1).optional(), // ✅ IMPORTANT pentru stats pe magazin
    type: z.enum(["PAGEVIEW", "CTA_CLICK", "MESSAGE"]),
    pageUrl: z.string().max(500).optional(),
    ctaLabel: z.string().max(200).optional(),
    referrer: z.string().max(500).optional(),
    sessionId: z.string().max(100).optional(),
    userAgent: z.string().max(500).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_payload" });
  }

  try {
    const d = parsed.data;

   await prisma.event.create({
  data: {
    vendorId: d.vendorId,
    serviceId: d.serviceId || null,
    type: d.type,
    pageUrl: d.pageUrl || null,
    ctaLabel: d.ctaLabel || null,
    referrer: d.referrer || null,
    sessionId: d.sessionId || null,
    userAgent: anonymizeUserAgent(
      d.userAgent || req.headers["user-agent"]?.toString()
    ),
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
    serviceId: z.string().min(1).optional(), // ✅ opțional dar util pe viitor
    query: z.string().min(1).max(200),
    hits: z.number().int().min(1).max(1000).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_payload" });
  }

  try {
    await prisma.search.create({
      data: {
        vendorId: parsed.data.vendorId,
        serviceId: parsed.data.serviceId || null, // dacă ai câmp în model
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