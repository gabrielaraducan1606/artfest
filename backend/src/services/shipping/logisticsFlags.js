// backend/src/services/shipping/logisticsFlags.js
//
// Funcțiile LOGISTICE Sameday, separate de checkout-ul clientului:
//
//   SAMEDAY_CHECKOUT_ENABLED       (checkoutMode.js, NESCHIMBAT) - metodele de livrare
//                                  din checkout, prețul Sameday, easybox / Sameday Point.
//   SAMEDAY_NOMENCLATOR_ENABLED    NOU - județele / localitățile Sameday pentru
//                                  VALIDAREA adreselor în afara checkout-ului
//                                  (deocamdată: adresa de ridicare a returului).
//                                  Nu schimbă checkout-ul: /api/shipping/options
//                                  rămâne legat DOAR de SAMEDAY_CHECKOUT_ENABLED.
//   RETURN_COURIER_PICKUP_ENABLED  NOU - opțiunea „Ridicare de la adresă” la retur
//                                  (alegerea clientului + coletul RETURN creat de Admin).
//
// Ambele flag-uri noi: pornite DOAR explicit („true” / „1”), nesetate = OPRITE.
// Niciunul nu pornește automat pentru că există un cont PLATFORM configurat:
// contul e o CONDIȚIE în plus (ridicarea de retur e refuzată fără el), nu un
// declanșator. Generarea AWB-ului real rămâne protejată separat de
// COURIER_INTEGRATION_ENABLED + COURIER_AWB_LIVE_ENABLED (couriers/http.js, awbLive.js).
// Decizia folosește DOAR env + DB - niciun apel la Sameday.

import { prisma as defaultDb } from "../../db.js";
import { findPlatformCourierAccount, platformConfig } from "../../couriers/platformAccount.js";
import { isSamedayCheckoutActive } from "./checkoutMode.js";

const isOn = (v) => ["true", "1"].includes(String(v ?? "").trim().toLowerCase());

export function isSamedayNomenclatorFlagOn(env = process.env) {
  return isOn(env.SAMEDAY_NOMENCLATOR_ENABLED);
}

export function isReturnCourierPickupFlagOn(env = process.env) {
  return isOn(env.RETURN_COURIER_PICKUP_ENABLED);
}

/**
 * Nomenclatorul Sameday e disponibil pentru validarea adreselor? Da dacă e
 * activat explicit SAU dacă checkout-ul Sameday e deja activ (îl folosește oricum).
 * @param {{ env?: Object, db?: Object, checkoutActive?: () => Promise<boolean> }} [opts]
 */
export async function isNomenclatorAvailable({ env = process.env, db = defaultDb, checkoutActive = null } = {}) {
  if (isSamedayNomenclatorFlagOn(env)) return true;
  return checkoutActive ? Boolean(await checkoutActive()) : isSamedayCheckoutActive(env, db);
}

/**
 * Contul Artfest (PLATFORM) e configurat pentru un AWB de retur: Sameday,
 * nedezactivat, activ, cu credentiale și punct de ridicare contractual.
 * (Serviciul „Retur standard” se verifică live doar la generarea AWB-ului.)
 */
export function isPlatformConfiguredForReturns(account) {
  if (!account || account.provider !== "SAMEDAY" || account.disabledAt) return false;
  if (account.status !== "ACTIVE") return false;
  if (!account.credentialsCipher) return false;
  return Boolean(platformConfig(account).pickupPointId);
}

export const RETURN_PICKUP_UNAVAILABLE_REASONS = Object.freeze({
  FLAG_OFF: "return_pickup_disabled",
  NOMENCLATOR_OFF: "nomenclator_disabled",
  PLATFORM_NOT_CONFIGURED: "platform_not_configured",
});

/**
 * „Ridicare de la adresă” la retur e disponibilă ACUM? Toate condițiile:
 * RETURN_COURIER_PICKUP_ENABLED + nomenclator disponibil + cont PLATFORM configurat.
 * @returns {Promise<{ available: boolean, reason: string|null }>}
 */
export async function returnPickupAvailability({ env = process.env, db = defaultDb, checkoutActive = null } = {}) {
  if (!isReturnCourierPickupFlagOn(env)) return { available: false, reason: RETURN_PICKUP_UNAVAILABLE_REASONS.FLAG_OFF };
  if (!(await isNomenclatorAvailable({ env, db, checkoutActive }))) {
    return { available: false, reason: RETURN_PICKUP_UNAVAILABLE_REASONS.NOMENCLATOR_OFF };
  }
  let account = null;
  try {
    account = await findPlatformCourierAccount(db);
  } catch {
    account = null;
  }
  if (!isPlatformConfiguredForReturns(account)) {
    return { available: false, reason: RETURN_PICKUP_UNAVAILABLE_REASONS.PLATFORM_NOT_CONFIGURED };
  }
  return { available: true, reason: null };
}
