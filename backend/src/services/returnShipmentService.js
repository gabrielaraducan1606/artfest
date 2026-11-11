// backend/src/services/returnShipmentService.js
//
// Retur STANDARD Sameday - fundația de flux (fără AWB în sine; AWB-ul e în
// couriers/awb/awbService.js -> buildReturnAwbPlan):
//
//   1. clientul alege metoda (HOME_PICKUP / CUSTOMER_SELF) și CONFIRMĂ adresa
//      de ridicare -> ReturnRequest.returnMethod + pickupAddress (snapshot
//      validat în nomenclatorul Sameday). Modificabil până la AWB activ.
//   2. Admin decide cine suportă transportul -> costBearer / costDecidedAt /
//      costDecidedById (fără sume, fără rețineri din refund, fără facturare).
//   3. Admin creează Shipment-ul RETURN + ShipmentDelivery (din snapshot), ATOMIC:
//      rândul cererii e blocat (SELECT ... FOR UPDATE) -> o singură expediere
//      de retur per cerere, și la cereri simultane. Produsele = DOAR liniile
//      cererii (ReturnRequestItem, ca ruta Admin de dinainte), niciodată tot
//      coletul inițial. Fără schimbare de status, fără notificări.
//   4. După AWB CONFIRMAT (CREATED): APPROVED -> PICKUP_REQUESTED (condiționat)
//      + intenție PERSISTENTĂ de notificare per AWB (returnNotices.js): in-app
//      deduplicat + email client / guest, reluat după restart / eroare SMTP
//      fără duplicate. Textul spune „ridicare comandată”, nu „colet preluat”.
//   5. Anulare CONFIRMATĂ a AWB-ului: PICKUP_REQUESTED -> APPROVED (fără alt
//      AWB activ) + notificarea „ridicare anulată” (dacă clientul fusese anunțat).
//
// Easybox Return (EASYBOX) NU e implementat: metoda e refuzată explicit.

import { Prisma } from "@prisma/client";
import { prisma as defaultDb } from "../db.js";
import { hasStreetNumber, isValidRoPhone } from "../couriers/awb/addresses.js";
import { resolveParcels } from "../couriers/awb/parcels.js";
import { SAMEDAY_STANDARD_RETURN_SERVICE_ID } from "../couriers/awb/returnAwb.js";
import { resolveSamedayPlace, SamedayPlaceError } from "./shipping/samedayPlace.js";
import { deliveryCatalog } from "./shipping/deliveryCatalog.js";
import { returnPickupAvailability } from "./shipping/logisticsFlags.js";
import { createUserNotification, createVendorNotification } from "./notifications.js";

export class ReturnFlowError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "ReturnFlowError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// metodele pe care clientul le poate alege ACUM (Easybox Return urmează)
export const CLIENT_RETURN_METHODS = Object.freeze(["HOME_PICKUP", "CUSTOMER_SELF"]);
// metoda / adresa se pot modifica doar în aceste stări și doar fără AWB activ
const METHOD_EDITABLE_STATUSES = new Set(["NEW", "IN_REVIEW", "APPROVED", "PICKUP_REQUESTED"]);
const COST_EDITABLE_STATUSES = new Set(["NEW", "IN_REVIEW", "APPROVED", "PICKUP_REQUESTED"]);
export const RETURN_COST_BEARERS = Object.freeze(["VENDOR", "CUSTOMER", "ARTFEST", "SPLIT"]);
const ACTIVE_AWB_STATUSES = ["REQUESTED", "CREATED", "UNKNOWN"];

const clean = (v, max = 500) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : "";
};
const digits = (v) => String(v ?? "").replace(/[^\d+]/g, "");
const positiveInt = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};
const shortId = (id) => String(id || "").slice(-6).toUpperCase();

/**
 * Nomenclatorul Sameday pentru validarea adresei de ridicare - DOAR când
 * ridicarea de retur e disponibilă (shipping/logisticsFlags.js):
 * RETURN_COURIER_PICKUP_ENABLED + nomenclator (SAMEDAY_NOMENCLATOR_ENABLED sau
 * checkout activ) + cont PLATFORM configurat. Independent de checkout-ul clientului.
 * null = ridicarea prin curier nu e disponibilă / nu poate fi validată acum.
 */
