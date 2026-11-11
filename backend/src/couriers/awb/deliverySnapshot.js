// backend/src/couriers/awb/deliverySnapshot.js
//
// Livrarea aleasă la checkout (ShipmentDelivery) -> datele de destinatar
// pentru mapperul AWB Sameday (providers/sameday/awbMapper.js):
//   HOME          -> destinatar cu adresa + ID-urile Sameday de județ /
//                    localitate (când au fost alese din nomenclator);
//   LOCKER / PUDO -> destinatar fără adresă + oohLastMile = locația aleasă.
// awbService îl folosește pentru HOME (homeRecipientFromDelivery); AWB-ul
// pentru easybox / Sameday Point e o etapă separată.

import { hasStreetNumber, isValidRoPhone } from "./addresses.js";

const clean = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s || null;
};
const digits = (v) => String(v ?? "").replace(/\D+/g, "") || null;

/**
 * @param {Object} delivery  rândul ShipmentDelivery
 * @returns {{ method, serviceId, oohLastMile, recipient } | null}
 */
export function awbInputFromDelivery(delivery) {
  if (!delivery) return null;
  const ooh = delivery.method === "LOCKER" || delivery.method === "PUDO";
  const base = {
    name: clean(delivery.recipientName),
    phone: digits(delivery.recipientPhone),
    email: clean(delivery.recipientEmail),
  };
  if (ooh) {
    return {
      method: delivery.method,
      serviceId: delivery.serviceId || null,
      oohLastMile: delivery.oohId ?? null,
      // folosite doar ca text informativ; mapperul nu trimite adresa la OOH
      recipient: { ...base, county: clean(delivery.oohCountyName), city: clean(delivery.oohCityName), address: clean(delivery.oohAddress), postalCode: clean(delivery.oohPostalCode) },
    };
  }
  return {
    method: "HOME",
    serviceId: delivery.serviceId || null,
    oohLastMile: null,
    recipient: {
      ...base,
      county: clean(delivery.countyName),
      city: clean(delivery.cityName),
      countyId: delivery.countyId ?? null,
      cityId: delivery.cityId ?? null,
      address: clean(delivery.address),
      postalCode: clean(delivery.postalCode),
    },
  };
}

const SNAPSHOT_INCOMPLETE_MESSAGE =
  "Datele de livrare salvate la plasarea comenzii sunt incomplete. AWB-ul nu poate fi generat; contactează suportul Artfest.";

/**
 * Destinatarul AWB pentru livrarea la ADRESĂ, EXCLUSIV din snapshot-ul
 * ShipmentDelivery (validat la plasarea comenzii). Snapshot incomplet ->
 * blockere; NU se completează din comandă / alte adrese.
 * ID-urile Sameday (county / city) se folosesc doar împreună; fără ele,
 * awbService le caută după numele din snapshot.
 * @param {Object} delivery  rândul ShipmentDelivery (method HOME)
 * @returns {{ recipient: Object, place: {countyId, cityId}|null, blockers: Array }}
 */
export function homeRecipientFromDelivery(delivery) {
  const r = awbInputFromDelivery(delivery)?.recipient || {};
  const blockers = [];
  const incomplete = (field) =>
    blockers.push({ code: "delivery_snapshot_incomplete", message: SNAPSHOT_INCOMPLETE_MESSAGE, field: `delivery.${field}` });

  if (!r.name) incomplete("recipientName");
  if (!r.phone) incomplete("recipientPhone");
  else if (!isValidRoPhone(r.phone)) {
    blockers.push({ code: "delivery_snapshot_invalid", message: "Telefonul destinatarului salvat la comandă nu este valid. Contactează suportul Artfest.", field: "delivery.recipientPhone" });
  }
  // emailul destinatarului e obligatoriu la Sameday (PDF v3.6 + Swagger AwbRecipientType)
  if (!r.email) incomplete("recipientEmail");
  if (!r.county) incomplete("countyName");
  if (!r.city) incomplete("cityName");
  if (!r.address) incomplete("address");
  else if (!hasStreetNumber(r.address)) {
    blockers.push({
      code: "recipient_street_number_missing",
      message: "Adresa de livrare nu conține numărul străzii. Contactează clientul pentru completare.",
      field: "delivery.address",
    });
  }
  const hasCounty = r.countyId != null;
  const hasCity = r.cityId != null;
  if (hasCounty !== hasCity) incomplete(hasCounty ? "cityId" : "countyId");
  if (r.postalCode && !/^\d{6}$/.test(r.postalCode)) {
    blockers.push({ code: "delivery_snapshot_invalid", message: "Codul poștal salvat la comandă nu este valid. Contactează suportul Artfest.", field: "delivery.postalCode" });
  }

  return {
    recipient: { name: r.name, phone: r.phone, email: r.email, county: r.county, city: r.city, postalCode: r.postalCode, address: r.address },
    place: hasCounty && hasCity ? { countyId: r.countyId, cityId: r.cityId } : null,
    // un singur mesaj per cod (primul câmp găsit rămâne în `field`)
    blockers: blockers.filter((b, i) => blockers.findIndex((x) => x.code === b.code) === i),
  };
}

