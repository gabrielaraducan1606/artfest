import { prisma } from "../../src/db.js";
import { addMinutes, generateRawToken, hashToken } from "../../src/utils/passwordReset.js";
import { sendPasswordResetEmail } from "../../src/lib/mailer.js";

const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");

export default async function forgotPassword(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email lipsă" });

    const user = await prisma.user.findUnique({ where: { email } });

    // dacă vrei să EXPUI că nu există cont, decomentează cele 3 linii de mai jos:
    // if (!user) {
    //   return res.status(404).json({ error: "user_not_found", message: "Nu există cont cu acest email." });
    // }

    // altfel, răspuns generic (fără enumerare)
    if (!user) return res.json({ ok: true });

    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null, expiresAt: { lt: new Date() } },
    });

    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    const ttl = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
    const expiresAt = addMinutes(new Date(), ttl);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const link = `${APP_URL}/reset-parola?token=${raw}`;

    try { await sendPasswordResetEmail({ to: email, link }); } catch {}

    return res.json({ ok: true });
  } catch (e) {
    console.error("forgotPassword error:", e);
    return res.status(500).json({ message: "Eroare server" });
  }
}
