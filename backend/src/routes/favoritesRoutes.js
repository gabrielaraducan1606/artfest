// ==============================
// File: server/routes/favorites.js (sau api/favorites.js)
// ==============================
import { Router } from "express";
import { prisma } from "../db.js";            // ajustează calea la proiectul tău
import { authRequired } from "../api/auth.js"; // ajustează calea
import { z } from "zod";

const router = Router();

const PAGE_SIZE_MAX = 50;
const ListQuery = z.object({
  limit: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(24),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  cursor: z.string().optional(), // base64(JSON) -> { createdAt, productId }
});
const BodyToggle = z.object({ productId: z.string().min(1) });
const BodyBulk = z.object({
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
});

const decodeCursor = (b64) => {
  try {
    if (!b64) return null;
    const txt = Buffer.from(b64, "base64").toString("utf8");
    const o = JSON.parse(txt);
    if (!o || !o.createdAt || !o.productId) return null;
    return { createdAt: new Date(o.createdAt), productId: String(o.productId) };
  } catch {
    return null;
  }
};
const encodeCursor = (o) =>
  Buffer.from(JSON.stringify({ createdAt: o.createdAt, productId: o.productId }), "utf8").toString("base64");

/** GET /api/favorites/ids */
router.get("/ids", authRequired, async (req, res) => {
  const favs = await prisma.favorite.findMany({
    where: { userId: req.user.sub },
    select: { productId: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items: favs.map((f) => f.productId) });
});

/** GET /api/favorites — pagina Wishlist, cu keyset pagination (createdAt, productId) */
router.get("/", authRequired, async (req, res) => {
  try {
    const { limit, sort, cursor } = ListQuery.parse(req.query);
    const c = decodeCursor(cursor);

    const where = { userId: req.user.sub };
    if (c?.createdAt && c?.productId) {
      if (sort === "newest") {
        // sort desc -> luam strict mai mici
        where.OR = [
          { createdAt: { lt: c.createdAt } },
          { AND: [{ createdAt: c.createdAt }, { productId: { lt: c.productId } }] },
        ];
      } else {
        // sort asc -> luam strict mai mari
        where.OR = [
          { createdAt: { gt: c.createdAt } },
          { AND: [{ createdAt: c.createdAt }, { productId: { gt: c.productId } }] },
        ];
      }
    }

    const orderBy =
      sort === "oldest"
        ? [{ createdAt: "asc" }, { productId: "asc" }]
        : [{ createdAt: "desc" }, { productId: "desc" }];

    const rows = await prisma.favorite.findMany({
      where,
      take: limit + 1, // overfetch pentru hasMore
      orderBy,
      include: {
        product: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            currency: true,
            images: true,
            service: {
              select: {
                vendorId: true,
                vendor: { select: { userId: true, displayName: true, id: true } },
                profile: { select: { slug: true, displayName: true } },
              },
            },
            // dacă există în modelul tău:
            // isActive: true,
            // stock: true,
          },
        },
      },
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const items = page
      .filter((r) => !!r.product)
      .map((r) => {
        const p = r.product;
        const price = typeof p.priceCents === "number" ? p.priceCents / 100 : null;
        const vendorId = p?.service?.vendorId ?? null;
        const vendorName =
          p?.service?.profile?.displayName ??
          p?.service?.vendor?.displayName ??
          "Magazin";
        const vendorSlug = p?.service?.profile?.slug ?? null;

        return {
          productId: r.productId,
          createdAt: r.createdAt,
          card: {
            id: p.id,
            title: p.title || "Produs",
            price,
            currency: p.currency || "RON",
            images: Array.isArray(p.images) ? p.images : [],
            vendorId,
            vendorSlug,
            vendorName,
            isActive: p?.isActive ?? true,
            stock: p?.stock ?? undefined,
          },
        };
      });

    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    res.json({ items, nextCursor, hasMore });
  } catch (err) {
    console.error("GET /api/favorites FAILED:", err);
    res.status(500).json({
      error: "favorites_list_failed",
      message:
        err?.message ||
        "Nu am putut încărca lista de favorite. Verifică logurile serverului.",
    });
  }
});

/** POST /api/favorites/toggle */
router.post("/toggle", authRequired, async (req, res) => {
  const { productId } = BodyToggle.parse(req.body || {});
  const prod = await prisma.product.findUnique({
    where: { id: productId },
    include: { service: { select: { vendor: { select: { userId: true } } } } },
  });
  if (!prod) return res.status(404).json({ error: "product_not_found" });

  const ownerUserId = prod?.service?.vendor?.userId;
  if (ownerUserId && ownerUserId === req.user.sub) {
    return res.status(403).json({ error: "cannot_favorite_own_product" });
  }

  const key = { userId_productId: { userId: req.user.sub, productId } };
  const exists = await prisma.favorite.findUnique({ where: key });

  if (exists) {
    await prisma.favorite.delete({ where: key });
    return res.json({ ok: true, favorited: false });
  } else {
    await prisma.favorite.create({ data: { userId: req.user.sub, productId } });
    return res.json({ ok: true, favorited: true });
  }
});

/** POST /api/favorites (add idempotent) */
router.post("/", authRequired, async (req, res) => {
  const { productId } = BodyToggle.parse(req.body || {});
  const prod = await prisma.product.findUnique({
    where: { id: productId },
    include: { service: { select: { vendor: { select: { userId: true } } } } },
  });
  if (!prod) return res.status(404).json({ error: "product_not_found" });

  const ownerUserId = prod?.service?.vendor?.userId;
  if (ownerUserId && ownerUserId === req.user.sub) {
    return res.status(403).json({ error: "cannot_favorite_own_product" });
  }

  await prisma.favorite.upsert({
    where: { userId_productId: { userId: req.user.sub, productId } },
    create: { userId: req.user.sub, productId },
    update: {},
  });
  res.json({ ok: true, favorited: true });
});

/** DELETE /api/favorites/:productId */
router.delete("/:productId", authRequired, async (req, res) => {
  const { productId } = BodyToggle.parse({ productId: req.params.productId });
  await prisma.favorite.deleteMany({ where: { userId: req.user.sub, productId } });
  res.json({ ok: true, favorited: false });
});

/** POST /api/favorites/bulk */
router.post("/bulk", authRequired, async (req, res) => {
  const { add, remove } = BodyBulk.parse(req.body || {});
  const userId = req.user.sub;

  if (add.length) {
    const dataAdd = add.map((productId) => ({ userId, productId }));
    await prisma.favorite.createMany({ data: dataAdd, skipDuplicates: true });
  }
  if (remove.length) {
    await prisma.favorite.deleteMany({
      where: { userId, productId: { in: remove } },
    });
  }
  res.json({ ok: true });
});

/** GET /api/favorites/count */
router.get("/count", authRequired, async (req, res) => {
  const c = await prisma.favorite.count({ where: { userId: req.user.sub } });
  res.json({ count: c });
});

/** DELETE /api/favorites (clear all) */
router.delete("/", authRequired, async (req, res) => {
  await prisma.favorite.deleteMany({ where: { userId: req.user.sub } });
  res.json({ ok: true });
});

/** alias compat pentru UI existent */
router.get("/../wishlist/count", authRequired, async (_req, res) => {
  res.status(404).json({ error: "use /api/favorites/count" });
});

export default router;

/** opțional: alias /api/wishlist/count */
export const mountWishlistCountAlias = (app) => {
  app.get("/api/wishlist/count", authRequired, async (req, res) => {
    const c = await prisma.favorite.count({ where: { userId: req.user.sub } });
    res.json({ count: c });
  });
};
