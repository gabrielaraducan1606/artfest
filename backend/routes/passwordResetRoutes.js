// backend/routes/passwordResetRoutes.js
import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import PasswordReset from "../models/passwordReset.js";
import { sendEmail } from "../utils/sendEmail.js";

const router = express.Router();

/**
 * @route POST /users/forgot-password
 */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: "Utilizatorul nu există" });

    const token = crypto.randomBytes(32).toString("hex");

    await PasswordReset.deleteMany({ userId: user._id });

    const resetDoc = new PasswordReset({
      userId: user._id,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 minute
    });
    await resetDoc.save();

    const resetLink = `${process.env.FRONTEND_URL}/resetare-parola/${token}`;

    await sendEmail(
      user.email,
      "Resetare parolă Artfest",
      `<p>Ai cerut resetarea parolei.</p>
       <p>Apasă pe acest link pentru a seta o nouă parolă (valabil 15 min):</p>
       <a href="${resetLink}">${resetLink}</a>`
    );

    res.json({ msg: "Email de resetare trimis" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/**
 * @route POST /users/reset-password/:token
 */
router.post("/reset-password/:token", async (req, res) => {
  const { password } = req.body;
  const { token } = req.params;
  try {
    const resetDoc = await PasswordReset.findOne({ token });
    if (!resetDoc) return res.status(400).json({ msg: "Token invalid" });

    if (resetDoc.expiresAt < new Date()) {
      await PasswordReset.deleteOne({ _id: resetDoc._id });
      return res.status(400).json({ msg: "Token expirat" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.updateOne(
      { _id: resetDoc.userId },
      { $set: { password: hashedPassword } }
    );

    await PasswordReset.deleteOne({ _id: resetDoc._id });

    res.json({ msg: "Parola a fost resetată cu succes" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
