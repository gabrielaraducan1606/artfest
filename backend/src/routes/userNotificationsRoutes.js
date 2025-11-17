// backend/src/routes/userNotificationsRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

router.use(authRequired, enforceTokenVersion);

/**
 * GET /api/notifications
 * (pentru user final / client)
 */
router.get("/notifications", async (req, res) => {
  const userId = req.user.sub;

  const { scope = "all", q = "" } = req.query;

  let where = { userId };

  if (scope === "unread") {
    where = { ...where, readAt: null, archived: false };
  } else if (scope === "archived") {
    where = { ...where, archived: true };
  } else {
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

  const items = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  res.json({ items });
});

/**
 * GET /api/notifications/unread-count
 * (pentru user final / client)
 */
router.get("/notifications/unread-count", async (req, res) => {
  const userId = req.user.sub;

  const count = await prisma.notification.count({
    where: {
      userId,
      readAt: null,
      archived: false,
    },
  });

  res.json({ count });
});

export default router;
