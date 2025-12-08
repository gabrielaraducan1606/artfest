// src/routes/authRoutes.js

/**
 * Rute de autentificare / cont utilizator.
 *
 * Prefix: /api/auth/*
 *
 * Responsabilități:
 * - creare cont (signup) pentru utilizatori și vendori
 * - verificare adresă de email (link din email)
 * - retrimitere email de verificare
 * - login + logout + /me (date user curent)
 * - verificare existență email (pentru formularul de înregistrare)
 * - integrare flow „am uitat parola” și „resetare parolă”
 *
 * Utilizare din frontend (exemple):
 * - POST /api/auth/signup           — Register.jsx
 * - POST /api/auth/login            — Login.jsx
 * - POST /api/auth/verify-email     — pagina VerifyEmail
 * - POST /api/auth/resend-verification — buton „Trimite din nou”
 * - GET  /api/auth/me               — încărcare user curent (layout)
 * - GET  /api/auth/exists?email=    — verificare email deja folosit
 * - POST /api/auth/logout           — buton Logout
 * - POST /api/auth/forgot-password  — formular „Am uitat parola”
 * - POST /api/auth/reset-password   — formular „Resetează parola”
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { signToken, authRequired, enforceTokenVersion } from "../api/auth.js";

// Aceste module exportă handlere (funcții) pentru forgot/reset password, montate mai jos ca rute POST

import forgotPassword from "./forgot-passwordRoutes.js";
import resetPassword from "./resetPassword.js";

const router = Router();
const APP_URL = process.env.APP_URL || "http://localhost:5173";

// === Config rate limiting login (email + fereastră de timp) ===
const LOGIN_WINDOW_MINUTES = Number(process.env.LOGIN_WINDOW_MINUTES || 10);
const LOGIN_MAX_ATTEMPTS_PER_WINDOW = Number(
  process.env.LOGIN_MAX_ATTEMPTS_PER_WINDOW || 8
);

// === Helpers hash & random token (pentru verificare email etc.) ===
const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");

/* ----------------------------- Helpers generale ----------------------------- */

// Normalizare email (folosită în Zod)
const normalizeEmail = (s = "") => s.trim().toLowerCase();

// Idempotency-Key: citire din header
const getIdemKey = (req) => req.headers["idempotency-key"] || null;

/**
 * Caută un request anterior cu același Idempotency-Key.
 * Folosit la /signup ca să nu creăm mai mulți useri dacă frontend-ul retrimite
 * același request (retry, refresh, rețea instabilă etc.).
 */
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

/**
 * Salvează răspunsul JSON asociat unui Idempotency-Key.
 * Dacă apare un retry cu același key, returnăm direct acest răspuns.
 */
async function idemSave(key, responseJson) {
  if (!key) return;
  try {
    await prisma.requestLog.create({
      data: { idempotencyKey: String(key), responseJson },
    });
  } catch {
    // dacă logarea Idempotency-Key eșuează, nu blocăm fluxul de signup
  }
}

/**
 * Helper pentru logarea încercărilor de login (reușite sau nu).
 * Nu blochează login-ul dacă insert-ul în DB eșuează.
 */
async function logLoginAttempt(req, { userId, email, success }) {
  try {
    const ipHeader = (req.headers["x-forwarded-for"] || "").toString();
    const ip =
      ipHeader.split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      null;

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
    // nu blocăm login-ul dacă logarea eșuează
  }
}

/* ----------------------------- Schemas (Zod) ----------------------------- */

// Consimțământul salvat pentru user (TOS, privacy, marketing)
const ConsentSchema = z.object({
  type: z.enum(["tos", "privacy_ack", "marketing_email_optin"]),
  version: z.string().trim().optional(),
  checksum: z.string().trim().optional().nullable(),
});

// Payload signup așa cum vine de la frontend
const SignupSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(8, "Parola minim 8 caractere"),
  name: z.string().trim().optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),

  // checkbox „vreau să fiu vendor”
  asVendor: z.boolean().optional().default(false),

  // checkbox „confirm că sunt entitate juridică”
  // ⚠️ NU atinge rolul direct, doar va fi folosit la crearea Vendor-ului
  entitySelfDeclared: z.boolean().optional().default(false),

  consents: z.array(ConsentSchema).optional().default([]),

  // dacă frontend-ul trimite acest flag, nu-l aruncăm
  noExternalLinks: z.boolean().optional(),
});

// 👉 includem remember ca optional, ca să nu fie aruncat de Zod
const LoginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

