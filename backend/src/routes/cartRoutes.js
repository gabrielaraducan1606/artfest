// ==============================
// File: server/routes/cart.js
// ==============================
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// helper
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * Returnează cart items în formatul așteptat de frontend,
 * făcând 2 query-uri rapide (cartItems + products IN ids).
 */
async function getCartForUser(userId) {
  const t0 = Date.now();

  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    select: { productId: true, qty: true },
    orderBy: { createdAt: "desc" },
  });

  const t1 = Date.now();

  const ids = cartItems.map((x) => x.productId);
  if (!ids.length) {
    return {
      items: [],
      timing: { cartMs: t1 - t0, productsMs: 0, mapMs: 0 },
    };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      images: true,
      priceCents: true,
      currency: true,
      service: {
        select: {
          vendorId: true,
          profile: { select: { displayName: true, slug: true } },
          vendor: { select: { displayName: true } },
        },
      },
    },
  });

  const t2 = Date.now();

  const byId = new Map(products.map((p) => [p.id, p]));

  const mapped = cartItems.map((ci) => {
    const p = byId.get(ci.productId);

    // Dacă produsul a fost șters / indisponibil
    if (!p) {
      return {
        productId: ci.productId,
        qty: ci.qty,
        product: null,
      };
    }

    const service = p.service;
    return {
      productId: ci.productId,
      qty: ci.qty,
      product: {
        id: p.id,
        title: p.title,
        images: p.images,
        price: (p.priceCents ?? 0) / 100,
        currency: p.currency || "RON",
        vendorId: service?.vendorId ?? null,
        storeName:
          service?.profile?.displayName ||
          service?.vendor?.displayName ||
          "Magazin",
        storeSlug: service?.profile?.slug || null,
      },
    };
  });

  const t3 = Date.now();

  return {
    items: mapped,
    timing: { cartMs: t1 - t0, productsMs: t2 - t1, mapMs: t3 - t2 },
  };
}

/* ============================================================
   POST /api/cart/add
   body: { productId, qty? }
============================================================ */
router.post("/cart/add", authRequired, async (req, res) => {
  const { productId, qty = 1 } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: "productId_required" });
  }

  const prod = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      service: {
        select: {
          vendorId: true,
          vendor: { select: { userId: true } },
        },
      },
    },
  });

  if (!prod) {
    return res.status(404).json({ error: "product_not_found" });
  }

  // Nu permite adăugarea propriilor produse (comparăm direct userId)
  if (prod.service?.vendor?.userId === req.user.sub) {
    return res.status(403).json({ error: "cannot_add_own_product" });
  }

  const safeQty = clamp(parseInt(qty, 10) || 1, 1, 99);

  const item = await prisma.cartItem.upsert({
    where: { userId_productId: { userId: req.user.sub, productId } },
    update: { qty: { increment: safeQty } },
    create: { userId: req.user.sub, productId, qty: safeQty },
  });

  res.json({ ok: true, item });
});

/* ============================================================
   POST /api/cart/update
============================================================ */
router.post("/cart/update", authRequired, async (req, res) => {
  const { productId, qty } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: "productId_required" });
  }

  const item = await prisma.cartItem.findUnique({
    where: { userId_productId: { userId: req.user.sub, productId } },
    select: {
      productId: true,
      qty: true,
      product: {
        select: {
          service: {
            select: {
              vendor: { select: { userId: true } },
            },
          },
        },
      },
    },
  });

  if (!item) {
    return res.status(404).json({ error: "cart_item_not_found" });
  }

  // Blocare owner: produsul aparține userului logat
  if (item.product?.service?.vendor?.userId === req.user.sub) {
    return res.status(403).json({ error: "cannot_update_own_product" });
  }

  const safeQty = clamp(parseInt(qty, 10) || 1, 1, 99);

  const updated = await prisma.cartItem.update({
    where: { userId_productId: { userId: req.user.sub, productId } },
    data: { qty: safeQty },
  });

  res.json({ ok: true, item: updated });
});

