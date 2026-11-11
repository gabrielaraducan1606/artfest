// backend/src/routes/shippingRoutes.js
//
// Proxy-ul de livrare pentru checkout (client autentificat și guest):
//   GET /api/shipping/options        metodele disponibile acum (fără ID-uri interne)
//   GET /api/shipping/counties       județele din nomenclatorul Sameday
//   GET /api/shipping/cities         localitățile unui județ (?countyId=&q=)
//   GET /api/shipping/ooh-locations  easybox / Sameday Point vizibile (?q=&type=)
//   GET /api/shipping/return-options „Ridicare de la adresă” la retur disponibilă?
// /options și /ooh-locations depind DOAR de checkout (SAMEDAY_CHECKOUT_ENABLED);
// /counties și /cities - de nomenclator (checkout activ SAU SAMEDAY_NOMENCLATOR_ENABLED,
// shipping/logisticsFlags.js). Checkout-ul din browser folosește nomenclatorul doar
// când /options raportează enabled + nomenclator, deci flag-ul nou nu îl schimbă.
// Frontend-ul nu vorbește niciodată direct cu Sameday; tokenul rămâne pe
// server. Cu checkout-ul nou inactiv (checkoutMode.js): doar livrarea la adresă.

import express from "express";

import { deliveryCatalog as defaultCatalog, foldText } from "../services/shipping/deliveryCatalog.js";
import { METHOD_LABELS } from "../services/shipping/deliverySelection.js";
import { isSamedayCheckoutActive } from "../services/shipping/checkoutMode.js";
import { isNomenclatorAvailable, returnPickupAvailability } from "../services/shipping/logisticsFlags.js";
import { findRoCounty } from "../constants/roCounties.js";

export const MAX_CITIES = 20;
export const MIN_CITY_QUERY = 2;

/** Rezultatele autocomplete-ului: potrivire exactă, apoi „începe cu”, apoi „conține”. */
export function rankCities(list = [], q = "") {
  const term = foldText(q);
  const score = (c) => {
    const name = foldText(c.name);
    if (name === term) return 0;
    if (name.startsWith(term)) return 1;
    if (name.split(" ").some((w) => w.startsWith(term))) return 2;
    return 3;
  };
  return list.map((c, i) => ({ c, s: score(c), i })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c);
}

/** ?near=lat,lng (Romania aprox.); orice altceva -> null. Nu se salvează nicăieri. */
export function parseNear(value) {
  const m = String(value || "").match(/^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < 43 || lat > 49 || lng < 20 || lng > 30.5) return null;
  return { lat, lng };
}

