// src/routes/resetPassword.js
import { prisma } from "../db.js"; // ajustează dacă fișierul tău e în altă parte
import { hashToken } from "../utils/passwordReset.js";
import bcrypt from "bcrypt";

const PASSWORD_HISTORY_LIMIT = Number(process.env.PASSWORD_HISTORY_LIMIT || 5);

export default async function resetPassword(req, res) {
  if (req.method && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ message: "Date lipsă" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Parola prea scurtă" });
    }

    const tokenHash = hashToken(token);
    const prt = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!prt || prt.usedAt || prt.expiresAt < new Date()) {
      return res.status(400).json({ message: "Token invalid sau expirat" });
    }

    const user = prt.user;
    if (!user) {
      return res.status(400).json({ message: "Utilizator inexistent" });
    }

    // 1) nu acceptăm parola identică
    const sameAsCurrent = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({
        error: "same_as_current",
        message: "Parola nouă nu poate fi identică cu parola curentă.",
      });
    }

    // 2) nu acceptăm ultimele N parole
    if (PASSWORD_HISTORY_LIMIT > 0) {
      const recent = await prisma.passwordHistory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: PASSWORD_HISTORY_LIMIT,
        select: { passwordHash: true },
      });
      for (const h of recent) {
        if (await bcrypt.compare(newPassword, h.passwordHash)) {
          return res.status(400).json({
            error: "password_reused",
            message: `Nu poți reutiliza una dintre ultimele ${PASSWORD_HISTORY_LIMIT} parole.`,
          });
        }
      }
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      // mută parola veche în istoric
      await tx.passwordHistory.create({
        data: { userId: user.id, passwordHash: user.passwordHash },
      });

      // setează parola nouă + revocă toate sesiunile (tokenVersion++) + update lastPasswordChangeAt
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
          lastPasswordChangeAt: new Date(), // 👈 important pt tabul de securitate
        },
      });

      // marchează tokenul ca folosit
      await tx.passwordResetToken.update({
        where: { id: prt.id },
        data: { usedAt: new Date() },
      });

      // invalidează alte tokenuri active
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null, id: { not: prt.id } },
      });

      // păstrează doar ultimele N parole în istoric
      if (PASSWORD_HISTORY_LIMIT > 0) {
        const extra = await tx.passwordHistory.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          skip: PASSWORD_HISTORY_LIMIT,
          select: { id: true },
        });
        if (extra.length) {
          await tx.passwordHistory.deleteMany({
            where: { id: { in: extra.map((x) => x.id) } },
          });
        }
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("resetPassword error:", e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
