import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/marketplace-waitlist", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: "invalid_email" });

    const source = req.body?.source ? String(req.body.source) : "coming-soon";
    const name = req.body?.name ? String(req.body.name).trim() : null;

    const ip =
      (req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? req.ip ?? "").trim() || null;

    const userAgent = req.headers["user-agent"]?.toString() ?? null;

    await prisma.marketplaceWaitlistSubscriber.upsert({
      where: { email },
      create: { email, source, name, ip, userAgent, status: "NEW" },
      update: { source, name: name ?? undefined, ip: ip ?? undefined, userAgent: userAgent ?? undefined },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("marketplace waitlist error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
