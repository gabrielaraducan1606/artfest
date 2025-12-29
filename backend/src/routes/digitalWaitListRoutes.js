import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import crypto from "crypto";

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clampStr(v, max = 120) {
  const s = String(v || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Token HMAC (nu stocăm token în DB)
 * Secret: WAITLIST_UNSUBSCRIBE_SECRET sau JWT_SECRET
 */
function makeUnsubscribeToken(email) {
  const secret = process.env.WAITLIST_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  const h = crypto.createHmac("sha256", secret);
  h.update(normalizeEmail(email));
  return h.digest("hex");
}

function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  const expected = makeUnsubscribeToken(email);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token)));
  } catch {
    return false;
  }
}

// POST /api/public/digital-waitlist
router.post("/digital-waitlist", limiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const source = clampStr(req.body?.source || "servicii-digitale", 60);
    const name = req.body?.name ? clampStr(req.body.name, 80) : null;

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "missing_email",
        message: "Email lipsă.",
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_email",
        message: "Email invalid.",
      });
    }

    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    const userAgent = req.headers["user-agent"]?.toString() || null;

    const row = await prisma.digitalWaitlistSubscriber.upsert({
      where: { email },
      update: {
        status: "new",
        source,
        name,
        ip,
        userAgent,
      },
      create: {
        email,
        source,
        name,
        ip,
        userAgent,
        status: "new",
      },
      select: { id: true, email: true, status: true, createdAt: true },
    });

    return res.json({
      ok: true,
      subscriber: row,
      message: "Te-am înscris. Te anunțăm când lansăm serviciile digitale!",
    });
  } catch (err) {
    console.error("digital-waitlist subscribe error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// (Fallback) POST /api/public/digital-waitlist/unsubscribe  { email }
router.post("/digital-waitlist/unsubscribe", limiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_email",
        message: "Email invalid.",
      });
    }

    await prisma.digitalWaitlistSubscriber
      .update({
        where: { email },
        data: { status: "unsubscribed" },
      })
      .catch(() => null);

    return res.json({ ok: true, message: "Te-am dezabonat." });
  } catch (err) {
    console.error("digital-waitlist unsubscribe error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * ✅ SECURIZAT: GET /api/public/digital-waitlist/unsubscribe-token?email=...&token=...
 * Asta e link-ul pe care îl pui în email.
 */
router.get("/digital-waitlist/unsubscribe-token", limiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.query?.email);
    const token = String(req.query?.token || "");

    if (!email || !isValidEmail(email)) return res.status(400).send("Email invalid.");
    if (!verifyUnsubscribeToken(email, token)) return res.status(403).send("Link de dezabonare invalid.");

    await prisma.digitalWaitlistSubscriber
      .update({
        where: { email },
        data: { status: "unsubscribed" },
      })
      .catch(() => null);

    return res.status(200).send("Te-ai dezabonat cu succes.");
  } catch (err) {
    console.error("digital-waitlist unsubscribe-token error:", err);
    return res.status(500).send("Eroare server.");
  }
});

export default router;

