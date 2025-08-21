import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/user.js';
import auth from '../middleware/auth.js';
import { forgotPassword, resetPassword } from "../controllers/authController.js";

dotenv.config();
const router = express.Router();

// 🔐 Înregistrare
router.post('/register', async (req, res) => {
  const { name, email, password, role = 'user' } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ msg: 'Toate câmpurile sunt obligatorii!' });
  }
  try {
    const userExists = await User.findOne({ email }).select('_id').lean().maxTimeMS(5000);
    if (userExists) return res.status(400).json({ msg: 'Emailul există deja!' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.status(201).json({ token, role: user.role });
  } catch (err) {
    console.error('Eroare la înregistrare:', err);
    res.status(500).json({ msg: 'Eroare la înregistrare!' });
  }
});

// 🔐 Logare
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email })
      .select('password role cart favorites')
      .lean()
      .maxTimeMS(5000);
    if (!user) return res.status(400).json({ msg: 'Email sau parolă incorectă!' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ msg: 'Email sau parolă incorectă!' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({
      token,
      role: user.role,
      cart: user.cart || [],
      favorites: user.favorites || []
    });
  } catch (err) {
    console.error('Eroare la logare:', err);
    res.status(500).json({ msg: 'Eroare la logare!' });
  }
});

// 🔑 Login prin token
router.post('/login-token', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('cart favorites')
      .lean()
      .maxTimeMS(5000);
    if (!user) return res.status(404).json({ msg: 'Utilizator inexistent' });

    res.json({
      cart: user.cart || [],
      favorites: user.favorites || []
    });
  } catch (err) {
    console.error('Eroare la login-token:', err);
    res.status(500).json({ msg: 'Eroare la preluarea datelor' });
  }
});

// 💾 Salvare date (cart + favorites)
router.post('/save-data', auth, async (req, res) => {
  const { cart, favorites } = req.body;
  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { cart: cart || [], favorites: favorites || [] },
      { new: true, projection: '_id', lean: true, maxTimeMS: 5000 }
    );
    if (!updatedUser) return res.status(404).json({ msg: 'Utilizatorul nu a fost găsit' });
    res.json({ msg: 'Date salvate cu succes' });
  } catch (err) {
    console.error('❌ Eroare la salvarea datelor:', err);
    res.status(500).json({ msg: 'Eroare la salvarea datelor' });
  }
});

// 🔍 Profil complet
router.get('/profil', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .lean()
      .maxTimeMS(5000);
    if (!user) return res.status(404).json({ msg: 'Utilizatorul nu a fost găsit' });
    res.json(user);
  } catch (err) {
    console.error('❌ Eroare la obținerea profilului:', err);
    res.status(500).json({ msg: 'Eroare la obținerea profilului' });
  }
});

// ✅ Datele utilizatorului logat – minimal & rapid
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('name email role cart favorites') // doar ce folosește UI de obicei
      .lean()
      .maxTimeMS(5000);
    if (!user) return res.status(404).json({ msg: 'Utilizatorul nu a fost găsit' });

    res.json({
      _id: user._id,
      id: user._id,      // compat
      name: user.name,
      email: user.email,
      role: user.role,
      cart: user.cart || [],
      favorites: user.favorites || []
    });
  } catch (err) {
    console.error('❌ Eroare la obținerea datelor utilizatorului:', err);
    res.status(500).json({ msg: 'Eroare la obținerea datelor utilizatorului' });
  }
});

// ✅ Forgot/Reset Password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

export default router;
