// ==============================
// File: server/routes/favorites.js
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

// ✅ limităm și validăm mai strict bulk-ul, ca să nu primim mii de id-uri dintr-un foc
const BodyBulk = z.object({
  add: z.array(z.string().min(1)).max(500).default([]),
  remove: z.array(z.string().min(1)).max(500).default([]),
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
  Buffer.from(
    JSON.stringify({ createdAt: o.createdAt, productId: o.productId }),
    "utf8"
  ).toString("base64");

/** GET /api/favorites/ids — paginat + cursor (super rapid) */
router.get("/ids", authRequired, async (req, res) => {
  try {
    const { limit, sort, cursor } = ListQuery.parse(req.query);
    const c = decodeCursor(cursor);
    if (cursor && !c) return res.status(400).json({ error: "invalid_cursor" });

    const userId = req.user.sub;
    const where = { userId };

    if (c?.createdAt && c?.productId) {
      if (sort === "newest") {
        where.OR = [
          { createdAt: { lt: c.createdAt } },
          { AND: [{ createdAt: c.createdAt }, { productId: { lt: c.productId } }] },
        ];
      } else {
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
      take: limit + 1,
      orderBy,
      select: { productId: true, createdAt: true },
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    res.json({
      items: page, // [{productId, createdAt}]
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("GET /api/favorites/ids FAILED:", err);
    res.status(500).json({ error: "favorites_ids_failed" });
  }
});

/** GET /api/favorites — FAST: 2 queries (favorites rows + products by ids) */
router.get("/", authRequired, async (req, res) => {
  try {
    const { limit, sort, cursor } = ListQuery.parse(req.query);
    const c = decodeCursor(cursor);

    if (cursor && !c) {
      return res.status(400).json({ error: "invalid_cursor" });
    }

    const userId = req.user.sub;

    const where = { userId };

    // cursor conditions (keyset)
    if (c?.createdAt && c?.productId) {
      if (sort === "newest") {
        where.OR = [
          { createdAt: { lt: c.createdAt } },
          { AND: [{ createdAt: c.createdAt }, { productId: { lt: c.productId } }] },
        ];
      } else {
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

    const doCount = !cursor;

    // 1) favorites rows (super light)
    const [rows, totalCountRaw] = await Promise.all([
      prisma.favorite.findMany({
        where,
        take: limit + 1,
        orderBy,
        select: { productId: true, createdAt: true }, // 🔥 no include here
      }),
      doCount ? prisma.favorite.count({ where: { userId } }) : Promise.resolve(null),
    ]);

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const ids = page.map((r) => r.productId);
    if (!ids.length) {
      return res.json({
        items: [],
        nextCursor: null,
        hasMore: false,
        totalCount: doCount ? totalCountRaw : undefined,
      });
    }

    // 2) products by ids (minimal select)
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        images: true,
        isActive: true,
        readyQty: true, // folosești ca stock (sau adaptezi)
        service: {
          select: {
            vendorId: true,
            profile: { select: { slug: true, displayName: true } },
            vendor: { select: { displayName: true } },
          },
        },
      },
    });

    // preserve order
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = page
      .map((r) => {
        const p = byId.get(r.productId);
        if (!p) return null; // produs șters => îl ignori
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
            images: Array.isArray(p.images) ? p.images.slice(0, 1) : [], // 🔥 trimite doar prima imagine
            vendorId,
            vendorSlug,
            vendorName,
            isActive: p.isActive ?? true,
            stock: typeof p.readyQty === "number" ? p.readyQty : undefined, // adaptează la modelul tău
          },
        };
      })
      .filter(Boolean);

    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    res.json({
      items,
      nextCursor,
      hasMore,
      totalCount: doCount ? totalCountRaw : undefined,
    });
  } catch (err) {
    console.error("GET /api/favorites FAILED:", err);
    res.status(500).json({
      error: "favorites_list_failed",
      message: err?.message || "Nu am putut încărca lista de favorite.",
    });
  }
});

/** POST /api/favorites/toggle */
router.post("/toggle", authRequired, async (req, res) => {
  try {
    const { productId } = BodyToggle.parse(req.body || {});
    const prod = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        service: { select: { vendor: { select: { userId: true } } } },
      },
    });
    if (!prod) return res.status(404).json({ error: "product_not_found" });

    const ownerUserId = prod?.service?.vendor?.userId;
    if (ownerUserId && ownerUserId === req.user.sub) {
      return res
        .status(403)
        .json({ error: "cannot_favorite_own_product" });
    }

    const key = { userId_productId: { userId: req.user.sub, productId } };
    const exists = await prisma.favorite.findUnique({ where: key });

    if (exists) {
      await prisma.favorite.delete({ where: key });
      return res.json({ ok: true, favorited: false });
    } else {
      await prisma.favorite.create({
        data: { userId: req.user.sub, productId },
      });
      return res.json({ ok: true, favorited: true });
    }
  } catch (err) {
    console.error("POST /api/favorites/toggle FAILED:", err);
    res.status(500).json({ error: "favorites_toggle_failed" });
  }
});

