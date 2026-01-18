// src/routes/authRoutes.js

/**
 * Rute de autentificare / cont utilizator.
 *
 * Prefix: /api/auth/*
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { signToken, authRequired, enforceTokenVersion } from "../api/auth.js";

import forgotPassword from "./forgot-passwordRoutes.js";
import resetPassword from "./resetPassword.js";

const router = Router();
const APP_URL = process.env.APP_URL || "http://localhost:5173";

// === Config rate limiting login (email + fereastră de timp) ===
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 10);
const LOGIN_MAX_ATTEMPTS_PER_WINDOW = Number(process.env.LOGIN_MAX_ATTEMPTS_PER_WINDOW || 8);

// === Helpers hash ===
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// Normalizare email (folosită în Zod)
const normalizeEmail = (s = "") => s.trim().toLowerCase();

// Idempotency-Key: citire din header
const getIdemKey = (req) => req.headers["idempotency-key"] || null;

// IP + UA helpers (pentru audit)
function getReqIp(req) {
  const ipHeader = (req.headers["x-forwarded-for"] || "").toString();
  return ipHeader.split(",")[0].trim() || req.socket?.remoteAddress || null;
}
function getReqUa(req) {
  return req.get("user-agent") || null;
}

/**
 * IMPORTANT: cookie options trebuie să fie CONSISTENTE între:
 * - res.cookie(...)
 * - res.clearCookie(...)
 *
 * Folosim aceeași logică pentru secure/sameSite bazată pe request.
 */
function isSecureReq(req) {
  // Render / proxy: x-forwarded-proto e de multe ori sursa corectă
  const xf = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (xf === "https") return true;
  return !!req.secure;
}

function cookieOpts(req, maxAge) {
  const secure = isSecureReq(req);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    path: "/",
    ...(typeof maxAge === "number" ? { maxAge } : {}),
  };
}

/* ----------------------------- OTP (Email verification) ----------------------------- */

const EMAIL_OTP_TTL_MIN = Number(process.env.EMAIL_OTP_TTL_MIN || 10);
const EMAIL_OTP_MAX_ATTEMPTS = Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 6);
const EMAIL_OTP_LOCK_MIN = Number(process.env.EMAIL_OTP_LOCK_MIN || 15);
const EMAIL_OTP_PEPPER = process.env.EMAIL_OTP_PEPPER || "";

function randomOtp6() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

function hashOtp(email, code) {
  return sha256(`${normalizeEmail(email)}:${String(code).trim()}:${EMAIL_OTP_PEPPER}`);
}

/* ----------------------------- Schemas (Zod) ----------------------------- */

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
  entitySelfDeclared: z.boolean().optional().default(false),

  entityMeta: z
    .object({
      pageUrl: z.string().trim().optional(),
      referrer: z.string().trim().optional().nullable(),
    })
    .optional(),

  consents: z.array(ConsentSchema).optional().default([]),
  noExternalLinks: z.boolean().optional(),
});

const LoginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

const VerifyEmailSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  code: z.string().regex(/^\d{6}$/),
});

/* ----------------------------- Helpers generale ----------------------------- */

async function idemFind(key) {
  if (!key) return null;
  try {
    return await prisma.requestLog.findUnique({
      where: { idempotencyKey: String(key) },
    });
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
  } catch {
    // noop
  }
}

