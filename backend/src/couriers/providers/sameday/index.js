// backend/src/couriers/providers/sameday/index.js

import { maskIdentifier } from "../../credentials/store.js";
import {
  getSamedaySession,
  invalidateSamedaySession,
  samedayGet,
  samedayRequest,
} from "./client.js";
import { CourierUnavailableError } from "../../errors.js";
import { buildSamedayAwbForm, parseSamedayAwbResponse, mapSamedayService } from "./awbMapper.js";

/*
 * Provider Sameday: conectare/testare cont + creare AWB + etichetă.
 * Tracking / pickup / lockers / anulare vin în etapele următoare;
 * capabilities le marchează false până sunt implementate.
 */

const LABEL_FORMATS = new Set(["A4", "A6"]);

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
      key: "username",
      label: "Utilizator eAWB Sameday",
      type: "text",
      required: true,
      secret: true,
      maxLength: 120,
      help: "Folosește datele cu care te autentifici în eAWB Sameday. Utilizatorul poate fi diferit de adresa de email.",
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
    // etapele următoare:
    tracking: false,
    cancelShipment: false,
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

  invalidateSession(accountId) {
    invalidateSamedaySession(accountId);
  },
};
