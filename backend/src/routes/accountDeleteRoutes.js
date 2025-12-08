// backend/src/routes/accountDeleteRoutes.js
// ---------------------------------------------------------
// Rute legate de contul utilizatorului (ștergere cont).
//
// Endpoint principal:
//
//   DELETE /api/account/me
//
// Șterge complet contul utilizatorului autentificat + toate
// entitățile direct legate (favorite, mesaje, notificări,
// vendor + servicii + produse, tokenuri de resetare, istoric
// parole).
//
// IMPORTANT:
//  - acțiune ireversibilă (hard delete);
//  - totul se execută într-o tranzacție Prisma.
// ---------------------------------------------------------

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/**
 * DELETE /api/account/me
 *
 * Scop:
 *  - Șterge complet contul utilizatorului logat.
 *  - Folosit de:
 *    - pagina de Settings pentru Vendor (SettingsPage.jsx)
 *    - pagina de Settings pentru User (UserSettingsPage.jsx)
 *
 * Cerințe:
 *  - utilizatorul trebuie să fie autentificat (authRequired).
 *
 * Pași:
 *  1. Luăm userId din JWT (req.user.sub).
 *  2. Verificăm că userul există.
 *  3. Deschidem tranzacție Prisma:
 *      (A) ștergem entitățile legate direct de user;
 *      (B) dacă userul are Vendor -> ștergem vendor + servicii + produse;
 *      (C) ștergem tokenurile de reset parolă & istoricul parolelor;
 *      (D) ștergem în final userul.
 *  4. Returnăm { ok: true } dacă a reușit.
 */
router.delete("/account/me", authRequired, async (req, res) => {
  try {
    // 1) ID-ul userului din token (payload JWT)
    const userId = req.user.sub;

    // 2) verificăm dacă există user în DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: "user_not_found" });
    }

    // 3) tranzacție atomică: toate ștergerile sau nimic
    await prisma.$transaction(async (tx) => {
      // -------------------------------------------------
      // (A) entități legate direct de user
      // -------------------------------------------------

      // favorite (produs/serviciu salvat)
      await tx.favorite.deleteMany({ where: { userId } }).catch(() => {});

      // mesaje (dacă ai tabela vendorMessage)
      await tx.vendorMessage
        .deleteMany({ where: { userId } })
        .catch(() => {});

      // notificări in-app
      await tx.notification
        .deleteMany({ where: { userId } })
        .catch(() => {});

      // dacă ai alte entități legate direct de user, adaugă-le aici

      // -------------------------------------------------
      // (B) dacă userul este Vendor -> ștergem vendor + context
      // -------------------------------------------------
      const vendor = await tx.vendor.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (vendor) {
        const vendorId = vendor.id;

        // produse legate de serviciile vendorului
        await tx.product
          .deleteMany({
            where: { service: { vendorId } },
          })
          .catch(() => {});

        // profile servicii
        await tx.serviceProfile
          .deleteMany({
            where: { service: { vendorId } },
          })
          .catch(() => {});

        // servicii (vendorService)
        await tx.vendorService
          .deleteMany({
            where: { vendorId },
          })
          .catch(() => {});

        // acceptanțe de termeni / politici, dacă le ai
        await tx.vendorAcceptance
          .deleteMany({ where: { vendorId } })
          .catch(() => {});

        // vendor în sine
        await tx.vendor
          .delete({
            where: { id: vendorId },
          })
          .catch(() => {});
      }

      // -------------------------------------------------
      // (C) securitate parolă – tokenuri + istoric
      // -------------------------------------------------
      await tx.passwordResetToken
        .deleteMany({ where: { userId } })
        .catch(() => {});

      await tx.passwordHistory
        .deleteMany({ where: { userId } })
        .catch(() => {});

      // dacă ai și alte tabele legate de securitate, le adaugi aici

      // -------------------------------------------------
      // (D) ștergem userul în sine
      // -------------------------------------------------
      await tx.user.delete({ where: { id: userId } });
    });

    // 4) răspuns OK – frontend-ul face redirect + „logout”
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/account/me error:", e);
    return res.status(500).json({ error: "account_delete_failed" });
  }
});

export default router;
