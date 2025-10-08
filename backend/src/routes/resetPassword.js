// server/routes/auth/resetPassword.js
import { PrismaClient } from "@prisma/client";
import { hashToken } from "../../utils/passwordReset.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export default async function resetPassword(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ message: "Date lipsă" });
    if (newPassword.length < 6) return res.status(400).json({ message: "Parola prea scurtă" });

    const tokenHash = hashToken(token);

    const prt = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!prt || prt.usedAt || prt.expiresAt < new Date()) {
      return res.status(400).json({ message: "Token invalid sau expirat" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: prt.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: prt.id },
        data: { usedAt: new Date() },
      }),
      // opțional: invalidează alte tokenuri active
      prisma.passwordResetToken.deleteMany({
        where: { userId: prt.userId, usedAt: null, id: { not: prt.id } },
      }),
    ]);

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
