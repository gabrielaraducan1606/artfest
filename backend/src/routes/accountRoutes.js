// src/routes/accountRoutes.js
import { Router } from "express";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import changePassword from "./changePasswordRoutes.js";
// (dacă ai și changeEmail, îl imporți similar)

const router = Router();

// schimbare parolă din tabul „Securitate”
router.post(
  "/change-password",
  authRequired,         // pune userul în req.user
  enforceTokenVersion,  // opțional, dar recomandat
  changePassword
);

// (aici poți monta și alte rute de account, ex: /me/profile, /me/notifications etc.)

export default router;
