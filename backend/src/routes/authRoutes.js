import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { signToken, authRequired } from "../api/auth.js";

const router = Router();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const APP_URL = process.env.APP_URL || "http://localhost:5173";

// hash & random
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

/* ----------------------------- Helpers ----------------------------- */
const normalizeEmail = (s = "") => s.trim().toLowerCase();
const getIdemKey = (req) => req.headers["idempotency-key"] || null;

async function idemFind(key) {
  if (!key) return null;
  try {
    return await prisma.requestLog.findUnique({ where: { idempotencyKey: String(key) } });
  } catch {
    return null;
  }
}
async function idemSave(key, responseJson) {
  if (!key) return;
  try {
    await prisma.requestLog.create({
      data: { idempotencyKey: String(key), responseJson },
    });
  } catch {}
}

/* ----------------------------- Schemas ----------------------------- */
const ConsentSchema = z.object({
  type: z.enum(["tos", "privacy_ack", "marketing_email_optin"]),
  version: z.string().trim().optional(),
  checksum: z.string().trim().optional().nullable(),
});

const SignupSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(8, "Parola minim 8 caractere"),
  name: z.string().trim().optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  asVendor: z.boolean().optional().default(false),
  marketingOptIn: z.boolean().optional().default(false),
  termsAccepted: z.boolean().optional().default(false),
  consents: z.array(ConsentSchema).optional().default([]),
});

const LoginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1),
});

