// backend/src/couriers/providers/sameday/index.js

import { maskIdentifier } from "../../credentials/store.js";
import {
  getSamedaySession,
  invalidateSamedaySession,
  samedayGet,
  samedayRequest,
} from "./client.js";
import {
  CourierError,
  CourierUnavailableError,
  CourierValidationError,
} from "../../errors.js";
import {
  buildSamedayAwbForm,
  parseSamedayAwbResponse,
  mapSamedayService,
  samedayPackageType,
  PACKAGE_TYPE_LABELS,
} from "./awbMapper.js";
import { resolveSamedayPlace } from "./geolocation.js";

/*
 * Provider Sameday - surse: „API custom documentation” v3.6 (PDF, 28.09.2026)
 * + Swagger-ul sandbox actual (prioritar unde diferă). Conectare/testare
 * cont, creare AWB (livrare la adresă, ridicare de la terț), recuperare după
 * clientInternalReference, etichetă, anulare, estimare cost, link public de
 * urmărire. status-sync / mkt-status-sync: doar apelul (fetchStatusSync),
 * fără job de sincronizare -> capabilities.tracking rămâne false.
 * Lockere / PUDO (GET /api/client/ooh-locations; /api/client/lockers e
 * deprecated în PDF) / webhook-uri NU sunt implementate.
 */

// eticheta: GET /api/awb/download/{awbNumber}/{format}/{contentType}/{disposition} (Swagger)
export const LABEL_FORMATS = Object.freeze(["A6", "A4"]);
const LABEL_CONTENT_TYPE = "pdf";
const LABEL_DISPOSITION = "attachment";

// doc v3.6, „URL tracking”: https://sameday.ro/#awb=<AWB>
const SAMEDAY_TRACKING_BASE = "https://sameday.ro/#awb=";

/*
 * Punctele de ridicare și serviciile contului „nu se schimbă” (doc v3.6,
 * recomandă salvarea lor) -> cache în memorie per cont, ca previzualizarea
 * să nu le ceară la fiecare deschidere. Cheia include contul și mediul.
 */
const ACCOUNT_DATA_TTL_MS = 30 * 60 * 1000;
const accountData = new Map();

async function cachedAccountData(ctx, kind, load) {
  if (!ctx?.accountId) return load();
  const key = `${ctx.accountId}|${ctx.publicConfig?.environment || "production"}|${kind}`;
  const hit = accountData.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  accountData.set(key, { value, expiresAt: Date.now() + ACCOUNT_DATA_TTL_MS });
  return value;
}

export function _clearSamedayAccountData() {
  accountData.clear();
}

function listOf(data) {
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}
// numerele AWB Sameday sunt alfanumerice; orice altceva -> fără link
const AWB_NUMBER_RE = /^[A-Za-z0-9]{4,40}$/;

export const AWB_NOT_CANCELLABLE_MESSAGE =
  "Sameday nu mai permite anularea acestui AWB (probabil coletul a fost deja preluat). Starea din Artfest nu a fost modificată.";
export const AWB_NOT_FOUND_AT_COURIER_MESSAGE =
  "Sameday nu a găsit acest AWB, deci nu l-a putut anula. Starea din Artfest nu a fost modificată; contactează suportul Artfest.";

export class AwbNotCancellableError extends CourierError {
  constructor(message = AWB_NOT_CANCELLABLE_MESSAGE) {
    super("awb_not_cancellable", message, { httpStatus: 409 });
    this.name = "AwbNotCancellableError";
  }
}

/*
 * GET /api/client/pickup-points: { id, alias, county, city, address,
 * defaultPickupPoint, status, pickupPointContactPerson }. Persoana de contact
 * e un OBIECT în Swagger și o LISTĂ în capturile PDF -> acceptăm ambele.
 */
function mapPickupPoint(p) {
  const raw = p?.pickupPointContactPerson;
  const contacts = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return {
    id: p?.id ?? null,
    alias: p?.alias || p?.name || null,
    isDefault: p?.defaultPickupPoint === true,
    // status false = punct dezactivat în contul Sameday
    active: p?.status !== false,
    county: p?.county?.name || null,
    city: p?.city?.name || null,
    // doar id-urile (fără nume / telefoane ale persoanelor de contact)
    contactPersonIds: contacts.map((c) => c?.id).filter((id) => id != null),
    defaultContactPersonId: contacts.find((c) => c?.defaultContactPerson === true)?.id ?? null,
  };
}

