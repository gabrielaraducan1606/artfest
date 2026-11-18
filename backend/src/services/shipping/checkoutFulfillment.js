// backend/src/services/shipping/checkoutFulfillment.js
//
// Etapa 3 - modul de livrare ales PER MAGAZIN la checkout (Shipment.fulfillment):
//
//   ARTFEST_SAMEDAY  „Sameday prin Artfest”: doar magazinele cu opțiunea ACTIVĂ
//                    (opt-in + eligibilitate, samedayStoreDelivery.js) și doar când TOT
//                    coșul se poate plăti integral cu cardul. Tarif EXCLUSIV Sameday
//                    (fără tariful de rezervă al magazinului, fără pragul lui de
//                    gratuitate - transportul e al Artfest). Plata doar CARD.
//   VENDOR_COURIER   curierul magazinului: tariful magazinului (cu pragul de gratuitate),
//                    livrare la adresă, ramburs sau card - exact ca până acum.
//
// Selecția trimisă de frontend per magazin:
//   { fulfillment?, method?, oohId?, expectedShippingCents? }
//  - fără `fulfillment` la quote  -> preselectare: Sameday dacă e disponibil și are tarif ACUM,
//                                    altfel curierul magazinului;
//  - fără `fulfillment` la plasare -> comportamentul vechi (curierul magazinului,
//                                    Shipment.fulfillment rămâne null);
//  - ARTFEST_SAMEDAY cerut, dar indisponibil acum -> NU se schimbă tăcut: quote marchează
//    magazinul (clientul reconfirmă), plasarea răspunde 409;
//  - expectedShippingCents (prețul văzut de client) diferit de cel recalculat -> 409.
// Eligibilitatea, metoda, locația și prețul se recalculează MEREU aici, pe server.
// Comutatorul Sameday prin Artfest oprit -> fiecare magazin = exact calculul vechi.

import { FULFILLMENT } from "./fulfillment.js";
import {
  DeliverySelectionError,
  PRICING_SOURCES,
  buildDeliverySnapshot,
  normalizeSelection,
  priceGroupShipping,
  publicDelivery,
  validateGroupSelection,
} from "./deliverySelection.js";

export const FULFILLMENT_MESSAGES = Object.freeze({
  sameday_unavailable:
    "Livrarea Sameday prin Artfest nu mai este disponibilă pentru acest magazin. Alege curierul magazinului ca să continui; costul transportului se recalculează.",
  cart_not_card_capable:
    "Livrarea Sameday prin Artfest se plătește integral online, cu cardul, iar plata cu cardul nu mai este disponibilă pentru toate produsele din coș. Alege curierul magazinului ca să continui.",
  sameday_price_unavailable:
    "Momentan nu putem calcula tariful Sameday pentru acest magazin. Poți alege curierul magazinului sau poți încerca din nou peste câteva minute.",
  sameday_requires_card:
    "Livrarea Sameday prin Artfest se plătește doar online, cu cardul. Alege plata cu cardul sau, pentru plata ramburs, curierul magazinului.",
  shipping_price_changed: "Costul transportului s-a schimbat. Verifică noul total înainte să plasezi comanda.",
  vendor_courier_method: "Easybox și Sameday Point sunt disponibile doar cu livrarea Sameday prin Artfest.",
});

const dec = (n) => Number.parseFloat(Number(n || 0).toFixed(2));
const centsOf = (n) => Math.round(Number(n || 0) * 100);
const ALL_METHODS = ["HOME", "LOCKER", "PUDO"];

function selectionError(code, groupKey, { httpStatus = 400, message = null, extra = null } = {}) {
  const error = new DeliverySelectionError(code, message || FULFILLMENT_MESSAGES[code], groupKey);
  error.httpStatus = httpStatus;
  if (extra) error.extra = extra;
  return error;
}

/** Selecția unui magazin, curățată (orice valoare necunoscută = absentă). */
export function readFulfillmentSelection(raw) {
  const f = raw?.fulfillment;
  const fulfillment = f === FULFILLMENT.ARTFEST_SAMEDAY || f === FULFILLMENT.VENDOR_COURIER ? f : null;
  const { method, oohId } = normalizeSelection(raw);
  const expected = raw?.expectedShippingCents;
  const expectedShippingCents = Number.isInteger(expected) && expected >= 0 ? expected : null;
  return { fulfillment, method, oohId, expectedShippingCents };
}

/** Metodele Sameday (adresă / easybox / Sameday Point) active acum pe contul Artfest. */
export function samedayMethods(services) {
  return ALL_METHODS.filter((m) => m === "HOME" || (services?.courierAvailable && services?.services?.[m]));
}

/**
 * Tariful Sameday prin Artfest: DOAR un tarif Sameday valid. Orice altceva
 * (lipsă, eroare, sursă diferită) -> indisponibil; NICIODATĂ tariful magazinului.
 */
