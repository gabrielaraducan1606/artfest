// backend/src/couriers/providers/sameday/awbMapper.js

/*
 * Mapare între input-ul GENERIC de AWB (couriers/contract.js) și formatul
 * Sameday, conform SDK-ului oficial (sameday-courier/php-sdk,
 * SamedayPostAwbRequest): POST /api/awb, body x-www-form-urlencoded cu
 * notație cu paranteze (awbRecipient[name], parcels[0][weight] ...).
 *
 * DE VALIDAT pe mediul demo Sameday înainte de producție: numele câmpurilor
 * de mai jos sunt izolate aici tocmai ca să poată fi corectate într-un
 * singur loc.
 */

const PACKAGE_TYPE_PARCEL = 0; // colet
const AWB_PAYMENT_CLIENT = 1; // expeditorul (contractul vendorului) plătește transportul
const PERSON_TYPE_INDIVIDUAL = 0;

function money(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

function kg(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

/**
 * @param {import("../../contract.js").CreateShipmentInput} input
 * @returns {URLSearchParams}
 */
export function buildSamedayAwbForm(input) {
  const f = new URLSearchParams();
  const parcels = input.parcels || [];
  const totalWeight = parcels.reduce((s, p) => s + Number(p.weightKg || 0), 0);

  f.set("pickupPoint", String(input.pickupPointId));
  f.set("packageType", String(PACKAGE_TYPE_PARCEL));
  f.set("packageNumber", String(parcels.length));
  f.set("packageWeight", kg(totalWeight));
  f.set("service", String(input.serviceId));
  f.set("awbPayment", String(AWB_PAYMENT_CLIENT));
  f.set("cashOnDelivery", money(input.codAmount));
  f.set("insuredValue", money(input.declaredValue || 0));
  f.set("thirdPartyPickup", "0");

  const r = input.recipient;
  f.set("awbRecipient[name]", r.name);
  f.set("awbRecipient[phoneNumber]", r.phone);
  f.set("awbRecipient[personType]", String(PERSON_TYPE_INDIVIDUAL));
  f.set("awbRecipient[countyString]", r.county);
  f.set("awbRecipient[cityString]", r.city);
  f.set("awbRecipient[address]", r.address);
  if (r.postalCode) f.set("awbRecipient[postalCode]", r.postalCode);
  if (r.email) f.set("awbRecipient[email]", r.email);

  parcels.forEach((p, i) => {
    f.set(`parcels[${i}][weight]`, kg(p.weightKg));
    if (p.lengthCm) f.set(`parcels[${i}][length]`, String(p.lengthCm));
    if (p.widthCm) f.set(`parcels[${i}][width]`, String(p.widthCm));
    if (p.heightCm) f.set(`parcels[${i}][height]`, String(p.heightCm));
  });

  if (input.lockerId) f.set("lockerLastMile", String(input.lockerId));
  if (input.clientReference) f.set("clientInternalReference", input.clientReference);
  if (input.observation) f.set("observation", input.observation);

  return f;
}

/**
 * Răspunsul Sameday la creare: { awbNumber, awbCost, parcels: [{ position, awbNumber }], pdfLink }.
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

export function mapSamedayService(s) {
  return {
    id: s?.id ?? null,
    name: s?.name || null,
    code: s?.serviceCode || s?.code || null,
    isDefault: !!(s?.defaultServiceOption ?? s?.default),
  };
}
