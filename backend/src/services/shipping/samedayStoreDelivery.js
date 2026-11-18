// backend/src/services/shipping/samedayStoreDelivery.js
//
// „Livrare Sameday prin Artfest” (ARTFEST_SAMEDAY) - activarea PER MAGAZIN (opt-in).
//
// Câmpuri (VendorService): samedayOptInAt / samedayOptInById = alegerea vânzătorului;
// samedayDisabledAt / samedayDisabledById = restricția Artfest (Admin), cu prioritate.
//
// Reguli:
//  - niciun magazin nu e activat automat; activarea cere eligibilitate COMPLETĂ,
//    verificată AICI, pe server (o cerere API modificată manual nu o poate ocoli);
//  - dezactivarea de către vânzător e mereu permisă;
//  - restricția Admin NU atinge magazinul (status / isActive / produse), doar Sameday;
//  - indisponibilitatea Sameday (contul Artfest nevalidat, comutator oprit, eroare de
//    verificare) face opțiunea INACTIVĂ, fără să schimbe livrarea vânzătorului;
//  - fără efect pe comenzi, plăți, facturare: doar alegerea magazinului.

import { prisma as defaultDb } from "../../db.js";
import { buildPickupParty } from "../../couriers/awb/addresses.js";
import { isSamedayArtfestDeliveryFlagOn, platformSamedayReadiness, storeSamedayEligibility } from "../../couriers/samedayReadiness.js";
import { VENDOR_STRIPE_STATUS_SELECT, isVendorStripeReady } from "../../payments/vendorStripeStatus.js";
import { PHYSICAL_STORE_TYPE } from "./vendorShippingSetup.js";

export class SamedayDeliveryError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "SamedayDeliveryError";
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

// mesajele pentru vânzător (motivele vin ca coduri fixe din eligibilitate)
export const SAMEDAY_REASON_MESSAGES = Object.freeze({
  platform_not_ready:
    "Livrarea Sameday prin Artfest nu este disponibilă momentan. Comenzile tale continuă normal, cu livrarea ta obișnuită.",
  store_disabled_by_artfest:
    "Artfest a dezactivat livrarea Sameday pentru acest magazin. Magazinul și livrarea ta obișnuită funcționează normal. Pentru detalii, scrie-ne din Asistență.",
  vendor_stripe_not_ready:
    "Pentru Sameday prin Artfest trebuie să activezi încasările online (Stripe), pentru că aceste comenzi se plătesc integral cu cardul. Magazinul tău și metodele actuale de livrare și plată funcționează în continuare normal.",
  pickup_address_not_ready:
    "Completează adresa de ridicare: persoană de contact, telefon valid, județ, localitate, stradă și număr.",
  store_not_physical: "Livrarea Sameday este disponibilă doar pentru magazinele cu produse fizice.",
});

const STORE_SELECT = {
  id: true,
  vendorId: true,
  title: true,
  samedayOptInAt: true,
  samedayOptInById: true,
  samedayDisabledAt: true,
  samedayDisabledById: true,
  type: { select: { code: true } },
};

