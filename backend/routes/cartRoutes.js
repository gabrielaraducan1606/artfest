import express from "express";
import auth from "../middleware/auth.js";
import Cart from "../models/cart.js";
import Product from "../models/product.js"; // atenție la numele fișierului

const router = express.Router();

// câmpuri aduse din Product
const PRODUCT_PROJECTION = "title price images sellerId stock";

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
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
      .lean()
      .maxTimeMS(5000);

    const byId = new Map(products.map(p => [toId(p._id), p]));
    const out = items.map(i => ({
      ...i,
      productId: byId.get(toId(i.productId)) || null, // compat front (așteaptă „populat”)
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
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
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

    // răspuns compatibil (include product populat)
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

    const product = await Product.findById(item.productId)
      .select("stock " + PRODUCT_PROJECTION)
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
      .lean()
      .maxTimeMS(5000);

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

/**
 * POST /cart/shipping-quote – calculează transportul pe artizan
 * Body: { items: [{ productId, qty }], isPickup?: boolean }
 * Nu cere autentificare; funcționează și pentru coșul oaspete.
 */
router.post("/shipping-quote", async (req, res) => {
  try {
    const { items = [], isPickup = false } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.json({ ok: true, shippingTotal: 0, breakdown: [] });
    }

    // adu produsele pentru a obține sellerId + price
    const ids = [...new Set(items.map(i => toId(i.productId)).filter(Boolean))];
    const prods = await Product.find({ _id: { $in: ids } })
      .select("_id price sellerId")
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
      .lean()
      .maxTimeMS(8000);

    const byId = new Map(prods.map(p => [toId(p._id), p]));

    // grupează pe seller
    const groups = new Map(); // sellerId -> { seller, subtotal, qty, items[] }
    for (const row of items) {
      const pid = toId(row.productId);
      const qty = Math.max(1, Number(row.qty) || 1);
      const p = byId.get(pid);
      if (!p) continue;
      const sid = toId(p.sellerId?._id || p.sellerId);
      const sellerDoc = p.sellerId && typeof p.sellerId === "object" ? p.sellerId : null;
      if (!groups.has(sid)) groups.set(sid, { sellerId: sid, seller: sellerDoc, subtotal: 0, qty: 0, lines: [] });
      const g = groups.get(sid);
      g.subtotal += (Number(p.price) || 0) * qty;
      g.qty += qty;
      g.lines.push({ productId: pid, qty, price: p.price });
    }

    // calculează per-seller
    let shippingTotal = 0;
    const breakdown = [];
    for (const g of groups.values()) {
      const policy = g.seller?.shippingPolicy || {};
      const base = Number(policy.baseCost ?? 19.99);
      const freeOver = policy.freeOver != null ? Number(policy.freeOver) : null;
      const perItem = Number(policy.perItem ?? 0);

      let ship = 0;
      if (isPickup && policy.pickupAvailable) {
        ship = 0;
      } else if (freeOver != null && g.subtotal >= freeOver) {
        ship = 0;
      } else {
        ship = base + perItem * g.qty;
      }
      shippingTotal += ship;
      breakdown.push({
        sellerId: g.sellerId,
        shopName: g.seller?.shopName || g.seller?.storeName || g.seller?.name || "Magazin",
        subtotal: Number(g.subtotal.toFixed(2)),
        qty: g.qty,
        shipping: Number(ship.toFixed(2)),
      });
    }

    return res.json({
      ok: true,
      shippingTotal: Number(shippingTotal.toFixed(2)),
      breakdown,
      currency: "RON",
    });
  } catch (e) {
    console.error("POST /cart/shipping-quote error", e);
    return res.status(500).json({ ok: false, message: "Eroare server la calculul transportului." });
  }
});

/* (compat) POST /cart/:productId – front-end vechi */
router.post("/:productId", auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const qty = Math.max(1, Number(req.body?.qty) || 1);

    const product = await Product.findById(productId)
      .select(PRODUCT_PROJECTION)
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
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
