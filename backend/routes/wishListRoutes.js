import express from "express";
import auth from "../middleware/auth.js";
import Wishlist from "../models/wishlist.js";
import Product from "../models/product.js";

const router = express.Router();

// 📌 Obține toate produsele din wishlist-ul utilizatorului logat
router.get("/", auth, async (req, res) => {
  try {
    const items = await Wishlist.find({ userId: req.user.id })
      .populate("productId");
    res.json(items.map(item => item.productId));
  } catch (err) {
    console.error("❌ Eroare GET wishlist:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ➕ Adaugă produs în wishlist
router.post("/:productId", auth, async (req, res) => {
  try {
    const { productId } = req.params;

    const exists = await Wishlist.findOne({ userId: req.user.id, productId });
    if (exists) {
      return res.status(200).json({ msg: "Produsul este deja în wishlist" });
    }

    const newItem = new Wishlist({
      userId: req.user.id,
      productId,
    });

    await newItem.save();
    res.status(201).json({ msg: "Produs adăugat în wishlist" });
  } catch (err) {
    console.error("❌ Eroare POST wishlist:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ❌ Șterge produs din wishlist
router.delete("/:productId", auth, async (req, res) => {
  try {
    await Wishlist.findOneAndDelete({ userId: req.user.id, productId: req.params.productId });
    res.json({ msg: "Produs șters din wishlist" });
  } catch (err) {
    console.error("❌ Eroare DELETE wishlist:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
