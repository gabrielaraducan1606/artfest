import Product from "../models/product.js";
import Order   from "../models/Order.js"; // presupunem că ai modelul
import { quoteBySellers } from "../services/shippingService.js";

/**
 * Body așteptat:
 * {
 *   items: [{ productId, qty }],
 *   coupon?: { code, ... },
 *   note?: string,
 *   payment: { method: "card" | "cod" },
 *   shippingAddress: { country, county, city, street, zip, name, phone, email? },
 *   isPickup?: boolean
 * }
 */
export async function create(req, res, next) {
  try {
    const {
      items = [],
      coupon,
      note,
      payment,
      shippingAddress = {},
      isPickup = false
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Items required" });
    }

    // 1) Încărcăm produsele din DB (preț + sellerId populat)
    const ids = items.map(i => i.productId);
    const products = await Product.find({ _id: { $in: ids } })
      .select("price sellerId")
      .populate({ path: "sellerId", select: "shopName storeName name shippingPolicy" })
      .lean();

    const map = new Map(products.map(p => [String(p._id), p]));

    // 2) Normalizăm pentru serviciul de shipping
    const normalized = items
      .map(i => {
        const p = map.get(String(i.productId));
        if (!p) return null;
        const sellerDoc = p.sellerId && typeof p.sellerId === "object" ? p.sellerId : null;
        const seller = {
          _id: String(sellerDoc?._id || p.sellerId),
          name: sellerDoc?.shopName || sellerDoc?.storeName || sellerDoc?.name || "Magazin",
          shippingPolicy: sellerDoc?.shippingPolicy || {}
        };
        return {
          qty: Math.max(1, Number(i.qty) || 1),
          product: { price: Number(p.price || 0), seller }
        };
      })
      .filter(Boolean);

    // 3) Recalcul pe server (anti-tampering)
    const shippingCalc = await quoteBySellers({
      items: normalized,
      address: shippingAddress,
      isPickup
    });

    // 4) Subtotal real
    const merchandise = normalized.reduce((s, n) => s + n.product.price * n.qty, 0);
    // TODO: aplică reguli reale de discount / cupoane
    const discount = 0;

    const VAT_RATE = 0.19;
    const taxable  = Math.max(0, merchandise - discount);
    const vatMerch = taxable * VAT_RATE / (1 + VAT_RATE);
    const vatShip  = shippingCalc.shippingTotal * VAT_RATE / (1 + VAT_RATE);
    const vat      = +(vatMerch + vatShip).toFixed(2);
    const total    = +(taxable + shippingCalc.shippingTotal).toFixed(2);

    // 5) Pregătim arrays pentru Order
    const orderItems = items.map(i => {
      const p = map.get(String(i.productId));
      const sellerId = p?.sellerId?._id || p?.sellerId;
      return {
        product: i.productId,
        seller:  sellerId,
        qty:     Math.max(1, Number(i.qty) || 1),
        price:   Number(p?.price || 0)
      };
    });

    const shipping = shippingCalc.bySeller.map(s => ({
      seller: s.sellerId,
      method: s.shipping.method,
      cost:   s.shipping.cost
    }));

    const order = await Order.create({
      buyer: req.user?.id || null, // permite și guest checkout
      items: orderItems,
      shipping,
      coupon: coupon || null,
      note: note || "",
      shippingAddress,
      payment: { method: payment?.method || "card", status: "pending" },
      totals: {
        merchandise: +merchandise.toFixed(2),
        discount,
        shipping: shippingCalc.shippingTotal,
        vat,
        total
      }
    });

    res.status(201).json({ ok: true, orderId: order._id });
  } catch (err) {
    next(err);
  }
}
