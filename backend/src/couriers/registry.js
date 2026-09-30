// backend/src/couriers/registry.js

import { assertValidProviderDefinition, describeProvider } from "./contract.js";
import { CourierProviderNotSupportedError } from "./errors.js";
import { samedayProvider } from "./providers/sameday/index.js";

/*
 * Registry-ul providerilor de curier. Cheia = valoarea din enum-ul Prisma
 * CourierProvider. Se înregistrează DOAR providerii implementați efectiv -
 * FAN_COURIER / DPD / CARGUS / GLS există în enum, dar nu apar în
 * GET /providers și nu pot fi conectați până nu au un adaptor aici.
 *
 * Adăugare provider nou: providers/<nume>/index.js care respectă
 * contract.js + o linie în PROVIDERS.
 */

const PROVIDERS = new Map(
  [samedayProvider].map((def) => [def.id, assertValidProviderDefinition(def)])
);

export function getCourierProvider(id) {
  const def = PROVIDERS.get(String(id || "").toUpperCase());
  if (!def) throw new CourierProviderNotSupportedError();
  return def;
}

export function isCourierProviderSupported(id) {
  return PROVIDERS.has(String(id || "").toUpperCase());
}

export function listCourierProviders() {
  return [...PROVIDERS.values()].map(describeProvider);
}

// invalidează sesiunea cache-uită a unui cont (credentiale înlocuite / cont șters)
export function invalidateCourierSession(providerId, accountId) {
  const def = PROVIDERS.get(String(providerId || "").toUpperCase());
  def?.invalidateSession?.(accountId);
}
