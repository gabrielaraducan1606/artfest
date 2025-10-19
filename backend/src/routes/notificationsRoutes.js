// backend/src/routes/notificationsRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

router.get("/notifications/unread-count", authRequired, async (req, res) => {
  try {
    if (!prisma.notification) {
      return res.json({ count: 0, _debug: "no_notification_model" });
    }
    const count = await prisma.notification.count({
      where: { userId: req.user.sub, readAt: null },
    });
    res.json({ count });
  } catch (e) {
    console.error("notifications/unread-count error:", e?.message || e);
    res.json({ count: 0 });
  }
});

router.get("/notifications", authRequired, async (req, res) => {
  if (!prisma.notification) return res.json({ items: [] });
  const items = await prisma.notification.findMany({
    where: { userId: req.user.sub },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, body: true, readAt: true, createdAt: true },
  });
  res.json({ items });
});

router.post("/notifications/read", authRequired, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length || !prisma.notification) return res.json({ updated: 0 });
  const r = await prisma.notification.updateMany({
    where: { id: { in: ids }, userId: req.user.sub, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: r.count });
});

export default router;