async function logLoginAttempt(req, { userId, email, success }) {
  try {
    const ipHeader = (req.headers["x-forwarded-for"] || "").toString();
    const ip = ipHeader.split(",")[0].trim() || req.socket?.remoteAddress || null;
    const userAgent = req.get("user-agent") || null;

    await prisma.loginAttempt.create({
      data: {
        userId: userId || null,
        email: email || null,
        success: !!success,
        ip,
        userAgent,
      },
    });
  } catch (err) {
    console.error("Failed to log login attempt", err);
  }
}

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
      entitySelfDeclared,
      entityMeta,
      consents = [],
      noExternalLinks,
    } = parsed.data;

    const idemKey = getIdemKey(req);
    const prev = await idemFind(idemKey);
    if (prev) return res.status(200).json(prev.responseJson);

    const exists = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
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

    const passwordHash = await bcrypt.hash(password, 12);
    const reqIp = getReqIp(req);
    const reqUa = getReqUa(req);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: name ?? ([firstName, lastName].filter(Boolean).join(" ").trim() || null),
          firstName: firstName || null,
          lastName: lastName || null,
          role: asVendor ? "VENDOR" : "USER",
          emailVerifiedAt: null,
          lastPasswordChangeAt: new Date(),
        },
        select: { id: true, email: true, role: true, name: true },
      });

      if (Array.isArray(consents) && consents.length > 0) {
        const ip =
          (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "";
        const ua = req.get("user-agent") || "";

        const mapDoc = (t) =>
          t === "tos" ? "TOS" : t === "privacy_ack" ? "PRIVACY_ACK" : "MARKETING_EMAIL_OPTIN";

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
      }

      if (asVendor) {
        const isDeclared = !!entitySelfDeclared;

        await tx.vendor.create({
          data: {
            userId: user.id,
            isActive: false,
            displayName: "",

            entitySelfDeclared: isDeclared,
            entitySelfDeclaredAt: isDeclared ? new Date() : null,

            entitySelfDeclaredIp: isDeclared ? reqIp : null,
            entitySelfDeclaredUa: isDeclared ? reqUa : null,
            entitySelfDeclaredMeta: isDeclared ? (entityMeta ?? null) : null,
          },
        });
      }

      return user;
    });

    await prisma.emailVerificationToken.deleteMany({
      where: { userId: created.id, purpose: "verify_email", usedAt: null },
    });

    const otp = randomOtp6();
    const tokenHash = hashOtp(email, otp);
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MIN * 60 * 1000);

    await prisma.emailVerificationToken.create({
      data: {
        userId: created.id,
        tokenHash,
        expiresAt,
        intent: asVendor ? "VENDOR" : "USER",
        purpose: "verify_email",
      },
    });

    try {
      await sendVerificationEmail({
        to: email,
        code: otp,
        ttlMin: EMAIL_OTP_TTL_MIN,
        userId: created.id,
      });
    } catch (err) {
      console.error("sendVerificationEmail failed:", err);
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV verify code]", otp, "for", email);
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

