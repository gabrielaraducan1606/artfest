// backend/src/couriers/contract.js

import { CourierValidationError } from "./errors.js";

/*
 * Contractul comun pentru orice provider de curier (Sameday, FAN, DPD,
 * Cargus, GLS...). Restul Artfest-ului lucrează DOAR prin acest contract
 * (vezi registry.js), niciodată direct cu un provider.
 *
 * @typedef {Object} CredentialField
 * @property {string}  key          - cheia în obiectul de credentiale
 * @property {string}  label        - eticheta pentru formularul generat în UI
 * @property {"text"|"password"} type
 * @property {boolean} required
 * @property {boolean} secret       - true => nu se afișează niciodată după salvare
 * @property {number}  [maxLength]
 * @property {string}  [help]
 *
 * @typedef {Object} PublicConfigField   - configurație NE-secretă (publicConfig)
 * @property {string}  key
 * @property {string}  label
 * @property {"select"|"text"} type
 * @property {boolean} required
 * @property {Array<{value:string,label:string}>} [options]
 * @property {string}  [default]
 *
 * @typedef {Object} ProviderContext
 * @property {string|null} accountId     - null la testarea unui cont încă nesalvat
 * @property {Object}      credentials   - decriptate, DOAR în memorie
 * @property {Object}      publicConfig
 *
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} ok
 * @property {Object}  [details]         - date NE-secrete (ex. puncte de ridicare)
 *
 * @typedef {Object} CourierProviderDefinition
 * @property {string} id                      - valoare din enum CourierProvider
 * @property {string} name
 * @property {string} [description]           - text scurt afișat vendorului la conectare
 * @property {CredentialField[]} credentialFields
 * @property {PublicConfigField[]} [publicConfigFields]
 * @property {Object<string, boolean>} capabilities  - vezi CAPABILITIES
 * @property {(credentials:Object) => (string|null)} credentialsHint
 * @property {(ctx:ProviderContext) => Promise<ConnectionTestResult>} testConnection
 * @property {(accountId:string) => void} [invalidateSession]
 *
 * Operații opționale (declarate în capabilities):
 *   listPickupPoints(ctx) -> [{ id, alias, isDefault, county, city }]
 *   listServices(ctx)     -> [{ id, name, code, isDefault }]
 *   createShipment(ctx, CreateShipmentInput) -> { awbNumber, parcelNumbers, cost }
 *   getLabel(ctx, awbNumber, { format }) -> { buffer, contentType }
 *
 * @typedef {Object} CreateShipmentInput
 * @property {string} clientReference     - referință Artfest trimisă curierului
 * @property {string|number} serviceId
 * @property {string|number} pickupPointId
 * @property {Array<{weightKg:number, lengthCm?:number, widthCm?:number, heightCm?:number}>} parcels
 * @property {number} codAmount           - calculat pe server (couriers/awb/codAmount.js)
 * @property {number} [declaredValue]
 * @property {{name:string, phone:string, email?:string, county:string, city:string,
 *             postalCode?:string, address:string}} recipient
 * @property {string} [lockerId]
 * @property {string} [observation]
 *
 * Etapele următoare (NU acum): trackShipments, cancelShipment,
 * requestPickup, listLockers, quote.
 */

export const CAPABILITIES = Object.freeze([
  "testConnection",
  "createShipment",
  "label",
  "tracking",
  "cancelShipment",
  "pickupRequest",
  "pickupPoints",
  "lockers",
  "cashOnDelivery",
  "quote",
  "webhooks",
]);

const REQUIRED_FUNCTIONS = ["testConnection", "credentialsHint"];

export function assertValidProviderDefinition(def) {
  if (!def || typeof def !== "object") throw new Error("courier provider: invalid definition");
  if (!def.id || !def.name) throw new Error("courier provider: id/name required");
  if (!Array.isArray(def.credentialFields) || !def.credentialFields.length) {
    throw new Error(`courier provider ${def.id}: credentialFields required`);
  }
  for (const fn of REQUIRED_FUNCTIONS) {
    if (typeof def[fn] !== "function") {
      throw new Error(`courier provider ${def.id}: ${fn}() required`);
    }
  }
  for (const key of Object.keys(def.capabilities || {})) {
    if (!CAPABILITIES.includes(key)) {
      throw new Error(`courier provider ${def.id}: unknown capability ${key}`);
    }
  }
  return def;
}

/*
 * Păstrează DOAR câmpurile declarate de provider (ignoră orice altceva
 * trimis de client), cu trim + lungime maximă + obligatorii.
 *
 * Folosit și la înlocuirea credentialelor (PATCH): tot setul e obligatoriu,
 * credentialele se înlocuiesc întotdeauna complet, nu se combină cu cele
 * vechi (nu le citim/returnăm niciodată).
 */
export function sanitizeCredentialsInput(def, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CourierValidationError("Completează datele de autentificare.", ["credentials"]);
  }

  const clean = {};
  const missing = [];

  for (const field of def.credentialFields) {
    const raw = input[field.key];
    const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw);
    const max = field.maxLength || 256;

    if (!value) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (value.length > max) {
      throw new CourierValidationError(`Câmpul „${field.label}” este prea lung.`, [field.key]);
    }
    clean[field.key] = value;
  }

  if (missing.length) {
    throw new CourierValidationError("Completează toate câmpurile obligatorii.", missing);
  }

  return clean;
}

/*
 * publicConfig: doar cheile declarate în publicConfigFields, cu valori din
 * opțiunile permise (select) sau text scurt. Nimic secret aici.
 */
export function sanitizePublicConfig(def, input, { current = {} } = {}) {
  const fields = def.publicConfigFields || [];
  const base = { ...(current || {}) };

  for (const field of fields) {
    if (base[field.key] === undefined && field.default !== undefined) {
      base[field.key] = field.default;
    }
  }

  if (input == null) return base;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new CourierValidationError("Configurația nu este validă.", ["publicConfig"]);
  }

  for (const field of fields) {
    if (!(field.key in input)) continue;
    const raw = input[field.key];

    if (field.type === "select") {
      const allowed = (field.options || []).map((o) => o.value);
      if (!allowed.includes(raw)) {
        throw new CourierValidationError(`Valoare invalidă pentru „${field.label}”.`, [field.key]);
      }
      base[field.key] = raw;
    } else {
      const value = raw == null ? "" : String(raw).trim().slice(0, 120);
      if (!value && field.required) {
        throw new CourierValidationError(`Completează „${field.label}”.`, [field.key]);
      }
      base[field.key] = value || null;
    }
  }

  return base;
}

// descrierea publică a providerului (GET /providers) - fără funcții
export function describeProvider(def) {
  return {
    id: def.id,
    name: def.name,
    ...(typeof def.description === "string" && def.description.trim()
      ? { description: def.description.trim() }
      : {}),
    credentialFields: def.credentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: !!f.required,
      secret: !!f.secret,
      maxLength: f.maxLength || 256,
      ...(f.help ? { help: f.help } : {}),
    })),
    publicConfigFields: (def.publicConfigFields || []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: !!f.required,
      ...(f.options ? { options: f.options } : {}),
      ...(f.default !== undefined ? { default: f.default } : {}),
    })),
    capabilities: Object.fromEntries(
      CAPABILITIES.map((c) => [c, !!def.capabilities?.[c]])
    ),
  };
}
