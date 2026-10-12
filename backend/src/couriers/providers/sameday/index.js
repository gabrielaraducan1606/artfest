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
import { buildSamedayAwbForm, parseSamedayAwbResponse, mapSamedayService } from "./awbMapper.js";

/*
 * Provider Sameday: conectare/testare cont + creare AWB + etichetă +
 * anulare AWB + link public de urmărire. Sincronizarea statusului
 * (tracking prin API) / pickup / lockers vin în etapele următoare;
 * capabilities le marchează false până sunt implementate.
 */

const LABEL_FORMATS = new Set(["A4", "A6"]);

// pagina publică de urmărire Sameday (DE VALIDAT pe demo, vezi checklist)
const SAMEDAY_TRACKING_BASE = "https://www.sameday.ro/#awb=";
// numerele AWB Sameday sunt alfanumerice; orice altceva -> fără link
const AWB_NUMBER_RE = /^[A-Za-z0-9]{4,40}$/;

export class AwbNotCancellableError extends CourierError {
  constructor(message = "Sameday nu mai permite anularea acestui AWB (probabil coletul a fost deja preluat). Starea din Artfest nu a fost modificată.") {
    super("awb_not_cancellable", message, { httpStatus: 409 });
    this.name = "AwbNotCancellableError";
  }
}

function mapPickupPoint(p) {
  return {
    id: p?.id ?? null,
    alias: p?.alias || p?.name || null,
    isDefault: !!(p?.defaultPickupPoint ?? p?.default),
    county: p?.county?.name || null,
    city: p?.city?.name || null,
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
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    return {
      ok: true,
      details: {
        pickupPoints: list.slice(0, 50).map(mapPickupPoint),
      },
    };
  },

  async listPickupPoints(ctx) {
    const data = await samedayGet(ctx, "/api/client/pickup-points?page=1&countPerPage=50");
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list.map(mapPickupPoint).filter((p) => p.id != null);
  },

  async listServices(ctx) {
    const data = await samedayGet(ctx, "/api/client/services?page=1&countPerPage=50");
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list.map(mapSamedayService).filter((s) => s.id != null);
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

  // PDF-ul poate fi descărcat oricând după numărul AWB (fără stocare la noi)
  async getLabel(ctx, awbNumber, { format = "A6" } = {}) {
    const fmt = LABEL_FORMATS.has(format) ? format : "A6";
    return samedayRequest(ctx, {
      method: "GET",
      path: `/api/awb/download/${encodeURIComponent(String(awbNumber))}/${fmt}`,
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