export async function returnAddressCatalog(db = defaultDb, env = process.env) {
  return (await returnPickupAvailability({ env, db })).available ? deliveryCatalog() : null;
}

// coletul de retur prin curier se pregătește doar cu ridicarea disponibilă (aceleași condiții)
async function assertReturnPickupAvailable(db, env) {
  const availability = await returnPickupAvailability({ env, db });
  if (!availability.available) {
    throw new ReturnFlowError(
      409,
      "return_pickup_unavailable",
      "Ridicarea returului prin curier nu este disponibilă momentan (serviciu dezactivat sau neconfigurat).",
      { reason: availability.reason }
    );
  }
}

/**
 * Adresa de ridicare trimisă de client -> snapshot validat (nimic presupus).
 * Județul și localitatea DOAR din nomenclatorul Sameday (ID-uri + denumiri
 * oficiale). Nomenclator indisponibil -> nu se salvează nimic (503).
 * @returns {Promise<Object>} snapshot pentru ReturnRequest.pickupAddress
 */
export async function validateReturnPickupAddress(raw, { catalog, now = new Date() } = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const fields = {};
  const name = clean(input.name, 160);
  const phone = digits(input.phone);
  const email = clean(input.email, 320);
  const county = clean(input.county, 120);
  const city = clean(input.city, 160);
  const address = clean(input.address ?? input.street, 500);
  const postalCode = clean(input.postalCode, 16);
  const countyId = positiveInt(input.samedayCountyId ?? input.countyId);
  const cityId = positiveInt(input.samedayCityId ?? input.cityId);

  if (!name) fields.name = "Completează numele persoanei care predă coletul.";
  if (!phone || !isValidRoPhone(phone)) fields.phone = "Telefonul nu este valid.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "Emailul nu este valid.";
  if (!county) fields.county = "Alege județul.";
  if (!city) fields.city = "Alege localitatea.";
  if (!address) fields.address = "Completează strada și numărul.";
  else if (!hasStreetNumber(address)) fields.address = "Adresa trebuie să conțină numărul străzii.";
  if (postalCode && !/^\d{6}$/.test(postalCode)) fields.postalCode = "Codul poștal trebuie să aibă exact 6 cifre.";
  if (Number.isNaN(countyId) || Number.isNaN(cityId)) fields.city = "Alege din nou localitatea din listă.";
  if (Object.keys(fields).length) {
    throw new ReturnFlowError(400, "return_address_invalid", "Verifică adresa de ridicare a returului.", { fields });
  }

  if (!catalog) {
    throw new ReturnFlowError(409, "return_pickup_unavailable", "Ridicarea returului prin curier nu este disponibilă momentan. Poți alege să trimiți coletul singur sau să revii mai târziu.");
  }
  let place;
  try {
    place = await resolveSamedayPlace({ county, city, countyId, cityId, catalog });
  } catch (error) {
    if (error instanceof SamedayPlaceError) {
      const field = error.field === "county" ? "county" : "city";
      throw new ReturnFlowError(400, "return_address_place_invalid", error.message, { fields: { [field]: error.message } });
    }
    throw error;
  }
  if (place?.status !== "validated") {
    throw new ReturnFlowError(503, "return_address_unverified", "Nu am putut verifica acum localitatea în nomenclatorul curierului. Încearcă din nou peste câteva minute.");
  }

  return {
    name,
    phone,
    email: email || null,
    county: place.countyName,
    city: place.cityName,
    countyId: place.countyId,
    cityId: place.cityId,
    address,
    postalCode: postalCode || null,
    confirmedAt: now.toISOString(),
  };
}

// snapshot-ul confirmat -> câmpurile ShipmentDelivery (pe RETURN: recipient* = CLIENTUL)
export function deliveryFieldsFromPickup(snapshot) {
  return {
    recipientName: snapshot.name,
    recipientPhone: snapshot.phone,
    recipientEmail: snapshot.email || null,
    countyId: snapshot.countyId,
    countyName: snapshot.county,
    cityId: snapshot.cityId,
    cityName: snapshot.city,
    address: snapshot.address,
    postalCode: snapshot.postalCode || null,
  };
}