// tipul locației OOH cerut de fiecare metodă (PDF v3.6: 0 = easybox, 1 = PUDO / Sameday Point)
export const OOH_TYPE_BY_METHOD = Object.freeze({ LOCKER: 0, PUDO: 1 });

/**
 * Destinatarul AWB pentru easybox / Sameday Point, EXCLUSIV din snapshot-ul
 * ShipmentDelivery: nume / telefon / email + locația aleasă (oohLastMile =
 * oohId). Snapshot incomplet sau cu tip greșit -> blockere; NU se completează
 * din comandă / alte adrese. Revalidarea live a locației se face în awbService.
 * @param {Object} delivery  rândul ShipmentDelivery (method LOCKER / PUDO)
 * @returns {{ recipient, oohLastMile: number|null, expectedOohType: 0|1, ooh: Object, blockers: Array }}
 */
export function oohRecipientFromDelivery(delivery) {
  const input = awbInputFromDelivery(delivery) || {};
  const r = input.recipient || {};
  const expectedOohType = OOH_TYPE_BY_METHOD[delivery?.method];
  const blockers = [];
  const incomplete = (field) =>
    blockers.push({ code: "delivery_snapshot_incomplete", message: SNAPSHOT_INCOMPLETE_MESSAGE, field: `delivery.${field}` });

  if (!r.name) incomplete("recipientName");
  if (!r.phone) incomplete("recipientPhone");
  else if (!isValidRoPhone(r.phone)) {
    blockers.push({ code: "delivery_snapshot_invalid", message: "Telefonul destinatarului salvat la comandă nu este valid. Contactează suportul Artfest.", field: "delivery.recipientPhone" });
  }
  // emailul e trimis în exemplele PDF pentru Locker / PUDO și e obligatoriu în Swagger (AwbRecipientType)
  if (!r.email) incomplete("recipientEmail");

  const oohId = Number(delivery?.oohId);
  const validId = Number.isInteger(oohId) && oohId > 0;
  if (!validId) incomplete("oohId");
  if (delivery?.oohType == null) incomplete("oohType");
  else if (Number(delivery.oohType) !== expectedOohType) {
    blockers.push({
      code: "ooh_type_mismatch",
      message: "Tipul punctului de livrare salvat la comandă nu corespunde metodei alese (easybox / Sameday Point). Contactează suportul Artfest.",
      field: "delivery.oohType",
    });
  }

  return {
    // forma din exemplele PDF Locker / PUDO: fără adresa clientului; restul e doar informativ
    recipient: { name: r.name, phone: r.phone, email: r.email, county: r.county, city: r.city, postalCode: r.postalCode, address: r.address },
    oohLastMile: validId ? oohId : null,
    expectedOohType,
    ooh: {
      oohId: validId ? oohId : null,
      oohType: delivery?.oohType ?? null,
      name: clean(delivery?.oohName),
      address: clean(delivery?.oohAddress),
      city: clean(delivery?.oohCityName),
      county: clean(delivery?.oohCountyName),
      postalCode: clean(delivery?.oohPostalCode),
    },
    blockers: blockers.filter((b, i) => blockers.findIndex((x) => x.code === b.code) === i),
  };
}
