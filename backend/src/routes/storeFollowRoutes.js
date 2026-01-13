// backend/src/routes/stores.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { notifyVendorOnStoreFollowCreated } from "../services/notifications.js";

const router = Router();

/**
 * GET /api/stores/:serviceId/followers-count
 * -> numărul de urmăritori (public)
 */
router.get("/:serviceId/followers-count", async (req, res) => {
  try {
    const { serviceId } = req.params;

    // opțional, poți verifica dacă există serviciul
    const service = await prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });

    if (!service) {
      return res.status(404).json({ ok: false, error: "store_not_found" });
    }

    const count = await prisma.serviceFollow.count({
      where: { serviceId },
    });

    return res.json({ ok: true, followersCount: count });
  } catch (e) {
    console.error("GET store followers count error", e);
    return res
      .status(500)
      .json({ ok: false, error: "store_followers_count_failed" });
  }
});

/**
 * GET /api/stores/:serviceId/follow
 * -> status user + count (user logat)
 */
router.get("/:serviceId/follow", authRequired, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const userId = req.user.sub;

    const service = await prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });

    if (!service) {
      return res.status(404).json({ ok: false, error: "store_not_found" });
    }

    const [follow, count] = await Promise.all([
      prisma.serviceFollow.findUnique({
        where: { userId_serviceId: { userId, serviceId } },
      }),
      prisma.serviceFollow.count({ where: { serviceId } }),
    ]);

    return res.json({
      ok: true,
      following: !!follow,
      followersCount: count,
    });
  } catch (e) {
    console.error("GET store follow status error", e);
    return res.status(500).json({
      ok: false,
      error: "store_follow_status_failed",
    });
  }
});

/**
 * POST /api/stores/:serviceId/follow
 * -> user-ul urmărește magazinul + notificare către VENDOR
 */
router.post("/:serviceId/follow", authRequired, async (req, res) => {
  const { serviceId } = req.params;
  const userId = req.user.sub;

  try {
    const service = await prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        vendorId: true,
        title: true,
        profile: {
          select: {
            displayName: true,
            slug: true,
          },
        },
      },
    });

    if (!service) {
      return res.status(404).json({ ok: false, error: "store_not_found" });
    }

    let isNewFollow = false;

    try {
      // încercăm să creăm follow; dacă există deja, prindem eroarea
      await prisma.serviceFollow.create({
        data: { userId, serviceId },
      });
      isNewFollow = true;
    } catch (e) {
      // P2002 = unique constraint (deja urmărește) -> ignorăm
      if (e.code !== "P2002") {
        console.error("create ServiceFollow error", e);
        throw e;
      }
      isNewFollow = false;
    }

    const count = await prisma.serviceFollow.count({ where: { serviceId } });

    // ==============================
    // 🔔 Notificare către VENDOR – doar la follow NOU
    // ==============================
    if (isNewFollow) {
      try {
        // helper-ul ia singur vendorId + storeName din service
        await notifyVendorOnStoreFollowCreated(serviceId, userId);
      } catch (e) {
        console.error("store follow notification failed", e);
        // nu stricăm răspunsul către client dacă notificarea eșuează
      }
    }

    return res.json({
      ok: true,
      following: true,
      followersCount: count,
    });
  } catch (e) {
    console.error("POST store follow error", e);
    return res.status(500).json({ ok: false, error: "store_follow_failed" });
  }
});

/**
 * DELETE /api/stores/:serviceId/follow
 * -> user-ul dă unfollow
 */
router.delete("/:serviceId/follow", authRequired, async (req, res) => {
  const { serviceId } = req.params;
  const userId = req.user.sub;

  try {
    const service = await prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: { id: true },
    });

    if (!service) {
      return res.status(404).json({ ok: false, error: "store_not_found" });
    }

    await prisma.serviceFollow.deleteMany({
      where: { userId, serviceId },
    });

    const count = await prisma.serviceFollow.count({ where: { serviceId } });

    return res.json({
      ok: true,
      following: false,
      followersCount: count,
    });
  } catch (e) {
    console.error("DELETE store unfollow error", e);
    return res
      .status(500)
      .json({ ok: false, error: "store_unfollow_failed" });
  }
});

export default router;
