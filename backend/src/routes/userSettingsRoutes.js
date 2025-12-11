// src/api/accountSettings.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmailChangeVerificationEmail } from "../lib/mailer.js";

const router = Router();

const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, message: code, ...extra });

// APP_URL pentru redirect după confirmare
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(
  /\/+$/,
  ""
);

// helper mic – să fim safe dacă auth pune id în `sub` sau `id`
function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

/* ===================== Profil user /me ===================== */

router.get("/me/profile", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true, // nume afișat (dacă îl folosești în alte părți)
      avatarUrl: true,
      createdAt: true,
      preferences: true,
    },
  });
  if (!u) return error(res, "user_not_found", 404);

  // dacă name nu e setat dar avem first+last, îl derivăm
  const displayName =
    u.name ||
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    "";

  res.json({
    user: {
      ...u,
      name: displayName,
    },
  });
});

router.patch("/me/profile", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!u) return error(res, "user_not_found", 404);

  const firstName =
    typeof req.body.firstName === "string"
      ? req.body.firstName.trim()
      : undefined;
  const lastName =
    typeof req.body.lastName === "string"
      ? req.body.lastName.trim()
      : undefined;
  const avatarUrl =
    typeof req.body.avatarUrl === "string"
      ? req.body.avatarUrl.trim()
      : undefined;

  if (
    firstName === undefined &&
    lastName === undefined &&
    avatarUrl === undefined
  ) {
    return error(res, "nothing_to_update", 400, {
      message: "Nu ai modificat niciun câmp.",
    });
  }

  // calculăm numele afișat (name) dacă s-a modificat ceva la first/last
  let nameUpdate;
  if (firstName !== undefined || lastName !== undefined) {
    const current = await prisma.user.findUnique({
      where: { id: u.id },
      select: { firstName: true, lastName: true },
    });
    const nextFirst =
      firstName !== undefined ? firstName : current?.firstName || "";
    const nextLast =
      lastName !== undefined ? lastName : current?.lastName || "";
    nameUpdate = [nextFirst, nextLast].filter(Boolean).join(" ") || null;
  }

  const updated = await prisma.user.update({
    where: { id: u.id },
    data: {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(nameUpdate !== undefined ? { name: nameUpdate } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  res.json({
    ok: true,
    user: updated,
  });
});

/* ===================== Notificări user /me ===================== */

router.get("/me/notifications", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, preferences: true },
  });
  if (!u) return error(res, "user_not_found", 404);

  const notif = u.preferences?.notifications || {};

  res.json({
    notifications: {
      inAppMessageNew: notif.inAppMessageNew ?? true,
      inAppBookingUpdates: notif.inAppBookingUpdates ?? true,
      inAppEventReminders: notif.inAppEventReminders ?? true,
    },
  });
});

router.patch("/me/notifications", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, preferences: true },
  });
  if (!u) return error(res, "user_not_found", 404);

  const prev = u.preferences || {};
  const curr = prev.notifications || {};
  const patch = req.body?.notifications || {};

  const nextNotifications = {
    inAppMessageNew:
      typeof patch.inAppMessageNew === "boolean"
        ? patch.inAppMessageNew
        : curr.inAppMessageNew ?? true,
    inAppBookingUpdates:
      typeof patch.inAppBookingUpdates === "boolean"
        ? patch.inAppBookingUpdates
        : curr.inAppBookingUpdates ?? true,
    inAppEventReminders:
      typeof patch.inAppEventReminders === "boolean"
        ? patch.inAppEventReminders
        : curr.inAppEventReminders ?? true,
  };

  await prisma.user.update({
    where: { id: u.id },
    data: {
      preferences: {
        ...prev,
        notifications: nextNotifications,
      },
    },
    select: { id: true },
  });

  res.json({ ok: true, notifications: nextNotifications });
});

/* ===================== Schimbare email (pas 1: cere schimbarea) ===================== */

router.post("/change-email", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  const { currentPassword, newEmail } = req.body || {};

  if (!currentPassword || typeof currentPassword !== "string") {
    return error(res, "current_password_required", 400, {
      message: "Parola curentă este obligatorie.",
    });
  }

  if (!newEmail || typeof newEmail !== "string") {
    return error(res, "new_email_required", 400, {
      message: "Emailul nou este obligatoriu.",
    });
  }

  const emailTrimmed = newEmail.trim().toLowerCase();
  if (!emailTrimmed.includes("@") || !emailTrimmed.includes(".")) {
    return error(res, "invalid_email", 400, {
      message: "Te rugăm să introduci un email valid.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      firstName: true,
      lastName: true,
      emailChangeToken: true,
      emailChangeNewEmail: true,
      emailChangeExpiresAt: true,
    },
  });

  if (!user) return error(res, "user_not_found", 404);

  if (!user.passwordHash) {
    return error(res, "no_password_set", 400, {
      message:
        "Contul tău nu are o parolă setată (probabil creat prin login social).",
    });
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    return error(res, "invalid_current_password", 400, {
      message: "Parola curentă nu este corectă.",
    });
  }

  if (user.email.toLowerCase() === emailTrimmed) {
    return error(res, "same_email", 400, {
      message: "Emailul nou este identic cu cel curent.",
    });
  }

  const existing = await prisma.user.findUnique({
    where: { email: emailTrimmed },
    select: { id: true },
  });

  if (existing && existing.id !== user.id) {
    return error(res, "email_taken", 400, {
      message: "Există deja un cont cu acest email.",
    });
  }

  // GENERĂM TOKEN & PUNEM EMAILUL ÎN PENDING
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailChangeToken: token,
      emailChangeNewEmail: emailTrimmed,
      emailChangeExpiresAt: expiresAt,
    },
    select: { id: true },
  });

  // Link de confirmare – merge direct în API, care apoi redirectează înapoi în aplicație
  const confirmUrl = `${req.protocol}://${req.get(
    "host"
  )}/api/account/change-email/confirm?token=${encodeURIComponent(token)}`;

  await sendEmailChangeVerificationEmail({
    to: emailTrimmed,
    link: confirmUrl,
  });

  return res.json({
    ok: true,
    pendingEmail: emailTrimmed,
    message:
      "Ți-am trimis un email de confirmare la adresa nouă. Te rugăm să accesezi linkul pentru a finaliza schimbarea.",
  });
});

