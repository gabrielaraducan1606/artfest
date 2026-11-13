// backend/src/couriers/providers/sameday/localSimulation.js
//
// SIMULARE LOCALĂ Sameday - DOAR pentru testarea manuală a checkout-ului pe
// localhost (servicii, easybox, nomenclator, tarif). TOATE datele de aici sunt
// FICTIVE (marcate „SIMULARE”): ID-uri, lockere, județe, localități, tarife.
// Nu le folosi niciodată ca valori reale.
//
// Activare: SAMEDAY_LOCAL_SIMULATION=1 ȘI NODE_ENV !== "production" ȘI
// procesul nu rulează pe Render / Vercel. În producție simularea e imposibil
// de activat, chiar cu variabila setată.
//
// Cu simularea activă (client.js):
//   - NICIUN apel în rețea către Sameday (nici citire, nici scriere), pentru
//     niciun cont - inclusiv conturile reale din DB;
//   - răspunsuri fixe doar pentru citiri (servicii, OOH, nomenclator, puncte
//     de ridicare) și estimarea de tarif;
//   - orice altă operație (AWB, anulare, etichetă, ridicare, status) -> eroare
//     explicită SamedaySimulationBlockedError.

import { CourierError } from "../../errors.js";

export const SIMULATION_ACCOUNT_ID = "simulare_locala_sameday";
export const SIMULATION_ENVIRONMENT = "simulare-locala";

export class SamedaySimulationBlockedError extends CourierError {
  constructor(operation = "operație") {
    super(
      "sameday_simulation_blocked",
      `Simulare locală Sameday: ${operation} este blocată (nicio operație reală la Sameday în modul simulare).`,
      { httpStatus: 503 }
    );
    this.name = "SamedaySimulationBlockedError";
  }
}

/** Simularea e activă? Imposibil în producție (NODE_ENV / Render / Vercel). */
export function isSamedayLocalSimulationEnabled(env = process.env) {
  if (String(env.SAMEDAY_LOCAL_SIMULATION ?? "").trim() !== "1") return false;
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") return false;
  if (env.RENDER || env.RENDER_SERVICE_ID || env.VERCEL) return false;
  return true;
}

let announced = false;
function announce() {
  if (announced) return;
  announced = true;
  console.warn("[sameday] SIMULARE LOCALĂ ACTIVĂ: date și tarife FICTIVE, niciun apel la Sameday.");
}

/* ===================== date FICTIVE ===================== */

const SIM_SERVICES = Object.freeze({ HOME: 990007, LOCKER: 990015, PUDO: 990016 });
const SIM_PICKUP_POINT_ID = 990001;

/** Contextul de cont simulat (fără credentiale). */
export function simulatedPlatformContext() {
  announce();
  return {
    accountId: SIMULATION_ACCOUNT_ID,
    simulated: true,
    credentials: null,
    publicConfig: {
      environment: SIMULATION_ENVIRONMENT,
      pickupPointId: String(SIM_PICKUP_POINT_ID),
      serviceId: String(SIM_SERVICES.HOME),
      lockerServiceId: String(SIM_SERVICES.LOCKER),
      pudoServiceId: String(SIM_SERVICES.PUDO),
    },
  };
}

/** Adresa de ridicare FICTIVĂ - doar când vendorul nu are una salvată (tariful simulat). */
export function simulatedPickupParty(vendorId) {
  return {
    addressId: null,
    storeName: "SIMULARE",
    name: "Expeditor SIMULARE",
    phone: "0700000000",
    email: null,
    county: "București",
    city: "Sectorul 1",
    postalCode: null,
    address: `Adresă de ridicare SIMULARE (vendor ${vendorId || "?"})`,
    personType: 0,
    company: null,
  };
}

const SIM_COUNTIES = [
  { id: 990101, name: "București", code: "B" },
  { id: 990102, name: "Ilfov", code: "IF" },
  { id: 990103, name: "Cluj", code: "CJ" },
  { id: 990104, name: "Iași", code: "IS" },
  { id: 990105, name: "Timiș", code: "TM" },
  { id: 990106, name: "Brașov", code: "BV" },
  { id: 990107, name: "Constanța", code: "CT" },
];

const SIM_CITIES = [
  [990101, ["Sectorul 1", "Sectorul 2", "Sectorul 3", "Sectorul 4", "Sectorul 5", "Sectorul 6", "București"]],
  [990102, ["Voluntari", "Otopeni", "Popești-Leordeni", "Chiajna"]],
  [990103, ["Cluj-Napoca", "Florești", "Turda"]],
  [990104, ["Iași", "Pașcani"]],
  [990105, ["Timișoara", "Lugoj"]],
  [990106, ["Brașov", "Săcele"]],
  [990107, ["Constanța", "Mangalia"]],
].flatMap(([countyId, names], i) =>
  names.map((name, j) => {
    const county = SIM_COUNTIES.find((c) => c.id === countyId);
    return { id: 9902000 + i * 100 + j, name, county: { id: county.id, name: county.name, code: county.code }, postalCode: null };
  })
);

const SCHEDULE = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, openingHour: "00:00", closingHour: "23:59" }));

