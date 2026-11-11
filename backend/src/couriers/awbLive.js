// backend/src/couriers/awbLive.js

import { CourierError } from "./errors.js";

/*
 * Emiterea AWB REAL (POST /api/awb la curier) are un guard separat de restul
 * integrării de curierat:
 *
 *   COURIER_AWB_LIVE_ENABLED = "true"   -> AWB real permis
 *   absent / false / 0 / off / orice    -> AWB real INTERZIS (fără niciun
 *                                          request către curier)
 *
 * COURIER_INTEGRATION_ENABLED rămâne comutatorul general (previzualizare AWB,
 * anulare, etichetă); NODE_ENV și mediul Sameday NU decid nimic aici.
 * Checkout-ul / estimate-cost, adresele de ridicare, nomenclatorul și
 * Admin → Curieri NU depind de acest flag.
 *
 * Verificat în: ruta POST /api/vendor/shipments/:id/awb, createAwbForShipment
 * (înainte de orice citire / rezervare) și providerul Sameday chiar înainte de
 * POST /api/awb - nicio cale nu ocolește guard-ul.
 */

export const AWB_LIVE_DISABLED_CODE = "courier_awb_live_disabled";
export const AWB_LIVE_DISABLED_MESSAGE = "Generarea AWB nu este activată momentan.";

export function isCourierAwbLiveEnabled(env = process.env) {
  return String(env.COURIER_AWB_LIVE_ENABLED ?? "").trim().toLowerCase() === "true";
}

export class CourierAwbLiveDisabledError extends CourierError {
  constructor() {
    super(AWB_LIVE_DISABLED_CODE, AWB_LIVE_DISABLED_MESSAGE, { httpStatus: 503 });
  }
}

export function assertCourierAwbLiveEnabled(env = process.env) {
  if (!isCourierAwbLiveEnabled(env)) throw new CourierAwbLiveDisabledError();
}
