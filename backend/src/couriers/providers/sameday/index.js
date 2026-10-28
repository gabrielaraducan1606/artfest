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
 * Provider Sameday (doc „API custom documentation” v3.6): conectare/testare
 * cont + creare AWB (livrare la adresă, ridicare de la terț) + recuperare
 * după clientInternalReference + etichetă + link public de urmărire.
 * Sincronizarea statusului (status-sync) / lockere / PUDO / webhook-uri NU
 * sunt implementate; capabilities le marchează false.
 */

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

export class AwbNotCancellableError extends CourierError {
  constructor(message = "Sameday nu mai permite anularea acestui AWB (probabil coletul a fost deja preluat). Starea din Artfest nu a fost modificată.") {
    super("awb_not_cancellable", message, { httpStatus: 409 });
    this.name = "AwbNotCancellableError";
  }
}

// GET /api/client/pickup-points: { id, alias, county, city, address, defaultPickupPoint, pickupPointContactPerson: [...] }
function mapPickupPoint(p) {
  const contacts = Array.isArray(p?.pickupPointContactPerson) ? p.pickupPointContactPerson : [];
  return {
    id: p?.id ?? null,
    alias: p?.alias || p?.name || null,
    isDefault: p?.defaultPickupPoint === true,
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
    // etapele următoare (tracking = sincronizare status prin API):
    tracking: false,
    pickupRequest: false,
    lockers: false,
    quote: false,
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
   * PDF-ul etichetei: calea din „pdfLink” al răspunsului de creare (doc v3.6:
   * https://api.sameday.ro/api/awb/download/<AWB>), cu X-AUTH-TOKEN.
   * Formatul (A4/A6) nu e descris în documentație -> nu îl trimitem.
   */
  async getLabel(ctx, awbNumber) {
    return samedayRequest(ctx, {
      method: "GET",
      path: `/api/awb/download/${encodeURIComponent(String(awbNumber))}`,
      binary: true,
    });
  },

  /**
   * Anulare AWB: DELETE /api/awb/{awbNumber} (SDK SamedayDeleteAwbRequest).
   * Sameday refuză (400/404/422) -> AwbNotCancellableError: apelantul NU
   * modifică starea locală. Timeout / 5xx -> erorile generice (rezultat
   * necunoscut, la fel fără modificare locală).
   */
  async cancelShipment(ctx, awbNumber) {
    try {
      await samedayRequest(ctx, {
        method: "DELETE",
        path: `/api/awb/${encodeURIComponent(String(awbNumber))}`,
        allowEmpty: true,
      });
    } catch (e) {
      if (e instanceof CourierValidationError || e?.providerStatus === 404) {
        throw new AwbNotCancellableError();
      }
      throw e;
    }
    return { cancelled: true };
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