/* ============================================================
   DELETE /api/cart/remove
============================================================ */
router.delete("/cart/remove", authRequired, async (req, res) => {
  const { productId } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: "productId_required" });
  }

  await prisma.cartItem
    .delete({
      where: { userId_productId: { userId: req.user.sub, productId } },
    })
    .catch(() => null);

  res.json({ ok: true });
});

/* ============================================================
   POST /api/cart/remove-batch
   body: { productIds: [] }
============================================================ */
router.post("/cart/remove-batch", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
  if (!arr.length) return res.json({ ok: true });

  await prisma.cartItem.deleteMany({
    where: {
      userId: req.user.sub,
      productId: { in: arr },
    },
  });

  res.json({ ok: true });
});

/* ============================================================
   POST /api/cart/clear
============================================================ */
router.post("/cart/clear", authRequired, async (req, res) => {
  await prisma.cartItem.deleteMany({
    where: { userId: req.user.sub },
  });

  res.json({ ok: true });
});

/* ============================================================
   POST /api/cart/merge
   body: { items: [{ productId, qty }] }
   OPTIMIZAT: 1 singur INSERT ... ON CONFLICT (Postgres)
============================================================ */
router.post("/cart/merge", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!arr.length) {
    return res.json({ ok: true, merged: 0, skipped: 0, items: [] });
  }

  const userId = req.user.sub;

  // dedupe ids
  const ids = Array.from(
    new Set(arr.map((x) => String(x.productId || "").trim()).filter(Boolean))
  );

  // luăm minim pentru filtrare "own product"
  const prods = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      service: { select: { vendor: { select: { userId: true } } } },
    },
  });

  const prodById = new Map(prods.map((p) => [p.id, p]));

  let skipped = 0;
  const rows = [];

  for (const x of arr) {
    const pid = String(x.productId || "").trim();
    if (!pid) continue;

    const qty = clamp(parseInt(x.qty, 10) || 1, 1, 99);
    const p = prodById.get(pid);

    if (!p) {
      skipped++;
      continue;
    }

    // nu lăsăm utilizatorul să-și adauge propriile produse
    if (p.service?.vendor?.userId === userId) {
      skipped++;
      continue;
    }

    rows.push({ userId, productId: pid, qty });
  }

  if (!rows.length) {
    const { items } = await getCartForUser(userId);
    return res.json({ ok: true, merged: 0, skipped, items });
  }

  // 1 singur statement SQL: INSERT ... ON CONFLICT
  // IMPORTANT: nu interpolăm valori direct în SQL, doar placeholders ($1, $2, ...)
  const valuesSql = rows
    .map(
      (_, i) =>
        `($${i * 3 + 1}::text, $${i * 3 + 2}::text, $${i * 3 + 3}::int)`
    )
    .join(",");

  const params = rows.flatMap((r) => [r.userId, r.productId, r.qty]);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "CartItem" ("userId", "productId", "qty")
    VALUES ${valuesSql}
    ON CONFLICT ("userId", "productId")
    DO UPDATE SET
      "qty" = LEAST(99, "CartItem"."qty" + EXCLUDED."qty"),
      "updatedAt" = NOW()
    `,
    ...params
  );

  // returnăm coșul complet în format FE
  const { items } = await getCartForUser(userId);

  res.json({
    ok: true,
    merged: rows.length,
    skipped,
    items,
  });
});

/* ============================================================
   GET /api/cart/count
============================================================ */
router.get("/cart/count", authRequired, async (req, res) => {
  const agg = await prisma.cartItem.aggregate({
    where: { userId: req.user.sub },
    _sum: { qty: true },
  });

  res.json({ count: agg._sum.qty ?? 0 });
});

/* ============================================================
   GET /api/cart
   OPTIMIZAT: 2 query-uri + map
============================================================ */
router.get("/cart", authRequired, async (req, res) => {
  const userId = req.user.sub;

  const { items, timing } = await getCartForUser(userId);

  // util pentru debugging/profiling (îl poți lăsa și în prod)
  res.setHeader(
    "Server-Timing",
    `cart;dur=${timing.cartMs},products;dur=${timing.productsMs},map;dur=${timing.mapMs}`
  );

  res.json({ items });
});

export default router;
