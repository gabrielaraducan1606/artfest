// backend/src/routes/assistantRoutes/assistantSupportRoutes.js

import { Router } from "express";

import assistantPublicSupportRoutes from "./support/assistantPublicSupportRoutes.js";
import assistantUserSupportRoutes from "./support/assistantUserSupportRoutes.js";

const router = Router();

/*
 * Rute publice:
 *
 * GET  /faqs
 * POST /tickets
 *
 * POST /tickets poate crea:
 * - tichet USER, dacă utilizatorul este autentificat;
 * - tichet GUEST, dacă nu este autentificat.
 */
router.use(
  assistantPublicSupportRoutes
);

/*
 * Rute autentificate:
 *
 * GET    /me/tickets
 * GET    /tickets/:id/messages
 * POST   /tickets/:id/messages
 * PATCH  /tickets/:id/read
 * DELETE /tickets/:id
 * GET    /unread-count
 */
router.use(
  assistantUserSupportRoutes
);

export default router;