export async function priceArtfestSameday({ group, validated, address, pricer, groupKey }) {
  if (typeof pricer !== "function") throw selectionError("sameday_price_unavailable", groupKey);
  let quote;
  try {
    quote = await pricer({ group, method: validated.method, serviceId: validated.serviceId, ooh: validated.ooh, place: validated.place, address });
  } catch {
    throw selectionError("sameday_price_unavailable", groupKey);
  }
  const amount = Number(quote?.amountCents);
  if (!quote || quote.source !== PRICING_SOURCES.SAMEDAY || !Number.isInteger(amount) || amount < 0) {
    throw selectionError("sameday_price_unavailable", groupKey);
  }
  const carrier = Number(quote.carrierCostCents);
  return {
    priceCents: amount,
    pricingSource: PRICING_SOURCES.SAMEDAY,
    carrierCostCents: Number.isInteger(carrier) && carrier >= 0 ? carrier : null,
  };
}

/**
 * Transportul coșului, per magazin.
 * @param {Object}   o
 * @param {Array}    o.groups        buildCheckoutGroups(...)
 * @param {Object}   o.selections    { [serviceId]: selecția clientului }
 * @param {Object}   o.address       adresa normalizată
 * @param {Object}   o.availability  checkoutSamedayAvailability(...)
 * @param {Function} o.getCatalog    () => deliveryCatalog
 * @param {Function} o.pricer        tariful Sameday (samedayCheckoutPricer.js)
 * @param {boolean}  o.placing       true la plasare (revalidare live, fără preselectare, erori 409)
 */
