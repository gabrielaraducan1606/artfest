// backend/src/couriers/providers/sameday/awbMapper.js

/*
 * Mapare între input-ul GENERIC de AWB (couriers/contract.js) și formatul
 * Sameday, conform „API custom documentation” v3.6 (POST /api/awb):
 * body x-www-form-urlencoded cu notație cu paranteze (awbRecipient[name],
 * parcels[0][weight] ...) - aceleași nume de câmpuri ca exemplele JSON din
 * documentație; sandbox-ul Swagger trimite tot parametri de formular.
 *
 * Curierat centralizat: AWB-ul e emis pe contractul Artfest (pickupPoint =
 * punctul contractual al Artfest, awbPayment = 1 -> plătește clientul
 * contractual), iar coletul e RIDICAT de la vendor: thirdPartyPickup = 1 +
 * thirdParty = datele de ridicare ale vendorului (din DB, niciodată din
 * request).
 *
 * Județ / localitate: ID-urile Sameday (county / city) DOAR dacă au fost
 * găsite în nomenclatorul Sameday (geolocation.js); altfel numai numele
 * (countyString / cityString) - documentația permite numele, cu mapare
 * automată la Sameday (sau revizuire manuală dacă nu reușește).
 */

const AWB_PAYMENT_CLIENT = 1; // doc: „Can only have value 1” (clientul contractual)
const THIRD_PARTY_PICKUP = 1;
export const PERSON_TYPE = Object.freeze({ INDIVIDUAL: 0, COMPANY: 1 });

/*
 * Tipul coletului după greutate (doc v3.6, „Types of parcels”):
 *   1 -> 0,01-1,00 kg (colet mic / plic); 0 -> 1,01-38 kg; 2 -> peste 38 kg.
 * Se aplică pe cel mai greu colet din AWB (documentația descrie tipul per colet).
 */
export const PACKAGE_TYPES = Object.freeze({
  PARCEL: 0,
  SMALL_PARCEL: 1,
  LARGE_PARCEL: 2,
});

export function samedayPackageType(parcels = []) {
  const heaviest = Math.max(0, ...(parcels || []).map((p) => Number(p?.weightKg) || 0));
  if (heaviest <= 0) return null;
  if (heaviest <= 1) return PACKAGE_TYPES.SMALL_PARCEL;
  if (heaviest <= 38) return PACKAGE_TYPES.PARCEL;
  return PACKAGE_TYPES.LARGE_PARCEL;
}

export const PACKAGE_TYPE_LABELS = Object.freeze({
  [PACKAGE_TYPES.SMALL_PARCEL]: "Colet mic (până la 1 kg)",
  [PACKAGE_TYPES.PARCEL]: "Colet standard (1-38 kg)",
  [PACKAGE_TYPES.LARGE_PARCEL]: "Colet supradimensionat (peste 38 kg)",
});

function money(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

function kg(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

function setIf(f, key, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") f.set(key, String(value));
}

// județ / localitate: ID Sameday dacă e cunoscut + numele (mereu)
function setPlace(f, prefix, place) {
  setIf(f, `${prefix}[county]`, place.countyId);
  setIf(f, `${prefix}[city]`, place.cityId);
  f.set(`${prefix}[countyString]`, place.county);
  f.set(`${prefix}[cityString]`, place.city);
}

/**
 * @param {import("../../contract.js").CreateShipmentInput} input
 * @returns {URLSearchParams}
 */
export function buildSamedayAwbForm(input) {
  const f = new URLSearchParams();
  const parcels = input.parcels || [];
  // packageWeight = suma exactă a greutăților trimise pe colete (coerență)
  const parcelWeights = parcels.map((p) => kg(p.weightKg));
  const totalWeight = parcelWeights.reduce((s, w) => s + Number(w), 0);

  f.set("pickupPoint", String(input.pickupPointId));
  setIf(f, "contactPerson", input.contactPersonId);
  f.set("packageType", String(samedayPackageType(parcels)));
  f.set("packageNumber", String(parcels.length));
  f.set("packageWeight", kg(totalWeight));
  f.set("service", String(input.serviceId));
  f.set("awbPayment", String(AWB_PAYMENT_CLIENT));
  f.set("cashOnDelivery", money(input.codAmount));
  f.set("insuredValue", money(input.declaredValue || 0));

  // ridicare de la vendor (terț), pe contractul Artfest
  const t = input.thirdParty;
  f.set("thirdPartyPickup", String(THIRD_PARTY_PICKUP));
  f.set("thirdParty[name]", t.name);
  f.set("thirdParty[phoneNumber]", t.phone);
  f.set("thirdParty[personType]", String(t.personType ?? PERSON_TYPE.INDIVIDUAL));
  setPlace(f, "thirdParty", t);
  f.set("thirdParty[address]", t.address);
  setIf(f, "thirdParty[postalCode]", t.postalCode);
  setIf(f, "thirdParty[contactEmail]", t.email);
  if (t.personType === PERSON_TYPE.COMPANY && t.company) {
    setIf(f, "thirdParty[companyName]", t.company.name);
    setIf(f, "thirdParty[companyCui]", t.company.cui);
    setIf(f, "thirdParty[companyOnrcNumber]", t.company.onrc);
  }

  const r = input.recipient;
  f.set("awbRecipient[name]", r.name);
  f.set("awbRecipient[phoneNumber]", r.phone);
  f.set("awbRecipient[personType]", String(PERSON_TYPE.INDIVIDUAL));
  setPlace(f, "awbRecipient", r);
  f.set("awbRecipient[address]", r.address);
  setIf(f, "awbRecipient[postalCode]", r.postalCode);
  setIf(f, "awbRecipient[email]", r.email);

  parcels.forEach((p, i) => {
    f.set(`parcels[${i}][weight]`, parcelWeights[i]);
    if (p.lengthCm) f.set(`parcels[${i}][length]`, String(p.lengthCm));
    if (p.widthCm) f.set(`parcels[${i}][width]`, String(p.widthCm));
    if (p.heightCm) f.set(`parcels[${i}][height]`, String(p.heightCm));
  });

  f.set("clientInternalReference", input.clientReference);
  setIf(f, "observation", input.observation);

  return f;
}

/**
 * Răspunsul Sameday la creare (și la GET /api/client/awb/{clientInternalReference},
 * „Returns the same response as AWB creation”):
 * { awbNumber, awbCost, parcels: [{ position, awbNumber }], pdfLink, ... }.
 * Păstrăm doar date NE-secrete.
 */
export function parseSamedayAwbResponse(body) {
  const awbNumber = body?.awbNumber ? String(body.awbNumber).trim() : "";
  if (!awbNumber) return null;

  const parcelNumbers = Array.isArray(body?.parcels)
    ? body.parcels.map((p) => (p?.awbNumber ? String(p.awbNumber) : null)).filter(Boolean)
    : [];

  const cost = Number(body?.awbCost);

  return {
    awbNumber,
    parcelNumbers,
    cost: Number.isFinite(cost) ? cost : null,
  };
}

// GET /api/client/services: { id, name, serviceCode, deliveryType, defaultServices, ... }
export function mapSamedayService(s) {
  return {
    id: s?.id ?? null,
    name: s?.name || null,
    code: s?.serviceCode || null,
    isDefault: s?.defaultServices === true,
  };
}
