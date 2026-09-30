// backend/src/couriers/awb/addresses.js

/*
 * Destinatar (din Order.shippingAddress + fallback contactPerson /
 * customerName / customerPhone) și expeditor (VendorPickupAddress) pentru
 * AWB, cu validare. Fiecare problemă devine un "blocker" cu mesaj clar -
 * cu blockere, AWB-ul NU se trimite la curier.
 *
 * Checkout-ul salvează numărul străzii în același câmp cu strada
 * (shippingAddress.street), deci verificăm că textul conține un număr (sau
 * mențiunea explicită „fără număr” / „FN”).
 */

function clean(v) {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

function digits(v) {
  return String(v || "").replace(/[^\d+]/g, "");
}

const STREET_NUMBER_RE = /(^|[\s,.])(nr\.?\s*)?\d+[a-z]?\b/i;
const NO_NUMBER_RE = /\b(f\.?\s?n\.?|fără număr|fara numar)\b/i;

export function hasStreetNumber(street, streetNo) {
  if (clean(streetNo)) return true;
  const s = clean(street);
  return STREET_NUMBER_RE.test(s) || NO_NUMBER_RE.test(s);
}

export function isValidRoPhone(phone) {
  const d = digits(phone);
  return /^(\+?40|0)\d{9}$/.test(d) || /^\+\d{9,15}$/.test(d);
}

function blocker(code, message, field) {
  return { code, message, ...(field ? { field } : {}) };
}

/**
 * @param {Object} order - cu shippingAddress, contactPerson, customerName, customerPhone, customerEmail
 * @returns {{ recipient: Object, blockers: Array }}
 */
export function buildRecipient(order) {
  const a = order?.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const contact = order?.contactPerson && typeof order.contactPerson === "object" ? order.contactPerson : {};

  const name =
    clean(a.name) ||
    clean([a.lastName, a.firstName].filter(Boolean).join(" ")) ||
    clean(contact.name) ||
    clean([contact.lastName, contact.firstName].filter(Boolean).join(" ")) ||
    clean(order?.customerName);

  const phone = digits(a.phone) || digits(contact.phone) || digits(order?.customerPhone);
  const email = clean(a.email) || clean(contact.email) || clean(order?.customerEmail);

  const street = clean(a.street);
  const streetNo = clean(a.streetNo || a.number);
  const address = [street, streetNo && !street.includes(streetNo) ? `nr. ${streetNo}` : ""]
    .filter(Boolean)
    .join(", ");

  const recipient = {
    name,
    phone,
    email: email || null,
    county: clean(a.county),
    city: clean(a.city),
    postalCode: clean(a.postalCode) || null,
    address,
  };

  const blockers = [];
  if (!recipient.name) blockers.push(blocker("recipient_name_missing", "Lipsește numele destinatarului.", "recipient.name"));
  if (!recipient.phone) {
    blockers.push(blocker("recipient_phone_missing", "Lipsește telefonul destinatarului.", "recipient.phone"));
  } else if (!isValidRoPhone(recipient.phone)) {
    blockers.push(blocker("recipient_phone_invalid", "Telefonul destinatarului nu este valid.", "recipient.phone"));
  }
  if (!recipient.county) blockers.push(blocker("recipient_county_missing", "Lipsește județul din adresa de livrare.", "recipient.county"));
  if (!recipient.city) blockers.push(blocker("recipient_city_missing", "Lipsește localitatea din adresa de livrare.", "recipient.city"));
  if (!street) {
    blockers.push(blocker("recipient_street_missing", "Lipsește strada din adresa de livrare.", "recipient.street"));
  } else if (!hasStreetNumber(street, streetNo)) {
    blockers.push(
      blocker(
        "recipient_street_number_missing",
        "Adresa de livrare nu conține numărul străzii. Contactează clientul pentru completare.",
        "recipient.streetNo"
      )
    );
  }
  if (recipient.postalCode && !/^\d{6}$/.test(recipient.postalCode)) {
    blockers.push(blocker("recipient_postal_code_invalid", "Codul poștal al destinatarului nu este valid.", "recipient.postalCode"));
  }

  return { recipient, blockers };
}

/**
 * @param {Object|null} pickup - VendorPickupAddress
 */
export function buildSender(pickup) {
  if (!pickup) {
    return {
      sender: null,
      blockers: [
        blocker(
          "pickup_address_missing",
          "Adaugă adresa de ridicare în Setări > Livrare și retururi > Adrese de ridicare.",
          "pickupAddress"
        ),
      ],
    };
  }

  const sender = {
    id: pickup.id,
    contactName: clean(pickup.contactName),
    phone: digits(pickup.phone),
    email: clean(pickup.email) || null,
    county: clean(pickup.county),
    city: clean(pickup.city),
    postalCode: clean(pickup.postalCode) || null,
    street: clean(pickup.street),
    streetNo: clean(pickup.streetNo),
    details: clean(pickup.details) || null,
  };

  const missing = ["contactName", "phone", "county", "city", "street", "streetNo"].filter((k) => !sender[k]);
  const blockers = missing.length
    ? [
        blocker(
          "pickup_address_incomplete",
          "Adresa de ridicare este incompletă. Completează persoana de contact, telefonul, județul, localitatea, strada și numărul.",
          "pickupAddress"
        ),
      ]
    : [];

  return { sender, blockers };
}
