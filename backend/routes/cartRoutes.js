import express from "express";
import auth from "../middleware/auth.js";
import Cart from "../models/cart.js";
import Product from "../models/product.js";

const router = express.Router();

// 📌 Obține toate produsele din coș
router.get("/", auth, async (req, res) => {
  try {
    const items = await Cart.find({ userId: req.user.id })
      .populate("productId");
    res.json(items);
  } catch (err) {
    console.error("❌ Eroare GET cart:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ➕ Adaugă produs în coș (sau crește cantitatea)
router.post("/:productId", auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const { qty = 1 } = req.body;

    const item = await Cart.findOne({ userId: req.user.id, productId });

    if (item) {
      item.qty += qty;
      await item.save();
      return res.status(200).json({ msg: "Cantitate actualizată", item });
    }

    const newItem = new Cart({
      userId: req.user.id,
      productId,
      qty
    });

    await newItem.save();
    res.status(201).json({ msg: "Produs adăugat în coș", item: newItem });
  } catch (err) {
    console.error("❌ Eroare POST cart:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ✏️ Actualizează cantitatea
router.patch("/:productId", auth, async (req, res) => {
  try {
    const { qty } = req.body;

    if (qty < 1) {
      return res.status(400).json({ msg: "Cantitate invalidă" });
    }

    const item = await Cart.findOneAndUpdate(
      { userId: req.user.id, productId: req.params.productId },
      { qty },
      { new: true }
    );

    if (!item) return res.status(404).json({ msg: "Produsul nu este în coș" });

    res.json({ msg: "Cantitate actualizată", item });
  } catch (err) {
    console.error("❌ Eroare PATCH cart:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// ❌ Șterge produs din coș
router.delete("/:productId", auth, async (req, res) => {
  try {
    await Cart.findOneAndDelete({ userId: req.user.id, productId: req.params.productId });
    res.json({ msg: "Produs șters din coș" });
  } catch (err) {
    console.error("❌ Eroare DELETE cart:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
