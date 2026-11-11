// backend/src/services/shipping/samedayPlace.js
//
// Județ + localitate pentru livrarea la adresă, față de nomenclatorul Sameday
// (GET /api/geolocation/county, GET /api/geolocation/city - prin catalog).
// PDF v3.6: se recomandă maparea nomenclatorului și trimiterea ID-urilor de
// județ / localitate la AWB (altfel Sameday încearcă o mapare după nume, iar
// la eșec coletul intră în verificare manuală).
//
// Rezultat:
//   { status: "validated", countyId, cityId, countyName, cityName }
//   { status: "unverified", reason }   - nomenclatorul nu poate fi consultat
//                                        acum (fără cont / indisponibil): se
//                                        păstrează doar textul, nevalidat
//   aruncă SamedayPlaceError            - nomenclatorul răspunde, dar locul nu
//                                        există / nu e în județul ales / e ambiguu
//
// Nu se ghicește nimic: textul liber se acceptă doar dacă există EXACT o
// localitate cu acel nume (fără diacritice) în județul ales.

import { findRoCounty, foldCountyName } from "../../constants/roCounties.js";

export class SamedayPlaceError extends Error {
  constructor(code, message, field = "city") {
    super(message);
    this.name = "SamedayPlaceError";
    this.code = code;
    this.field = field;
  }
}

const fold = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const toId = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

const unverified = (reason) => ({ status: "unverified", reason });

/**
 * @param {{ county?: string, city?: string, countyId?: number|string|null, cityId?: number|string|null, catalog?: Object|null }} input
 *   county = codul din checkout („CJ”) sau denumirea; city = denumirea tastată / aleasă
 */
export async function resolveSamedayPlace({ county, city, countyId = null, cityId = null, catalog = null }) {
  const wantCountyId = toId(countyId);
  const wantCityId = toId(cityId);
  if (Number.isNaN(wantCountyId) || Number.isNaN(wantCityId)) {
    throw new SamedayPlaceError("shipping_place_invalid", "Alege din nou localitatea din listă.");
  }
  if (!catalog) return unverified("nomenclator_disabled");

  try {
    const services = await catalog.getServices();
    if (!services?.courierAvailable) return unverified("courier_unavailable");
  } catch {
    return unverified("courier_unavailable");
  }

  const roCounty = findRoCounty(county);

  // ---- județul ----
  let samedayCounty = null;
  try {
    if (wantCountyId != null) {
      samedayCounty = await catalog.findCounty(wantCountyId);
    } else {
      const target = foldCountyName(roCounty?.name || county);
      if (!target) throw new SamedayPlaceError("shipping_county_required", "Alege județul.", "county");
      samedayCounty = (await catalog.counties()).find((c) => foldCountyName(c.name) === target) || null;
    }
  } catch (error) {
    if (error instanceof SamedayPlaceError) throw error;
    return unverified("nomenclator_unavailable");
  }
  if (!samedayCounty) {
    throw new SamedayPlaceError("shipping_county_invalid", "Județul nu a fost găsit în lista curierului. Alege-l din nou.", "county");
  }
  // ID vechi de județ, dar clientul a schimbat județul din formular
  if (roCounty && foldCountyName(roCounty.name) !== foldCountyName(samedayCounty.name)) {
    throw new SamedayPlaceError("shipping_place_invalid", "Localitatea aleasă nu este în județul selectat. Alege din nou localitatea.");
  }

  // ---- localitatea ----
  let samedayCity = null;
  try {
    if (wantCityId != null) {
      // findCity caută DOAR în județul dat -> localitate din alt județ = null
      samedayCity = await catalog.findCity(samedayCounty.id, wantCityId);
      if (!samedayCity) {
        throw new SamedayPlaceError("shipping_place_invalid", "Localitatea nu este în județul selectat. Alege din nou localitatea din listă.");
      }
    } else {
      const target = fold(city);
      if (!target) throw new SamedayPlaceError("shipping_city_required", "Alege localitatea din listă.");
      const list = await catalog.cities(samedayCounty.id, city);
      const exact = [...new Map(list.filter((c) => fold(c.name) === target).map((c) => [String(c.id), c])).values()];
      if (exact.length === 0) {
        throw new SamedayPlaceError("shipping_city_not_found", `Nu am găsit localitatea „${String(city).trim()}” în județul ${samedayCounty.name}. Alege localitatea din listă.`);
      }
      if (exact.length > 1) {
        throw new SamedayPlaceError("shipping_city_ambiguous", `Există mai multe localități „${String(city).trim()}” în județul ${samedayCounty.name}. Alege-o pe cea corectă din listă.`);
      }
      samedayCity = exact[0];
    }
  } catch (error) {
    if (error instanceof SamedayPlaceError) throw error;
    return unverified("nomenclator_unavailable");
  }

  return {
    status: "validated",
    countyId: Number(samedayCounty.id),
    countyName: samedayCounty.name,
    cityId: Number(samedayCity.id),
    cityName: samedayCity.name,
    postalCode: samedayCity.postalCode || null,
  };
}
