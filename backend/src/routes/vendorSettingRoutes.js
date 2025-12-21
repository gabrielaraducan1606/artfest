// backend/src/routes/vendorSettingsRoutes.js (ESM)
import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import {
  sendVendorDeactivateConfirmEmail,
  sendPasswordResetEmail,
  sendEmailChangeVerificationEmail,
} from "../lib/mailer.js";
import { addMinutes, generateRawToken, hashToken } from "../utils/passwordReset.js";

const router = Router();

/* =========================
   Config
========================= */
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:5173").replace(
  /\/+$/,
  ""
);

const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
const FP_COOLDOWN_SECONDS = Number(process.env.FP_COOLDOWN_SECONDS || 120);
const FP_DAILY_CAP = Number(process.env.FP_DAILY_CAP || 5);

function secondsAgo(sec) {
  return new Date(Date.now() - sec * 1000);
}

function baseAppUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

function vendorSettingsRedirectUrl(appUrl) {
  // ajustează dacă pagina ta are alt path
  return `${appUrl}/vendor/settings?tab=security&emailChange=ok`;
}

/* =========================
   Schemas
========================= */
const DeactivateRequestPayload = z.object({
  reason: z.string().optional().default(""),
});

const DeactivateConfirmPayload = z.object({
  token: z.string().min(10),
});

const VendorPasswordResetRequestPayload = z.object({
  reason: z.string().optional().default(""),
});

const ChangeEmailRequestPayload = z.object({
  currentPassword: z.string().min(1),
  newEmail: z.string().min(5),
});

/* =========================
   Helpers
========================= */
async function getVendorForUser(userId) {
  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true, userId: true, displayName: true, isActive: true },
  });
}

async function getUserEmailById(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return u?.email || "";
}

function makeAnonymizedDisplayName(vendorId) {
  return `Vendor ${String(vendorId).slice(-6).toUpperCase()}`;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/* ======================================================================
   PUBLIC: Confirmare schimbare email (din email) — trebuie să fie PUBLIC
   GET /api/vendor/settings/account/change-email/confirm?token=...
====================================================================== */
router.get("/vendor/settings/account/change-email/confirm", async (req, res) => {
  const { token } = req.query || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "invalid_token", message: "Token lipsă sau invalid." });
  }

  const now = new Date();

  const user = await prisma.user.findFirst({
    where: {
      emailChangeToken: token,
      emailChangeExpiresAt: { gt: now },
    },
    select: { id: true, emailChangeNewEmail: true },
  });

  if (!user || !user.emailChangeNewEmail) {
    return res.status(400).json({
      error: "invalid_or_expired_token",
      message: "Linkul este invalid sau a expirat. Reîncearcă schimbarea emailului.",
    });
  }

  // re-verificăm să nu fie luat între timp
  const taken = await prisma.user.findUnique({
    where: { email: user.emailChangeNewEmail.toLowerCase() },
    select: { id: true },
  });

  if (taken && taken.id !== user.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailChangeToken: null,
        emailChangeNewEmail: null,
        emailChangeExpiresAt: null,
      },
    });

    return res.status(400).json({
      error: "email_taken",
      message: "Între timp, această adresă de email este folosită de un alt cont.",
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: user.emailChangeNewEmail.toLowerCase(),
      emailChangeToken: null,
      emailChangeNewEmail: null,
      emailChangeExpiresAt: null,

      // recomandat: logout everywhere
      tokenVersion: { increment: 1 },
    },
    select: { id: true, email: true },
  });

  const appUrl = baseAppUrl();
  if (appUrl) return res.redirect(vendorSettingsRedirectUrl(appUrl));

  return res.json({ ok: true, message: "Emailul a fost actualizat." });
});

/* =========================
   Totul de mai jos: doar vendor logat
========================= */
router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));

/* =========================
   GET /api/vendor/settings/account
========================= */
router.get("/vendor/settings/account", async (req, res) => {
  const userId = req.user.sub || req.user.id;
  const vendor = await getVendorForUser(userId);
  if (!vendor) return res.status(404).json({ error: "not_a_vendor" });

  res.json({
    vendor: {
      id: vendor.id,
      displayName: vendor.displayName,
      isActive: vendor.isActive,
    },
    deletion: {
      mode: "safe_deactivate_with_email_confirm",
      keepsSensitiveData: true,
      confirmByEmail: true,
    },
  });
});

