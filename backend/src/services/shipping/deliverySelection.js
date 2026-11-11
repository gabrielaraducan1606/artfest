// backend/src/services/shipping/deliverySelection.js
//
// Alegerea livrării, PER SHIPMENT (un shipment = un magazin din coș):
//   HOME    livrare la adresă (adresa comenzii, cu ID-urile Sameday de
//           județ / localitate când clientul le-a ales din nomenclator);
//   LOCKER  easybox (oohType 0);
//   PUDO    Sameday Point (oohType 1).
//
// Frontend-ul trimite DOAR { method, oohId }. Serverul:
//   - verifică metoda și serviciul activ pe contul Artfest;
//   - verifică locația (există, e vizibilă clientului, tipul corespunde);
//   - verifică perechea județ / localitate din nomenclator;
//   - recalculează costul (niciun preț / serviceId din frontend nu contează);
//   - întoarce snapshot-ul validat salvat pe shipment (pentru AWB).

import { billingFieldsAtPlacement } from "./shippingBilling.js";
import { resolveSamedayPlace, SamedayPlaceError } from "./samedayPlace.js";

export class DeliverySelectionError extends Error {
  constructor(code, message, groupKey = null) {
    super(message);
    this.name = "DeliverySelectionError";
    this.code = code;
    this.groupKey = groupKey;
  }
}

const METHOD_ALIASES = { HOME: "HOME", COURIER: "HOME", LOCKER: "LOCKER", EASYBOX: "LOCKER", PUDO: "PUDO" };

/** Metoda cerută, normalizată; orice altceva -> HOME (comportamentul de până acum). */
export function normalizeSelection(raw) {
  const method = METHOD_ALIASES[String(raw?.method || "").trim().toUpperCase()] || "HOME";
  const oohId = method === "HOME" ? null : Number(raw?.oohId);
  return { method, oohId: Number.isInteger(oohId) && oohId > 0 ? oohId : null };
}

export const METHOD_LABELS = Object.freeze({ HOME: "Livrare la adresă", LOCKER: "Easybox", PUDO: "Sameday Point" });

/*
 * Sursa costului de transport taxat clientului (ShipmentDelivery.pricingSource):
 *   SAMEDAY          tariful calculat prin Sameday (estimate-cost) - sursa normală;
 *   ARTFEST_RULE     regula centrală Artfest (ex. tarif fix pe metodă) - rezervat;
 *   VENDOR_FALLBACK  tariful de rezervă configurat de vendor, folosit DOAR când
 *                    sursa principală nu poate da un tarif (motivul în fallbackReason).
 */
export const PRICING_SOURCES = Object.freeze({
  SAMEDAY: "SAMEDAY",
  ARTFEST_RULE: "ARTFEST_RULE",
  VENDOR_FALLBACK: "VENDOR_FALLBACK",
});

export const FALLBACK_REASONS = Object.freeze({
  NOT_CONFIGURED: "primary_pricing_not_configured",
  UNAVAILABLE: "primary_price_unavailable",
  ERROR: "primary_pricing_error",
});

function groupSubtotalCents(group) {
  return (group?.items || []).reduce((sum, it) => sum + Math.round(Number(it.price || 0) * 100) * Number(it.qty || 0), 0);
}

/**
 * Tariful de REZERVĂ al magazinului (câmpurile vechi estimatedShippingFeeCents
 * / freeShippingThresholdCents, păstrate), cu pragul de transport gratuit.
 * @returns {{ priceCents, estimatedShippingFeeCents, freeShippingThresholdCents, qualifiesFreeShipping, vendorSubtotalCents, pricingSource }}
 */
export function priceGroupShipping(group) {
  const estimatedShippingFeeCents = group?.estimatedShippingFeeCents != null ? Number(group.estimatedShippingFeeCents) : 0;
  const freeShippingThresholdCents = group?.freeShippingThresholdCents != null ? Number(group.freeShippingThresholdCents) : null;
  const vendorSubtotalCents = groupSubtotalCents(group);
  const qualifiesFreeShipping = freeShippingThresholdCents != null && vendorSubtotalCents >= freeShippingThresholdCents;
  return {
    priceCents: qualifiesFreeShipping ? 0 : estimatedShippingFeeCents,
    estimatedShippingFeeCents,
    freeShippingThresholdCents,
    qualifiesFreeShipping,
    vendorSubtotalCents,
    pricingSource: PRICING_SOURCES.VENDOR_FALLBACK,
  };
}