// [oohId, oohType (0 = easybox, 1 = Sameday Point), oraș, județ, lat, lng, plată card]
const SIM_OOH = [
  [99000101, 0, "Sectorul 1", "București", 44.4520, 26.0850, 1],
  [99000102, 0, "Sectorul 2", "București", 44.4440, 26.1300, 1],
  [99000103, 0, "Sectorul 3", "București", 44.4250, 26.1450, 0],
  [99000104, 0, "Sectorul 6", "București", 44.4350, 26.0300, 1],
  [99000105, 1, "Sectorul 4", "București", 44.4000, 26.1100, 0],
  [99000106, 0, "Voluntari", "Ilfov", 44.4900, 26.1800, 1],
  [99000107, 0, "Cluj-Napoca", "Cluj", 46.7700, 23.5900, 1],
  [99000108, 0, "Cluj-Napoca", "Cluj", 46.7550, 23.6050, 0],
  [99000109, 1, "Cluj-Napoca", "Cluj", 46.7800, 23.6200, 1],
  [99000110, 0, "Iași", "Iași", 47.1600, 27.5900, 1],
  [99000111, 0, "Timișoara", "Timiș", 45.7500, 21.2300, 1],
  [99000112, 0, "Brașov", "Brașov", 45.6500, 25.6000, 1],
  [99000113, 0, "Constanța", "Constanța", 44.1700, 28.6300, 1],
];

const SIM_OOH_ROWS = SIM_OOH.map(([oohId, oohType, city, county, lat, lng, card], i) => {
  const cityRow = SIM_CITIES.find((c) => c.name === city && c.county.name === county);
  return {
    oohId,
    oohType,
    name: `${oohType === 0 ? "easybox" : "Sameday Point"} SIMULARE ${i + 1} - ${city}`,
    address: `Strada Exemplu SIMULARE nr. ${i + 1}`,
    city,
    cityId: cityRow?.id ?? null,
    county,
    countyId: cityRow?.county.id ?? null,
    postalCode: null,
    lat,
    lng,
    clientVisible: 1,
    supportedPayment: card,
    schedule: SCHEDULE,
    specialSchedule: [],
  };
});

/* ===================== tarif FICTIV ===================== */

// SIMULARE: formula NU reflectă tarifele Sameday. Lei cu TVA.
const SIM_TARIFF = {
  [SIM_SERVICES.HOME]: { base: 19.9, perKg: 2.5 },
  [SIM_SERVICES.LOCKER]: { base: 14.9, perKg: 1.5 },
  [SIM_SERVICES.PUDO]: { base: 13.9, perKg: 1.5 },
};

function simulatedEstimate(form) {
  const service = Number(form?.get?.("service"));
  const rule = SIM_TARIFF[service];
  if (!rule) throw new SamedaySimulationBlockedError("estimarea pentru un serviciu necunoscut simulării");
  const weight = Math.max(0, Number(form.get("packageWeight")) || 0);
  const extraKg = Math.max(0, Math.ceil(weight) - 1);
  const amount = Math.round((rule.base + extraKg * rule.perKg) * 100) / 100;
  return { amount, currency: "RON", time: 24, simulated: true };
}

/* ===================== răspunsuri ===================== */

const fold = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const page = (rows) => ({ data: rows, total: rows.length, currentPage: 1, pages: 1, perPage: rows.length || 1, simulated: true });

/**
 * Răspunsul FICTIV pentru o cerere Sameday. Doar citiri + estimarea de tarif;
 * orice altceva -> SamedaySimulationBlockedError (fără niciun apel în rețea).
 */
export function simulatedSamedayResponse({ method = "GET", path = "", form = null } = {}) {
  announce();
  const verb = String(method).toUpperCase();
  const url = new URL(String(path), "http://simulare.local");
  const q = url.searchParams;
  const route = url.pathname;

  if (verb === "POST" && route === "/api/awb/estimate-cost") return simulatedEstimate(form);
  if (verb !== "GET") throw new SamedaySimulationBlockedError(`${verb} ${route}`);

  if (route === "/api/client/services") {
    return page([
      { id: SIM_SERVICES.HOME, name: "24H (SIMULARE)", serviceCode: "SIM24", deliveryType: { name: "Home delivery (SIMULARE)" }, defaultServices: true },
      { id: SIM_SERVICES.LOCKER, name: "Locker NextDay (SIMULARE)", serviceCode: "SIMLN", deliveryType: { name: "Locker (SIMULARE)" } },
      { id: SIM_SERVICES.PUDO, name: "PUDO NextDay (SIMULARE)", serviceCode: "SIMPN", deliveryType: { name: "PUDO (SIMULARE)" } },
    ]);
  }
  if (route === "/api/client/pickup-points") {
    return page([{ id: SIM_PICKUP_POINT_ID, alias: "Punct de ridicare SIMULARE", defaultPickupPoint: true, pickupPointContactPerson: [] }]);
  }
  if (route === "/api/client/ooh-locations") {
    const ids = String(q.get("oohList") || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    return page(ids.length ? SIM_OOH_ROWS.filter((r) => ids.includes(r.oohId)) : SIM_OOH_ROWS);
  }
  if (route === "/api/geolocation/county") {
    const name = fold(q.get("name"));
    return page(name ? SIM_COUNTIES.filter((c) => fold(c.name) === name) : SIM_COUNTIES);
  }
  if (route === "/api/geolocation/city") {
    const county = String(q.get("county") || "");
    const name = fold(q.get("name"));
    return page(SIM_CITIES.filter((c) => (!county || String(c.county.id) === county) && (!name || fold(c.name) === name)));
  }
  throw new SamedaySimulationBlockedError(`GET ${route}`);
}