/* =========================
   POST /api/vendor/settings/account/change-email
   (pas 1: cere schimbarea emailului, trimite confirmare pe email)
========================= */
router.post("/vendor/settings/account/change-email", async (req, res) => {
  const userId = req.user.sub || req.user.id;

  const parsed = ChangeEmailRequestPayload.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }

  const { currentPassword, newEmail } = parsed.data;
  const emailTrimmed = String(newEmail).trim().toLowerCase();

  if (!emailTrimmed.includes("@") || !emailTrimmed.includes(".")) {
    return res.status(400).json({ error: "invalid_email", message: "Te rugăm să introduci un email valid." });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  if (!user) return res.status(404).json({ error: "user_not_found" });

  if (!user.passwordHash) {
    return res.status(400).json({
      error: "no_password_set",
      message: "Contul tău nu are o parolă setată (probabil creat prin login social).",
    });
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    return res.status(400).json({
      error: "invalid_current_password",
      message: "Parola curentă nu este corectă.",
    });
  }

  if ((user.email || "").toLowerCase() === emailTrimmed) {
    return res.status(400).json({
      error: "same_email",
      message: "Emailul nou este identic cu cel curent.",
    });
  }

  const existing = await prisma.user.findUnique({
    where: { email: emailTrimmed },
    select: { id: true },
  });

  if (existing && existing.id !== user.id) {
    return res.status(400).json({
      error: "email_taken",
      message: "Există deja un cont cu acest email.",
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  await prisma.user.update({
    where: { id: userId },
    data: {
      emailChangeToken: token,
      emailChangeNewEmail: emailTrimmed,
      emailChangeExpiresAt: expiresAt,
    },
  });

  const confirmUrl = `${req.protocol}://${req.get(
    "host"
  )}/api/vendor/settings/account/change-email/confirm?token=${encodeURIComponent(token)}`;

  await sendEmailChangeVerificationEmail({
    to: emailTrimmed,
    link: confirmUrl,
  });

  return res.json({
    ok: true,
    pendingEmail: emailTrimmed,
    message: "Ți-am trimis un email de confirmare la adresa nouă.",
  });
});

/* =========================
   POST /api/vendor/settings/security/password-reset/request
========================= */
router.post("/vendor/settings/security/password-reset/request", async (req, res) => {
  const userId = req.user.sub || req.user.id;

  const parsed = VendorPasswordResetRequestPayload.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }

  const vendor = await getVendorForUser(userId);
  if (!vendor) return res.status(404).json({ error: "not_a_vendor" });

  const email = (req.user?.email || (await getUserEmailById(userId)) || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email_missing", message: "Nu am găsit emailul contului." });

  // cooldown
  const last = await prisma.passwordResetToken.findFirst({
    where: { userId, createdAt: { gt: secondsAgo(24 * 3600) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (last && last.createdAt > secondsAgo(FP_COOLDOWN_SECONDS)) {
    return res.status(429).json({
      error: "too_many_requests",
      message: "Ai cerut recent un link de resetare. Mai încearcă în câteva minute.",
      retryAfterSec: FP_COOLDOWN_SECONDS,
    });
  }

  // daily cap
  const count24h = await prisma.passwordResetToken.count({
    where: { userId, createdAt: { gt: secondsAgo(24 * 3600) } },
  });

  if (count24h >= FP_DAILY_CAP) {
    return res.status(429).json({
      error: "too_many_requests",
      message: "Ai atins limita zilnică de linkuri de resetare. Revino mai târziu.",
      limitPerDay: FP_DAILY_CAP,
    });
  }

  // cleanup
  await prisma.passwordResetToken.deleteMany({
    where: { userId, usedAt: null, expiresAt: { lt: new Date() } },
  });

  // token nou
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = addMinutes(new Date(), RESET_TOKEN_TTL_MINUTES);

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  const link = `${APP_URL}/reset-parola?token=${encodeURIComponent(raw)}`;

  try {
    await sendPasswordResetEmail({ to: email, link });
  } catch (e) {
    console.warn("sendPasswordResetEmail failed:", e?.message || e);
  }

  return res.json({ ok: true });
});

/* =========================
   POST /api/vendor/settings/account/deactivate/request
========================= */
router.post("/vendor/settings/account/deactivate/request", async (req, res) => {
  const userId = req.user.sub || req.user.id;

  const parsed = DeactivateRequestPayload.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }

  const vendor = await getVendorForUser(userId);
  if (!vendor) return res.status(404).json({ error: "not_a_vendor" });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 oră

  await prisma.user.update({
    where: { id: userId },
    data: {
      vendorDeactivateToken: tokenHash,
      vendorDeactivateExpiresAt: expiresAt,
    },
  });

  const appUrl = baseAppUrl();

  const link = appUrl
    ? `${appUrl}/vendor/settings/confirm-deactivate?token=${encodeURIComponent(rawToken)}`
    : `token:${rawToken}`;

  const email = (req.user?.email || (await getUserEmailById(userId)) || "").trim().toLowerCase();

  await sendVendorDeactivateConfirmEmail({ to: email, link });

  return res.json({ ok: true });
});

/* =========================
   POST /api/vendor/settings/account/deactivate/confirm
========================= */
router.post("/vendor/settings/account/deactivate/confirm", async (req, res) => {
  const userId = req.user.sub || req.user.id;

  const parsed = DeactivateConfirmPayload.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
  }

  const vendor = await getVendorForUser(userId);
  if (!vendor) return res.status(404).json({ error: "not_a_vendor" });

  const now = new Date();
  const incomingHash = sha256(parsed.data.token);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      vendorDeactivateToken: true,
      vendorDeactivateExpiresAt: true,
    },
  });

  if (!user?.vendorDeactivateToken || user.vendorDeactivateToken !== incomingHash) {
    return res.status(400).json({ error: "invalid_token" });
  }
  if (!user.vendorDeactivateExpiresAt || user.vendorDeactivateExpiresAt < now) {
    return res.status(400).json({ error: "token_expired" });
  }

  const anonName = makeAnonymizedDisplayName(vendor.id);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          vendorDeactivateToken: null,
          vendorDeactivateExpiresAt: null,
        },
      });

      await tx.vendor.update({
        where: { id: vendor.id },
        data: {
          isActive: false,
          displayName: anonName,

          about: null,
          logoUrl: null,
          coverUrl: null,
          phone: null,
          email: null,
          website: null,
          socials: null,
          address: null,
          delivery: { set: [] },
          city: null,
          citySlug: null,
        },
      });

      const services = await tx.vendorService.findMany({
        where: { vendorId: vendor.id },
        select: { id: true },
      });

      if (services.length) {
        const serviceIds = services.map((s) => s.id);

        await tx.vendorService.updateMany({
          where: { id: { in: serviceIds } },
          data: { isActive: false, status: "INACTIVE" },
        });

        await tx.product.updateMany({
          where: { serviceId: { in: serviceIds } },
          data: { isHidden: true, isActive: false },
        });
      }

      await tx.userMarketingPrefs.upsert({
        where: { userId },
        update: {
          marketingOptIn: false,
          emailEnabled: false,
          smsEnabled: false,
          pushEnabled: false,
          topics: { set: [] },
          updatedAt: now,
        },
        create: {
          userId,
          marketingOptIn: false,
          emailEnabled: false,
          smsEnabled: false,
          pushEnabled: false,
          topics: [],
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          status: "SUSPENDED",
          tokenVersion: { increment: 1 },

          firstName: null,
          lastName: null,
          phone: null,
          name: null,
          city: null,
          avatarUrl: null,
          preferences: null,
          marketingOptIn: false,
        },
      });

      await tx.notification.updateMany({
        where: { vendorId: vendor.id, archived: false },
        data: { archived: true, readAt: now },
      });

      await tx.messageThread.updateMany({
        where: { vendorId: vendor.id, archived: false },
        data: { archived: true },
      });
    });

    return res.json({
      ok: true,
      vendorId: vendor.id,
      vendorDisplayName: anonName,
      message: "Contul de vendor a fost dezactivat (safe). Datele sensibile au rămas intacte.",
    });
  } catch (e) {
    console.error("Deactivate vendor account failed:", e);
    return res.status(500).json({
      error: "deactivate_failed",
      message: e?.message || "Nu am putut dezactiva contul de vendor.",
    });
  }
});

export default router;
