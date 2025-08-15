// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.js';
import Seller from '../models/Seller.js';

const JWT_SECRET = process.env.JWT_SECRET;

/** POST /users/register  { email, password, role? } */
 const registerUser = async (req, res) => {
  const { email, password, role = 'user' } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: 'Email deja folosit.' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, role });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token, role: user.role });
  } catch (err) {
    console.error('Eroare la înregistrare:', err);
    res.status(500).json({ msg: 'Eroare la înregistrare.' });
  }
};

/** POST /users/login  { email, password } */
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password role');
    if (!user) return res.status(400).json({ msg: 'Utilizator inexistent.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Parolă greșită.' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);

    // opțional: poți include și cart/favorites dacă le folosești
    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ msg: 'Eroare la logare.' });
  }
};

/** GET /users/me */
 const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'Utilizator inexistent' });

    let onboarding = null;
    if (user.role === 'seller') {
      const seller = await Seller.findOne({ userId: user._id }).select('status onboardingStep');
      onboarding = {
        step: seller ? Math.max(1, Math.min(3, seller.onboardingStep || 1)) : 1,
        completed: seller ? seller.status === 'active' : false,
      };
    }

    res.json({
      id: user._id,
      email: user.email,
      role: user.role,
      onboarding, // { step, completed } sau null pentru user normal
    });
  } catch (err) {
    console.error('getProfile:', err);
    res.status(500).json({ msg: 'Eroare server' });
  }
};


//Forgot Password

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      // Securitate: răspuns identic dacă emailul nu există
      return res.json({ msg: "Dacă există un cont, vei primi un email" });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await PasswordReset.deleteMany({ userId: user._id });

    await new PasswordReset({
      userId: user._id,
      token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    }).save();

    const link = `${process.env.FRONTEND_URL}/resetare-parola/${token}`;

    await sendEmail(
      user.email,
      "Resetare parolă Artfest",
      `<p>Ai cerut resetarea parolei.</p>
       <p>Linkul este valabil 15 minute:</p>
       <a href="${link}">${link}</a>`
    );

    res.json({ msg: "Dacă există un cont, vei primi un email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Eroare server" });
  }
};

//Reset Password

 const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  try {
    const reset = await PasswordReset.findOne({ token });
    if (!reset) return res.status(400).json({ msg: "Token invalid" });

    if (reset.expiresAt < new Date()) {
      await PasswordReset.deleteOne({ _id: reset._id });
      return res.status(400).json({ msg: "Token expirat" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.updateOne({ _id: reset.userId }, { password: hashed });

    await PasswordReset.deleteOne({ _id: reset._id });

    res.json({ msg: "Parola resetată cu succes" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Eroare server" });
  }
};

export {
  registerUser,
  loginUser,
  getProfile,
  forgotPassword,
  resetPassword
};