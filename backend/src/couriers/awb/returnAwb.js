// backend/src/couriers/awb/returnAwb.js
//
// Retur Sameday STANDARD (ridicare de la client) - regulile PURE (fără DB,
// fără curier), folosite de awbService.buildReturnAwbPlan.
//
// Sursa: PDF v3.6 „Local return shipping with home pickup (Standard Return)”:
//   service = 10, thirdPartyPickup = 1, thirdParty = cine PREDĂ coletul
//   (clientul), awbRecipient = cine îl PRIMEȘTE (vendorul), pickupPoint =
//   punctul contractual al contului (Artfest). Endpoint: același POST /api/awb.
//
// ATENȚIE la denumiri: pe un Shipment RETURN, câmpurile ShipmentDelivery
// recipientName / recipientPhone / recipientEmail / countyId / cityId /
// address / postalCode descriu CLIENTUL = sursa ridicării (thirdParty), NU
// destinatarul AWB-ului. Destinatarul (vendorul) vine din VendorPickupAddress.
// Datele clientului NU se reconstruiesc din comandă.
//
// Ramburs: mereu 0 (rambursarea clientului NU devine ramburs Sameday).
// Valoare asigurată: 0 până la o regulă aprobată (PDF: „send 0” = fără asigurare).

import { hasStreetNumber, isValidRoPhone } from "./addresses.js";

// PDF v3.6 „Services”: Retur standard - Service ID = 10; Locker Retur - 24
export const SAMEDAY_STANDARD_RETURN_SERVICE_ID = "10";
export const SAMEDAY_LOCKER_RETURN_SERVICE_ID = "24";
export const SAMEDAY_RETURN_SERVICE_IDS = new Set([SAMEDAY_STANDARD_RETURN_SERVICE_ID, SAMEDAY_LOCKER_RETURN_SERVICE_ID]);

// cererea de retur trebuie să fie acceptată (APPROVED) sau deja în fluxul de curier
export const RETURN_AWB_REQUEST_STATUSES = new Set(["APPROVED", "PICKUP_REQUESTED"]);

// coletul de retur încă nepredat curierului
export const RETURN_AWB_SHIPMENT_STATUSES = new Set(["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"]);

const clean = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s || null;
};
const digits = (v) => String(v ?? "").replace(/\D+/g, "") || null;
const blocker = (code, message, field) => ({ code, message, ...(field ? { field } : {}) });

/**
 * Cererea de retur + Shipment-ul RETURN permit generarea AWB-ului standard?
 * Coduri stabile; fără apel la curier.
 * @returns {Array<{code, message, field?}>}
 */
export function returnRequestBlockers({ shipment, returnRequest }) {
  const out = [];
  if (!shipment || shipment.direction !== "RETURN") {
    out.push(blocker("return_shipment_required", "AWB-ul de retur se generează doar pentru o expediere de retur."));
    return out;
  }
  if (!returnRequest) {
    out.push(blocker("return_request_missing", "Expedierea de retur nu este legată de o cerere de retur."));
    return out;
  }
  // un retur aparține unui singur vendor: AWB-ul merge DOAR către vendorul cererii
  if (String(returnRequest.vendorId) !== String(shipment.vendorId)) {
    out.push(blocker("return_vendor_mismatch", "Cererea de retur aparține altui magazin decât expedierea de retur."));
  }
  if (!RETURN_AWB_REQUEST_STATUSES.has(String(returnRequest.status))) {
    out.push(
      blocker("return_status_not_eligible", "Cererea de retur nu este acceptată; AWB-ul de retur se generează doar după acceptare.")
    );
  }
  if (returnRequest.returnMethod !== "HOME_PICKUP") {
    out.push(
      blocker(
        "return_method_not_home_pickup",
        "Metoda aleasă pentru retur nu este ridicarea de la adresă (Retur standard Sameday)."
      )
    );
  }
  // cine suportă transportul: decizie EXPLICITĂ a Admin înainte de AWB (fără valoare implicită)
  if (!returnRequest.costBearer) {
    out.push(
      blocker("return_cost_bearer_missing", "Nu s-a decis cine suportă transportul returului. AWB-ul de retur se generează după această decizie.")
    );
  }
  if (shipment.manualShipment) {
    out.push(blocker("manual_shipment", "Returul a fost marcat ca trimis fără integrare de curier."));
  }
  if (shipment.handedOverAt || shipment.deliveredAt || shipment.returnedAt || !RETURN_AWB_SHIPMENT_STATUSES.has(String(shipment.status))) {
    out.push(blocker("return_shipment_status", "Coletul de retur nu mai este într-o etapă în care se poate genera AWB."));
  }
  return out;
}