/* ===================== Confirmare schimbare email (pas 2) ===================== */

router.get("/change-email/confirm", async (req, res) => {
  const { token } = req.query || {};

  if (!token || typeof token !== "string") {
    return error(res, "invalid_token", 400, {
      message: "Token lipsă sau invalid.",
    });
  }

  const now = new Date();

  const user = await prisma.user.findFirst({
    where: {
      emailChangeToken: token,
      emailChangeExpiresAt: {
        gt: now,
      },
    },
    select: {
      id: true,
      email: true,
      emailChangeNewEmail: true,
    },
  });

  if (!user || !user.emailChangeNewEmail) {
    return error(res, "invalid_or_expired_token", 400, {
      message:
        "Linkul de confirmare este invalid sau a expirat. Te rugăm să reîncerci schimbarea emailului.",
    });
  }

  // re-verificăm să nu fie între timp folosit de altcineva
  const taken = await prisma.user.findUnique({
    where: { email: user.emailChangeNewEmail.toLowerCase() },
    select: { id: true },
  });

  if (taken && taken.id !== user.id) {
    // curățăm pending
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailChangeToken: null,
        emailChangeNewEmail: null,
        emailChangeExpiresAt: null,
      },
    });

    return error(res, "email_taken", 400, {
      message:
        "Între timp, această adresă de email este folosită de un alt cont.",
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: user.emailChangeNewEmail.toLowerCase(),
      emailChangeToken: null,
      emailChangeNewEmail: null,
      emailChangeExpiresAt: null,
    },
    select: {
      id: true,
      email: true,
    },
  });

  // dacă avem APP_URL, redirect către frontend cu un query param
  if (APP_URL) {
    return res.redirect(
      `${APP_URL}/setari-cont?tab=security&emailChange=ok`
    );
  }

  return res.json({
    ok: true,
    user: updated,
    message: "Adresa de email a fost actualizată.",
  });
});
/* ===================== Ștergere cont ===================== */

router.delete("/me", authRequired, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return error(res, "unauthorized", 401);

  try {
    // 1. Luăm user-ul curent cu câmpurile de care avem nevoie
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        lastLoginAt: true,
        scheduledDeletionAt: true,
      },
    });

    if (!user) return error(res, "user_not_found", 404);

    // 2. Verificăm dacă are comenzi (pentru log)
    const ordersCount = await prisma.order.count({
      where: { userId: user.id },
    });

    const hadOrders = ordersCount > 0;

    // 3. Generăm datele de anonimizare
    const deletedEmail = `deleted+${user.id}@deleted.local`;
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const randomPasswordHash = await bcrypt.hash(randomPassword, 12);

    // 4. Rulăm totul într-o singură tranzacție
    await prisma.$transaction(async (tx) => {
      // 4.1. Log în InactiveUserLog
      await tx.inactiveUserLog.create({
        data: {
          userId: user.id,
          email: user.email, // dacă vrei extra-GDPR, poți salva un hash aici
          deletedAt: new Date(),
          reason: "USER_REQUEST",
          hadOrders,
          monthsInactive: null,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          scheduledDeletionAt: user.scheduledDeletionAt,
          meta: {},
        },
      });

      // 4.2. Curățăm date non-critice legate de user
      await tx.cartItem.deleteMany({ where: { userId: user.id } });
      await tx.favorite.deleteMany({ where: { userId: user.id } });
      await tx.serviceFollow.deleteMany({ where: { userId: user.id } });
      await tx.userVendorBlock.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.supportRead.deleteMany({ where: { userId: user.id } });
      await tx.userMarketingPrefs.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
      await tx.loginAttempt.deleteMany({ where: { userId: user.id } });

      // 4.3. Anonimizăm user-ul (soft delete + blocare cont)
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: deletedEmail,
          firstName: null,
          lastName: null,
          phone: null,
          city: null,
          avatarUrl: null,
          name: null,
          marketingOptIn: false,
          preferences: {},
          status: "SUSPENDED", // folosit ca „DELETED”
          locked: true,

          // email-change in progress → curățate
          emailChangeToken: null,
          emailChangeNewEmail: null,
          emailChangeExpiresAt: null,

          // opțional: considerăm emailul „neconfirmat” după ștergere
          emailVerifiedAt: null,

          // parolă random și invalidăm toate sesiunile
          passwordHash: randomPasswordHash,
          tokenVersion: { increment: 1 },
        },
      });
    });

    // 5. Logout: ștergem cookie-ul token
    const isProd = process.env.NODE_ENV === "production";
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "None" : "Lax",
      path: "/",
    });

    return res.json({
      ok: true,
      message: "Contul tău a fost șters (anonimizat).",
    });
  } catch (e) {
    console.error("DELETE /api/account/me error:", e);
    return error(res, "delete_failed", 500, {
      message: "Nu am putut șterge contul. Te rugăm să încerci din nou.",
    });
  }
});

export default router;
