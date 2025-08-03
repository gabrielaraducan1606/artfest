import express from "express";
import multer from "multer";
import auth from "../middleware/auth.js";
import Product from "../models/product.js";
import { uploadToStorage } from "../utils/storage.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// 📌 URL API din .env sau fallback local
const API_URL = process.env.API_URL || "http://localhost:5000";

// 🔧 Funcție utilitară — convertește imaginile în URL-uri absolute
const withAbsoluteImageUrls = (product) => {
  if (!product) return product;
  const obj = product.toObject ? product.toObject() : product;

  if (Array.isArray(obj.images)) {
    obj.images = obj.images.map((img) =>
      img && !img.startsWith("http") ? `${API_URL}${img}` : img
    );
  }

  return obj;
};

// 🔐 Returnează produsele vânzătorului logat
router.get("/my", auth, async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.user.id });
    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/my:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 📥 Returnează un singur produs al vânzătorului
router.get("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) {
      return res.status(404).json({ msg: "Produs inexistent" });
    }
    res.json(withAbsoluteImageUrls(product));
  } catch (err) {
    console.error("Eroare /products/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ➕ Adaugă produs nou (acceptă mai multe imagini)
router.post("/", auth, upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      imageUrls = await Promise.all(
        req.files.map((file) =>
          uploadToStorage(
            file,
            `products/${req.user.id}/${Date.now()}-${file.originalname}`
          )
        )
      );
    }

    const product = new Product({
      title: req.body.title,
      price: req.body.price,
      description: req.body.description,
      images: imageUrls,
      sellerId: req.user.id,
    });

    await product.save();
    res.status(201).json(withAbsoluteImageUrls(product));
  } catch (err) {
    console.error("Eroare adăugare produs:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ✏️ Editare produs
router.put("/:id", auth, upload.array("images", 5), async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) {
      return res.status(404).json({ msg: "Produs inexistent" });
    }

    if (req.files && req.files.length > 0) {
      product.images = await Promise.all(
        req.files.map((file) =>
          uploadToStorage(
            file,
            `products/${req.user.id}/${Date.now()}-${file.originalname}`
          )
        )
      );
    }

    product.title = req.body.title || product.title;
    product.price = req.body.price || product.price;
    product.description = req.body.description || product.description;

    await product.save();
    res.json(withAbsoluteImageUrls(product));
  } catch (err) {
    console.error("Eroare actualizare produs:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 🗑️ Ștergere produs
router.delete("/:id", auth, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) {
      return res.status(404).json({ msg: "Produs inexistent" });
    }

    res.json({ msg: "Produs șters cu succes" });
  } catch (err) {
    console.error("Eroare ștergere produs:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

router.get('/public/:id', async (req, res) => {
  try {
    let product = await Product.findById(req.params.id)
      .populate("sellerId", "shopName profileImageUrl");

    if (!product) {
      return res.status(404).json({ msg: 'Produs inexistent' });
    }

    // Transformă imaginile produsului în URL absolut
    product = withAbsoluteImageUrls(product);

    // Transformă și logo-ul vânzătorului în URL absolut
    if (product.sellerId?.profileImageUrl && !product.sellerId.profileImageUrl.startsWith("http")) {
      product.sellerId.profileImageUrl = `${API_URL}${product.sellerId.profileImageUrl}`;
    }

    res.json(product);
  } catch (err) {
    console.error('Eroare /products/public/:id:', err);
    res.status(500).json({ msg: 'Eroare server' });
  }
});


export default router;