const PICKUP_INCOMPLETE_MESSAGE =
  "Datele de ridicare ale returului (clientul) sunt incomplete. AWB-ul de retur nu poate fi generat până nu sunt completate.";

/**
 * EXPEDITORUL returului = clientul, EXCLUSIV din ShipmentDelivery al
 * Shipment-ului RETURN (method HOME). Județ + localitate DOAR prin ID-urile
 * Sameday salvate (validate la alegere); incomplet -> blockere, fără
 * completare din comandă.
 * @returns {{ party: Object|null, place: {countyId, cityId}|null, blockers: Array }}
 */
export function returnPickupFromDelivery(delivery) {
  const blockers = [];
  if (!delivery) {
    return { party: null, place: null, blockers: [blocker("return_pickup_missing", PICKUP_INCOMPLETE_MESSAGE, "delivery")] };
  }
  if (delivery.method !== "HOME") {
    return {
      party: null,
      place: null,
      blockers: [blocker("return_delivery_method_mismatch", "Returul standard se ridică de la adresă; datele salvate sunt pentru alt tip de predare.", "delivery.method")],
    };
  }
  if (delivery.serviceId && String(delivery.serviceId) !== SAMEDAY_STANDARD_RETURN_SERVICE_ID) {
    blockers.push(blocker("return_service_mismatch", "Serviciul salvat pentru retur nu este Retur standard Sameday.", "delivery.serviceId"));
  }

  const party = {
    name: clean(delivery.recipientName),
    phone: digits(delivery.recipientPhone),
    email: clean(delivery.recipientEmail),
    county: clean(delivery.countyName),
    city: clean(delivery.cityName),
    address: clean(delivery.address),
    postalCode: clean(delivery.postalCode),
    // persoană fizică (clientul); fără date de firmă
    personType: 0,
    company: null,
  };

  const incomplete = (field) => blockers.push(blocker("return_pickup_incomplete", PICKUP_INCOMPLETE_MESSAGE, `delivery.${field}`));
  if (!party.name) incomplete("recipientName");
  if (!party.phone) incomplete("recipientPhone");
  else if (!isValidRoPhone(party.phone)) {
    blockers.push(blocker("return_pickup_phone_invalid", "Telefonul clientului pentru ridicarea returului nu este valid.", "delivery.recipientPhone"));
  }
  if (!party.address) incomplete("address");
  else if (!hasStreetNumber(party.address)) {
    blockers.push(blocker("return_pickup_street_number_missing", "Adresa de ridicare a returului nu conține numărul străzii.", "delivery.address"));
  }
  const countyId = delivery.countyId ?? null;
  const cityId = delivery.cityId ?? null;
  if (countyId == null) incomplete("countyId");
  if (cityId == null) incomplete("cityId");
  if (party.postalCode && !/^\d{6}$/.test(party.postalCode)) {
    blockers.push(blocker("return_pickup_postal_code_invalid", "Codul poștal al adresei de ridicare a returului nu este valid.", "delivery.postalCode"));
  }

  return {
    party,
    place: countyId != null && cityId != null ? { countyId, cityId } : null,
    // un singur mesaj per cod
    blockers: blockers.filter((b, i) => blockers.findIndex((x) => x.code === b.code) === i),
  };
}

/*
 * Clasificarea DESTINATARULUI (vendorul) pentru Sameday - awbRecipient.personType
 * (PDF v3.6: 0 = natural person, 1 = company; companyName / companyCui /
 * companyOnrcNumber opționale, Swagger AwbRecipientType):
 *   SRL / SA / SRL-D               -> 1, cu datele firmei + persoana de contact;
 *   creator independent (fără formă juridică înregistrată) -> 0, fără date fiscale;
 *   PFA / II / IF                  -> NECONFIRMAT de documentația Sameday ->
 *                                     AWB blocat controlat (datele fiscale rămân
 *                                     în Artfest) până la confirmarea Sameday;
 *   orice altceva / date lipsă     -> blocat (fără clasificare presupusă).
 * Un singur loc de schimbat după răspunsul Sameday.
 */
export const RECIPIENT_COMPANY_LEGAL_TYPES = new Set(["SRL", "SA", "SRL-D"]);
export const RECIPIENT_UNCONFIRMED_LEGAL_TYPES = new Set(["PFA", "II", "IF"]);

/**
 * @param {Object|null} billing  VendorBilling { sellerType, legalType, companyName, cui, regCom }
 * @returns {{ personType: 0|1|null, company: {name, cui, onrc}|null, blockers: Array }}
 */
