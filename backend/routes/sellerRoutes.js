import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import Seller from '../models/Seller.js';
import auth from '../middleware/auth.js';
import { uploadToStorage } from '../utils/storage.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/** Validator minim inline — mută-l în utils/validators.js dacă vrei */
function validateSellerBody(body) {
  const errors = [];
  const reqd = (k, label = k) => {
    if (!String(body[k] ?? '').trim()) errors.push(`${label} este obligatoriu`);
  };

  reqd('shopName', 'Nume magazin');
  reqd('username', 'Username');
  reqd('email', 'Email');
  reqd('password', 'Parola');
  reqd('phone', 'Telefon');
  reqd('category', 'Categorie');
  reqd('city', 'Oraș');
  reqd('country', 'Țară');
  reqd('entityType', 'Tip entitate');
  reqd('companyName', 'Denumire companie');
  reqd('cui', 'CUI');
  reqd('registrationNumber', 'Nr. Registrul Comerțului');
  reqd('iban', 'IBAN');

  const entityType = String(body.entityType || '').toLowerCase();
  if (!['pfa', 'srl'].includes(entityType)) errors.push('Tip entitate invalid (pfa/srl)');

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('Email invalid');
  if (body.username && !/^[a-z0-9._-]{3,30}$/.test(body.username)) errors.push('Username invalid (3–30, litere/cifre/._-)');

  return errors;
}

// GET /api/seller/me
router.get('/me', auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) return res.status(404).json({ msg: 'Not found' });
  res.json(seller);
});

// POST /api/seller
router.post(
  '/',
  auth,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage',  maxCount: 1 },
  ]),
  async (req, res) => {
    // validare devreme (clarifică utilizatorului ce lipsește)
    const errors = validateSellerBody(req.body);
    if (errors.length) {
      return res.status(400).json({ msg: 'Validare eșuată', errors });
    }

    try {
      const entityType = String(req.body.entityType || '').toLowerCase();

      const password = req.body.password;
      const passwordHash = await bcrypt.hash(password, 10);

      // uploads (opționale)
      let profileImageUrl, coverImageUrl;
      if (req.files?.profileImage?.[0]) {
        profileImageUrl = await uploadToStorage(
          req.files.profileImage[0],
          `sellers/${req.user._id}/profile.png`
        );
      }
      if (req.files?.coverImage?.[0]) {
        coverImageUrl = await uploadToStorage(
          req.files.coverImage[0],
          `sellers/${req.user._id}/cover.png`
        );
      }

      const payload = {
        shopName: req.body.shopName,
        username: req.body.username?.toLowerCase(),
        email: req.body.email?.toLowerCase(),
        passwordHash,
        phone: req.body.phone,
        publicPhone: req.body.publicPhone === 'true' || req.body.publicPhone === true,
        profileImageUrl,
        coverImageUrl,
        shortDescription: req.body.shortDescription,
        brandStory: req.body.brandStory,
        category: req.body.category,
        city: req.body.city,
        country: req.body.country,
        deliveryNotes: req.body.deliveryNotes,
        returnNotes: req.body.returnNotes,
        entityType,
        companyName: req.body.companyName,
        cui: req.body.cui,
        registrationNumber: req.body.registrationNumber,
        iban: req.body.iban,
        userId: req.user._id,
      };

      // upsert — creează dacă nu există, altfel actualizează
      const seller = await Seller.findOneAndUpdate(
        { userId: req.user._id },
        { $set: payload },
        { new: true, upsert: true, runValidators: true }
      );

      res.status(201).json(seller);
    } catch (err) {
      // E11000 = unique index (username deja folosit)
      if (err?.code === 11000) {
        return res.status(409).json({ msg: 'Username deja folosit' });
      }
      return res.status(400).json({ msg: 'Seller validation failed', error: err.message });
    }
  }
);

export default router;