async function loadPickupReady(db, vendorId) {
  const [billing, pickup] = await Promise.all([
    db.vendorBilling.findUnique({ where: { vendorId }, select: { legalType: true, companyName: true, cui: true, regCom: true } }),
    db.vendorPickupAddress.findFirst({ where: { vendorId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);
  if (!pickup) return false;
  return buildPickupParty({ vendor: null, billing, pickup }).blockers.length === 0;
}

// indisponibilitatea verificării (DB / config) => platforma NU e gata (fail closed)
async function safeReadiness(db, env, now) {
  try {
    return await platformSamedayReadiness({ db, env, now });
  } catch (error) {
    console.error("[sameday-delivery] verificarea contului Artfest a eșuat:", error?.code || error?.name || "Error");
    return { ready: false, degraded: false, reasons: ["readiness_check_failed"] };
  }
}

/**
 * Starea calculată pentru un magazin (din datele deja încărcate).
 * @returns {object} vezi getStoreSamedayStatus
 */
export function computeStoreSamedayStatus({ store, vendor, readiness, pickupReady }) {
  const eligibility = storeSamedayEligibility({ store, vendor, readiness, pickupReady });
  const reasons = eligibility.reasons.filter((r) => r !== "store_not_opted_in");
  if (String(store?.type?.code || "") !== PHYSICAL_STORE_TYPE) reasons.push("store_not_physical");
  const optedIn = Boolean(store?.samedayOptInAt);
  const canActivate = reasons.length === 0;
  return {
    serviceId: store.id,
    optedIn,
    optedInAt: store.samedayOptInAt || null,
    disabledByArtfest: Boolean(store.samedayDisabledAt),
    // ACTIV = alegerea vânzătorului + toate condițiile îndeplinite ACUM
    active: optedIn && canActivate,
    canActivate,
    canDeactivate: optedIn,
    reasons,
    messages: reasons.map((r) => SAMEDAY_REASON_MESSAGES[r]).filter(Boolean),
    stripeReady: !reasons.includes("vendor_stripe_not_ready"),
    pickupReady: Boolean(pickupReady),
    platform: { ready: Boolean(readiness?.ready), degraded: Boolean(readiness?.degraded) },
  };
}

async function loadStoreForVendor(db, vendorId, serviceId) {
  const store = await db.vendorService.findFirst({ where: { id: String(serviceId || ""), vendorId: String(vendorId || "") }, select: STORE_SELECT });
  if (!store) throw new SamedayDeliveryError(404, "store_not_found", "Magazinul nu a fost găsit.");
  return store;
}

async function statusFor(db, store, { env, now }) {
  const [vendor, pickupReady, readiness] = await Promise.all([
    db.vendor.findUnique({ where: { id: store.vendorId }, select: VENDOR_STRIPE_STATUS_SELECT }),
    loadPickupReady(db, store.vendorId),
    safeReadiness(db, env, now),
  ]);
  return computeStoreSamedayStatus({ store, vendor, readiness, pickupReady });
}

/** Vânzător: starea Sameday pentru UN magazin propriu (altul => 404). */
export async function getStoreSamedayStatus({ db = defaultDb, vendorId, serviceId, env = process.env, now = new Date() }) {
  const store = await loadStoreForVendor(db, vendorId, serviceId);
  return statusFor(db, store, { env, now });
}

/**
 * Vânzător: activează / dezactivează Sameday pentru un magazin propriu.
 * Activarea re-verifică TOT pe server, cu rândul magazinului blocat (FOR UPDATE).
 */
export async function setStoreSamedayOptIn({ db = defaultDb, vendorId, serviceId, enabled, userId = null, env = process.env, now = new Date() }) {
  if (typeof enabled !== "boolean") {
    throw new SamedayDeliveryError(400, "invalid_request", "Alege dacă activezi sau dezactivezi livrarea Sameday.");
  }
  await db.$transaction(async (tx) => {
    const store = await loadStoreForVendor(tx, vendorId, serviceId);
    await tx.$queryRaw`SELECT "id" FROM "VendorService" WHERE "id" = ${store.id} FOR UPDATE`;
    if (!enabled) {
      if (store.samedayOptInAt) {
        await tx.vendorService.update({ where: { id: store.id }, data: { samedayOptInAt: null, samedayOptInById: null } });
      }
      return;
    }
    if (store.samedayOptInAt) return; // deja activat (idempotent)
    const status = await statusFor(tx, store, { env, now });
    if (!status.canActivate) {
      throw new SamedayDeliveryError(409, "sameday_not_eligible", status.messages[0] || "Magazinul nu îndeplinește condițiile pentru livrarea Sameday prin Artfest.", { reasons: status.reasons });
    }
    await tx.vendorService.update({ where: { id: store.id }, data: { samedayOptInAt: now, samedayOptInById: userId ? String(userId) : null } });
  });
  return getStoreSamedayStatus({ db, vendorId, serviceId, env, now });
}

/** Admin: restricția Artfest pentru un magazin (nu atinge magazinul în sine). */
export async function setStoreSamedayAdminDisabled({ db = defaultDb, serviceId, disabled, adminId = null, now = new Date() }) {
  if (typeof disabled !== "boolean") {
    throw new SamedayDeliveryError(400, "invalid_request", "Alege dacă dezactivezi sau reactivezi livrarea Sameday.");
  }
  const store = await db.vendorService.findUnique({ where: { id: String(serviceId || "") }, select: STORE_SELECT });
  if (!store) throw new SamedayDeliveryError(404, "store_not_found", "Magazinul nu a fost găsit.");
  await db.vendorService.update({
    where: { id: store.id },
    data: disabled
      ? { samedayDisabledAt: store.samedayDisabledAt || now, samedayDisabledById: store.samedayDisabledAt ? store.samedayDisabledById : adminId ? String(adminId) : null }
      : { samedayDisabledAt: null, samedayDisabledById: null },
  });
  return { serviceId: store.id, disabledByArtfest: disabled };
}

/** Admin: magazinele cu opțiunea activată sau restricționate + starea contului Artfest. */
export async function listSamedayStoresForAdmin({ db = defaultDb, env = process.env, now = new Date() } = {}) {
  const [stores, readiness] = await Promise.all([
    db.vendorService.findMany({
      where: { OR: [{ samedayOptInAt: { not: null } }, { samedayDisabledAt: { not: null } }] },
      select: { ...STORE_SELECT, vendor: { select: { id: true, displayName: true } } },
      orderBy: { samedayOptInAt: "desc" },
      take: 500,
    }),
    safeReadiness(db, env, now),
  ]);
  return {
    platform: { ready: Boolean(readiness.ready), degraded: Boolean(readiness.degraded), reasons: readiness.reasons || [] },
    stores: stores.map((s) => ({
      serviceId: s.id,
      title: s.title || null,
      vendorName: s.vendor?.displayName || null,
      optedIn: Boolean(s.samedayOptInAt),
      optedInAt: s.samedayOptInAt || null,
      disabledByArtfest: Boolean(s.samedayDisabledAt),
      disabledAt: s.samedayDisabledAt || null,
    })),
  };
}

/* ---------------------------------------------------------------
 * CHECKOUT (etapa 3): unde se poate oferi „Sameday prin Artfest”
 * ------------------------------------------------------------- */

// mesajele pentru CLIENT (fără detalii interne despre magazin / cont)
export const CHECKOUT_SAMEDAY_MESSAGES = Object.freeze({
  cart_not_card_capable:
    "Livrarea Sameday prin Artfest se plătește integral online, cu cardul, iar plata cu cardul nu este disponibilă pentru toate produsele din coș.",
  store_unavailable: "Livrarea Sameday prin Artfest nu este disponibilă momentan pentru acest magazin.",
});

const OFFERED_CACHE_MS = 30_000;
let offeredCache = null; // { value, at } - doar pentru process.env + DB-ul aplicației

/**
 * Checkout-ul poate oferi acum „Sameday prin Artfest” (comutator + cont Artfest validat)?
 * Comutator oprit -> false, FĂRĂ nicio interogare. Eroare -> false (fail closed).
 */
export async function isArtfestSamedayOffered({ db = defaultDb, env = process.env, now = new Date() } = {}) {
  if (!isSamedayArtfestDeliveryFlagOn(env)) return false;
  const shared = env === process.env && db === defaultDb;
  if (shared && offeredCache && now.getTime() - offeredCache.at < OFFERED_CACHE_MS) return offeredCache.value;
  const value = Boolean((await safeReadiness(db, env, now)).ready);
  if (shared) offeredCache = { value, at: now.getTime() };
  return value;
}

/**
 * Disponibilitatea Sameday prin Artfest pentru magazinele unui coș:
 *  - available: magazinul are opțiunea ACTIVĂ (opt-in + eligibil acum) ȘI tot coșul
 *    se poate plăti integral cu cardul (toți vânzătorii cu Stripe activ);
 *  - offered:   magazinul are opțiunea activă (afișăm opțiunea, eventual indisponibilă,
 *    cu motivul - de ex. coș care nu se poate plăti integral cu cardul).
 * Comutator oprit -> { offered:false }, fără nicio interogare (checkout-ul vechi, identic).
 * @returns {Promise<{ offered:boolean, cartCardCapable:boolean, degraded:boolean, reasons:string[], byService: Object }>}
 */
export async function checkoutSamedayAvailability({ db = defaultDb, groups = [], env = process.env, now = new Date() } = {}) {
  const off = (reason) => ({ offered: false, cartCardCapable: false, degraded: false, reasons: [reason], byService: {} });
  if (!isSamedayArtfestDeliveryFlagOn(env)) return off("feature_flag_off");
  const readiness = await safeReadiness(db, env, now);
  if (!readiness.ready) return off("platform_not_ready");

  const serviceIds = [...new Set(groups.map((g) => String(g?.serviceId || "")).filter(Boolean))];
  const vendorIds = [...new Set(groups.map((g) => String(g?.vendorId || "")).filter(Boolean))];
  if (!serviceIds.length || !vendorIds.length) return off("cart_empty");
  try {
    const [stores, vendors] = await Promise.all([
      db.vendorService.findMany({ where: { id: { in: serviceIds } }, select: STORE_SELECT }),
      db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, ...VENDOR_STRIPE_STATUS_SELECT } }),
    ]);
    const vendorById = new Map(vendors.map((v) => [String(v.id), v]));
    // plata integrală cu cardul: TOȚI vânzătorii din coș (nu doar cei cu Sameday)
    const cartCardCapable = vendorIds.every((id) => isVendorStripeReady(vendorById.get(id)));
    const optedVendorIds = [...new Set(stores.filter((s) => s.samedayOptInAt && !s.samedayDisabledAt).map((s) => String(s.vendorId)))];
    const pickupByVendor = new Map(await Promise.all(optedVendorIds.map(async (id) => [id, await loadPickupReady(db, id)])));

    const byService = {};
    for (const store of stores) {
      const status = computeStoreSamedayStatus({
        store,
        vendor: vendorById.get(String(store.vendorId)),
        readiness,
        pickupReady: pickupByVendor.get(String(store.vendorId)) === true,
      });
      if (!status.active) continue; // magazin fără opțiunea activă: doar curierul magazinului
      byService[String(store.id)] = cartCardCapable
        ? { offered: true, available: true, reason: null, message: null }
        : { offered: true, available: false, reason: "cart_not_card_capable", message: CHECKOUT_SAMEDAY_MESSAGES.cart_not_card_capable };
    }
    return { offered: true, cartCardCapable, degraded: Boolean(readiness.degraded), reasons: [], byService };
  } catch (error) {
    console.error("[sameday-delivery] disponibilitatea la checkout nu a putut fi verificată:", error?.code || error?.name || "Error");
    return off("availability_check_failed");
  }
}