export function classifyReturnRecipient(billing) {
  if (!billing) {
    return { personType: null, company: null, blockers: [blocker("return_recipient_billing_missing", "Magazinul nu are datele de facturare completate; AWB-ul de retur nu se generează fără ele.")] };
  }
  const legalType = clean(billing.legalType)?.toUpperCase() || null;
  if (!legalType) {
    if (String(billing.sellerType || "") === "independent_creator") return { personType: 0, company: null, blockers: [] };
    return { personType: null, company: null, blockers: [blocker("return_recipient_fiscal_incomplete", "Forma juridică a magazinului nu este completată în datele de facturare.")] };
  }
  if (RECIPIENT_COMPANY_LEGAL_TYPES.has(legalType)) {
    const name = clean(billing.companyName);
    const cui = clean(billing.cui);
    if (!name || !cui) {
      return { personType: null, company: null, blockers: [blocker("return_recipient_fiscal_incomplete", "Denumirea firmei sau CUI-ul lipsesc din datele de facturare ale magazinului.")] };
    }
    return { personType: 1, company: { name, cui, onrc: clean(billing.regCom) }, blockers: [] };
  }
  if (RECIPIENT_UNCONFIRMED_LEGAL_TYPES.has(legalType)) {
    return {
      personType: null,
      company: null,
      blockers: [
        blocker(
          "return_recipient_classification_unconfirmed",
          `AWB-ul de retur către un magazin ${legalType} nu se generează încă: clasificarea pentru Sameday (persoană fizică / juridică) așteaptă confirmarea curierului.`
        ),
      ],
    };
  }
  return { personType: null, company: null, blockers: [blocker("return_recipient_classification_unconfirmed", "Forma juridică a magazinului nu are o clasificare confirmată pentru Sameday.")] };
}

const RETURN_ADDRESS_MESSAGE =
  "Magazinul nu are o adresă de ridicare validă. Ea este și adresa de retur: completeaz-o (cu email) în setările de livrare. AWB-ul de retur nu se generează fără ea.";

/**
 * DESTINATARUL returului = vendorul, din VendorPickupAddress (aceeași sursă de
 * adevăr ca la ridicarea outbound). Fără fallback la adresa Artfest.
 * @param {{party: Object|null, blockers: Array}} pickup  rezultatul buildPickupParty
 * @returns {{ recipient: Object|null, blockers: Array }}
 */
export function returnRecipientFromPickup({ party, blockers: pickupBlockers = [] }, classification = { personType: 0, company: null, blockers: [] }) {
  const blockers = [...(classification.blockers || [])];
  if (!party || pickupBlockers.length) {
    blockers.push(blocker("return_address_invalid", RETURN_ADDRESS_MESSAGE, "pickupAddress"));
    blockers.push(...pickupBlockers);
  } else if (!party.email) {
    // Sameday: emailul destinatarului e obligatoriu (Swagger AwbRecipientType)
    blockers.push(blocker("return_address_email_missing", RETURN_ADDRESS_MESSAGE, "pickupAddress.email"));
  }
  if (!party) return { recipient: null, blockers };
  const company = classification.personType === 1 ? classification.company : null;
  return {
    recipient: {
      // persoana de contact (o caută curierul); firma, separat, în câmpurile company*
      name: party.name,
      personType: company ? 1 : 0,
      company,
      phone: party.phone,
      email: party.email,
      county: party.county,
      city: party.city,
      address: party.address,
      postalCode: party.postalCode,
    },
    blockers,
  };
}

/**
 * Amprenta datelor de retur folosite în payload-ul AWB (expeditorul = clientul,
 * din ShipmentDelivery RETURN) + condițiile cererii. Calculată la planificare
 * și RECALCULATĂ în tranzacția de rezervare, cu cererea blocată (FOR UPDATE):
 * o schimbare a metodei / adresei între timp oprește generarea înainte de
 * orice apel la Sameday. Pură, fără DB.
 */
export function returnPayloadFingerprint(delivery, returnRequest) {
  const d = delivery || {};
  const rr = returnRequest || {};
  return JSON.stringify([
    rr.returnMethod ?? null,
    rr.status ?? null,
    rr.costBearer ?? null,
    rr.vendorId ?? null,
    d.method ?? null,
    d.serviceId ?? null,
    clean(d.recipientName),
    digits(d.recipientPhone),
    clean(d.recipientEmail),
    d.countyId ?? null,
    d.cityId ?? null,
    clean(d.countyName),
    clean(d.cityName),
    clean(d.address),
    clean(d.postalCode),
  ]);
}
