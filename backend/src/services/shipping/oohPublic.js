// backend/src/services/shipping/oohPublic.js
//
// Forma publică a unei locații easybox / Sameday Point (ce vede clientul),
// din forma normalizată a catalogului Sameday (catalog.js normalizeOohLocation).
// Fără câmpuri logistice interne Sameday. Reexportată din deliveryCatalog.js.

export function publicOoh(loc) {
  return {
    id: loc.oohId,
    type: loc.method, // LOCKER | PUDO
    name: loc.name,
    address: loc.address,
    city: loc.city,
    county: loc.county,
    postalCode: loc.postalCode,
    lat: loc.lat,
    lng: loc.lng,
    schedule: loc.schedule,
    specialSchedule: loc.specialSchedule,
    // supportedPayment Sameday: plata cu cardul la locație (true / false / null = necunoscut)
    acceptsCardPayment: typeof loc.acceptsCardPayment === "boolean" ? loc.acceptsCardPayment : null,
  };
}
