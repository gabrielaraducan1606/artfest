// backend/src/couriers/awb/recipientOverride.js
//
// Adresa destinatarului CORECTATĂ înainte de AWB (livrare la adresă), salvată
// pe Shipment.recipientOverride. Originalul NU se atinge: Order.shippingAddress
// și ShipmentDelivery rămân exact ca la plasarea comenzii (istoric / audit).
//
// Forma salvată (JSON):
//   {
//     active: true,                 // false = s-a revenit la adresa din comandă
//     address: { name, phone, email, county, countyId, city, cityId, street,
//                streetNo, block, staircase, apartment, postalCode, notes } | null,
//     updatedAt, updatedBy: { userId, role },
//     history: [{ at, by: { userId, role }, before, after }]   // ultimele 20
//   }
// Logică pură (fără DB / rețea) - folosită de awbService (previzualizare,
// generare, salvare).

import { hasStreetNumber, isValidRoPhone } from "./addresses.js";

export const RECIPIENT_FIELD_LIMITS = Object.freeze({
  name: 160,
  phone: 40,
  email: 320,
  county: 120,
  city: 160,
  street: 200,
  streetNo: 20,
  block: 20,
  staircase: 20,
  apartment: 20,
  postalCode: 6,
  notes: 200,
});

export const RECIPIENT_FIELDS = Object.freeze(Object.keys(RECIPIENT_FIELD_LIMITS));
const HISTORY_LIMIT = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s || null;
};
const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Validează formularul trimis de vendor / Admin. Mesaje clare, per câmp.
 * @returns {{ address: Object|null, fields: Object }} fields = { câmp: mesaj }
 */
export function normalizeRecipientInput(body = {}) {
  const fields = {};
  const address = {};
  for (const key of RECIPIENT_FIELDS) {
    const value = clean(body?.[key]);
    if (value && value.length > RECIPIENT_FIELD_LIMITS[key]) {
      fields[key] = `Maximum ${RECIPIENT_FIELD_LIMITS[key]} de caractere.`;
    }
    address[key] = value;
  }
  // ID-urile Sameday doar împreună (alese din nomenclator); altfel se rezolvă după nume
  const countyId = positiveInt(body?.countyId);
  const cityId = positiveInt(body?.cityId);
  address.countyId = countyId && cityId ? countyId : null;
  address.cityId = countyId && cityId ? cityId : null;

  if (!address.name) fields.name = "Completează numele destinatarului.";
  if (!address.phone) fields.phone = "Completează telefonul destinatarului.";
  else if (!isValidRoPhone(address.phone)) fields.phone = "Telefonul nu este valid (ex. 07xxxxxxxx).";
  else address.phone = address.phone.replace(/[^\d+]/g, "");
  if (!address.email) fields.email = "Completează emailul destinatarului (obligatoriu pentru AWB).";
  else if (!EMAIL_RE.test(address.email)) fields.email = "Emailul nu este valid.";
  if (!address.county) fields.county = "Alege județul.";
  if (!address.city) fields.city = "Alege localitatea.";
  if (!address.street) fields.street = "Completează strada.";
  if (!address.streetNo && address.street && !hasStreetNumber(address.street)) {
    fields.streetNo = "Completează numărul (sau „FN” dacă strada nu are număr).";
  }
  if (address.postalCode && !/^\d{6}$/.test(address.postalCode)) fields.postalCode = "Codul poștal are 6 cifre.";

  return { address: Object.keys(fields).length ? null : address, fields };
}

