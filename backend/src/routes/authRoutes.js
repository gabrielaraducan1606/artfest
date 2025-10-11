import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db.js";
import { signToken, authRequired } from "../api/auth.js";

const router = Router();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

/* ----------------------------- Helpers ----------------------------- */
const normalizeEmail = (s = "") => s.trim().toLowerCase();
const getIdemKey = (req) => req.headers["idempotency-key"] || null;

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
    // ignore duplicate key errors
  }
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
  displayName: z.string().trim().optional(),
  city: z.string().trim().optional(),
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
      return res
        .status(400)
        .json({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    const {
      email,
      password,
      name,
      firstName,
      lastName,
      asVendor,
      displayName,
      city,
      marketingOptIn,
      termsAccepted,
      consents = [],
    } = parsed.data;

    // Idempotency (returnează același răspuns dacă s-a mai făcut)
    const idemKey = getIdemKey(req);
    const prev = await idemFind(idemKey);
    if (prev) return res.status(200).json(prev.responseJson);

    // Unic email
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res
        .status(409)
        .json({ error: "email_deja_folosit", message: "Acest email este deja folosit." });
    }

    const isAdmin = email === ADMIN_EMAIL;
    const passwordHash = await bcrypt.hash(password, 12);

    // Creare user (+vendor dacă e cazul) + consents în aceeași tranzacție
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
          role: isAdmin ? "ADMIN" : asVendor ? "VENDOR" : "USER",
        },
        select: { id: true, email: true, role: true, name: true },
      });

      if (!isAdmin && asVendor) {
        const display =
          (displayName && displayName.trim()) ||
          (name && name.trim()) ||
          email.split("@")[0];

        await tx.vendor.create({
          data: {
            userId: user.id,
            displayName: display,
            city: (city || "").trim() || null,
            isActive: true,
          },
        });
      }

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

    const token = signToken({ sub: created.id, role: created.role });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,                 // ✅ obligatoriu true în prod
      sameSite: isProd ? "None" : "Lax", // ✅ cross-site în prod
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const responseJson = {
      ok: true,
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
      },
      next: asVendor ? "/onboarding" : "/desktop",
    };
    if (idemKey) await idemSave(idemKey, responseJson);

    return res.status(201).json(responseJson);
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "email_deja_folosit" });
    }
    console.error("SIGNUP error:", e);
    return res.status(500).json({ error: "signup_failed" });
  }
});

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const { email, password } = parsed.data;

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "credentale_gresite" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "credentale_gresite" });

    if (email === ADMIN_EMAIL && user.role !== "ADMIN") {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: "ADMIN" },
      });
    }

    const token = signToken({ sub: user.id, role: user.role });
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,                 // ✅
      sameSite: isProd ? "None" : "Lax", // ✅
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
    if (!me) return res.status(404).json({ error: "user_not_found" });
    res.json({ user: me });
  } catch (e) {
    console.error("ME route error:", e);
    res.status(500).json({ error: "me_failed" });
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