/**
 * Costul transportului pentru un magazin: sursa principală, iar dacă nu
 * poate da un tarif (lipsă / indisponibilă / eroare), tariful de rezervă al
 * vendorului - cu sursa și motivul vizibile. Pragul de transport gratuit al
 * vendorului se aplică în ambele cazuri (prețul taxat clientului devine 0).
 * @returns {Promise<{ priceCents, pricingSource, fallbackReason: string|null, carrierCostCents: number|null, ... }>}
 */
export async function resolveGroupShippingPrice({ group, method = "HOME", serviceId = null, ooh = null, place = null, address = null, groupKey = null, primaryPricer = null }) {
  const fallback = priceGroupShipping(group);
  let fallbackReason = FALLBACK_REASONS.NOT_CONFIGURED;

  // primaryPricer (services/shipping/samedayCheckoutPricer.js):
  //   async ({ group, method, serviceId, ooh, place, address }) =>
  //     { amountCents, source: "SAMEDAY" | "ARTFEST_RULE", carrierCostCents? };
  //   aruncă o eroare cu fallbackReason când nu poate da un tarif.
  if (primaryPricer) {
    try {
      const quote = await primaryPricer({ group, method, serviceId, ooh, place, address });
      const amount = Number(quote?.amountCents);
      if (quote && Number.isInteger(amount) && amount >= 0) {
        const source = quote.source === PRICING_SOURCES.ARTFEST_RULE ? PRICING_SOURCES.ARTFEST_RULE : PRICING_SOURCES.SAMEDAY;
        return {
          ...fallback,
          priceCents: fallback.qualifiesFreeShipping ? 0 : amount,
          pricingSource: source,
          fallbackReason: null,
          carrierCostCents: quote.carrierCostCents != null && Number.isInteger(Number(quote.carrierCostCents)) && Number(quote.carrierCostCents) >= 0 ? Number(quote.carrierCostCents) : null,
        };
      }
      fallbackReason = FALLBACK_REASONS.UNAVAILABLE;
    } catch (e) {
      fallbackReason = typeof e?.fallbackReason === "string" && e.fallbackReason ? e.fallbackReason : FALLBACK_REASONS.ERROR;
    }
  }

  // fără tarif de rezervă (și fără transport gratuit) nu inventăm un preț
  if (group?.estimatedShippingFeeCents == null && !fallback.qualifiesFreeShipping) {
    throw new DeliverySelectionError(
      "shipping_price_unavailable",
      "Nu putem calcula acum costul transportului pentru acest magazin. Încearcă din nou în câteva minute.",
      groupKey
    );
  }

  return { ...fallback, pricingSource: PRICING_SOURCES.VENDOR_FALLBACK, fallbackReason, carrierCostCents: null };
}

const clean = (v, max = 500) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Validează alegerea pentru un magazin.
 * @param {Object} options
 * @param {Object} options.selection  { method, oohId } (din frontend)
 * @param {Object} options.address    adresa normalizată a comenzii
 * @param {Object} options.catalog    deliveryCatalog()
 * @param {Object} options.services   rezultatul catalog.getServices() (o dată per cerere)
 * @param {string} options.groupKey   magazinul (pentru mesajul de eroare)
 * @returns {Promise<{ method, serviceId, ooh: Object|null, place: Object|null }>}
 */