export async function quoteCheckoutShipping({ groups, selections = {}, address = null, availability = null, getCatalog = null, pricer = null, placing = false }) {
  const byService = availability?.byService || {};
  const wanted = (g) => readFulfillmentSelection(selections?.[String(g.serviceId)]).fulfillment === FULFILLMENT.ARTFEST_SAMEDAY;
  // catalogul Sameday doar dacă vreun magazin chiar îl folosește
  const needsCatalog = groups.some((g) => byService[String(g.serviceId)]?.available && (!placing || wanted(g)));
  let cat = null;
  let services = { courierAvailable: false, services: {} };
  if (needsCatalog) {
    try {
      cat = getCatalog ? getCatalog() : null;
      services = cat ? await cat.getServices() : services;
    } catch {
      services = { courierAvailable: false, services: {} };
    }
  }

  const shipments = await Promise.all(
    groups.map(async (g) => {
      const key = String(g.serviceId);
      const sel = readFulfillmentSelection(selections?.[key]);
      const wantsSameday = sel.fulfillment === FULFILLMENT.ARTFEST_SAMEDAY;
      const avail = byService[key] || null;
      const vendorPricing = priceGroupShipping(g);
      const vendorOption = {
        available: true,
        price: dec(vendorPricing.priceCents / 100),
        qualifiesFreeShipping: vendorPricing.qualifiesFreeShipping,
        paymentMethods: ["COD", "CARD"],
      };
      const base = {
        serviceId: g.serviceId,
        vendorId: g.vendorId,
        lockerId: null,
        estimatedShippingFee: dec(vendorPricing.estimatedShippingFeeCents / 100),
        freeShippingThreshold: vendorPricing.freeShippingThresholdCents != null ? dec(vendorPricing.freeShippingThresholdCents / 100) : null,
        shippingNotes: g.shippingNotes || null,
        vendorSubtotal: dec(vendorPricing.vendorSubtotalCents / 100),
      };

      // opțiunea Sameday a magazinului (la plasare: doar dacă e cea aleasă)
      let sameday = null;
      if (avail?.offered && (!placing || wantsSameday)) {
        if (!avail.available) {
          sameday = { blockedCode: avail.reason || "sameday_unavailable", option: { available: false, price: null, reason: avail.reason, message: avail.message, paymentMethods: ["CARD"] } };
        } else {
          try {
            const validated = await validateGroupSelection({
              selection: { method: wantsSameday ? sel.method : "HOME", oohId: sel.oohId },
              address,
              catalog: cat,
              services,
              groupKey: key,
              liveOoh: placing && wantsSameday,
            });
            const pricing = await priceArtfestSameday({ group: g, validated, address, pricer, groupKey: key });
            sameday = {
              validated,
              pricing,
              option: { available: true, price: dec(pricing.priceCents / 100), methods: samedayMethods(services), paymentMethods: ["CARD"] },
            };
          } catch (error) {
            if (!(error instanceof DeliverySelectionError)) throw error;
            // locația / adresa aleasă pentru Sameday: aceleași erori ca până acum
            if (wantsSameday && error.code !== "sameday_price_unavailable") throw error;
            sameday = {
              blockedCode: error.code,
              option: { available: false, price: null, reason: error.code, message: error.message, methods: samedayMethods(services), paymentMethods: ["CARD"] },
            };
          }
        }
      }
      const fulfillmentOptions = { VENDOR_COURIER: vendorOption, ...(sameday ? { ARTFEST_SAMEDAY: sameday.option } : {}) };

      let chosen;
      let preselected = false;
      if (wantsSameday) {
        if (!sameday?.pricing) {
          // ales Sameday, indisponibil acum: fără schimbare tăcută
          const code = sameday?.blockedCode === "sameday_price_unavailable" || sameday?.blockedCode === "cart_not_card_capable" ? sameday.blockedCode : "sameday_unavailable";
          if (placing) throw selectionError(code === "sameday_price_unavailable" ? code : "sameday_unavailable", key, { httpStatus: 409, message: FULFILLMENT_MESSAGES[code] });
          return {
            ...base,
            fulfillment: null,
            selectedFulfillment: null,
            preselected: false,
            method: "COURIER",
            delivery: null,
            publicDelivery: null,
            price: null,
            priceUnavailable: true,
            priceUnavailableMessage: FULFILLMENT_MESSAGES[code],
            samedayUnavailable: { code, message: FULFILLMENT_MESSAGES[code] },
            qualifiesFreeShipping: false,
            fulfillmentOptions,
          };
        }
        chosen = FULFILLMENT.ARTFEST_SAMEDAY;
      } else if (sel.fulfillment === FULFILLMENT.VENDOR_COURIER) {
        chosen = FULFILLMENT.VENDOR_COURIER;
      } else if (!placing && sameday?.pricing) {
        chosen = FULFILLMENT.ARTFEST_SAMEDAY;
        preselected = true;
      } else {
        chosen = FULFILLMENT.VENDOR_COURIER;
      }

      if (chosen === FULFILLMENT.ARTFEST_SAMEDAY) {
        const { validated, pricing } = sameday;
        const delivery = buildDeliverySnapshot({
          validated,
          address,
          priceCents: pricing.priceCents,
          pricingSource: pricing.pricingSource,
          fallbackReason: null,
          carrierCostCents: pricing.carrierCostCents,
        });
        return {
          ...base,
          fulfillment: FULFILLMENT.ARTFEST_SAMEDAY,
          selectedFulfillment: FULFILLMENT.ARTFEST_SAMEDAY,
          preselected,
          // câmpul vechi Shipment.method: easybox și Sameday Point = livrare la punct fix
          method: validated.method === "HOME" ? "COURIER" : "LOCKER",
          delivery,
          publicDelivery: publicDelivery(delivery),
          price: dec(pricing.priceCents / 100),
          qualifiesFreeShipping: false,
          fulfillmentOptions,
        };
      }

      // curierul magazinului: doar livrare la adresă (punctele fixe sunt doar Sameday prin Artfest)
      if (placing && sel.method !== "HOME") {
        throw selectionError("delivery_method_unavailable", key, { message: FULFILLMENT_MESSAGES.vendor_courier_method });
      }
      return {
        ...base,
        // null = alegere neexplicită (checkout vechi) -> exact comportamentul de până acum
        fulfillment: sel.fulfillment === FULFILLMENT.VENDOR_COURIER ? FULFILLMENT.VENDOR_COURIER : null,
        selectedFulfillment: FULFILLMENT.VENDOR_COURIER,
        preselected: false,
        method: "COURIER",
        delivery: null,
        publicDelivery: null,
        price: vendorOption.price,
        qualifiesFreeShipping: vendorPricing.qualifiesFreeShipping,
        fulfillmentOptions,
      };
    })
  );

  return {
    shipments,
    totalShipping: dec(shipments.reduce((s, x) => s + Number(x.price || 0), 0)),
    currency: "RON",
    // Sameday ales la cel puțin un magazin -> toată comanda doar cu cardul
    requiresCard: shipments.some((s) => s.selectedFulfillment === FULFILLMENT.ARTFEST_SAMEDAY),
  };
}

/**
 * La plasare, după recalculare: plata compatibilă cu livrarea aleasă și prețul
 * transportului identic cu cel văzut de client. Aruncă DeliverySelectionError.
 */
export function assertPlacementCompatible({ quote, selections = {}, paymentMethod }) {
  const sameday = (quote?.shipments || []).filter((s) => s.fulfillment === FULFILLMENT.ARTFEST_SAMEDAY);
  if (sameday.length && paymentMethod !== "CARD") {
    throw selectionError("sameday_requires_card", String(sameday[0].serviceId));
  }
  for (const s of quote?.shipments || []) {
    const { expectedShippingCents } = readFulfillmentSelection(selections?.[String(s.serviceId)]);
    if (expectedShippingCents != null && expectedShippingCents !== centsOf(s.price)) {
      throw selectionError("shipping_price_changed", String(s.serviceId), { httpStatus: 409, extra: { price: dec(s.price) } });
    }
  }
}

/** Câmpul Shipment.fulfillment la crearea expedierii (null -> câmpul nu se scrie). */
export function shipmentFulfillmentData(quotedShipment) {
  const f = quotedShipment?.fulfillment;
  return f === FULFILLMENT.ARTFEST_SAMEDAY || f === FULFILLMENT.VENDOR_COURIER ? { fulfillment: f } : {};
}
