// backend/src/routes/vendorCourierRoutes.js

import { Router } from "express";
import { authRequired } from "../api/auth.js";
import { listCourierProviders } from "../couriers/registry.js";
import { requireVendorAccount, courierApiLimiter, handleCourier } from "../couriers/http.js";
import {
  listVendorCourierAccounts,
  createVendorCourierAccount,
  testVendorCourierAccount,
  updateVendorCourierAccount,
  deleteVendorCourierAccount,
  setDefaultVendorCourierAccount,
} from "../couriers/accounts.js";
import {
  listPickupAddresses,
  createPickupAddress,
  updatePickupAddress,
  deletePickupAddress,
  setDefaultPickupAddress,
} from "../couriers/pickupAddresses.js";

/*
 * Montat pe /api/vendor:
 *   /couriers/providers, /couriers/accounts..., /pickup-addresses...
 *
 * Credentialele intră doar în POST/PATCH și NU ies niciodată în răspunsuri
 * (vezi toPublicCourierAccount). Erorile nu includ răspunsul curierului.
 */

const router = Router();

// operațiile care contactează API-ul curierului (test / creare / înlocuire)
const courierLimiter = courierApiLimiter();
const handle = (fn) => handleCourier(fn, "vendorCourierRoutes");

router.use(["/couriers", "/pickup-addresses"], authRequired, requireVendorAccount);

/* ===== Provideri ===== */

// GET /api/vendor/couriers/providers
router.get(
  "/couriers/providers",
  handle(async (_req, res) => {
    res.json({ items: listCourierProviders() });
  })
);

/* ===== Conturi de curier ===== */

// GET /api/vendor/couriers/accounts
router.get(
  "/couriers/accounts",
  handle(async (req, res) => {
    res.json({ items: await listVendorCourierAccounts(req.vendorId) });
  })
);

// POST /api/vendor/couriers/accounts - testează înainte de salvare
router.post(
  "/couriers/accounts",
  courierLimiter,
  handle(async (req, res) => {
    const result = await createVendorCourierAccount(req.vendorId, req.body || {});
    res.status(201).json(result);
  })
);

// POST /api/vendor/couriers/accounts/:id/test
router.post(
  "/couriers/accounts/:id/test",
  courierLimiter,
  handle(async (req, res) => {
    res.json(await testVendorCourierAccount(req.vendorId, req.params.id));
  })
);

// PATCH /api/vendor/couriers/accounts/:id
router.patch(
  "/couriers/accounts/:id",
  courierLimiter,
  handle(async (req, res) => {
    const account = await updateVendorCourierAccount(req.vendorId, req.params.id, req.body || {});
    res.json({ account });
  })
);

// DELETE /api/vendor/couriers/accounts/:id
router.delete(
  "/couriers/accounts/:id",
  handle(async (req, res) => {
    res.json(await deleteVendorCourierAccount(req.vendorId, req.params.id));
  })
);

// POST /api/vendor/couriers/accounts/:id/default
router.post(
  "/couriers/accounts/:id/default",
  handle(async (req, res) => {
    const account = await setDefaultVendorCourierAccount(req.vendorId, req.params.id);
    res.json({ account });
  })
);

/* ===== Adrese de ridicare ===== */

// GET /api/vendor/pickup-addresses
router.get(
  "/pickup-addresses",
  handle(async (req, res) => {
    res.json({ items: await listPickupAddresses(req.vendorId) });
  })
);

// POST /api/vendor/pickup-addresses
router.post(
  "/pickup-addresses",
  handle(async (req, res) => {
    const address = await createPickupAddress(req.vendorId, req.body || {});
    res.status(201).json({ address });
  })
);

// PATCH /api/vendor/pickup-addresses/:id
router.patch(
  "/pickup-addresses/:id",
  handle(async (req, res) => {
    const address = await updatePickupAddress(req.vendorId, req.params.id, req.body || {});
    res.json({ address });
  })
);

// DELETE /api/vendor/pickup-addresses/:id
router.delete(
  "/pickup-addresses/:id",
  handle(async (req, res) => {
    res.json(await deletePickupAddress(req.vendorId, req.params.id));
  })
);

// POST /api/vendor/pickup-addresses/:id/default
router.post(
  "/pickup-addresses/:id/default",
  handle(async (req, res) => {
    const address = await setDefaultPickupAddress(req.vendorId, req.params.id);
    res.json({ address });
  })
);

export default router;