export async function validateGroupSelection({ selection, address, catalog, services, groupKey, liveOoh = false }) {
  const { method, oohId } = normalizeSelection(selection);
  const service = services?.services?.[method] || null;

  if (method === "HOME") {
    const place = await validateHomePlace({ address, catalog, courierAvailable: services?.courierAvailable, groupKey });
    return { method, serviceId: service?.id || null, ooh: null, place };
  }

  if (!services?.courierAvailable || !service) {
    throw new DeliverySelectionError(
      "delivery_method_unavailable",
      `Momentan ${METHOD_LABELS[method]} nu este disponibil. Poți continua cu livrare la adresă.`,
      groupKey
    );
  }
  if (!oohId) {
    throw new DeliverySelectionError("ooh_location_required", `Alege locația ${METHOD_LABELS[method]} pentru acest magazin.`, groupKey);
  }
  // la plasare: revalidare punctuală prin Sameday (oohList=<id>, clientVisible = 1)
  let loc = null;
  let unverifiable = false;
  try {
    if (liveOoh && typeof catalog.findOohFresh === "function") {
      const fresh = await catalog.findOohFresh(oohId);
      loc = fresh.loc;
      unverifiable = fresh.source === "unavailable";
    } else {
      loc = await catalog.findOoh(oohId);
    }
  } catch {
    unverifiable = true;
  }
  if (unverifiable) {
    // Sameday nu răspunde: NU plasăm comanda către o locație neverificată
    throw new DeliverySelectionError(
      "ooh_location_unverified",
      `Momentan nu putem verifica locația ${METHOD_LABELS[method]} aleasă. Poți continua cu livrare la adresă sau poți încerca din nou peste câteva minute.`,
      groupKey
    );
  }
  if (!loc) {
    throw new DeliverySelectionError("ooh_location_unavailable", "Locația aleasă nu mai este disponibilă. Alege altă locație.", groupKey);
  }
  if (loc.method !== method || loc.oohType !== (method === "PUDO" ? 1 : 0)) {
    throw new DeliverySelectionError("ooh_location_type_mismatch", `Locația aleasă nu este ${METHOD_LABELS[method]}. Alege din nou locația.`, groupKey);
  }
  return { method, serviceId: service.id, ooh: loc, place: null };
}

/**
 * Livrare la adresă: ID-urile Sameday de județ / localitate sunt opționale,
 * dar când sunt trimise trebuie să existe și să fie pereche corectă.
 */
async function validateHomePlace({ address, catalog, courierAvailable, groupKey }) {
  const textOnly = { countyId: null, cityId: null, countyName: clean(address?.county, 120), cityName: clean(address?.city, 160) };
  /*
   * Revalidare la fiecare quote / plasare (samedayPlace.js):
   *  - ID-uri trimise -> verificate în nomenclator (inclusiv „localitate din alt județ”);
   *  - fără ID-uri (lista de localități a fost indisponibilă în browser) ->
   *    încercăm acum potrivirea exactă și unică după nume;
   *  - nomenclator indisponibil acum -> rămâne textul, nevalidat (Sameday
   *    mapează numele la AWB - PDF v3.6); nu blocăm livrarea la adresă.
   */
  try {
    const place = await resolveSamedayPlace({
      county: address?.county,
      city: address?.city,
      countyId: address?.samedayCountyId ?? null,
      cityId: address?.samedayCityId ?? null,
      catalog: courierAvailable ? catalog : null,
    });
    if (place.status !== "validated") return textOnly;
    return { countyId: place.countyId, cityId: place.cityId, countyName: place.countyName, cityName: place.cityName };
  } catch (error) {
    if (error instanceof SamedayPlaceError) throw new DeliverySelectionError("shipping_place_invalid", error.message, groupKey);
    // orice altă problemă a nomenclatorului: adresa rămâne text (Sameday nu blochează livrarea la adresă)
    return textOnly;
  }
}

/**
 * Snapshot-ul salvat pe shipment (model ShipmentDelivery propus) - tot ce
 * trebuie pentru „Generează AWB” fără date suplimentare de la vendor.
 */
export function buildDeliverySnapshot({ validated, address, priceCents, pricingSource, fallbackReason = null, carrierCostCents = null }) {
  const ooh = validated.ooh;
  const place = validated.place || {};
  return {
    courierProvider: "SAMEDAY",
    method: validated.method,
    serviceId: validated.serviceId || null,
    shippingCost: (Number(priceCents) || 0) / 100,
    pricingSource,
    fallbackReason: pricingSource === "VENDOR_FALLBACK" ? fallbackReason : null,
    carrierCost: carrierCostCents == null ? null : carrierCostCents / 100,
    recipientName: clean(address?.name || [address?.firstName, address?.lastName].filter(Boolean).join(" "), 160),
    recipientPhone: clean(address?.phone, 40),
    recipientEmail: clean(address?.email, 320),
    // HOME: adresa clientului; LOCKER / PUDO: adresa rămâne doar informativă (AWB-ul folosește locația)
    countyId: validated.method === "HOME" ? place.countyId ?? null : null,
    countyName: validated.method === "HOME" ? place.countyName ?? clean(address?.county, 120) : null,
    cityId: validated.method === "HOME" ? place.cityId ?? null : null,
    cityName: validated.method === "HOME" ? place.cityName ?? clean(address?.city, 160) : null,
    address: validated.method === "HOME" ? clean(address?.street, 500) : null,
    postalCode: validated.method === "HOME" ? clean(address?.postalCode, 16) : null,
    oohId: ooh ? ooh.oohId : null,
    oohType: ooh ? ooh.oohType : null,
    oohName: ooh ? clean(ooh.name, 200) : null,
    oohAddress: ooh ? clean(ooh.address, 500) : null,
    oohCityName: ooh ? clean(ooh.city, 160) : null,
    oohCountyName: ooh ? clean(ooh.county, 120) : null,
    oohPostalCode: ooh ? clean(ooh.postalCode, 16) : null,
    oohLat: ooh ? ooh.lat : null,
    oohLng: ooh ? ooh.lng : null,
    oohSchedule: ooh ? { schedule: ooh.schedule, specialSchedule: ooh.specialSchedule } : null,
  };
}