/** POST /api/favorites (add idempotent) */
router.post("/", authRequired, async (req, res) => {
  try {
    const { productId } = BodyToggle.parse(req.body || {});
  const prod = await prisma.product.findUnique({
  where: { id: productId },
  select: {
    id: true,
    service: { select: { vendor: { select: { userId: true } } } },
  },
});
    if (!prod) return res.status(404).json({ error: "product_not_found" });

    const ownerUserId = prod?.service?.vendor?.userId;
    if (ownerUserId && ownerUserId === req.user.sub) {
      return res
        .status(403)
        .json({ error: "cannot_favorite_own_product" });
    }

    await prisma.favorite.upsert({
      where: { userId_productId: { userId: req.user.sub, productId } },
      create: { userId: req.user.sub, productId },
      update: {},
    });
    res.json({ ok: true, favorited: true });
  } catch (err) {
    console.error("POST /api/favorites FAILED:", err);
    res.status(500).json({ error: "favorites_add_failed" });
  }
});

/** DELETE /api/favorites/:productId */
router.delete("/:productId", authRequired, async (req, res) => {
  try {
    const { productId } = BodyToggle.parse({
      productId: req.params.productId,
    });
    await prisma.favorite.deleteMany({
      where: { userId: req.user.sub, productId },
    });
    res.json({ ok: true, favorited: false });
  } catch (err) {
    console.error("DELETE /api/favorites/:productId FAILED:", err);
    res.status(500).json({ error: "favorites_delete_failed" });
  }
});

/** POST /api/favorites/bulk */
router.post("/bulk", authRequired, async (req, res) => {
  try {
    const { add, remove } = BodyBulk.parse(req.body || {});
    const userId = req.user.sub;

    // ✅ scoatem dublurile
    const addDistinct = Array.from(new Set(add));
    const removeDistinct = Array.from(new Set(remove));

    if (addDistinct.length) {
      // ✅ validăm că produsele există și nu sunt ale userului
      const products = await prisma.product.findMany({
        where: { id: { in: addDistinct } },
        select: {
          id: true,
          service: { select: { vendor: { select: { userId: true } } } },
        },
      });

      const validProductIds = products
        .filter((p) => p.service?.vendor?.userId !== userId)
        .map((p) => p.id);

      if (validProductIds.length) {
        const dataAdd = validProductIds.map((productId) => ({
          userId,
          productId,
        }));
        await prisma.favorite.createMany({
          data: dataAdd,
          skipDuplicates: true,
        });
      }
    }

    if (removeDistinct.length) {
      await prisma.favorite.deleteMany({
        where: { userId, productId: { in: removeDistinct } },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/favorites/bulk FAILED:", err);
    res.status(500).json({ error: "favorites_bulk_failed" });
  }
});

/** GET /api/favorites/count */
router.get("/count", authRequired, async (req, res) => {
  try {
    const c = await prisma.favorite.count({
      where: { userId: req.user.sub },
    });
    res.json({ count: c });
  } catch (err) {
    console.error("GET /api/favorites/count FAILED:", err);
    res.status(500).json({ error: "favorites_count_failed" });
  }
});

/** DELETE /api/favorites (clear all) */
router.delete("/", authRequired, async (req, res) => {
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.user.sub },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/favorites FAILED:", err);
    res.status(500).json({ error: "favorites_clear_failed" });
  }
});

/** alias compat pentru UI existent */
router.get("/../wishlist/count", authRequired, async (_req, res) => {
  res.status(404).json({ error: "use /api/favorites/count" });
});

export default router;

/** opțional: alias /api/wishlist/count */
export const mountWishlistCountAlias = (app) => {
  app.get("/api/wishlist/count", authRequired, async (req, res) => {
    try {
      const c = await prisma.favorite.count({
        where: { userId: req.user.sub },
      });
      res.json({ count: c });
    } catch (err) {
      console.error("GET /api/wishlist/count FAILED:", err);
      res.status(500).json({ error: "favorites_count_failed" });
    }
  });
};