/** „Str. Lalelelor, nr. 7, bl. A1, sc. 2, ap. 10” (fără a dubla numărul deja scris în stradă). */
export function composeAddressLine(a = {}) {
  const street = clean(a.street);
  const no = clean(a.streetNo);
  return [
    street,
    no && !(street || "").includes(no) ? `nr. ${no}` : null,
    clean(a.block) ? `bl. ${clean(a.block)}` : null,
    clean(a.staircase) ? `sc. ${clean(a.staircase)}` : null,
    clean(a.apartment) ? `ap. ${clean(a.apartment)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Corectura activă (sau null). */
export function activeOverride(json) {
  if (!json || typeof json !== "object" || json.active !== true) return null;
  return json.address && typeof json.address === "object" ? json.address : null;
}

/**
 * Destinatarul AWB din adresa corectată (aceleași câmpuri ca restul fluxului).
 * @returns {{ recipient: Object, placeHint: {countyId, cityId}|null, observation: string|null, blockers: Array }}
 */
export function recipientFromOverride(address) {
  const recipient = {
    name: clean(address?.name),
    phone: clean(address?.phone) ? String(address.phone).replace(/[^\d+]/g, "") : null,
    email: clean(address?.email),
    county: clean(address?.county),
    city: clean(address?.city),
    postalCode: clean(address?.postalCode),
    address: composeAddressLine(address),
  };
  // verificare defensivă (datele au fost validate la salvare)
  const { fields } = normalizeRecipientInput(address || {});
  const blockers = Object.keys(fields).length
    ? [{ code: "recipient_correction_invalid", message: "Adresa corectată este incompletă. Modifică adresa și salvează din nou.", field: "recipient" }]
    : [];
  const placeHint = address?.countyId && address?.cityId ? { countyId: address.countyId, cityId: address.cityId } : null;
  return { recipient, placeHint, observation: clean(address?.notes), blockers };
}

/**
 * Formularul precompletat: corectura activă, altfel datele originale
 * (snapshot-ul ShipmentDelivery, apoi Order.shippingAddress). Strada originală
 * e un singur rând de text: rămâne întreagă în „Stradă”.
 */
export function recipientFormFrom({ override = null, delivery = null, order = null } = {}) {
  const active = activeOverride(override);
  if (active) {
    const out = {};
    for (const key of RECIPIENT_FIELDS) out[key] = active[key] ?? "";
    return { ...out, countyId: active.countyId ?? null, cityId: active.cityId ?? null };
  }
  const a = order?.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const contact = order?.contactPerson && typeof order.contactPerson === "object" ? order.contactPerson : {};
  const home = delivery && delivery.method === "HOME" ? delivery : null;
  const name =
    clean(home?.recipientName) ||
    clean(a.name) ||
    clean([a.lastName, a.firstName].filter(Boolean).join(" ")) ||
    clean(contact.name) ||
    clean(order?.customerName);
  return {
    name: name || "",
    phone: clean(home?.recipientPhone) || clean(a.phone) || clean(contact.phone) || clean(order?.customerPhone) || "",
    email: clean(home?.recipientEmail) || clean(a.email) || clean(contact.email) || clean(order?.customerEmail) || "",
    county: clean(home?.countyName) || clean(a.county) || "",
    city: clean(home?.cityName) || clean(a.city) || "",
    countyId: home?.countyId ?? positiveInt(a.samedayCountyId),
    cityId: home?.cityId ?? positiveInt(a.samedayCityId),
    street: clean(home?.address) || [clean(a.street), clean(a.streetNo || a.number)].filter(Boolean).join(", ") || "",
    streetNo: "",
    block: "",
    staircase: "",
    apartment: "",
    postalCode: clean(home?.postalCode) || clean(a.postalCode) || "",
    notes: clean(a.notes) || "",
  };
}

/**
 * Noua valoare JSON: corectura (address) sau revenirea la original (address = null),
 * cu istoricul păstrat (cine / când / înainte / după).
 */
export function nextOverrideValue(previous, address, { userId = null, role = null, now = new Date() } = {}) {
  const prev = previous && typeof previous === "object" ? previous : null;
  const before = activeOverride(prev);
  const at = now.toISOString();
  const by = { userId: userId || null, role: role || null };
  const history = [...(Array.isArray(prev?.history) ? prev.history : []), { at, by, before, after: address || null }].slice(-HISTORY_LIMIT);
  return { active: Boolean(address), address: address || null, updatedAt: at, updatedBy: by, history };
}
