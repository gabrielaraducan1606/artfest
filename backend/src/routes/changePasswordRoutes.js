// src/routes/changePassword.js
import { prisma } from "../db.js";
import bcrypt from "bcrypt";

const PASSWORD_HISTORY_LIMIT = Number(process.env.PASSWORD_HISTORY_LIMIT || 5);

export default async function changePassword(req, res) {
  if (req.method && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // 👇 authRequired pune { sub, role, tv } în req.user
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Neautentificat" });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Date lipsă" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Parola prea scurtă" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(400).json({ message: "Utilizator inexistent" });
    }

    // 1) verificăm parola curentă
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(400).json({
        error: "invalid_current_password",
        message: "Parola curentă nu este corectă.",
      });
    }

    // 2) nu acceptăm parola identică
    const sameAsCurrent = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({
        error: "same_as_current",
        message: "Parola nouă nu poate fi identică cu parola curentă.",
      });
    }

    // 3) nu acceptăm ultimele N parole
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
      // mutăm parola veche în istoric
      await tx.passwordHistory.create({
        data: { userId: user.id, passwordHash: user.passwordHash },
      });

      // setăm parola nouă + revocăm sesiunile + logăm momentul schimbării
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
          lastPasswordChangeAt: new Date(),
        },
      });

      // păstrăm doar ultimele N parole în istoric
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

    // mic log de debug
    console.log("Parola schimbată pentru user", user.id, "din settings");

    return res.json({ ok: true });
  } catch (e) {
    console.error("changePassword error:", e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