export const samedayProvider = {
  id: "SAMEDAY",
  name: "Sameday",
  description: "Pentru conectare ai nevoie de un cont contractual/eAWB Sameday.",

  credentialFields: [
    {
      // trimis NESCHIMBAT (doar fără spații la capete) ca X-Auth-Username:
      // poate fi utilizatorul eAWB sau emailul, dacă Sameday îl acceptă
      key: "username",
      label: "Utilizator eAWB sau email",
      placeholder: "ex. user123 sau nume@firma.ro",
      type: "text",
      required: true,
      secret: true,
      maxLength: 120,
      help: "Contul eAWB poate avea un nume de utilizator diferit de adresa de email folosită la onboarding.",
    },
    {
      key: "password",
      label: "Parolă eAWB Sameday",
      type: "password",
      required: true,
      secret: true,
      maxLength: 256,
    },
  ],

  publicConfigFields: [
    {
      key: "environment",
      label: "Mediu",
      type: "select",
      required: true,
      default: "production",
      options: [
        { value: "production", label: "Producție" },
        { value: "demo", label: "Test (demo)" },
      ],
    },
  ],

  capabilities: {
    testConnection: true,
    createShipment: true,
    label: true,
    cashOnDelivery: true,
    pickupPoints: true,
    cancelShipment: true,
    // POST /api/awb/estimate-cost (estimateCost) - pregătit, neintegrat în checkout
    quote: true,
    // etapele următoare (tracking = job de sincronizare; fetchStatusSync e doar apelul):
    tracking: false,
    pickupRequest: false,
    lockers: false,
    webhooks: false,
  },

  credentialsHint(credentials) {
    return maskIdentifier(credentials?.username);
  },

  /**
   * Autentificare proaspătă (verifică efectiv credentialele, nu un token
   * vechi din cache) + citirea punctelor de ridicare ale contului.
   */
  async testConnection(ctx) {
    await getSamedaySession(ctx, { forceRefresh: true });

    const data = await samedayGet(ctx, "/api/client/pickup-points?page=1&countPerPage=50");

    return {
      ok: true,
      details: {
        pickupPoints: listOf(data).slice(0, 50).map(mapPickupPoint),
      },
    };
  },

  async listPickupPoints(ctx) {
    return cachedAccountData(ctx, "pickupPoints", async () => {
      const data = await samedayGet(ctx, "/api/client/pickup-points?page=1&countPerPage=50");
      return listOf(data).map(mapPickupPoint).filter((p) => p.id != null);
    });
  },

  // serviciile ACTIVE ale contului (doc v3.6: GET /api/client/services)
  async listServices(ctx) {
    return cachedAccountData(ctx, "services", async () => {
      const data = await samedayGet(ctx, "/api/client/services?page=1&countPerPage=500");
      return listOf(data).map(mapSamedayService).filter((s) => s.id != null);
    });
  },

  // ID-urile Sameday de județ / localitate, doar la potrivire exactă (altfel null)
  resolvePlace(ctx, place) {
    return resolveSamedayPlace(ctx, place);
  },

  // tipul coletului (packageType) după greutate - aceeași regulă ca la creare
  describePackage(parcels) {
    const type = samedayPackageType(parcels);
    return type == null ? null : { type, label: PACKAGE_TYPE_LABELS[type] };
  },

  /**
   * Creează AWB-ul. Aruncă:
   * - CourierAuthError / CourierValidationError -> eșec SIGUR (nimic creat);
   * - CourierTimeoutError / CourierUnavailableError -> rezultat NECUNOSCUT.
   */
  async createShipment(ctx, input) {
    const body = await samedayRequest(ctx, {
      method: "POST",
      path: "/api/awb",
      form: buildSamedayAwbForm(input),
    });
    const parsed = parseSamedayAwbResponse(body);
    // răspuns 2xx fără număr AWB: nu știm sigur ce s-a creat
    if (!parsed) throw new CourierUnavailableError("Răspuns neașteptat de la Sameday.");
    return parsed;
  },

  /**
   * Recuperare după clientInternalReference (doc v3.6: GET
   * /api/client/awb/{clientInternalReference} - „Returns the same response
   * as AWB creation”), când răspunsul la POST /api/awb nu a ajuns la noi.
   * @returns {Promise<{awbNumber, parcelNumbers, cost}|null>} null = Sameday
   *   răspunde 404 (nu există AWB cu referința). Altă eroare -> excepție
   *   (rezultat tot necunoscut).
   */
  async findShipmentByReference(ctx, clientReference) {
    let body;
    try {
      body = await samedayGet(ctx, `/api/client/awb/${encodeURIComponent(String(clientReference))}`);
    } catch (e) {
      if (e?.providerStatus === 404) return null;
      throw e;
    }
    const parsed = parseSamedayAwbResponse(body);
    if (!parsed) throw new CourierUnavailableError("Răspuns neașteptat de la Sameday.");
    return parsed;
  },

  /*
   * Eticheta (Swagger): GET /api/awb/download/{awbNumber}/{format}/{contentType}/{disposition}
   * format A4 | A6 (implicit la noi A6), contentType pdf, disposition attachment.
   * PDF-ul v3.6 arată doar „pdfLink” = /api/awb/download/{awbNumber}.
   */
  async getLabel(ctx, awbNumber, { format = "A6" } = {}) {
    const wanted = String(format || "").toUpperCase();
    const fmt = LABEL_FORMATS.includes(wanted) ? wanted : "A6";
    return samedayRequest(ctx, {
      method: "GET",
      path: `/api/awb/download/${encodeURIComponent(String(awbNumber))}/${fmt}/${LABEL_CONTENT_TYPE}/${LABEL_DISPOSITION}`,
      binary: true,
    });
  },

  /**
   * Anulare (Swagger): DELETE /api/awb/{awbOrParcelNumber}
   *   204 -> anulat; 405 -> „AWB or Parcel cannot be canceled”; 404 -> nu există.
   * Orice altceva decât 2xx (inclusiv timeout / 5xx) -> excepție, iar apelantul
   * NU modifică starea locală.
   */
  async cancelShipment(ctx, awbNumber) {
    try {
      await samedayRequest(ctx, {
        method: "DELETE",
        path: `/api/awb/${encodeURIComponent(String(awbNumber))}`,
        allowEmpty: true,
      });
    } catch (e) {
      if (e?.providerStatus === 405 || e instanceof CourierValidationError) {
        throw new AwbNotCancellableError();
      }
      if (e?.providerStatus === 404) {
        throw new AwbNotCancellableError(AWB_NOT_FOUND_AT_COURIER_MESSAGE);
      }
      throw e;
    }
    return { cancelled: true };
  },

  /**
   * Estimare cost (Swagger): POST /api/awb/estimate-cost - aceleași câmpuri ca
   * la creare (schema AwbType2, fără clientInternalReference) ->
   * { amount, currency, time }. Pregătit pentru previzualizare / admin; NU e
   * folosit în checkout.
   */
  async estimateCost(ctx, input) {
    const body = await samedayRequest(ctx, {
      method: "POST",
      path: "/api/awb/estimate-cost",
      form: buildSamedayAwbForm(input, { forEstimate: true }),
    });
    const amount = Number(body?.amount);
    if (body?.amount == null || !Number.isFinite(amount)) {
      throw new CourierUnavailableError("Răspuns neașteptat de la Sameday.");
    }
    const time = Number(body?.time);
    return {
      amount,
      currency: body?.currency ? String(body.currency) : null,
      time: body?.time != null && Number.isFinite(time) ? time : null,
    };
  },

  /**
   * Tranzițiile de status între 2 momente (maxim 2 ore, paginat - Swagger):
   *   GET /api/client/status-sync      (AWB-urile clientului)
   *   GET /api/client/mkt-status-sync  (marketplace - etapa următoare de tracking)
   * startTimestamp / endTimestamp se trimit EXACT cum le dă apelantul: formatul
   * „string($timestamp)” nu e precizat în surse (de confirmat la sandbox).
   * Doar apelul - fără job / polling (capabilities.tracking = false).
   */
  async fetchStatusSync(ctx, { startTimestamp, endTimestamp, page = 1, countPerPage = 500 } = {}, { marketplace = false } = {}) {
    if (startTimestamp == null || endTimestamp == null || startTimestamp === "" || endTimestamp === "") {
      throw new CourierValidationError("Intervalul de sincronizare lipsește.", ["startTimestamp", "endTimestamp"]);
    }
    const q = new URLSearchParams({
      startTimestamp: String(startTimestamp),
      endTimestamp: String(endTimestamp),
      page: String(page),
      countPerPage: String(countPerPage),
    });
    const body = await samedayGet(ctx, `/api/client/${marketplace ? "mkt-status-sync" : "status-sync"}?${q}`);
    return {
      currentPage: body?.currentPage ?? null,
      perPage: body?.perPage ?? null,
      items: listOf(body).map((s) => ({
        parcelAwbNumber: s?.parcelAwbNumber ?? null,
        statusId: s?.statusId ?? null,
        status: s?.status ?? null,
        statusLabel: s?.statusLabel ?? null,
        statusState: s?.statusState ?? null,
        statusDate: s?.statusDate ?? null,
        reasonId: s?.reasonId ?? null,
        reason: s?.reason ?? null,
        inReturn: s?.inReturn === true,
        ...(marketplace ? { marketplaceId: s?.marketplaceId ?? null, sellerId: s?.sellerId ?? null } : {}),
      })),
    };
  },

  // link public de urmărire, doar pentru un număr AWB cu format sigur
  trackingUrl(awbNumber) {
    const awb = String(awbNumber || "").trim();
    return AWB_NUMBER_RE.test(awb) ? `${SAMEDAY_TRACKING_BASE}${awb}` : null;
  },

  invalidateSession(accountId) {
    invalidateSamedaySession(accountId);
  },
};
