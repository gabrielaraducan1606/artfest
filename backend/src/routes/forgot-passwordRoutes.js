// src/routes/forgot-passwordRoutes.js
import { prisma } from "../db.js";
import { addMinutes, generateRawToken, hashToken } from "../utils/passwordReset.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");

// Configurabil prin env:
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60); // durata de viață a link-ului
const FP_COOLDOWN_SECONDS = Number(process.env.FP_COOLDOWN_SECONDS || 120);       // cât timp între 2 cereri
const FP_DAILY_CAP = Number(process.env.FP_DAILY_CAP || 5);                        // câte cereri/24h

// Helper mic: „acum minus X secunde”
function secondsAgo(sec) {
  return new Date(Date.now() - sec * 1000);
}

export default async function forgotPassword(req, res) {
  if (req.method && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email lipsă" });

    const normalized = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });

    // RĂSPUNS GENERIC când nu există (anti-enumerare).
    if (!user) return res.json({ ok: true });

    // 1) COOLDOWN: nu permite spam la câteva secunde distanță
    // găsim cel mai recent token (indiferent dacă e folosit sau nu), dar doar în ultimele 24h
    const last = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: secondsAgo(24 * 3600) },
      },
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

    // 2) DAILY CAP: maxim N cereri în ultimele 24h
    const count24h = await prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        createdAt: { gt: secondsAgo(24 * 3600) },
      },
    });
    if (count24h >= FP_DAILY_CAP) {
      return res.status(429).json({
        error: "too_many_requests",
        message: "Ai atins limita zilnică de linkuri de resetare. Revino mai târziu.",
        limitPerDay: FP_DAILY_CAP,
      });
    }

    // 3) Curățăm tokenurile EXPIRATE și nefolosite
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null, expiresAt: { lt: new Date() } },
    });

    // 4) Creăm un token NOU
    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    const expiresAt = addMinutes(new Date(), RESET_TOKEN_TTL_MINUTES);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const link = `${APP_URL}/reset-parola?token=${raw}`;

    // 5) Trimitem emailul (nu blocăm fluxul pe eroarea SMTP)
    try {
      await sendPasswordResetEmail({ to: normalized, link });
    } catch (e) {
      // nu expunem eroarea SMTP; returnăm ok pentru a evita enumerarea
      console.warn("sendPasswordResetEmail failed:", e?.message || e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("forgotPassword error:", e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
