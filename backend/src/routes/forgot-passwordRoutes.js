// server/routes/auth/forgotPassword.js
import { PrismaClient } from "@prisma/client";
import { addMinutes, generateRawToken, hashToken } from "../../utils/passwordReset.js";
import { sendPasswordResetEmail } from "../../utils/mailer.js";

const prisma = new PrismaClient();

export default async function forgotPassword(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email lipsă" });

    const user = await prisma.user.findUnique({ where: { email } });

    // răspunsul e același indiferent dacă user-ul există (evităm enumeration)
    if (!user) return res.json({ ok: true });

    // invalidăm token-urile vechi nefolosite (opțional)
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null, expiresAt: { lt: new Date() } },
    });

    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    const ttl = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
    const expiresAt = addMinutes(new Date(), ttl);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const link = `${process.env.APP_URL}/reset-parola?token=${raw}`;

    // trimite email (dacă pică, nu aruncăm detalii către client)
    try { await sendPasswordResetEmail({ to: email, link }); } catch {}

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