/** POST /api/auth/verify-email { email, code } */
router.post("/verify-email", async (req, res) => {
  try {
    const parsed = VerifyEmailSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: "Email sau cod invalid." });

    const { email, code } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, tokenVersion: true, emailVerifiedAt: true, locked: true },
    });

    if (!user) return res.status(400).json({ message: "Cod invalid sau expirat." });
    if (user.locked) return res.status(403).json({ message: "Contul este blocat." });

    // dacă e deja verificat -> facem login (set cookie) și returnăm next
    if (user.emailVerifiedAt) {
      const jwt = signToken({ sub: user.id, role: user.role, tv: user.tokenVersion });
      res.cookie("token", jwt, cookieOpts(req, 7 * 24 * 60 * 60 * 1000));

      const next = user.role === "ADMIN" ? "/admin" : "/desktop";
      return res.json({ ok: true, next });
    }

    const rec = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id, purpose: "verify_email", usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!rec) return res.status(400).json({ message: "Cod invalid sau expirat." });
    if (rec.expiresAt.getTime() < Date.now()) return res.status(400).json({ message: "Cod expirat. Cere unul nou." });

    if (rec.lockedUntil && rec.lockedUntil.getTime() > Date.now()) {
      return res.status(429).json({ message: "Prea multe încercări. Încearcă mai târziu." });
    }

    const computed = hashOtp(email, code);

    if (computed !== rec.tokenHash) {
      const nextAttempts = (rec.attempts || 0) + 1;
      const updateData = { attempts: nextAttempts };

      if (nextAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + EMAIL_OTP_LOCK_MIN * 60 * 1000);
      }

      await prisma.emailVerificationToken.update({ where: { id: rec.id }, data: updateData });
      return res.status(400).json({ message: "Cod invalid sau expirat." });
    }

    const userUpdateData = { emailVerifiedAt: new Date() };
    if (rec.intent === "VENDOR") userUpdateData.role = "VENDOR";

    await prisma.$transaction([
      prisma.emailVerificationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: userUpdateData }),
    ]);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });

    if (updatedUser) {
      const jwt = signToken({ sub: updatedUser.id, role: updatedUser.role, tv: updatedUser.tokenVersion });
      res.cookie("token", jwt, cookieOpts(req, 7 * 24 * 60 * 60 * 1000));
    }

    let next = "/desktop";
    if (updatedUser?.role === "ADMIN") next = "/admin";
    else if (rec.intent === "VENDOR") next = "/onboarding";

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

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });

    if (!user) return res.json({ ok: true });
    if (user.emailVerifiedAt) return res.json({ ok: true });

    const last = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id, purpose: "verify_email" },
      orderBy: { createdAt: "desc" },
      select: { intent: true },
    });
    const intent = last?.intent || "USER";

    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, purpose: "verify_email", usedAt: null },
    });

    const otp = randomOtp6();
    const tokenHash = hashOtp(email, otp);
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MIN * 60 * 1000);

    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt, intent, purpose: "verify_email" },
    });

    await sendVerificationEmail({ to: email, code: otp, ttlMin: EMAIL_OTP_TTL_MIN, userId: user.id });

    if (process.env.NODE_ENV !== "production") {
      console.log("[DEV resend verify code]", otp, "for", email);
    }

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
      return res.status(400).json({
        error: "invalid_payload",
        message: "Te rugăm să completezi e-mailul și parola.",
      });
    }

    const { email, password, remember } = parsed.data;

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await logLoginAttempt(req, { userId: null, email, success: false });
      return res.status(404).json({ error: "user_not_found", message: "Nu există niciun cont cu acest e-mail." });
    }

    if (user.locked) {
      await logLoginAttempt(req, { userId: user.id, email, success: false });
      return res.status(403).json({ error: "account_locked", message: "Contul este blocat." });
    }

    if (!user.emailVerifiedAt) {
      await logLoginAttempt(req, { userId: user.id, email, success: false });
      return res.status(403).json({
        error: "email_not_verified",
        message: "Te rugăm să îți confirmi adresa de email înainte de a te conecta.",
      });
    }

    // Rate limiting per email
    try {
      const windowStart = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000);
      const recentFailures = await prisma.loginAttempt.count({
        where: { email, success: false, createdAt: { gte: windowStart } },
      });

      if (recentFailures >= LOGIN_MAX_ATTEMPTS_PER_WINDOW) {
        await logLoginAttempt(req, { userId: user.id, email, success: false });
        return res.status(429).json({
          error: "too_many_attempts",
          message: "Prea multe încercări de conectare. Te rugăm să încerci mai târziu.",
        });
      }
    } catch (err) {
      console.error("LOGIN rate-limit check failed:", err);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const limit = Number(process.env.PASSWORD_HISTORY_LIMIT || 5);
      if (limit > 0) {
        const hist = await prisma.passwordHistory.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { passwordHash: true },
        });

        for (const h of hist) {
          const matchesOld = await bcrypt.compare(password, h.passwordHash);
          if (matchesOld) {
            await logLoginAttempt(req, { userId: user.id, email, success: false });
            return res.status(401).json({
              error: "old_password_used",
              message:
                "Această parolă a fost folosită anterior și a fost înlocuită. Folosește parola nouă sau resetează-ți parola.",
            });
          }
        }
      }

      await logLoginAttempt(req, { userId: user.id, email, success: false });
      return res.status(401).json({
        error: "wrong_password",
        message: "Parola este incorectă. Încearcă din nou sau resetează-ți parola.",
      });
    }

    await logLoginAttempt(req, { userId: user.id, email, success: true });

    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const jwt = signToken({ sub: user.id, role: user.role, tv: user.tokenVersion });

    const maxAge = (remember ? 30 : 7) * 24 * 60 * 60 * 1000;
    res.cookie("token", jwt, cookieOpts(req, maxAge));

    const displayName =
      user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || "";

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    });
  } catch (e) {
    console.error("LOGIN error:", e);
    return res.status(500).json({ error: "login_failed" });
  }
});

/** GET /api/auth/me */
router.get("/me", authRequired, enforceTokenVersion, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        avatarUrl: true,
        role: true,
        vendor: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    });

    if (!me) {
      // IMPORTANT: ștergem cookie-ul cu aceleași atribute ca la setare
      res.clearCookie("token", cookieOpts(req));
      return res.status(401).json({ error: "user_not_found" });
    }

    const displayName = me.name || [me.firstName, me.lastName].filter(Boolean).join(" ") || "";

    res.json({
      user: {
        ...me,
        name: displayName,
      },
    });
  } catch (e) {
    console.error("ME route error:", e);
    return res.status(500).json({ error: "me_failed" });
  }
});

/** GET /api/auth/exists?email= */
router.get("/exists", async (req, res) => {
  try {
    const raw = (req.query.email || "").toString().trim().toLowerCase();
    if (!raw) return res.json({ exists: false });

    const u = await prisma.user.findUnique({
      where: { email: raw },
      select: { id: true },
    });

    res.json({ exists: !!u });
  } catch {
    res.json({ exists: false });
  }
});

/** POST /api/auth/logout */
router.post("/logout", (req, res) => {
  // IMPORTANT: ștergem cookie-ul cu aceleași atribute ca la setare
  res.clearCookie("token", cookieOpts(req));
  res.json({ ok: true });
});

/** forgot/reset password */
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
