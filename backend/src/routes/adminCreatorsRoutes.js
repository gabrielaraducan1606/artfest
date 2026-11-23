// backend/src/routes/adminCreatorsRoutes.js
//
// Admin -> Artfest Creators (etapa 1a): moderarea profilurilor. Montat pe
// /api/admin/creators. Disponibil permanent, doar pentru admini.
//
//   GET  /options                                   etichetele (nișe, platforme, tipuri de conținut)
//   GET  /profiles?status=&q=&suspended=1&page=     listă paginată
//   GET  /profiles/:id                              detaliu: versiunea publicată vs. cea trimisă,
//                                                   oferte, istoric (cu statusul emailurilor)
//   POST /profiles/:id/approve                      PENDING -> APPROVED (publică versiunea trimisă)
//   POST /profiles/:id/request-changes { reason }   -> CHANGES_REQUESTED (mesaj pentru influencer)
//   POST /profiles/:id/reject          { reason }   PENDING, niciodată publicat -> REJECTED
//   POST /profiles/:id/suspend         { reason }   ascunde profilul publicat
//   POST /profiles/:id/unsuspend
//   POST /profiles/:id/offers/:offerId/deactivate { reason }
//
// Fiecare acțiune = eveniment în istoric (cine, când, motiv). Aprobarea NU
// schimbă nimic din programul de afiliere (status, comision, perioadă).

import { Router } from "express";

import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { adminDeactivateOffer, adminGetProfile, adminListProfiles, adminModerate } from "../services/creators/creatorProfileService.js";
import { catalogCategoryOptions, sendCreatorError } from "./creatorRoutes.js";
import { creatorOptions } from "../config/creators.js";

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user?.sub) return res.status(401).json({ error: "unauthorized" });
  prisma.user
    .findUnique({ where: { id: req.user.sub }, select: { id: true, role: true, status: true } })
    .then((user) => {
      if (!user) return res.status(401).json({ error: "user_not_found" });
      if (user.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
      req.adminUser = user;
      next();
    })
    .catch((error) => {
      console.error("[adminCreators] adminOnly:", error?.message || error);
      res.status(500).json({ error: "auth_check_failed" });
    });
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendCreatorError(res, error, "adminCreators");
  }
};

router.use(authRequired, adminOnly);

// etichetele (nișe, platforme, tipuri de conținut) - aceeași sursă ca la influencer
router.get("/options", (_req, res) => res.json({ ...creatorOptions(), ...catalogCategoryOptions() }));

router.get(
  "/profiles",
  handle(async (req, res) => {
    res.json(
      await adminListProfiles({
        status: req.query.status ? String(req.query.status) : null,
        q: req.query.q ? String(req.query.q).slice(0, 80) : "",
        suspended: req.query.suspended === "1" ? true : null,
        page: req.query.page,
      })
    );
  })
);

router.get(
  "/profiles/:id",
  handle(async (req, res) => {
    res.json(await adminGetProfile({ id: req.params.id }));
  })
);

const ACTIONS = { approve: "approve", "request-changes": "request_changes", reject: "reject", suspend: "suspend", unsuspend: "unsuspend" };

// Express 5: fără regex în cale -> acțiunea se validează aici (necunoscută = 404)
router.post(
  "/profiles/:id/:action",
  handle(async (req, res) => {
    if (!Object.hasOwn(ACTIONS, req.params.action)) return res.status(404).json({ error: "not_found" });
    const result = await adminModerate({
      id: req.params.id,
      action: ACTIONS[req.params.action],
      adminId: req.adminUser.id,
      reason: req.body?.reason ?? null,
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/profiles/:id/offers/:offerId/deactivate",
  handle(async (req, res) => {
    const result = await adminDeactivateOffer({
      profileId: req.params.id,
      offerId: req.params.offerId,
      adminId: req.adminUser.id,
      reason: req.body?.reason ?? null,
    });
    res.json({ ok: true, ...result });
  })
);

export default router;
