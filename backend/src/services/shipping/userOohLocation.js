// backend/src/services/shipping/userOohLocation.js
//
// „Ultimul punct folosit” (model UserOohLocation): separat pentru easybox
// (oohType 0) și Sameday Point (oohType 1) - NU e adresă implicită.
//
//  - oohId + oohType = identificatorii; nume / adresă / coordonate / program
//    = snapshot DOAR pentru afișare, niciodată sursă de adevăr;
//  - înainte de afișare / reutilizare: revalidare punctuală prin Sameday
//    (catalog.findOohFresh -> GET /api/client/ooh-locations?oohList=<id>);
//    locația e folosită doar dacă există, are clientVisible = 1 și tipul
//    e același; la plasare checkout-ul revalidează din nou;
//  - salvarea se face DOAR după o comandă plasată cu succes (punctul tocmai
//    validat de server), nu din frontend.

import { prisma as defaultDb } from "../../db.js";
import { publicOoh } from "./oohPublic.js";

export const OOH_PROVIDER = "SAMEDAY";
const TYPE_BY_METHOD = Object.freeze({ LOCKER: 0, PUDO: 1 });
const METHOD_BY_TYPE = Object.freeze({ 0: "LOCKER", 1: "PUDO" });

const dec = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Snapshot UI din locația Sameday validată (forma normalizată din catalog). */
export function snapshotFromLocation(loc, now = new Date()) {
  return {
    oohId: loc.oohId,
    oohType: loc.oohType,
    name: String(loc.name || "").slice(0, 200) || `Punct ${loc.oohId}`,
    address: loc.address ? String(loc.address).slice(0, 500) : null,
    cityName: loc.city ? String(loc.city).slice(0, 160) : null,
    countyName: loc.county ? String(loc.county).slice(0, 120) : null,
    postalCode: loc.postalCode ? String(loc.postalCode).slice(0, 16) : null,
    lat: dec(loc.lat),
    lng: dec(loc.lng),
    // programul e doar informativ (se schimbă - vezi specialSchedule)
    scheduleSnapshot: { schedule: loc.schedule || [], specialSchedule: loc.specialSchedule || [] },
    lastValidatedAt: now,
  };
}

/**
 * Locațiile OOH folosite într-o comandă, din snapshot-urile de livrare deja
 * validate pe server la plasare (buildDeliverySnapshot). Una per tip
 * (ultima din coș câștigă - toate sunt validate în aceeași cerere).
 */
export function oohLocationsFromQuote(quote) {
  const byType = new Map();
  for (const s of quote?.shipments || []) {
    const d = s?.delivery;
    if (!d || (d.method !== "LOCKER" && d.method !== "PUDO") || !Number.isInteger(d.oohId)) continue;
    if (d.oohType !== 0 && d.oohType !== 1) continue;
    byType.set(d.oohType, {
      oohId: d.oohId,
      oohType: d.oohType,
      name: d.oohName,
      address: d.oohAddress,
      city: d.oohCityName,
      county: d.oohCountyName,
      postalCode: d.oohPostalCode,
      lat: d.oohLat,
      lng: d.oohLng,
      schedule: d.oohSchedule?.schedule || [],
      specialSchedule: d.oohSchedule?.specialSchedule || [],
    });
  }
  return [...byType.values()];
}

export function createUserOohLocationService({ db = defaultDb, catalog = null, now = () => new Date() } = {}) {
  /**
   * Ultimele puncte, REVALIDATE acum. Pentru fiecare tip:
   *   { method, status: "ok", location }          -> se poate folosi
   *   { method, status: "unavailable", previous } -> nu mai există / nu e vizibil
   * Metodele fără serviciu activ pe contul Artfest sunt omise. Fără catalog
   * (Sameday indisponibil) -> listă goală (nu afișăm snapshot nevalidat).
   */
  async function listValidated(userId) {
    if (!catalog) return [];
    const services = await catalog.getServices().catch(() => null);
    if (!services?.courierAvailable) return [];

    const rows = await db.userOohLocation.findMany({
      where: { userId, courierProvider: OOH_PROVIDER },
      orderBy: { lastUsedAt: "desc" },
    });

    const out = [];
    for (const row of rows) {
      const method = METHOD_BY_TYPE[row.oohType];
      if (!method || !services.services?.[method]) continue;

      const { loc } = await catalog.findOohFresh(row.oohId);
      if (!loc || loc.oohType !== row.oohType) {
        out.push({
          method,
          status: "unavailable",
          previous: { name: row.name, address: row.address, city: row.cityName },
        });
        continue;
      }
      // snapshot UI reîmprospătat din răspunsul Sameday (nu invers)
      const snap = snapshotFromLocation(loc, now());
      await db.userOohLocation
        .update({ where: { id: row.id }, data: snap })
        .catch(() => null);
      out.push({ method, status: "ok", location: publicOoh(loc) });
    }
    return out;
  }

  /**
   * După plasarea comenzii: salvează punctul folosit (deja revalidat de
   * checkout) ca „ultimul” pentru tipul lui. Upsert pe (userId, provider, oohType).
   */
  async function recordUsed(userId, loc) {
    if (!userId || !loc || TYPE_BY_METHOD[METHOD_BY_TYPE[loc.oohType]] === undefined) return null;
    const t = now();
    const snap = snapshotFromLocation(loc, t);
    return db.userOohLocation.upsert({
      where: { userId_courierProvider_oohType: { userId, courierProvider: OOH_PROVIDER, oohType: loc.oohType } },
      create: { ...snap, userId, courierProvider: OOH_PROVIDER, lastUsedAt: t },
      update: { ...snap, lastUsedAt: t },
    });
  }

  return { listValidated, recordUsed };
}
