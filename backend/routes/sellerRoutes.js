import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import Seller from '../models/seller.js';
import auth from '../middleware/auth.js';
import { uploadToStorage } from '../utils/storage.js';
import Product from "../models/product.js";
import Review from "../models/review.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// 📌 URL public API pentru imagini
const API_URL = process.env.API_URL || "http://localhost:5000";

/** Validator minim inline */
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

// 📌 GET /api/seller/me
router.get('/me', auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id });
  if (!seller) return res.status(404).json({ msg: 'Not found' });
  res.json(seller);
});

// 📌 POST /api/seller
router.post(
  '/',
  auth,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  async (req, res) => {
    const errors = validateSellerBody(req.body);
    if (errors.length) {
      return res.status(400).json({ msg: 'Validare eșuată', errors });
    }

    try {
      const entityType = String(req.body.entityType || '').toLowerCase();
      const passwordHash = await bcrypt.hash(req.body.password, 10);

      let profileImageUrl, coverImageUrl;
      if (req.files?.profileImage?.[0]) {
        profileImageUrl = await uploadToStorage(
          req.files.profileImage[0],
          `sellers/${req.user.id}/profile.png`
        );
      }
      if (req.files?.coverImage?.[0]) {
        coverImageUrl = await uploadToStorage(
          req.files.coverImage[0],
          `sellers/${req.user.id}/cover.png`
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
        userId: req.user.id,
      };

      const seller = await Seller.findOneAndUpdate(
        { userId: req.user.id },
        { $set: payload },
        { new: true, upsert: true, runValidators: true }
      );

      res.status(201).json(seller);
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ msg: 'Username deja folosit' });
      }
      res.status(400).json({ msg: 'Seller validation failed', error: err.message });
    }
  }
);

// 📌 GET /api/seller/settings
router.get('/settings', auth, async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) {
      return res.status(404).json({ msg: 'Profil vânzător inexistent' });
    }
    res.json(seller);
  } catch (err) {
    console.error('Eroare GET /seller/settings:', err);
    res.status(500).json({ msg: 'Eroare server' });
  }
});

// 📌 PATCH /api/seller/settings
router.patch(
  '/settings',
  auth,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      let seller = await Seller.findOne({ userId: req.user.id });
      if (!seller) {
        return res.status(404).json({ msg: 'Profil vânzător inexistent' });
      }

      Object.keys(req.body).forEach((key) => {
        if (req.body[key] !== "" && req.body[key] !== null) {
          seller[key] = req.body[key];
        }
      });

      if (req.files?.profileImage?.[0]) {
        seller.profileImageUrl = await uploadToStorage(
          req.files.profileImage[0],
          `sellers/${req.user.id}/profile-${Date.now()}.png`
        );
      }
      if (req.files?.coverImage?.[0]) {
        seller.coverImageUrl = await uploadToStorage(
          req.files.coverImage[0],
          `sellers/${req.user.id}/cover-${Date.now()}.png`
        );
      }

      await seller.save();
      res.json({ msg: '✅ Setări salvate cu succes', seller });
    } catch (err) {
      console.error('❌ Eroare PATCH /seller/settings:', err);
      res.status(500).json({ msg: 'Eroare server', error: err.message });
    }
  }
);

// 📌 GET /api/seller/public
router.get("/public", async (req, res) => {
  try {
    let sellers = await Seller.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "userId",
          foreignField: "sellerId",
          as: "products"
        }
      },
      {
        $lookup: {
          from: "reviews",
          localField: "userId",
          foreignField: "sellerId",
          as: "reviews"
        }
      },
      {
        $addFields: {
          productCount: { $size: "$products" },
          rating: { $avg: "$reviews.rating" }
        }
      },
      {
        $project: {
          shopName: 1,
          shortDescription: 1,
          city: 1,
          country: 1,
          profileImageUrl: 1,
          coverImageUrl: 1,
          category: 1,
          productCount: 1,
          rating: { $ifNull: ["$rating", 0] }
        }
      }
    ]);

    sellers = sellers.map(seller => {
      if (seller.profileImageUrl && !seller.profileImageUrl.startsWith("http")) {
        seller.profileImageUrl = `${API_URL}/${seller.profileImageUrl}`;
      }
      if (seller.coverImageUrl && !seller.coverImageUrl.startsWith("http")) {
        seller.coverImageUrl = `${API_URL}/${seller.coverImageUrl}`;
      }
      return seller;
    });

    res.json(sellers);
  } catch (err) {
    console.error("❌ Eroare /seller/public:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 📌 GET /api/seller/public/:id
router.get("/public/:id", async (req, res) => {
  try {
    const seller = await Seller.findById(req.params.id)
      .select("shopName shortDescription city country profileImageUrl coverImageUrl category brandStory userId");

    if (!seller) {
      return res.status(404).json({ msg: "Vânzător inexistent" });
    }

 if (seller.profileImageUrl && !seller.profileImageUrl.startsWith("http")) {
  seller.profileImageUrl = `${API_URL}${seller.profileImageUrl}`;
}
if (seller.coverImageUrl && !seller.coverImageUrl.startsWith("http")) {
  seller.coverImageUrl = `${API_URL}${seller.coverImageUrl}`;
}

    const productCount = await Product.countDocuments({ sellerId: seller.userId });

    const reviews = await Review.find({ sellerId: seller.userId });
    const rating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    res.json({
      ...seller.toObject(),
      productCount,
      rating: Number(rating.toFixed(1)),
    });
  } catch (err) {
    console.error("❌ Eroare /seller/public/:id:", err);
    res.status(500).json({ msg: "Eroare server", error: err.message });
  }
});

export default router;
