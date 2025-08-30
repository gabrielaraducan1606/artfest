// controllers/checkoutController.js
import Product from "../models/Product.js";
import { quoteBySellers } from "../services/shippingService.js";

export async function quote(req, res, next) {
  try {
    const { items = [], address = {}, isPickup = false, coupon } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, message: "Items required" });
    }

    const ids = items.map(i => i.productId);
    const products = await Product.find({ _id: { $in: ids } })
      .select("title price images seller")
      .populate({ path: "seller", select: "name shippingPolicy" })
      .lean();

    const map = new Map(products.map(p => [String(p._id), p]));
    const normalized = items
      .map(i => ({ qty: Math.max(1, Number(i.qty)||1), product: map.get(String(i.productId)) }))
      .filter(x => x.product);

    const base = await quoteBySellers({ items: normalized, address, isPickup });

    // TODO: integrează cupoane reale (acum 0 doar ca exemplu)
    const discount = 0;

    // TVA inclus (informativ)
    const VAT_RATE = 0.19;
    const taxable = Math.max(0, base.merchandise - discount);
    const vatIncludedMerch = taxable * VAT_RATE / (1 + VAT_RATE);
    const vatIncludedShip  = base.shippingTotal * VAT_RATE / (1 + VAT_RATE);
    const vat = +(vatIncludedMerch + vatIncludedShip).toFixed(2);
    const grandTotal = +(taxable + base.shippingTotal).toFixed(2);

    res.json({
      ok: true,
      bySeller: base.bySeller,
      merchandise: base.merchandise,
      discount,
      shippingTotal: base.shippingTotal,
      vat,
      grandTotal
    });
  } catch (err) { next(err); }
}