// ShipmentDelivery al coletului RETURN (clientul = expeditorul), fără costuri inventate
function returnDeliveryFields(snapshot) {
  return {
    courierProvider: "SAMEDAY",
    method: "HOME",
    serviceId: SAMEDAY_STANDARD_RETURN_SERVICE_ID,
    // partea clientului: 0 până la o decizie de cost cu sume (neimplementat)
    shippingCost: 0,
    pricingSource: "SAMEDAY",
    ...deliveryFieldsFromPickup(snapshot),
  };
}

function returnDeliveryCreateData(shipmentId, snapshot) {
  return { shipmentId, ...returnDeliveryFields(snapshot) };
}

function isCompletePickup(s) {
  return !!(s && typeof s === "object" && s.name && s.phone && s.address && s.countyId && s.cityId && s.county && s.city);
}

/**
 * Metoda de retur în cererea NOUĂ (la creare, înainte de salvare).
 * @returns {Promise<{ returnMethod: string|null, pickupAddress: Object|null }>}
 */
export async function prepareReturnMethodForCreate({ returnMethod, pickupAddress, catalog, now = new Date() }) {
  if (returnMethod == null || returnMethod === "") return { returnMethod: null, pickupAddress: null };
  assertClientMethod(returnMethod);
  if (returnMethod !== "HOME_PICKUP") return { returnMethod, pickupAddress: null };
  return { returnMethod, pickupAddress: await validateReturnPickupAddress(pickupAddress, { catalog, now }) };
}

function assertClientMethod(method) {
  if (method === "EASYBOX") {
    throw new ReturnFlowError(400, "return_method_unavailable", "Returul prin easybox nu este disponibil încă.");
  }
  if (!CLIENT_RETURN_METHODS.includes(method)) {
    throw new ReturnFlowError(400, "return_method_invalid", "Metoda de retur nu este validă.");
  }
}

