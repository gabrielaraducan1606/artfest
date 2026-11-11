// backend/src/routes/userAddressesRoutes.js
//
// Agenda de adrese + ultimul punct easybox / Sameday Point, pentru clientul
// autentificat (orice rol care cumpără). Totul e limitat la req.user.sub.
//
//   GET    /api/me/addresses               lista (implicita prima)
//   POST   /api/me/addresses               adaugă (prima devine implicită)
//   PUT    /api/me/addresses/:id           editează (revalidare Sameday)
//   DELETE /api/me/addresses/:id           șterge (implicita trece pe cea mai veche rămasă)
//   POST   /api/me/addresses/:id/default   setează implicită
//   GET    /api/me/ooh-locations/last      ultimul easybox / Sameday Point, revalidat acum
//
// Cu checkout-ul nou inactiv (checkoutMode.js): adresele funcționează (doar text, fără
// ID-uri Sameday), iar „ultimul punct” e o listă goală.

import express from "express";

import { authRequired as defaultAuthRequired, enforceTokenVersion as defaultEnforceTokenVersion } from "../api/auth.js";
import { prisma as defaultDb } from "../db.js";
import { deliveryCatalog as defaultCatalog } from "../services/shipping/deliveryCatalog.js";
import { isSamedayCheckoutActive } from "../services/shipping/checkoutMode.js";
import { createUserAddressService, UserAddressError } from "../services/userAddresses.js";
import { createUserOohLocationService } from "../services/shipping/userOohLocation.js";

export function createUserAddressesRouter({
  db = defaultDb,
  catalog = null,
  env = process.env,
  isActive = null,
  authRequired = defaultAuthRequired,
  enforceTokenVersion = defaultEnforceTokenVersion,
} = {}) {
  const router = express.Router();
  const cat = async () => ((isActive ? await isActive() : await isSamedayCheckoutActive(env, db)) ? catalog || defaultCatalog() : null);
  const addresses = async () => createUserAddressService({ db, catalog: await cat() });
  const ooh = async () => createUserOohLocationService({ db, catalog: await cat() });

  router.use(["/addresses", "/ooh-locations"], authRequired, enforceTokenVersion);

  const handle = (fn) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return await fn(req, res);
    } catch (error) {
      if (error instanceof UserAddressError) {
        return res.status(error.status).json({ error: error.code, message: error.message, fields: error.fields || undefined });
      }
      console.error("[me/addresses]", error?.message || error);
      return res.status(500).json({ error: "addresses_failed", message: "Nu am putut salva adresa. Încearcă din nou." });
    }
  };

  const userId = (req) => String(req.user?.sub || "");

  router.get("/addresses", handle(async (req, res) => res.json({ items: await (await addresses()).list(userId(req)) })));

  router.post("/addresses", handle(async (req, res) => res.status(201).json({ address: await (await addresses()).create(userId(req), req.body || {}) })));

  router.put("/addresses/:id", handle(async (req, res) => res.json({ address: await (await addresses()).update(userId(req), req.params.id, req.body || {}) })));

  router.delete("/addresses/:id", handle(async (req, res) => res.json(await (await addresses()).remove(userId(req), req.params.id))));

  router.post("/addresses/:id/default", handle(async (req, res) => res.json({ address: await (await addresses()).setDefault(userId(req), req.params.id) })));

  router.get("/ooh-locations/last", handle(async (req, res) => res.json({ items: await (await ooh()).listValidated(userId(req)) })));

  return router;
}

export default createUserAddressesRouter();
