import express from "express";
import auth from "../middleware/auth.js";
import Cart from "../models/cart.js";
import Product from "../models/product.js";

const router = express.Router();

// ce câmpuri să aducem din Product
const PRODUCT_PROJECTION = "title price images seller stock attrs";

/* Utils */
const toId = (v) => String(v || "");

/* GET /cart – coșul userului (lean + join manual) */
router.get("/", auth, async (req, res) => {
  try {
    const items = await Cart.find({ userId: req.user.id })
      .select("productId qty")
      .lean()
      .maxTimeMS(5000);

    if (!items.length) return res.json([]);

    const ids = [...new Set(items.map(i => i.productId).map(toId).filter(Boolean))];
    const products = await Product.find({ _id: { $in: ids } })
      .select(PRODUCT_PROJECTION)
      .lean()
      .maxTimeMS(5000);

    const byId = new Map(products.map(p => [toId(p._id), p]));
    const out = items.map(i => ({
      ...i,
      productId: byId.get(toId(i.productId)) || null, // compat cu front care expectă populate
    }));
    return res.json(out);
  } catch (e) {
    console.error("GET /cart error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la încărcarea coșului." });
  }
});

/* POST /cart – adaugă în coș { productId, qty } */
router.post("/", auth, async (req, res) => {
  try {
    const { productId, qty = 1 } = req.body || {};
    if (!productId) return res.status(400).json({ ok: false, message: "productId lipsă" });

    const product = await Product.findById(productId)
      .select(PRODUCT_PROJECTION)
      .lean()
      .maxTimeMS(5000);
    if (!product) return res.status(404).json({ ok: false, message: "Produsul nu există." });

    const desired = Math.max(1, Number(qty) || 1);
    const allowed = typeof product.stock === "number"
      ? Math.max(0, Math.min(desired, product.stock))
      : desired;
    if (allowed <= 0) return res.status(409).json({ ok: false, message: "Produsul este epuizat." });

    let doc = await Cart.findOne({ userId: req.user.id, productId }).maxTimeMS(5000);
    if (doc) {
      const next = typeof product.stock === "number"
        ? Math.min(doc.qty + allowed, product.stock)
        : (doc.qty + allowed);
      doc.qty = next;
      await doc.save();
    } else {
      doc = await Cart.create({ userId: req.user.id, productId, qty: allowed });
    }

    // răspuns compatibil (include product “populat”)
    return res.status(201).json({
      ok: true,
      item: {
        _id: doc._id,
        userId: doc.userId,
        productId: product,
        qty: doc.qty,
      },
    });
  } catch (e) {
    console.error("POST /cart error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la adăugarea în coș." });
  }
});

/* PATCH /cart/:id – actualizează cantitatea */
router.patch("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    let { qty } = req.body || {};
    qty = Math.max(1, Number(qty) || 1);

    const item = await Cart.findOne({ _id: id, userId: req.user.id }).maxTimeMS(5000);
    if (!item) return res.status(404).json({ ok: false, message: "Item inexistent în coș." });

    const product = await Product.findById(item.productId).select("stock " + PRODUCT_PROJECTION).lean().maxTimeMS(5000);
    if (product && typeof product.stock === "number") {
      qty = Math.min(qty, Math.max(0, product.stock));
      if (qty <= 0) return res.status(409).json({ ok: false, message: "Produsul este epuizat." });
    }

    item.qty = qty;
    await item.save();

    return res.json({
      ok: true,
      item: {
        _id: item._id,
        userId: item.userId,
        productId: product || null,
        qty: item.qty,
      },
    });
  } catch (e) {
    console.error("PATCH /cart/:id error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la actualizarea cantității." });
  }
});

/* DELETE /cart/:id – șterge un item */
router.delete("/:id", auth, async (req, res) => {
  try {
    const del = await Cart.findOneAndDelete({ _id: req.params.id, userId: req.user.id }).maxTimeMS(5000);
    if (!del) return res.status(404).json({ ok: false, message: "Item inexistent." });
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /cart/:id error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la ștergere." });
  }
});

/* DELETE /cart – golește coșul curent */
router.delete("/", auth, async (req, res) => {
  try {
    await Cart.deleteMany({ userId: req.user.id }).maxTimeMS(5000);
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /cart error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la golirea coșului." });
  }
});

/* POST /cart/apply-coupon – mock validare cupon (rapid) */
router.post("/apply-coupon", auth, async (req, res) => {
  try {
    const { code = "" } = req.body || {};
    const normalized = String(code).trim().toUpperCase();
    if (!normalized) return res.status(400).json({ ok: false, message: "Cod invalid." });

    const catalog = {
      "WELCOME10": { type: "percent", value: 10 },
      "ARTIZAN25": { type: "fixed", value: 25 },
      "FREEDEL": { type: "fixed", value: 19.99 },
    };
    const found = catalog[normalized];
    if (!found) return res.json({ ok: false, message: "Cupon invalid sau expirat." });
    return res.json({ ok: true, coupon: { code: normalized, ...found } });
  } catch (e) {
    console.error("POST /cart/apply-coupon error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la validarea cuponului." });
  }
});

/* (compat) POST /cart/:productId – front-end vechi */
router.post("/:productId", auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const qty = Math.max(1, Number(req.body?.qty) || 1);

    const product = await Product.findById(productId)
      .select(PRODUCT_PROJECTION)
      .lean()
      .maxTimeMS(5000);
    if (!product) return res.status(404).json({ ok: false, message: "Produsul nu există." });

    const allowed = typeof product.stock === "number"
      ? Math.min(qty, Math.max(0, product.stock))
      : qty;
    if (allowed <= 0) return res.status(409).json({ ok: false, message: "Produsul este epuizat." });

    let doc = await Cart.findOne({ userId: req.user.id, productId }).maxTimeMS(5000);
    if (doc) {
      const next = typeof product.stock === "number"
        ? Math.min(doc.qty + allowed, product.stock)
        : (doc.qty + allowed);
      doc.qty = next;
      await doc.save();
    } else {
      doc = await Cart.create({ userId: req.user.id, productId, qty: allowed });
    }

    return res.status(201).json({
      ok: true,
      item: {
        _id: doc._id,
        userId: doc.userId,
        productId: product,
        qty: doc.qty,
      },
    });
  } catch (e) {
    console.error("POST /cart/:productId error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la adăugarea în coș." });
  }
});

export default router;