export function createShippingRouter({ catalog = null, env = process.env, isActive = null, db = undefined } = {}) {
  const router = express.Router();
  const cat = () => catalog || defaultCatalog();
  // checkout (metode, easybox / Sameday Point)
  const enabled = () => (isActive ? isActive() : isSamedayCheckoutActive(env));
  // nomenclator (județe / localități): checkout activ SAU activare explicită
  const nomenclatorEnabled = () => isNomenclatorAvailable({ env, ...(db ? { db } : {}), checkoutActive: enabled });

  const cache = (res, seconds) => res.set("Cache-Control", `public, max-age=${seconds}`);
  // mesaje prietenoase, fără textul tehnic Sameday; livrarea la adresă rămâne mereu disponibilă
  const FAIL_MESSAGES = {
    "ooh-locations": "Momentan nu putem încărca opțiunile Easybox / Sameday Point. Poți continua cu livrare la adresă.",
    counties: "Momentan nu putem încărca lista de județe. Poți scrie adresa manual.",
    cities: "Momentan nu putem încărca lista de localități. Poți scrie localitatea manual.",
  };
  const fail = (res, error, where) => {
    console.error(`[shipping] ${where}:`, error?.name || "Error", String(error?.message || "").slice(0, 120));
    return res.status(503).json({
      error: "shipping_catalog_unavailable",
      message: FAIL_MESSAGES[where] || "Momentan nu putem încărca opțiunile de livrare. Poți continua cu livrare la adresă.",
    });
  };

  router.get("/options", async (_req, res) => {
    try {
      if (!(await enabled())) {
        return res.json({ enabled: false, nomenclator: false, methods: [{ method: "HOME", label: METHOD_LABELS.HOME }] });
      }
      const { courierAvailable, services } = await cat().getServices();
      const methods = ["HOME", "LOCKER", "PUDO"]
        .filter((m) => m === "HOME" || (courierAvailable && services[m]))
        .map((m) => ({ method: m, label: METHOD_LABELS[m] }));
      // indisponibil temporar -> cache scurt, ca metodele să revină repede
      cache(res, courierAvailable ? 300 : 30);
      return res.json({ enabled: true, nomenclator: Boolean(courierAvailable), methods });
    } catch (error) {
      return fail(res, error, "options");
    }
  });

  router.get("/counties", async (_req, res) => {
    try {
      if (!(await nomenclatorEnabled())) return res.json({ items: [] });
      cache(res, 3600);
      // code = codul de județ folosit de checkout în adresă (asociat după denumire; null dacă nu se potrivește)
      return res.json({ items: (await cat().counties()).map((c) => ({ id: c.id, name: c.name, code: findRoCounty(c.name)?.code || null })) });
    } catch (error) {
      return fail(res, error, "counties");
    }
  });

  router.get("/cities", async (req, res) => {
    try {
      if (!(await nomenclatorEnabled())) return res.json({ items: [] });
      const countyId = String(req.query.countyId || "").trim();
      if (!/^\d{1,9}$/.test(countyId)) return res.status(400).json({ error: "county_required", message: "Alege întâi județul." });
      // autocomplete: abia de la 2 caractere (nu trimitem tot județul la fiecare deschidere)
      const q = String(req.query.q || "").trim().slice(0, 80);
      if (foldText(q).length < MIN_CITY_QUERY) return res.json({ items: [], total: 0 });
      const list = rankCities(await cat().cities(countyId, q), q);
      cache(res, 3600);
      return res.json({
        // postalCode = codul localității din nomenclator (unul per localitate) - doar sugestie în UI
        items: list.slice(0, MAX_CITIES).map((c) => ({ id: c.id, name: c.name, village: c.village, postalCode: c.postalCode })),
        total: list.length,
      });
    } catch (error) {
      return fail(res, error, "cities");
    }
  });

  // retur: „Ridicare de la adresă” disponibilă acum? (fără ID-uri / config internă)
  router.get("/return-options", async (_req, res) => {
    try {
      const availability = await returnPickupAvailability({ env, ...(db ? { db } : {}), checkoutActive: enabled });
      res.set("Cache-Control", "private, max-age=60");
      return res.json({ homePickup: availability.available });
    } catch (error) {
      console.error("[shipping] return-options:", error?.name || "Error");
      return res.json({ homePickup: false });
    }
  });

  router.get("/ooh-locations", async (req, res) => {
    try {
      if (!(await enabled())) return res.json({ items: [], total: 0 });
      const type = ["LOCKER", "PUDO"].includes(String(req.query.type || "").toUpperCase()) ? String(req.query.type).toUpperCase() : "ALL";
      const q = String(req.query.q || "").slice(0, 80);
      // zona din adresa clientului (prioritizare) și, opțional, poziția din browser
      const city = String(req.query.city || "").slice(0, 160);
      const county = String(req.query.county || "").slice(0, 120);
      const near = parseNear(req.query.near);
      const result = await cat().searchOoh({ q, type, limit: Number(req.query.limit) || undefined, city, county, near });
      // poziția clientului nu se păstrează în cache-uri partajate
      if (near) res.set("Cache-Control", "private, no-store");
      else cache(res, 300);
      return res.json(result);
    } catch (error) {
      return fail(res, error, "ooh-locations");
    }
  });

  return router;
}

export default createShippingRouter();
