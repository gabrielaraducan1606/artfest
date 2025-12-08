// ==============================
// File: server/routes/cart.js
// ==============================
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// helper
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

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
          vendor: {
            select: { userId: true },
          },
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
============================================================ */
router.post("/cart/merge", authRequired, async (req, res) => {
  const arr = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!arr.length) {
    return res.json({ ok: true, merged: 0, skipped: 0 });
  }

  const userId = req.user.sub;

  const ids = Array.from(
    new Set(
      arr.map((x) => String(x.productId || "").trim()).filter(Boolean)
    )
  );

  const prods = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      priceCents: true,
      currency: true,
      images: true,
      title: true,
      service: {
        select: {
          vendorId: true,
          vendor: { select: { userId: true, displayName: true } },
          profile: {
            select: {
              displayName: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  const prodById = new Map(prods.map((p) => [p.id, p]));

  let merged = 0;
  let skipped = 0;

  const upserts = [];

  for (const x of arr) {
    const pid = String(x.productId || "").trim();
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

    upserts.push(
      prisma.cartItem.upsert({
        where: { userId_productId: { userId, productId: pid } },
        update: { qty: { increment: qty } },
        create: { userId, productId: pid, qty },
      })
    );
  }

  if (upserts.length) {
    await prisma.$transaction(upserts);
  }

  merged = upserts.length;

  // trimitem înapoi items cu numele magazinului
  const items = await prisma.cartItem.findMany({
    where: { userId },
    select: {
      productId: true,
      qty: true,
      product: {
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          service: {
            select: {
              vendorId: true,
              vendor: { select: { displayName: true } },
              profile: {
                select: {
                  displayName: true,
                  slug: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const map = items.map((i) => {
    const p = i.product;
    const service = p?.service;
    return {
      productId: i.productId,
      qty: i.qty,
      product: {
        id: p.id,
        title: p.title,
        images: p.images,
        price: p.priceCents / 100,
        currency: p.currency || "RON",
        vendorId: service?.vendorId,
        storeName:
          service?.profile?.displayName ||
          service?.vendor?.displayName ||
          "Magazin",
        storeSlug: service?.profile?.slug || null,
      },
    };
  });

  res.json({ ok: true, merged, skipped, items: map });
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
============================================================ */
router.get("/cart", authRequired, async (req, res) => {
  const items = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    select: {
      productId: true,
      qty: true,
      product: {
        select: {
          id: true,
          title: true,
          images: true,
          priceCents: true,
          currency: true,
          service: {
            select: {
              vendorId: true,
              profile: {
                select: {
                  displayName: true,
                  slug: true,
                },
              },
              vendor: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const map = items.map((i) => {
    const p = i.product;
    const service = p?.service;

    return {
      productId: i.productId,
      qty: i.qty,
      product: {
        id: p.id,
        title: p.title,
        images: p.images,
        price: p.priceCents / 100,
        currency: p.currency || "RON",
        vendorId: service?.vendorId,
        // 🔥 ADĂUGAT / FORMAT PENTRU FRONTEND:
        storeName:
          service?.profile?.displayName ||
          service?.vendor?.displayName ||
          "Magazin",
        storeSlug: service?.profile?.slug || null,
      },
    };
  });

  res.json({ items: map });
});

export default router;
