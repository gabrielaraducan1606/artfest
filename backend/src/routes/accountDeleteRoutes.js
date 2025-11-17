// src/routes/accountRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/**
 * DELETE /api/account/me
 * Șterge contul utilizatorului logat + ce e direct legat de el ca vendor.
 * Ai GRIJĂ ce ștergi aici – ajustează după modelul tău de date.
 */
router.delete("/account/me", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub; // la tine userId e în req.user.sub

    // verificăm dacă există user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }

    await prisma.$transaction(async (tx) => {
      // 1) ștergem/parțial ștergem tot ce e direct legat de user

      // favorite
      await tx.favorite.deleteMany({ where: { userId } });

      // mesaje, notificări etc. – adaptează la schema ta
      await tx.vendorMessage.deleteMany({ where: { userId } }).catch(() => {});
      await tx.notification.deleteMany({ where: { userId } }).catch(() => {});

      // 2) vendor + servicii + produse
      const vendor = await tx.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (vendor) {
        const vendorId = vendor.id;

        // produse
        await tx.product.deleteMany({
          where: { service: { vendorId } },
        });

        // profile servicii
        await tx.serviceProfile.deleteMany({
          where: { service: { vendorId } },
        });

        // servicii
        await tx.vendorService.deleteMany({
          where: { vendorId },
        });

        // vendor
        await tx.vendor.delete({
          where: { id: vendorId },
        });
      }

      // 3) tokenuri de reset/istoric parole etc.
      await tx.passwordResetToken
        .deleteMany({ where: { userId } })
        .catch(() => {});
      await tx.passwordHistory
        .deleteMany({ where: { userId } })
        .catch(() => {});

      // 4) user
      await tx.user.delete({ where: { id: userId } });
    });

    // ideal: ștergi și cookie-ul de auth la nivel de frontend la redirect
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/account/me error:", e);
    return res.status(500).json({ error: "account_delete_failed" });
  }
});

export default router;
