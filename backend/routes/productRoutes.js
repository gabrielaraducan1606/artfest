// backend/routes/productRoutes.js
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import auth from "../middleware/auth.js";
import Product from "../models/product.js";
import Seller from "../models/seller.js";
import { uploadToStorage } from "../utils/storage.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const API_URL = (process.env.API_URL || "http://localhost:5000").replace(/\/+$/, "");

/** Absolutizează URL-urile imaginilor. Repară și cele encodate. */
function toAbs(u) {
  if (!u) return u;
  let v = String(u);
  try { v = decodeURIComponent(v); } catch {}
  if (/^https?:\/\//i.test(v)) return v;
  return `${API_URL}/${v.replace(/^\/+/, "")}`;
}

const withAbsoluteImageUrls = (product) => {
  if (!product) return product;
  const obj = product.toObject ? product.toObject() : product;

  if (Array.isArray(obj.images)) {
    obj.images = obj.images.map((img) => (img ? toAbs(img) : img));
  }
  return obj;
};

/* ========================= PUBLIC ========================= */

/** GET /api/products/public
 *  Lista de produse cu filtrare/sortare și embed de seller (slug/username/shopName)
 */
router.get("/public", async (req, res) => {
  try {
    const { category, sort = "new", page = 1, limit = 12, search } = req.query;

    const matchStage = {};
    if (category) matchStage.category = category;
    if (search) matchStage.title = { $regex: search, $options: "i" };

    const sortOption = (() => {
      switch (sort) {
        case "price-asc": return { price: 1 };
        case "price-desc": return { price: -1 };
        case "rating": return { avgRating: -1 };
        default: return { createdAt: -1 };
      }
    })();

    const skip = (Number(page) - 1) * Number(limit);

    const productsAgg = await Product.aggregate([
      { $match: matchStage },

      // review stats (pe seller, dacă așa sunt salvate)
      {
        $lookup: {
          from: "reviews",
          localField: "sellerId",
          foreignField: "sellerId",
          as: "reviews",
        },
      },

      // embed seller (sellers.userId == products.sellerId)
      {
        $lookup: {
          from: "sellers",
          let: { sid: "$sellerId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$sid"] } } },
            { $project: { _id: 1, shopName: 1, slug: 1, username: 1 } },
          ],
          as: "seller",
        },
      },
      {
        $addFields: {
          seller: { $arrayElemAt: ["$seller", 0] },
          avgRating: { $avg: "$reviews.rating" },
          reviewCount: { $size: "$reviews" },
        },
      },

      { $sort: sortOption },
      { $skip: skip },
      { $limit: Number(limit) },

      {
        $project: {
          title: 1,
          price: 1,
          images: 1,
          createdAt: 1,
          category: 1,
          avgRating: 1,
          reviewCount: 1,
          sellerId: 1,
          seller: 1,
        },
      },
    ]);

    const total = await Product.countDocuments(matchStage);
    const totalPages = Math.ceil(total / Number(limit));

    const products = productsAgg.map(withAbsoluteImageUrls);
    res.json({ products, totalPages });
  } catch (err) {
    console.error("Eroare /products/public:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/** GET /api/products/suggestions */
router.get("/suggestions", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim() === "") return res.json([]);

    const products = await Product.find({
      title: { $regex: query, $options: "i" },
    })
      .limit(8)
      .select("title images");

    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/suggestions:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/** GET /api/products/public/:id */
router.get("/public/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ msg: "ID produs invalid" });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ msg: "Produs inexistent" });

    // atașează seller minimal
    const seller = await Seller.findOne({ userId: product.sellerId })
      .select("_id shopName slug username profileImageUrl");

    let out = withAbsoluteImageUrls(product);
    if (seller) {
      out.seller = {
        _id: seller._id,
        shopName: seller.shopName,
        slug: seller.slug,
        username: seller.username,
        profileImageUrl: seller.profileImageUrl ? toAbs(seller.profileImageUrl) : null,
      };
    }

    res.json(out);
  } catch (err) {
    console.error("Eroare /products/public/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/** GET /api/products/by-seller/:sellerId */
router.get("/by-seller/:sellerId", async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (!mongoose.isValidObjectId(sellerId)) {
      return res.status(400).json({ msg: "Parametrul sellerId este invalid", sellerId });
    }

    const products = await Product.find({ sellerId });
    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/by-seller/:sellerId:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/** GET /api/products/by-shop/:handle  (handle = userId || slug) */
router.get("/by-shop/:handle", async (req, res) => {
  try {
    const { handle } = req.params;

    let ownerId = null;
    if (mongoose.isValidObjectId(handle)) {
      ownerId = handle;
    } else {
      const shop = await Seller.findOne({ slug: handle }).select("userId");
      if (!shop) return res.status(404).json({ msg: "Magazin inexistent" });
      ownerId = shop.userId;
    }

    const products = await Product.find({ sellerId: ownerId });
    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/by-shop/:handle:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

/* ========================= PRIVATE ========================= */

router.get("/my", auth, async (req, res) => {
  try {
    const products = await Product.find({ sellerId: req.user.id });
    res.json(products.map(withAbsoluteImageUrls));
  } catch (err) {
    console.error("Eroare /products/my:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ msg: "ID produs invalid" });
    }
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) return res.status(404).json({ msg: "Produs inexistent" });
    res.json(withAbsoluteImageUrls(product));
  } catch (err) {
    console.error("Eroare /products/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

router.post("/", auth, upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];
    if (req.files?.length) {
      imageUrls = await Promise.all(
        req.files.map((file) =>
          uploadToStorage(file, `products/${req.user.id}/${Date.now()}-${file.originalname}`)
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

router.put("/:id", auth, upload.array("images", 5), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ msg: "ID produs invalid" });
    }

    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) return res.status(404).json({ msg: "Produs inexistent" });

    if (req.files?.length) {
      product.images = await Promise.all(
        req.files.map((file) =>
          uploadToStorage(file, `products/${req.user.id}/${Date.now()}-${file.originalname}`)
        )
      );
    }

    product.title = req.body.title ?? product.title;
    product.price = req.body.price ?? product.price;
    product.description = req.body.description ?? product.description;

    await product.save();
    res.json(withAbsoluteImageUrls(product));
  } catch (err) {
    console.error("Eroare actualizare produs:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ msg: "ID produs invalid" });
    }
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      sellerId: req.user.id,
    });
    if (!product) return res.status(404).json({ msg: "Produs inexistent" });

    res.json({ msg: "Produs șters cu succes" });
  } catch (err) {
    console.error("Eroare ștergere produs:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
