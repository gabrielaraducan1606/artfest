// backend/src/routes/publicMessagesRoutes.js
import express from "express";

const router = express.Router();

/*
 * POST /public/contact-vendor - DEZACTIVAT.
 *
 * Ruta era publică (montată în afara /api: fără autentificare, fără
 * limitatorul global), accepta `userId` din body (autor falsificabil) și
 * apela moderarea AI la fiecare cerere. Nu are apelanți în frontend.
 *
 * Mesajele către vânzători se trimit DOAR autentificat:
 *   POST /api/user-inbox/ensure-thread
 *   POST /api/user-inbox/threads/:id/messages
 * (utilizatorul vine din token, nu din body).
 *
 * Răspuns constant: fără bază de date, fără AI, pentru orice metodă.
 */
router.all("/contact-vendor", (_req, res) => {
  res.status(410).json({
    error: "endpoint_removed",
    message: "Această rută nu mai este disponibilă. Trimite mesajul din contul tău Artfest.",
  });
});

export default router;
