// backend/src/services/shipping/checkoutMode.js
//
// Când e activ checkout-ul NOU (livrare per magazin, nomenclator Sameday,
// easybox / Sameday Point, snapshot ShipmentDelivery)?
//
//   SAMEDAY_CHECKOUT_ENABLED=true          -> mereu (forțat)
//   SAMEDAY_CHECKOUT_ENABLED=false|0|off   -> niciodată (oprire de urgență)
//   nesetat / auto                         -> imediat ce contul Sameday PLATFORM
//                                             e configurat în DB (vezi mai jos)
//
// Decizia folosește DOAR configurația din DB, niciun apel la Sameday: dacă
// Sameday cade (timeout / 5xx / autentificare respinsă), checkout-ul NU
// schimbă formularul - doar metodele dependente de Sameday trec pe rezervă
// (deliveryCatalog: courierAvailable = false -> doar livrare la adresă, text).

import { prisma as defaultDb } from "../../db.js";
import { findPlatformCourierAccount, platformConfig } from "../../couriers/platformAccount.js";

const MODE_TTL_MS = 60_000;

/** "on" | "off" | "auto" */
export function samedayCheckoutFlag(env = process.env) {
  const v = String(env.SAMEDAY_CHECKOUT_ENABLED ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(v)) return "on";
  if (["false", "0", "off", "no"].includes(v)) return "off";
  return "auto";
}

/**
 * Contul PLATFORM e „configurat corect” pentru checkout: Sameday, nedezactivat,
 * credentiale salvate, punct de ridicare contractual + serviciul de livrare la
 * adresă. INVALID_CREDENTIALS contează tot ca „configurat” (statusul se pune
 * automat la o autentificare respinsă - nu trebuie să schimbe formularul;
 * catalogul îl tratează ca Sameday indisponibil).
 */
export function isPlatformConfiguredForCheckout(account) {
  if (!account || account.provider !== "SAMEDAY" || account.disabledAt) return false;
  if (!["ACTIVE", "INVALID_CREDENTIALS"].includes(account.status)) return false;
  if (!account.credentialsCipher) return false;
  const cfg = platformConfig(account);
  return Boolean(cfg.pickupPointId && cfg.serviceId);
}

/**
 * @param {Object} [deps] injectate în teste
 * @returns {() => Promise<boolean>}
 */
export function createCheckoutModeResolver({ db = defaultDb, env = process.env, now = () => Date.now(), ttlMs = MODE_TTL_MS } = {}) {
  let last = null; // { value, at }

  return async function isSamedayCheckoutActive() {
    const flag = samedayCheckoutFlag(env);
    if (flag !== "auto") return flag === "on";
    if (last && now() - last.at < ttlMs) return last.value;
    try {
      const value = isPlatformConfiguredForCheckout(await findPlatformCourierAccount(db));
      last = { value, at: now() };
      return value;
    } catch {
      // DB indisponibil: ultima decizie cunoscută (fără salt de formular); altfel formularul de până acum
      return last ? last.value : false;
    }
  };
}

let shared = null;
/** Resolverul comun (cache 60 s); `env` diferit (teste) -> resolver separat, fără cache comun. */
export function isSamedayCheckoutActive(env = process.env, db = defaultDb) {
  if (env !== process.env || db !== defaultDb) return createCheckoutModeResolver({ env, db })();
  if (!shared) shared = createCheckoutModeResolver();
  return shared();
}