/* =================================================================== */
/** POST /api/auth/signup
 *
 * Creează un user nou (rol USER sau VENDOR) + consimțăminte + (opțional) Vendor,
 * generează token de verificare email și trimite email-ul de confirmare.
 * Răspunsul este "pending_verification" până când user-ul apasă pe linkul din email.
 */
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
      consents = [],
      // eslint-disable-next-line no-unused-vars
      noExternalLinks, // deocamdată nu îl folosim aici, dar îl acceptăm
    } = parsed.data;

    // Idempotency — dacă același request a mai rulat, returnăm direct rezultatul salvat
    const idemKey = getIdemKey(req);
    const prev = await idemFind(idemKey);
    if (prev) return res.status(200).json(prev.responseJson);

    // Verificăm dacă există deja user cu acest email
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

    // Creare user + consents + (opțional) Vendor, într-o singură tranzacție
    const created = await prisma.$transaction(async (tx) => {
      // 1) User
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name:
            name ??
            ([firstName, lastName].filter(Boolean).join(" ").trim() || null),
          firstName: firstName || null,
          lastName: lastName || null,

          // ⚠️ Rolul este setat în funcție de asVendor:
          // - dacă a bifat "vreau să fiu vendor" -> role = VENDOR
          // - altfel -> USER
          role: asVendor ? "VENDOR" : "USER",

          emailVerifiedAt: null,
          // parola inițială – considerăm că data asta e "ultima schimbare"
          lastPasswordChangeAt: new Date(),
        },
        select: { id: true, email: true, role: true, name: true },
      });

      // 2) Consimțământ în UserConsent (nu mai umblăm la câmpuri legacy)
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
      }

      // 3) Dacă user-ul vrea să fie vendor -> creăm Vendor
      //    entitySelfDeclared influențează DOAR vendorul, nu rolul user-ului.
      if (asVendor) {
        await tx.vendor.create({
          data: {
            userId: user.id,
            isActive: false,
            displayName: "",

            entitySelfDeclared: !!entitySelfDeclared,
            entitySelfDeclaredAt: entitySelfDeclared ? new Date() : null,
          },
        });
      }

      return user;
    });

    // Generează token verificare + persistă intenția (USER vs VENDOR)
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

    // Linkul pentru email (folosit de pagina de verify-email din frontend)
    const link = `${APP_URL}/verify-email?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(email)}&intent=${
      asVendor ? "vendor" : ""
    }`;

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

/** POST /api/auth/verify-email { token }
 *
 * Verifică token-ul din email, marchează user-ul ca având email verificat
 * și setează cookie-ul cu tokenul JWT. Redirecționează (via "next") spre
 * desktop, admin sau onboarding vendor.
 */
router.post("/verify-email", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ message: "Token lipsă." });

    const tokenHash = sha256(token);
    const rec = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    if (!rec) return res.status(400).json({ message: "Link invalid." });
    if (rec.usedAt) return res.status(400).json({ message: "Link deja folosit." });
    if (rec.expiresAt.getTime() < Date.now())
      return res.status(400).json({ message: "Link expirat." });

    const userUpdateData = { emailVerifiedAt: new Date() };
    if (rec.intent === "VENDOR") {
      // păstrăm comportamentul existent:
      // dacă intenția era VENDOR, ne asigurăm că role=VENDOR
      userUpdateData.role = "VENDOR";
    }

    await prisma.$transaction([
      prisma.emailVerificationToken.update({
        where: { tokenHash },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: rec.userId },
        data: userUpdateData,
      }),
    ]);

    const user = await prisma.user.findUnique({ where: { id: rec.userId } });
    if (user) {
      const jwt = signToken({
        sub: user.id,
        role: user.role,
        tv: user.tokenVersion,
      });
      const isSecure = !!(
        req.secure || req.headers["x-forwarded-proto"] === "https"
      );
      res.cookie("token", jwt, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "None" : "Lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    // "next" este folosit de frontend pentru redirect după confirmare
    let next = "/desktop";
    if (user?.role === "ADMIN") {
      next = "/admin";
    } else if (rec.intent === "VENDOR") {
      next = "/onboarding";
    } else {
      next = "/desktop";
    }

    return res.json({ ok: true, next });
  } catch (e) {
    console.error("VERIFY error:", e);
    return res.status(500).json({ message: "verify_failed" });
  }
});

/** POST /api/auth/resend-verification { email }
 *
 * Retrimite email-ul de verificare pentru un user neconfirmat.
 * Răspunsul este mereu generic (ok:true) pentru a nu dezvălui dacă emailul există sau nu.
 */