/**
 * Comanda salvează altă adresă decât cea validată (PJ fără adresă de livrare
 * separată -> adresa de facturare + persoana de contact): destinatarul și,
 * la livrarea la adresă, adresa din snapshot devin exact cele ale comenzii.
 * ID-urile Sameday rămân doar dacă vin din aceeași adresă (altfel null).
 */
export function alignSnapshotWithOrderAddress(snapshot, orderAddress, validatedAddress) {
  if (!snapshot || !orderAddress || orderAddress === validatedAddress) return snapshot;
  const sameRecipient = {
    recipientName: clean(orderAddress.name || [orderAddress.firstName, orderAddress.lastName].filter(Boolean).join(" "), 160),
    recipientPhone: clean(orderAddress.phone, 40),
    recipientEmail: clean(orderAddress.email, 320),
  };
  if (snapshot.method !== "HOME") return { ...snapshot, ...sameRecipient };
  return {
    ...snapshot,
    ...sameRecipient,
    countyId: null,
    cityId: null,
    countyName: clean(orderAddress.county, 120),
    cityName: clean(orderAddress.city, 160),
    address: clean(orderAddress.street, 500),
    postalCode: clean(orderAddress.postalCode, 16),
  };
}

/**
 * Datele pentru crearea ShipmentDelivery (relație 1-1 cu Shipment, model
 * propus - vezi schema.prisma). null = fără snapshot (flag oprit).
 */
export function shipmentDeliveryCreate(snapshot) {
  if (!snapshot) return {};
  const coord = (v) => (v == null || !Number.isFinite(Number(v)) ? null : String(Number(v).toFixed(6)));
  return {
    delivery: {
      create: {
        courierProvider: snapshot.courierProvider,
        method: snapshot.method,
        serviceId: snapshot.serviceId,
        shippingCost: String(Number(snapshot.shippingCost || 0).toFixed(2)),
        pricingSource: snapshot.pricingSource,
        ...billingFieldsAtPlacement({ carrierCost: snapshot.carrierCost, fallbackReason: snapshot.fallbackReason }),
        recipientName: snapshot.recipientName,
        recipientPhone: snapshot.recipientPhone,
        recipientEmail: snapshot.recipientEmail,
        countyId: snapshot.countyId,
        countyName: snapshot.countyName,
        cityId: snapshot.cityId,
        cityName: snapshot.cityName,
        address: snapshot.address,
        postalCode: snapshot.postalCode,
        oohId: snapshot.oohId,
        oohType: snapshot.oohType,
        oohName: snapshot.oohName,
        oohAddress: snapshot.oohAddress,
        oohCityName: snapshot.oohCityName,
        oohCountyName: snapshot.oohCountyName,
        oohPostalCode: snapshot.oohPostalCode,
        oohLat: coord(snapshot.oohLat),
        oohLng: coord(snapshot.oohLng),
        ...(snapshot.oohSchedule ? { oohSchedule: snapshot.oohSchedule } : {}),
      },
    },
  };
}

/** Ce vede clientul din snapshot (fără ID-uri de serviciu). */
export function publicDelivery(snapshot) {
  if (!snapshot) return null;
  return {
    method: snapshot.method,
    label: METHOD_LABELS[snapshot.method],
    location: snapshot.oohId
      ? { id: snapshot.oohId, name: snapshot.oohName, address: snapshot.oohAddress, city: snapshot.oohCityName, county: snapshot.oohCountyName }
      : null,
  };
}
