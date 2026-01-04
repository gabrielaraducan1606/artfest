// backend/src/routes/digitalWaitlistRoutes.js
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import crypto from "crypto";

// ✅ Trimite email folosind infrastructura ta existentă
import { sendMarketingEmail } from "../lib/mailer.js";

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
  if (!secret) throw new Error("Missing WAITLIST_UNSUBSCRIBE_SECRET/JWT_SECRET");
  const h = crypto.createHmac("sha256", secret);
  h.update(normalizeEmail(email));
  return h.digest("hex");
}

function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  const expected = makeUnsubscribeToken(email);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(String(token), "utf8")
    );
  } catch {
    return false;
  }
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

/**
 * Bază API publică pentru linkuri din email.
 * Recomandat să fie backend domain (API), nu frontend.
 * Env:
 *   PUBLIC_API_BASE_URL=https://api.artfest.ro
 */
function getPublicApiBaseUrl() {
  const v =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.API_URL ||
    "";
  const cleaned = String(v).trim().replace(/\/+$/, "");
  return cleaned || "https://api.artfest.ro";
}

function buildUnsubscribeLink(email) {
  const apiBase = getPublicApiBaseUrl();
  const token = makeUnsubscribeToken(email);

  return `${apiBase}/api/public/digital-waitlist/unsubscribe-token?email=${encodeURIComponent(
    email
  )}&token=${encodeURIComponent(token)}`;
}

async function sendWaitlistConfirmationEmail({ to, source }) {
  const unsubLink = buildUnsubscribeLink(to);

  const safeSource = clampStr(source, 60) || "servicii-digitale";

  const html = `
    <h2>Ești înscris(ă) pe lista de așteptare ✅</h2>
    <p>Mulțumim! Te-am înscris pentru <strong>${safeSource}</strong>.</p>
    <p>Îți trimitem un email imediat ce lansăm.</p>
    <hr/>
    <p style="font-size:12px;color:#6b7280;margin:0;">
      Dacă nu mai vrei emailuri despre această listă:
      <a href="${unsubLink}">dezabonare</a>
    </p>
  `.trim();

  await sendMarketingEmail({
    to,
    subject: "Confirmare înscriere – Servicii digitale",
    preheader: "Confirmare înscriere pe lista de așteptare",
    html,
    userId: null,
  });
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

    const ip = getClientIp(req);
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

    // ✅ trimitem email (NU blocăm înscrierea dacă mailul pică)
    try {
      await sendWaitlistConfirmationEmail({ to: email, source });
    } catch (e) {
      console.error("waitlist email failed:", e?.message || e);
    }

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
 */
router.get("/digital-waitlist/unsubscribe-token", limiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.query?.email);
    const token = String(req.query?.token || "");

    if (!email || !isValidEmail(email)) return res.status(400).send("Email invalid.");
    if (!verifyUnsubscribeToken(email, token))
      return res.status(403).send("Link de dezabonare invalid.");

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
