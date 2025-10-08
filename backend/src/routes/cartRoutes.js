import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// helper
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * POST /api/cart/add
 * body: { productId, qty? }
 */
router.post("/cart/add", authRequired, async (req, res) => {
  const { productId, qty = 1 } = req.body || {};
  if (!productId) return res.status(400).json({ error: "productId_required" });

  const prod = await prisma.product.findUnique({
    where: { id: productId },
    include: { service: { select: { vendorId: true } } },
  });
  if (!prod) return res.status(404).json({ error: "product_not_found" });

  // blochează vendorul proprietar (folosește optional chaining ca să nu arunce)
  const meVendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  if (meVendor && prod?.service?.vendorId === meVendor.id) {
    return res.status(403).json({ error: "cannot_add_own_product" });
  }

  const safeQty = clamp(parseInt(qty || 1, 10) || 1, 1, 99);

  const item = await prisma.cartItem.upsert({
    where: { userId_productId: { userId: req.user.sub, productId } },
    update: { qty: { increment: safeQty } },
    create: { userId: req.user.sub, productId, qty: safeQty },
  });

  return res.json({ ok: true, item });
});

/**
 * POST /api/cart/update
 * body: { productId, qty }
 */
router.post("/cart/update", authRequired, async (req, res) => {
  const { productId, qty } = req.body || {};
  if (!productId) return res.status(400).json({ error: "productId_required" });

  const item = await prisma.cartItem.findUnique({
    where: { userId_productId: { userId: req.user.sub, productId } },
    include: {
      product: { include: { service: { select: { vendorId: true } } } },
    },
  });
  if (!item) return res.status(404).json({ error: "cart_item_not_found" });

  // blocare owner (cu optional chaining)
  const meVendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  if (meVendor && item?.product?.service?.vendorId === meVendor.id) {
    return res.status(403).json({ error: "cannot_update_own_product" });
  }

  const safeQty = clamp(parseInt(qty || 1, 10) || 1, 1, 99);
  const updated = await prisma.cartItem.update({
    where: { userId_productId: { userId: req.user.sub, productId } },
    data: { qty: safeQty },
  });
  res.json({ ok: true, item: updated });
});

/**
 * DELETE /api/cart/remove
 * body: { productId }
 */
router.delete("/cart/remove", authRequired, async (req, res) => {
  const { productId } = req.body || {};
  if (!productId) return res.status(400).json({ error: "productId_required" });

  await prisma.cartItem
    .delete({
      where: { userId_productId: { userId: req.user.sub, productId } },
    })
    .catch(() => null);

  res.json({ ok: true });
});

/**
 * POST /api/cart/merge
 * body: { items: [{ productId, qty }] }
 * -> pentru când userul se loghează; unește coșul local (guest) cu cel din cont
 */
router.post("/cart/merge", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!arr.length) return res.json({ ok: true, merged: 0, skipped: 0 });

  const userId = req.user.sub;
  let merged = 0;
  let skipped = 0;

  // fetch produse o singură dată
  const ids = Array.from(
    new Set(
      arr.map((x) => String(x.productId || "").trim()).filter(Boolean)
    )
  );
  const prods = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { service: { select: { vendorId: true } } },
  });
  const prodById = new Map(prods.map((p) => [p.id, p]));

  const meVendor = await prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });
  const myVendorId = meVendor?.id || null;

  for (const x of arr) {
    const pid = String(x.productId || "").trim();
    const qty = clamp(parseInt(x.qty || 1, 10) || 1, 1, 99);
    const p = prodById.get(pid);
    if (!pid || !p) {
      skipped++;
      continue;
    }

    // nu adăugăm propriile produse
    if (myVendorId && p?.service?.vendorId === myVendorId) {
      skipped++;
      continue;
    }

    await prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId: pid } },
      update: { qty: { increment: qty } },
      create: { userId, productId: pid, qty },
    });
    merged++;
  }

  const items = await prisma.cartItem.findMany({
    where: { userId },
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

  const map = items.map((i) => ({
    productId: i.productId,
    qty: i.qty,
    product: {
      id: i.product.id,
      title: i.product.title,
      images: i.product.images,
      price: Math.round(i.product.priceCents) / 100,
      currency: i.product.currency || "RON",
      vendorId: i.product?.service?.vendorId ?? null,
    },
  }));

  res.json({ ok: true, merged, skipped, items: map });
});

/** GET /api/cart/count */
router.get("/cart/count", authRequired, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    select: { qty: true },
  });
  const count = items.reduce((s, i) => s + i.qty, 0);
  res.json({ count });
});

/** GET /api/cart */
router.get("/cart", authRequired, async (req, res) => {
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

  const map = items.map((i) => ({
    productId: i.productId,
    qty: i.qty,
    product: {
      id: i.product.id,
      title: i.product.title,
      images: i.product.images,
      price: Math.round(i.product.priceCents) / 100,
      currency: i.product.currency || "RON",
      vendorId: i.product?.service?.vendorId ?? null,
    },
  }));

  res.json({ items: map });
});

export default router;
