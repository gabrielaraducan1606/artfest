// backend/src/routes/checkoutRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// helper money
const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

// === 1) SUMMARY: items + subtotal (include thumb)
router.get("/checkout/summary", authRequired, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          service: { select: { vendorId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!items.length) return res.json({ items: [], currency: "RON", subtotal: 0 });

  const currency = items[0]?.product?.currency || "RON";

  const mapped = items.map((i) => ({
    productId: i.productId,
    title: i.product.title,
    image: Array.isArray(i.product.images) && i.product.images[0] ? i.product.images[0] : null,
    qty: i.qty,
    price: Math.round(i.product.priceCents) / 100,
    currency: i.product.currency || currency,
    vendorId: i.product.service?.vendorId || null,
  }));

  const subtotal = dec(mapped.reduce((s, it) => s + it.price * it.qty, 0));

  res.json({ items: mapped, currency, subtotal });
});

// --- MOCK shipping engine (înlocuiești cu Sameday)
async function quoteShipping({ address, groups, selections }) {
  // groups: [{ vendorId, items: [{price, qty}]}]
  // selections: { [vendorId]: { method: "COURIER"|"LOCKER", lockerId?: string } }
  // Exemplu: curier = 19 RON, easybox = 14 RON per vendor
  const shipments = groups.map((g) => {
    const sel = selections?.[String(g.vendorId)] || { method: "COURIER" };
    const isLocker = sel.method === "LOCKER";
    return {
      vendorId: g.vendorId,
      method: sel.method,
      lockerId: isLocker ? sel.lockerId || null : null,
      price: isLocker ? 14 : 19,
    };
  });
  const totalShipping = dec(shipments.reduce((s, x) => s + x.price, 0));
  return { shipments, totalShipping, currency: "RON" };
}

// === 2) QUOTE: calculează livrarea per vendor + ține cont de selecții
router.post("/checkout/quote", authRequired, async (req, res) => {
  const address = req.body?.address || {};
  const selections = req.body?.selections || {}; // { [vendorId]: { method, lockerId? } }

  if (!address?.name || !address?.phone || !address?.city || !address?.street) {
    return res.status(400).json({ error: "address_invalid", message: "Completează nume, telefon, oraș și stradă." });
  }

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true, title: true, priceCents: true, currency: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  if (!cart.length) return res.status(400).json({ error: "cart_empty" });

  const byVendor = new Map();
  for (const it of cart) {
    const vId = it.product.service?.vendorId || "unknown";
    if (!byVendor.has(vId)) byVendor.set(vId, []);
    byVendor.get(vId).push({
      productId: it.productId,
      title: it.product.title,
      qty: it.qty,
      price: Math.round(it.product.priceCents) / 100,
      currency: it.product.currency || "RON",
    });
  }

  const groups = Array.from(byVendor.entries()).map(([vendorId, items]) => ({ vendorId, items }));
  const q = await quoteShipping({ address, groups, selections });

  const quoteId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({ id: quoteId, ...q });
});

// === 3) PLACE: creează Order + Shipments (+ lockerId dacă e cazul), golește coșul
router.post("/checkout/place", authRequired, async (req, res) => {
  const { address, quoteId, selections } = req.body || {};
  if (!address) return res.status(400).json({ error: "address_required" });

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true, title: true, priceCents: true, currency: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });
  if (!cart.length) return res.status(400).json({ error: "cart_empty" });

  const currency = cart[0]?.product?.currency || "RON";
  const items = cart.map((i) => ({
    productId: i.productId,
    title: i.product.title,
    qty: i.qty,
    price: Math.round(i.product.priceCents) / 100,
    vendorId: i.product.service?.vendorId || "unknown",
  }));
  const subtotal = dec(items.reduce((s, it) => s + it.price * it.qty, 0));

  const groupsMap = new Map();
  for (const it of items) {
    if (!groupsMap.has(it.vendorId)) groupsMap.set(it.vendorId, []);
    groupsMap.get(it.vendorId).push(it);
  }
  const groups = Array.from(groupsMap.entries()).map(([vendorId, its]) => ({ vendorId, items: its }));
  const quote = await quoteShipping({ address, groups, selections });
  const shippingTotal = dec(quote.totalShipping);
  const total = dec(subtotal + shippingTotal);

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: req.user.sub,
        status: "PENDING",
        paymentMethod: "COD",
        currency,
        subtotal,
        shippingTotal,
        total,
        shippingAddress: address,
      },
    });

    for (const s of quote.shipments) {
      const sh = await tx.shipment.create({
        data: {
          orderId: order.id,
          vendorId: String(s.vendorId),
          method: s.method === "LOCKER" ? "locker" : "courier",
          lockerId: s.lockerId || null,
          price: dec(s.price),
          status: "PENDING",
        },
      });

      const its = groups.find((g) => String(g.vendorId) === String(s.vendorId))?.items || [];
      if (its.length) {
        await tx.shipmentItem.createMany({
          data: its.map((it) => ({
            shipmentId: sh.id,
            productId: it.productId,
            title: it.title,
            qty: it.qty,
            price: dec(it.price),
          })),
        });
      }
    }

    await tx.cartItem.deleteMany({ where: { userId: req.user.sub } });

    return order;
  });

  return res.json({ ok: true, orderId: created.id });
});

export default router;
