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
    obj.images = obj.images.map((img) => {
      if (img && !img.startsWith("http")) {
        return `${API_URL}/${img.replace(/^\/+/, "")}`;
      }
      return img;
    });
  }

  return obj;
};


// 📥 Listă produse publice cu filtrare/sortare/paginare (PUBLICĂ)
router.get("/public", async (req, res) => {
  try {
    const { category, sort = "new", page = 1, limit = 12, search } = req.query;

    const matchStage = {};
    if (category) matchStage.category = category;
    if (search) matchStage.title = { $regex: search, $options: "i" };

    // Pipeline agregare
    let sortOption = {};
    switch (sort) {
      case "price-asc": sortOption.price = 1; break;
      case "price-desc": sortOption.price = -1; break;
      case "rating": sortOption.avgRating = -1; break;
      default: sortOption.createdAt = -1;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const productsAgg = await Product.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "reviews",
          localField: "sellerId",
          foreignField: "sellerId",
          as: "reviews"
        }
      },
      {
        $addFields: {
          avgRating: { $avg: "$reviews.rating" },
          reviewCount: { $size: "$reviews" }
        }
      },
      { $sort: sortOption },
      { $skip: skip },
      { $limit: Number(limit) }
    ]);

    const total = await Product.countDocuments(matchStage);
    const totalPages = Math.ceil(total / Number(limit));

    // Formatare imagini
    const products = productsAgg.map(p => {
      p = withAbsoluteImageUrls(p);
      return p;
    });

    res.json({ products, totalPages });
  } catch (err) {
    console.error("Eroare /products/public:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});


// 📥 Sugestii produse după titlu (PUBLIC)
router.get("/suggestions", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim() === "") {
      return res.json([]);
    }

    // Căutare insensitive în titlu
    const products = await Product.find({
      title: { $regex: query, $options: "i" }
    })
      .limit(8) // max 8 sugestii
      .select("title images"); // doar titlu și imagine

    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/suggestions:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 📥 Produs public după ID (PUBLIC)
router.get("/public/:id", async (req, res) => {
  try {
    let product = await Product.findById(req.params.id)
      .populate("sellerId", "shopName profileImageUrl");

    if (!product) {
      return res.status(404).json({ msg: "Produs inexistent" });
    }

    product = withAbsoluteImageUrls(product);

    if (
      product.sellerId?.profileImageUrl &&
      !product.sellerId.profileImageUrl.startsWith("http")
    ) {
      product.sellerId.profileImageUrl = `${API_URL}/${product.sellerId.profileImageUrl.replace(/^\/+/, "")}`;
    }

    res.json(product);
  } catch (err) {
    console.error("Eroare /products/public/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

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

// 📥 Returnează produs public după ID
router.get("/public/:id", async (req, res) => {
  try {
    let product = await Product.findById(req.params.id)
      .populate("sellerId", "shopName profileImageUrl");

    if (!product) {
      return res.status(404).json({ msg: "Produs inexistent" });
    }

    // Transformă imaginile produsului în URL absolut
    product = withAbsoluteImageUrls(product);

    // Transformă și logo-ul vânzătorului în URL absolut
    if (
      product.sellerId?.profileImageUrl &&
      !product.sellerId.profileImageUrl.startsWith("http")
    ) {
      product.sellerId.profileImageUrl = `${API_URL}/${product.sellerId.profileImageUrl.replace(/^\/+/, "")}`;
    }

    res.json(product);
  } catch (err) {
    console.error("Eroare /products/public/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 📥 Returnează toate produsele publice ale unui vânzător
router.get("/by-seller/:sellerId", async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.params.sellerId });

    if (!products || products.length === 0) {
      return res.json([]);
    }

    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/by-seller/:sellerId:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