router.post("/resend-verification", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || "");
    if (!email) return res.json({ ok: true });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });
    if (user.emailVerifiedAt) return res.json({ ok: true });

    const last = await prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { expiresAt: "desc" },
      select: { intent: true },
    });
    const intent = last?.intent || "USER";

    // invalidăm token-urile anterioare nefolosite
    await prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt, intent },
    });

    const link = `${APP_URL}/verify-email?token=${encodeURIComponent(
      token
    )}&email=${encodeURIComponent(email)}&intent=${
      intent === "VENDOR" ? "vendor" : ""
    }`;
    await sendVerificationEmail({ to: email, link });

    return res.json({ ok: true });
  } catch (e) {
    console.error("RESEND error:", e);
    return res.status(500).json({ ok: false });
  }
});

/** POST /api/auth/login
 *
 * Verifică email + parolă, aplică rate limiting, verifică dacă emailul este confirmat,
 * loghează încercările de login și setează cookie-ul cu token JWT.
 */
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
      await logLoginAttempt(req, {
        userId: null,
        email,
        success: false,
      });
      return res.status(404).json({
        error: "user_not_found",
        message: "Nu există niciun cont cu acest e-mail.",
      });
    }

    // opțional: respectăm flag-ul locked
    if (user.locked) {
      await logLoginAttempt(req, {
        userId: user.id,
        email,
        success: false,
      });
      return res
        .status(403)
        .json({ error: "account_locked", message: "Contul este blocat." });
    }

    // ⚠️ forțăm verificarea email-ului înainte de login
    if (!user.emailVerifiedAt) {
      await logLoginAttempt(req, {
        userId: user.id,
        email,
        success: false,
      });
      return res.status(403).json({
        error: "email_not_verified",
        message:
          "Te rugăm să îți confirmi adresa de email înainte de a te conecta.",
      });
    }

    // Rate limiting simplu per email (în fereastră de timp configurabilă)
    try {
      const windowStart = new Date(
        Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000
      );
      const recentFailures = await prisma.loginAttempt.count({
        where: {
          email,
          success: false,
          createdAt: { gte: windowStart },
        },
      });

      if (recentFailures >= LOGIN_MAX_ATTEMPTS_PER_WINDOW) {
        await logLoginAttempt(req, {
          userId: user.id,
          email,
          success: false,
        });
        return res.status(429).json({
          error: "too_many_attempts",
          message:
            "Prea multe încercări de conectare. Te rugăm să încerci mai târziu.",
        });
      }
    } catch (err) {
      console.error("LOGIN rate-limit check failed:", err);
      // nu blocăm login-ul dacă verificarea de rate-limit eșuează
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      // opțional: verificăm dacă parola nu este una veche reutilizată
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
            await logLoginAttempt(req, {
              userId: user.id,
              email,
              success: false,
            });
            return res.status(401).json({
              error: "old_password_used",
              message:
                "Această parolă a fost folosită anterior și a fost înlocuită. Folosește parola nouă sau resetează-ți parola.",
            });
          }
        }
      }

      await logLoginAttempt(req, {
        userId: user.id,
        email,
        success: false,
      });
      return res.status(401).json({
        error: "wrong_password",
        message:
          "Parola este incorectă. Încearcă din nou sau resetează-ți parola.",
      });
    }

    // login reușit – logăm succesul
    await logLoginAttempt(req, {
      userId: user.id,
      email,
      success: true,
    });

    // ACTUALIZĂM ULTIMA CONECTARE (lastLoginAt)
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const jwt = signToken({
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
    });
    const isSecure = !!(
      req.secure || req.headers["x-forwarded-proto"] === "https"
    );
    const maxAge = (remember ? 30 : 7) * 24 * 60 * 60 * 1000;

    res.cookie("token", jwt, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "None" : "Lax",
      path: "/",
      maxAge,
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (e) {
    console.error("LOGIN error:", e);
    return res.status(500).json({ error: "login_failed" });
  }
});

/** GET /api/auth/me
 *
 * Returnează user-ul autentificat (citit din token), împreună cu informații
 * minimale despre vendor, dacă există. Dacă user-ul lipsește, șterge cookie-ul.
 */
router.get("/me", authRequired, enforceTokenVersion, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        email: true,
        name: true,
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
    return res.status(500).json({ error: "me_failed" });
  }
});

/** GET /api/auth/exists?email=
 *
 * Răspunde cu { exists: true/false } în funcție de existența unui user cu emailul dat.
 * Folosit de frontend la input-ul de email din formularul de înregistrare.
 */
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

/** POST /api/auth/logout
 *
 * Șterge cookie-ul token și "deloghează" utilizatorul.
 */
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

/** Integrare rută "am uitat parola" + "resetare parolă"
 *
 * Implementarea efectivă este în fișiere separate:
 * - ./forgot-passwordRoutes.js
 * - ./resetPassword.js
 * Aici doar le montăm pe prefixul /api/auth.
 */
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
