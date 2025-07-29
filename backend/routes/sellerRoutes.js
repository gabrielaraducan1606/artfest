import express from 'express';
import auth from '../middleware/auth.js';
import Seller from '../models/seller.js';
import User from '../models/user.js';

const router = express.Router();

// 🔸 Creează profil de vânzător
router.post('/', auth, async (req, res) => {
  try {
    const existing = await Seller.findOne({ userId: req.user.id });
    if (existing) {
      return res.status(400).json({ msg: 'Ai deja un profil de vânzător.' });
    }

    const newSeller = new Seller({
      userId: req.user.id,
      ...req.body,
    });

    await newSeller.save();
    res.status(201).json({ msg: 'Profilul de vânzător a fost creat cu succes.' });
  } catch (err) {
    console.error('Eroare la salvarea profilului vânzător:', err);
    res.status(500).json({ msg: 'Eroare la salvare.' });
  }
});

// 🔸 Obține datele vânzătorului logat
router.get('/me', auth, async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) return res.status(404).json({ msg: 'Nu ai un profil de vânzător.' });
    res.json(seller);
  } catch (err) {
    console.error('Eroare /seller/me:', err);
    res.status(500).json({ msg: 'Eroare server' });
  }
});

// 🔸 Actualizează profilul de vânzător
router.put('/me', auth, async (req, res) => {
  try {
    const updated = await Seller.findOneAndUpdate(
      { userId: req.user.id },
      { ...req.body },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error('Eroare la actualizare seller:', err);
    res.status(500).json({ msg: 'Eroare la actualizare' });
  }
});

export default router;
