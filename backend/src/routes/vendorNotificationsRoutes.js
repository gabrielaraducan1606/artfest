// backend/src/routes/vendorNotificationsRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";

const router = Router();

/**
 * Toate rutele de aici:
 * - necesită user logat
 * - necesită rol VENDOR
 * - verifică tokenVersion dacă există
 */
router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));

/**
 * helper: obține vendorId pentru userul logat
 *
 * încercăm în ordine:
 * 1) req.user.vendorId (ideal, dacă îl pui în JWT la login)
 * 2) căutăm vendor după userId (id/sub)
 */
async function getVendorIdForUser(req) {
  if (req.user.vendorId) return req.user.vendorId;

  const userId = req.user.id || req.user.sub;

  if (!userId) {
    console.warn(
      "[getVendorIdForUser] missing userId on req.user:",
      JSON.stringify(req.user)
    );
    return null;
  }

  const vendor = await prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!vendor) {
    console.warn("[getVendorIdForUser] no vendor for userId:", userId);
  }

  return vendor?.id || null;
}

/**
 * GET /api/vendor/notifications
 * query: scope=all|unread|archived, q=search
 */
router.get("/vendor/notifications", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) {
    return res.status(403).json({ error: "no_vendor_for_user" });
  }

  const { scope = "all", q = "" } = req.query;

  let where = { vendorId };

  if (scope === "unread") {
    where = { ...where, readAt: null, archived: false };
  } else if (scope === "archived") {
    where = { ...where, archived: true };
  } else {
    where = { ...where, archived: false }; // "all" = ne-arhivate
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

  res.json({ items });
});

/**
 * GET /api/vendor/notifications/unread-count
 */
router.get("/vendor/notifications/unread-count", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) return res.json({ count: 0 });

  const count = await prisma.notification.count({
    where: {
      vendorId,
      readAt: null,
      archived: false,
    },
  });

  res.json({ count });
});

/**
 * PATCH /api/vendor/notifications/:id/read
 */
router.patch("/vendor/notifications/:id/read", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) {
    return res.status(403).json({ error: "no_vendor_for_user" });
  }

  const { id } = req.params;

  await prisma.notification.updateMany({
    where: { id, vendorId, readAt: null },
    data: { readAt: new Date() },
  });

  res.json({ ok: true });
});

/**
 * PATCH /api/vendor/notifications/:id/archive
 */
router.patch("/vendor/notifications/:id/archive", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) {
    return res.status(403).json({ error: "no_vendor_for_user" });
  }

  const { id } = req.params;
  const { archived = true } = req.body || {};

  await prisma.notification.updateMany({
    where: { id, vendorId },
    data: { archived: !!archived },
  });

  res.json({ ok: true });
});

/**
 * PATCH /api/vendor/notifications/read-all
 */
router.patch("/vendor/notifications/read-all", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId) {
    return res.status(403).json({ error: "no_vendor_for_user" });
  }

  const result = await prisma.notification.updateMany({
    where: { vendorId, readAt: null, archived: false },
    data: { readAt: new Date() },
  });

  res.json({ updated: result.count });
});

export default router;
