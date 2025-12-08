// src/api/accountSettings.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import bcrypt from "bcryptjs";

const router = Router();

const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, message: code, ...extra });

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
      name: true,       // nume afișat (dacă îl folosești în alte părți)
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

/* ===================== Schimbare email ===================== */

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
      passwordHash: true, // adaptează la schema ta dacă se numește altfel
      firstName: true,
      lastName: true,
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

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: emailTrimmed,
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

export default router;
