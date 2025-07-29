import express from 'express';
import auth from '../middleware/auth.js';
import Product from '../models/product.js';

const router = express.Router();

// 🔐 Returnează produsele vânzătorului logat
router.get('/my', auth, async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.user.id });
    res.json(products);
  } catch (err) {
    console.error('Eroare /products/my:', err);
    res.status(500).json({ msg: 'Eroare server' });
  }
});

export default router;
