// backend/src/routes/userNotificationsRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

// 🔐 notificări pt user final / client
// -> cerem doar user logat + tokenVersion valid
router.use(authRequired, enforceTokenVersion);

// helper mic: ia userId din token
function getUserId(req) {
  return req.user.id || req.user.sub;
}

/**
 * GET /api/notifications
 * query: scope=all|unread|archived, q=search
 *
 * (fiind montat pe /api/notifications, aici ruta e "/")
 */
router.get("/", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "no_user_id_in_token" });
  }

  const {
    scope = "all",
    q = "",
    page: pageRaw = "1",
    limit: limitRaw = "20",
  } = req.query;

  // page & limit safe
  const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  let where = { userId };

  if (scope === "unread") {
    where = { ...where, readAt: null, archived: false };
  } else if (scope === "archived") {
    where = { ...where, archived: true };
  } else {
    // "all" = ne-arhivate
    where = { ...where, archived: false };
  }

  if (q) {
    const term = String(q);
    where = {
      ...where,
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { body: { contains: term, mode: "insensitive" } },
      ],
    };
  }

  // cerem limit + 1 ca să știm dacă există pagină următoare
  const rawItems = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: limit + 1,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      archived: true,
      createdAt: true,
    },
  });

  const hasMore = rawItems.length > limit;
  const items = hasMore ? rawItems.slice(0, limit) : rawItems;

  res.json({
    items,
    page,
    limit,
    hasMore,
  });
});

/**
 * GET /api/notifications/unread-count
 * (în router: GET /unread-count)
 */
router.get("/unread-count", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.json({ count: 0 });

  const count = await prisma.notification.count({
    where: {
      userId,
      readAt: null,
      archived: false,
    },
  });

  res.json({ count });
});

/**
 * PATCH /api/notifications/:id/read
 */
router.patch("/:id/read", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "no_user_id_in_token" });
  }

  const { id } = req.params;

  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });

  res.json({ ok: true });
});

/**
 * PATCH /api/notifications/:id/archive
 */
router.patch("/:id/archive", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "no_user_id_in_token" });
  }

  const { id } = req.params;
  const { archived = true } = req.body || {};

  await prisma.notification.updateMany({
    where: { id, userId },
    data: { archived: !!archived },
  });

  res.json({ ok: true });
});

/**
 * PATCH /api/notifications/read-all
 */
router.patch("/read-all", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "no_user_id_in_token" });
  }

  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, archived: false },
    data: { readAt: new Date() },
  });

  res.json({ updated: result.count });
});

export default router;
