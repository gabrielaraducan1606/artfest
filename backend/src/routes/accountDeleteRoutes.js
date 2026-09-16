// backend/src/routes/accountDeleteRoutes.js
// ---------------------------------------------------------
// Rute legate de contul utilizatorului (ștergere cont).
//
// Endpoint principal:
//
//   DELETE /api/account/me
//
// IMPORTANT: contul este ANONIMIZAT, nu șters fizic din DB.
// Vezi src/services/accountDeletionService.js pentru motivul
// legal exact (retenția facturilor - Legea 82/1991 - și a
// dovezilor de acceptare a documentelor legale - UserConsent/
// VendorAcceptance - care ar dispărea prin cascadă dacă am
// șterge fizic rândul User).
//
// Folosit de:
//  - pagina de Settings pentru Vendor (SettingsPage.jsx)
//  - pagina de Settings pentru User (UserSettingsPage.jsx)
//
// Aceeași logică (deleteOrAnonymizeAccount) e folosită și de
// jobul de curățare a conturilor inactive
// (adminMaintenanceRoutes.js), ca să nu existe două
// implementări divergente.
// ---------------------------------------------------------

import { Router } from "express";
import { authRequired } from "../api/auth.js";
import { deleteOrAnonymizeAccount } from "../services/accountDeletionService.js";

const router = Router();

/**
 * DELETE /api/account/me
 */
router.delete("/account/me", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const result = await deleteOrAnonymizeAccount({
      userId,
      reason: "SELF_SERVICE",
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.json({
      ok: true,
      alreadyProcessed: result.alreadyProcessed || false,
    });
  } catch (e) {
    console.error("DELETE /api/account/me error:", e);
    return res.status(500).json({ error: "account_delete_failed" });
  }
});

export default router;