/* =================================================================== */
/** POST /api/auth/signup */
router.post("/signup", async (req, res) => {
  try {
    const parsed = SignupSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const {
      email,
      password,
      name,
      firstName,
      lastName,
      asVendor,
      marketingOptIn,
      termsAccepted,
      consents = [],
    } = parsed.data;

    // Idempotency
    const idemKey = getIdemKey(req);
    const prev = await idemFind(idemKey);
    if (prev) return res.status(200).json(prev.responseJson);

    const exists = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true }
    });
    if (exists) {
      const unverified = !exists.emailVerifiedAt;
      return res.status(409).json({
        error: unverified ? "email_exists_unverified" : "email_deja_folosit",
        message: unverified
          ? "Există deja un cont cu acest email, dar nu este confirmat."
          : "Acest email este deja folosit.",
      });
    }

    const isAdmin = email === ADMIN_EMAIL;
    const passwordHash = await bcrypt.hash(password, 12);

    // Creare user + consents
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: name ?? (([firstName, lastName].filter(Boolean).join(" ").trim()) || null),
          firstName: firstName || null,
          lastName: lastName || null,
          marketingOptIn: !!marketingOptIn,
          termsAcceptedAt: termsAccepted ? new Date() : null,
          role: isAdmin ? "ADMIN" : "USER",
          emailVerifiedAt: null,
        },
        select: { id: true, email: true, role: true, name: true },
      });

      if (Array.isArray(consents) && consents.length > 0) {
        const ip =
          (req.headers["x-forwarded-for"] || "")
            .toString()
            .split(",")[0]
            .trim() || req.socket.remoteAddress || "";
        const ua = req.get("user-agent") || "";

        const mapDoc = (t) =>
          t === "tos"
            ? "TOS"
            : t === "privacy_ack"
            ? "PRIVACY_ACK"
            : "MARKETING_EMAIL_OPTIN";

        for (const c of consents) {
          await tx.userConsent.create({
            data: {
              userId: user.id,
              document: mapDoc(c.type),
              version: c.version || "1.0.0",
              checksum: c.checksum || null,
              ip,
              ua,
            },
          });
        }

        if (consents.some((c) => c.type === "tos")) {
          await tx.user.update({
            where: { id: user.id },
            data: { termsAcceptedAt: new Date() },
          });
        }
        if (consents.some((c) => c.type === "marketing_email_optin")) {
          await tx.user.update({
            where: { id: user.id },
            data: { marketingOptIn: true },
          });
        }
      }

      return user;
    });

    // Generează token verificare + persistă intenția
    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.emailVerificationToken.create({
      data: {
        userId: created.id,
        tokenHash,
        expiresAt,
        intent: asVendor ? "VENDOR" : "USER",
      },
    });

    // include intent în link, ca fallback
    const link = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&intent=${asVendor ? "vendor" : ""}`;

    try {
      await sendVerificationEmail({ to: email, link });
    } catch (err) {
      console.error("sendVerificationEmail failed:", err);
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV verify link]", link);
    }

    const responseJson = {
      status: "pending_verification",
      next: `/verify-email?email=${encodeURIComponent(email)}`,
      asVendorIntent: !!asVendor,
    };

    if (idemKey) await idemSave(idemKey, responseJson);
    return res.status(200).json(responseJson);
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "email_deja_folosit" });
    }
    console.error("SIGNUP error:", e);
    return res.status(500).json({ error: "signup_failed" });
  }
});

/** POST /api/auth/verify-email { token } */
router.post("/verify-email", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ message: "Token lipsă." });

    const tokenHash = sha256(token);
    const rec = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!rec) return res.status(400).json({ message: "Link invalid." });
    if (rec.usedAt) return res.status(400).json({ message: "Link deja folosit." });
    if (rec.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "Link expirat." });

    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { tokenHash }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: rec.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);

    // autentifică automat după verificare
    const user = await prisma.user.findUnique({ where: { id: rec.userId } });
    if (user) {
      const jwt = signToken({ sub: user.id, role: user.role });
      const isSecure = !!(req.secure || (req.headers["x-forwarded-proto"] === "https"));
      res.cookie("token", jwt, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "None" : "Lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    const next = rec.intent === "VENDOR" ? "/onboarding" : "/desktop";
    return res.json({ ok: true, next });
  } catch (e) {
    console.error("VERIFY error:", e);
    return res.status(500).json({ message: "verify_failed" });
  }
});

/** POST /api/auth/resend-verification { email } */
router.post("/resend-verification", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || "");
    if (!email) return res.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });
    if (user.emailVerifiedAt) return res.json({ ok: true });

    // recuperează ultima intenție a userului (dacă există tokenuri vechi)
    const last = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { expiresAt: "desc" },
      select: { intent: true },
    });
    const intent = last?.intent || "USER";

    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash, expiresAt, intent } });

    const link = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&intent=${intent === "VENDOR" ? "vendor" : ""}`;
    await sendVerificationEmail({ to: email, link });

    return res.json({ ok: true });
  } catch (e) {
    console.error("RESEND error:", e);
    return res.status(500).json({ ok: false });
  }
});

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const { email, password, remember } = parsed.data;

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "user_not_found" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "wrong_password" });

    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
    if (email === ADMIN_EMAIL && user.role !== "ADMIN") {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: "ADMIN" },
      });
    }

    const jwt = signToken({ sub: user.id, role: user.role });

    const isSecure = !!(req.secure || (req.headers["x-forwarded-proto"] === "https"));
    const maxAge = remember ? (30 * 24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000);

    res.cookie("token", jwt, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "None" : "Lax",
      path: "/",
      maxAge,
    });

    res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (e) {
    console.error("LOGIN error:", e);
    res.status(500).json({ error: "login_failed" });
  }
});

/** GET /api/auth/me */
router.get("/me", authRequired, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        vendor: { select: { id: true, displayName: true, city: true } },
      },
    });
    if (!me) {
      const isProd = process.env.NODE_ENV === "production";
      res.clearCookie("token", {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "None" : "Lax",
        path: "/",
      });
      return res.status(401).json({ error: "user_not_found" });
    }
    res.json({ user: me });
  } catch (e) {
    console.error("ME route error:", e);
    res.status(500).json({ error: "me_failed" });
  }
});

/** GET /api/auth/exists?email= */
router.get("/exists", async (req, res) => {
  try {
    const raw = (req.query.email || "").toString().trim().toLowerCase();
    if (!raw) return res.json({ exists: false });
    const u = await prisma.user.findUnique({ where: { email: raw }, select: { id: true } });
    res.json({ exists: !!u });
  } catch (e) {
    res.json({ exists: false });
  }
});

/** POST /api/auth/logout */
router.post("/logout", (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/",
  });
  res.json({ ok: true });
});

export default router;