// blochează rândul cererii până la finalul tranzacției (serializează operațiile pe cerere)
async function lockReturnRequest(tx, id) {
  await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${String(id)} FOR UPDATE`;
}

function hasActiveAwb(shipments = []) {
  return shipments.some((s) => (s.courierAwbs || []).some((a) => ACTIVE_AWB_STATUSES.includes(a.status)));
}

/**
 * Clientul (cont sau guest) alege / schimbă metoda și adresa confirmată.
 * scope: { userId } (cont) sau { guestOrderId } (guest, deja verificat prin token).
 * Blocat după AWB (activ: în curs / confirmat / neconfirmat).
 */
export async function setReturnMethod({ db = defaultDb, returnRequestId, scope = {}, returnMethod, pickupAddress, catalog, now = new Date() }) {
  assertClientMethod(returnMethod);
  // validarea (cu nomenclatorul) ÎNAINTE de tranzacție - fără apeluri externe în tranzacție
  const snapshot = returnMethod === "HOME_PICKUP" ? await validateReturnPickupAddress(pickupAddress, { catalog, now }) : null;

  const ownership = scope.userId
    ? { id: String(returnRequestId || ""), userId: String(scope.userId) }
    : scope.guestOrderId
      ? { id: String(returnRequestId || ""), orderId: String(scope.guestOrderId), userId: null }
      : null;
  if (!ownership) throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");

  return db.$transaction(async (tx) => {
    const exists = await tx.returnRequest.findFirst({ where: ownership, select: { id: true } });
    if (!exists) throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
    await lockReturnRequest(tx, exists.id);

    const rr = await tx.returnRequest.findUnique({
      where: { id: exists.id },
      select: {
        id: true,
        status: true,
        returnShipments: {
          where: { direction: "RETURN" },
          select: { id: true, courierAwbs: { select: { status: true } }, delivery: { select: { id: true } } },
        },
      },
    });
    if (!METHOD_EDITABLE_STATUSES.has(rr.status)) {
      throw new ReturnFlowError(409, "return_method_locked", "Metoda de retur nu mai poate fi schimbată pentru această cerere.");
    }
    if (hasActiveAwb(rr.returnShipments)) {
      throw new ReturnFlowError(409, "return_method_locked_awb", "AWB-ul de retur a fost deja generat; metoda și adresa nu mai pot fi schimbate. Contactează suportul Artfest.");
    }
    if (rr.returnShipments.length && returnMethod !== "HOME_PICKUP") {
      throw new ReturnFlowError(409, "return_shipment_exists", "Ridicarea prin curier este deja pregătită. Pentru altă metodă contactează suportul Artfest.");
    }

    const updated = await tx.returnRequest.update({
      where: { id: rr.id },
      data: { returnMethod, pickupAddress: snapshot ?? Prisma.DbNull },
      select: { id: true, returnMethod: true, pickupAddress: true, status: true },
    });
    // coletul de retur deja pregătit (fără AWB activ): aceeași adresă și în livrare
    if (snapshot && rr.returnShipments.length) {
      // adresa nouă, confirmată acum de client, în livrarea coletului de retur (fără AWB activ)
      await tx.shipmentDelivery.updateMany({
        where: { shipmentId: { in: rr.returnShipments.map((s) => s.id) } },
        data: deliveryFieldsFromPickup(snapshot),
      });
      // retur vechi (creat înainte de ShipmentDelivery): livrarea lipsă se CREEAZĂ
      for (const sh of rr.returnShipments.filter((x) => !x.delivery)) {
        await tx.shipmentDelivery.create({ data: returnDeliveryCreateData(sh.id, snapshot) });
      }
    }
    return updated;
  });
}

/**
 * ADMIN: cine suportă transportul returului (decizie explicită; faultParty NU
 * decide nimic). Blocat cât există un AWB de retur activ.
 */
export async function setReturnCostBearer({ db = defaultDb, returnRequestId, costBearer, adminUserId, now = new Date() }) {
  if (!RETURN_COST_BEARERS.includes(costBearer)) {
    throw new ReturnFlowError(400, "cost_bearer_invalid", "Alege cine suportă transportul returului.");
  }
  return db.$transaction(async (tx) => {
    await lockReturnRequest(tx, returnRequestId);
    const rr = await tx.returnRequest.findUnique({
      where: { id: String(returnRequestId || "") },
      select: {
        id: true,
        status: true,
        returnShipments: { where: { direction: "RETURN" }, select: { id: true, courierAwbs: { select: { status: true } } } },
      },
    });
    if (!rr) throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
    if (!COST_EDITABLE_STATUSES.has(rr.status)) {
      throw new ReturnFlowError(409, "return_cost_locked", "Cererea de retur este închisă sau respinsă.");
    }
    if (hasActiveAwb(rr.returnShipments)) {
      throw new ReturnFlowError(409, "return_cost_locked", "AWB-ul de retur a fost deja generat; decizia de cost nu mai poate fi schimbată.");
    }
    return tx.returnRequest.update({
      where: { id: rr.id },
      data: { costBearer, costDecidedAt: now, costDecidedById: adminUserId || null },
      select: { id: true, costBearer: true, costDecidedAt: true, costDecidedById: true },
    });
  });
}

/**
 * ADMIN: creează Shipment-ul RETURN + ShipmentDelivery din adresa confirmată.
 * Atomic (rândul cererii blocat) -> o singură expediere de retur per cerere.
 * Coletele / greutatea vin EXPLICIT (fără valori implicite). Produsele: doar
 * liniile cererii de retur (ReturnRequestItem). Nimic financiar (ledger-ul
 * ignoră Shipment-urile RETURN), fără status nou pe cerere, fără notificări.
 */
export async function createReturnShipment({ db = defaultDb, returnRequestId, input = {}, now = new Date(), env = process.env }) {
  await assertReturnPickupAvailable(db, env);
  const parcelInput = {
    parcels: input.parcels,
    weightKg: input.weightKg,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
  };
  const parcels = resolveParcels({}, parcelInput);
  const parcelBlockers = [...parcels.blockers];
  if (input.parcels === undefined || input.parcels === null || input.parcels === "") {
    parcelBlockers.unshift({ code: "parcels_required", message: "Completează numărul de colete al returului.", field: "parcels" });
  }
  if (parcelBlockers.length) {
    throw new ReturnFlowError(400, "return_parcels_invalid", "Verifică coletele și greutatea returului.", { blockers: parcelBlockers });
  }

  return db.$transaction(async (tx) => {
    await lockReturnRequest(tx, returnRequestId);
    const rr = await tx.returnRequest.findUnique({
      where: { id: String(returnRequestId || "") },
      select: {
        id: true,
        status: true,
        orderId: true,
        vendorId: true,
        returnMethod: true,
        pickupAddress: true,
        originalShipment: { select: { id: true, orderId: true, vendorId: true, direction: true, status: true } },
        returnShipments: { where: { direction: "RETURN" }, select: { id: true } },
        items: { select: { productId: true, title: true, qty: true, price: true } },
      },
    });
    if (!rr) throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
    if (rr.status !== "APPROVED") {
      throw new ReturnFlowError(409, "return_status_not_eligible", "Coletul de retur se pregătește doar pentru o cerere acceptată.");
    }
    if (rr.returnMethod !== "HOME_PICKUP") {
      throw new ReturnFlowError(409, "return_method_not_home_pickup", "Clientul nu a ales ridicarea de la adresă pentru acest retur.");
    }
    if (!isCompletePickup(rr.pickupAddress)) {
      throw new ReturnFlowError(409, "return_pickup_address_missing", "Clientul nu a confirmat încă adresa de ridicare.");
    }
    const original = rr.originalShipment;
    // multi-vendor: coletul de retur aparține vendorului și comenzii CERERII
    if (!original || original.vendorId !== rr.vendorId || original.orderId !== rr.orderId || original.direction !== "OUTBOUND" || original.status !== "DELIVERED") {
      throw new ReturnFlowError(409, "return_original_shipment_invalid", "Livrarea inițială a cererii nu este validă pentru retur.");
    }
    if (rr.returnShipments.length) {
      throw new ReturnFlowError(409, "return_shipment_exists", "Coletul de retur există deja pentru această cerere.");
    }
    if (!rr.items?.length) {
      throw new ReturnFlowError(409, "return_items_missing", "Cererea de retur nu are produse.");
    }

    return tx.shipment.create({
      data: {
        orderId: rr.orderId,
        vendorId: rr.vendorId,
        method: "COURIER",
        direction: "RETURN",
        returnRequestId: rr.id,
        status: "READY_FOR_PICKUP",
        pickupScheduledAt: now,
        parcels: parcels.parcels,
        weightKg: parcels.weightKg,
        lengthCm: parcels.lengthCm,
        widthCm: parcels.widthCm,
        heightCm: parcels.heightCm,
        // DOAR produsele cererii aprobate (snapshot titlu / cantitate / preț)
        items: {
          create: (rr.items || []).map((it) => ({
            productId: it.productId || null,
            title: it.title,
            qty: it.qty,
            price: it.price,
          })),
        },
        delivery: { create: returnDeliveryFields(rr.pickupAddress) },
      },
      select: { id: true, orderId: true, vendorId: true, direction: true, status: true, returnRequestId: true, parcels: true, weightKg: true },
    });
  });
}

/**
 * ADMIN - retur VECHI (coletul RETURN creat de ruta Admin de dinainte, fără
 * ShipmentDelivery și / sau fără colete): completează DOAR ce lipsește.
 *  - livrarea lipsă: din adresa confirmată de client (HOME_PICKUP); o livrare
 *    existentă NU se modifică;
 *  - coletele / greutatea: doar dacă lipsesc pe colet (nu suprascrie).
 * Doar fără AWB activ; cererea blocată (FOR UPDATE). Nimic financiar, fără status.
 */
export async function completeReturnShipment({ db = defaultDb, returnRequestId, input = {}, env = process.env }) {
  await assertReturnPickupAvailable(db, env);
  return db.$transaction(async (tx) => {
    await lockReturnRequest(tx, returnRequestId);
    const rr = await tx.returnRequest.findUnique({
      where: { id: String(returnRequestId || "") },
      select: {
        id: true,
        status: true,
        returnMethod: true,
        pickupAddress: true,
        returnShipments: {
          where: { direction: "RETURN" },
          select: { id: true, parcels: true, weightKg: true, courierAwbs: { select: { status: true } }, delivery: { select: { id: true } } },
        },
      },
    });
    if (!rr) throw new ReturnFlowError(404, "return_not_found", "Cererea de retur nu a fost găsită.");
    const ship = rr.returnShipments[0];
    if (!ship) throw new ReturnFlowError(409, "return_shipment_missing", "Cererea nu are încă un colet de retur.");
    if (rr.returnShipments.length > 1) {
      throw new ReturnFlowError(409, "return_shipment_multiple", "Cererea are mai multe colete de retur; necesită verificare manuală.");
    }
    if (hasActiveAwb(rr.returnShipments)) {
      throw new ReturnFlowError(409, "return_method_locked_awb", "Coletul are deja un AWB activ.");
    }

    const data = {};
    const missingParcels = ship.parcels == null || ship.weightKg == null;
    if (missingParcels && (input.parcels != null || input.weightKg != null)) {
      const parcels = resolveParcels({}, {
        parcels: input.parcels,
        weightKg: input.weightKg,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
      });
      if (parcels.blockers.length) {
        throw new ReturnFlowError(400, "return_parcels_invalid", "Verifică coletele și greutatea returului.", { blockers: parcels.blockers });
      }
      Object.assign(data, {
        parcels: parcels.parcels,
        weightKg: parcels.weightKg,
        lengthCm: parcels.lengthCm,
        widthCm: parcels.widthCm,
        heightCm: parcels.heightCm,
      });
    }

    let deliveryCreated = false;
    if (!ship.delivery) {
      if (rr.returnMethod !== "HOME_PICKUP") {
        throw new ReturnFlowError(409, "return_method_not_home_pickup", "Clientul nu a ales ridicarea de la adresă pentru acest retur.");
      }
      if (!isCompletePickup(rr.pickupAddress)) {
        throw new ReturnFlowError(409, "return_pickup_address_missing", "Clientul nu a confirmat încă adresa de ridicare.");
      }
      await tx.shipmentDelivery.create({ data: returnDeliveryCreateData(ship.id, rr.pickupAddress) });
      deliveryCreated = true;
    }
    if (Object.keys(data).length) await tx.shipment.update({ where: { id: ship.id }, data });
    return { shipmentId: ship.id, deliveryCreated, parcelsSet: Object.keys(data).length > 0 };
  });
}

/**
 * După un AWB de retur CONFIRMAT (CREATED), într-o singură tranzacție, cu
 * cererea blocată: APPROVED -> PICKUP_REQUESTED (condiționat) + INTENȚIA
 * persistentă de notificare pentru ACEST AWB (returnNotices.confirmed), dacă
 * cererea e în PICKUP_REQUESTED. Apoi trimiterea (best-effort; dacă procesul
 * se oprește, jobul de notificări o reia - fără duplicate, vezi returnNotices.js).
 * Shipment OUTBOUND / AWB neconfirmat / anulare în curs -> nimic. Nu aruncă.
 */
export async function onReturnAwbConfirmed({ db = defaultDb, shipmentId, awbId }) {
  try {
    const awb = await db.courierAwb.findUnique({
      where: { id: String(awbId || "") },
      select: { id: true, status: true, shipmentId: true, providerMeta: true, shipment: { select: { direction: true, returnRequestId: true } } },
    });
    if (!awb || awb.shipmentId !== String(shipmentId || awb.shipmentId) || awb.shipment?.direction !== "RETURN" || !awb.shipment.returnRequestId) {
      return { applied: false };
    }
    if (awb.status !== "CREATED" || awb.providerMeta?.cancelState) return { applied: false };
    const notices = await import("./returnNotices.js");
    const returnRequestId = awb.shipment.returnRequestId;

    const { moved, queued } = await db.$transaction(async (tx) => {
      await lockReturnRequest(tx, returnRequestId);
      const changed = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: "APPROVED" },
        data: { status: "PICKUP_REQUESTED" },
      });
      const rr = await tx.returnRequest.findUnique({ where: { id: returnRequestId }, select: { status: true } });
      // cerere respinsă / închisă între timp: fără mesaj „ridicare comandată”
      const q = rr?.status === "PICKUP_REQUESTED" ? await notices.queueReturnNotice(tx, { awbId: awb.id, kind: "confirmed", returnRequestId }) : false;
      return { moved: changed.count === 1, queued: q };
    });

    const sent = await notices
      .dispatchReturnNotice({ db, awbId: awb.id, kind: "confirmed" })
      .catch((e) => console.error("[returns] notificarea AWB retur (va fi reluată):", awb.id, e?.message || e));
    const cost = await recordReturnAwbCost({ db, shipmentId: awb.shipmentId, providerMeta: awb.providerMeta });
    return { applied: true, statusChanged: moved, queued, notice: sent?.state || null, cost };
  } catch (e) {
    console.error("[returns] post-AWB retur eșuat (reconcilierea îl reia):", shipmentId, e?.code || e?.name || "Error");
    return { applied: false, failed: true };
  }
}

/**
 * Costul returnat de Sameday la crearea AWB-ului (awbCost, păstrat în
 * providerMeta.cost) -> ShipmentDelivery-ul returului, după costBearer
 * (shippingBilling.recordReturnCarrierCost: idempotent, auditat, SPLIT blocat).
 * Best-effort: un eșec nu afectează AWB-ul / notificarea; reconcilierea
 * (onReturnAwbConfirmed reluat) sau Admin îl poate reface. Fără cost -> nimic.
 */
async function recordReturnAwbCost({ db, shipmentId, providerMeta }) {
  const raw = providerMeta?.cost;
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0) return { recorded: false, reason: "cost_unknown" };
  try {
    const { recordReturnCarrierCost } = await import("./shipping/shippingBilling.js");
    // awbCost poate avea mai mult de 2 zecimale: rotunjit la bani
    const r = await recordReturnCarrierCost({ db, shipmentId, carrierCost: Number(raw).toFixed(2), source: "awb_create" });
    return { recorded: true, ...r };
  } catch (e) {
    console.error("[returns] costul returului nu a fost înregistrat (de reluat):", shipmentId, e?.code || e?.name || "Error");
    return { recorded: false, reason: "failed" };
  }
}

/**
 * După anularea CONFIRMATĂ a unui AWB de retur (CANCELLED), cu cererea blocată:
 *  - confirmarea încă netrimisă -> SUPERSEDED (clientul nu primește nici
 *    „comandată”, nici „anulată”);
 *  - confirmarea trimisă / posibil trimisă -> intenția „ridicare anulată”;
 *  - PICKUP_REQUESTED -> APPROVED (condiționat), doar fără alt AWB activ
 *    -> regenerarea e posibilă, iar AWB-ul nou primește propria notificare.
 * Anulare în curs / neconfirmată NU ajunge aici (AWB-ul rămâne CREATED).
 * Marcajul „tratat” = returnNotices.cancelled (și SKIPPED), deci idempotent.
 */
export async function onReturnAwbCancelled({ db = defaultDb, awbId, now = new Date() }) {
  try {
    const awb = await db.courierAwb.findUnique({
      where: { id: String(awbId || "") },
      select: { id: true, status: true, shipmentId: true, providerMeta: true, shipment: { select: { direction: true, returnRequestId: true } } },
    });
    if (!awb || awb.status !== "CANCELLED" || awb.shipment?.direction !== "RETURN" || !awb.shipment.returnRequestId) {
      return { applied: false };
    }
    const notices = await import("./returnNotices.js");
    if (notices.noticeOf(awb, "cancelled")) return { applied: false, already: true };
    const returnRequestId = awb.shipment.returnRequestId;

    const out = await db.$transaction(async (tx) => {
      await lockReturnRequest(tx, returnRequestId);
      const prev = await notices.supersedeConfirmedNotice(tx, awb);
      const active = await tx.courierAwb.count({
        where: { shipmentId: awb.shipmentId, status: { in: ACTIVE_AWB_STATUSES } },
      });
      const reverted = active
        ? { count: 0 }
        : await tx.returnRequest.updateMany({ where: { id: returnRequestId, status: "PICKUP_REQUESTED" }, data: { status: "APPROVED" } });
      // clientul a fost (sau poate fi fost) anunțat de ridicare -> îl anunțăm și de anulare
      const tell = prev && !["PENDING", "RETRY", "SUPERSEDED", "SKIPPED"].includes(prev);
      const queued = await notices.queueReturnNotice(tx, { awbId: awb.id, kind: "cancelled", returnRequestId, now });
      if (queued && !tell) {
        await tx.$executeRaw`
          UPDATE "CourierAwb"
             SET "providerMeta" = jsonb_set("providerMeta", '{returnNotices,cancelled,state}', '"SKIPPED"'::jsonb, false),
                 "updatedAt" = NOW()
           WHERE "id" = ${awb.id}`;
      }
      return { reverted: reverted.count === 1, notify: queued && tell };
    });

    if (out.notify) {
      await notices
        .dispatchReturnNotice({ db, awbId: awb.id, kind: "cancelled", now })
        .catch((e) => console.error("[returns] notificarea anulării (va fi reluată):", awb.id, e?.message || e));
    }
    return { applied: true, statusReverted: out.reverted, notified: out.notify };
  } catch (e) {
    console.error("[returns] post-anulare AWB retur eșuat (reconcilierea îl reia):", awbId, e?.code || e?.name || "Error");
    return { applied: false, failed: true };
  }
}

/**
 * Reconcilierea (job periodic + la cerere): reia pașii întrerupți de un
 * restart / o eroare. Doar AWB-uri de RETUR Artfest (ARTFEST-RETURN-*).
 *  1. AWB confirmat fără intenție de notificare -> onReturnAwbConfirmed;
 *  2. AWB anulat, netratat -> onReturnAwbCancelled;
 *  3. SENDING abandonat -> RETRY (Resend + cheie stabilă, < 23h) / UNCERTAIN;
 *  3b. notificări in-app nefinalizate -> reluate (dedupeKey, fără duplicate);
 *  4. notificările scadente (PENDING / RETRY) -> trimitere.
 */
export async function reconcileReturnNotices({ db = defaultDb, now = new Date(), limit = 50, minAgeMs = 60_000 } = {}) {
  const notices = await import("./returnNotices.js");
  const before = new Date(now.getTime() - minAgeMs);
  const summary = { confirmed: 0, cancelled: 0, stale: 0, inApp: 0, dispatched: 0 };

  const toConfirm = await db.$queryRaw`
    SELECT a."id", a."shipmentId" FROM "CourierAwb" a
      JOIN "Shipment" s ON s."id" = a."shipmentId"
      JOIN "ReturnRequest" r ON r."id" = s."returnRequestId"
     WHERE a."status"::text = 'CREATED' AND s."direction"::text = 'RETURN'
       AND a."clientReference" LIKE 'ARTFEST-RETURN-%'
       AND (a."providerMeta"->>'cancelState') IS NULL
       AND (a."providerMeta"->'returnNotices'->'confirmed') IS NULL
       AND r."status"::text IN ('APPROVED', 'PICKUP_REQUESTED')
       AND a."updatedAt" < ${before}
     LIMIT ${limit}`;
  for (const row of toConfirm) {
    const r = await onReturnAwbConfirmed({ db, shipmentId: row.shipmentId, awbId: row.id });
    if (r.applied) summary.confirmed++;
  }

  const toCancel = await db.$queryRaw`
    SELECT a."id" FROM "CourierAwb" a
      JOIN "Shipment" s ON s."id" = a."shipmentId"
     WHERE a."status"::text = 'CANCELLED' AND s."direction"::text = 'RETURN'
       AND a."clientReference" LIKE 'ARTFEST-RETURN-%'
       AND (a."providerMeta"->'returnNotices'->'cancelled') IS NULL
       AND a."updatedAt" < ${before}
     LIMIT ${limit}`;
  for (const row of toCancel) {
    const r = await onReturnAwbCancelled({ db, awbId: row.id, now });
    if (r.applied) summary.cancelled++;
  }

  summary.stale = await notices.markStaleSendingNotices({ db, now });
  // in-app nefinalizat (eșuat sau proces oprit) - independent de email
  summary.inApp = await notices.retryPendingInApp({ db, limit });

  const due = await db.$queryRaw`
    SELECT a."id", k.kind FROM "CourierAwb" a
     CROSS JOIN (VALUES ('confirmed'), ('cancelled')) AS k(kind)
     WHERE (a."providerMeta"->>'cancelState') IS NULL
       AND (a."providerMeta"->'returnNotices'->k.kind->>'state') IN ('PENDING', 'RETRY')
       AND COALESCE((a."providerMeta"->'returnNotices'->k.kind->>'nextAttemptAt')::timestamptz, '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz
     LIMIT ${limit}`;
  for (const row of due) {
    const r = await notices.dispatchReturnNotice({ db, awbId: row.id, kind: row.kind, now }).catch(() => null);
    if (r) summary.dispatched++;
  }
  return summary;
}

/** Răspuns HTTP pentru ReturnFlowError (cod + mesaj fix, fără detalii interne). */
export function sendReturnFlowError(res, error) {
  return res.status(error.status || 400).json({
    ok: false,
    error: error.code,
    message: error.message,
    ...(error.extra?.fields ? { fields: error.extra.fields } : {}),
    ...(error.extra?.blockers ? { blockers: error.extra.blockers } : {}),
  });
}
