// backend/src/couriers/platformAccountSetup.js
//
// Regulile PURE (fără DB, fără rețea) pentru scriptul
// scripts/configureSamedayPlatformAccount.mjs - separarea strictă a
// conturilor PLATFORM Sameday pe medii:
//   - mediul cerut (SAMEDAY_API_ENVIRONMENT) e OBLIGATORIU, fără implicit;
//   - se scrie DOAR contul cu exact acel mediu (publicConfig.environment
//     explicit); dacă nu există, se creează un cont NOU (ID nou, credentiale
//     criptate cu ID-ul lui - nu se copiază nimic între medii);
//   - un cont din alt mediu sau fără mediu NU este modificat niciodată
//     (nici credentiale, nici mediu, nici configurație);
//   - mai multe conturi active în același mediu -> oprire (ambiguu).

import { explicitEnvironment } from "./samedayEnvironment.js";

export class PlatformSetupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformSetupError";
    this.code = code;
  }
}

/** Mediul cerut scriptului: "demo" | "production", altfel eroare (fără implicit). */
export function requireSetupEnvironment(value) {
  const environment = explicitEnvironment(value);
  if (!environment) {
    throw new PlatformSetupError(
      "environment_required",
      "SAMEDAY_API_ENVIRONMENT este obligatoriu (demo sau production). Nu există valoare implicită. Nimic nu a fost scris."
    );
  }
  return environment;
}

/**
 * Ce ar scrie scriptul pentru `environment`.
 * @param {{ environment: string, accounts: Array<{id, publicConfig, isDefault}> }} input
 *   accounts = conturile PLATFORM SAMEDAY nedezactivate
 * @returns {{ action: "update"|"create", accountId: string|null, previousConfig: Object, untouched: string[] }}
 */
export function planPlatformAccountWrite({ environment, accounts = [] }) {
  const env = requireSetupEnvironment(environment);
  const same = [];
  const untouched = [];
  for (const a of accounts) {
    if (explicitEnvironment(a?.publicConfig?.environment) === env) same.push(a);
    else untouched.push(a.id);
  }
  if (same.length > 1) {
    throw new PlatformSetupError(
      "environment_ambiguous",
      `Există ${same.length} conturi PLATFORM Sameday active în mediul ${env}. Dezactivează manual unul dintre ele. Nimic nu a fost scris.`
    );
  }
  if (same.length === 1) {
    const prev = same[0].publicConfig && typeof same[0].publicConfig === "object" ? same[0].publicConfig : {};
    return { action: "update", accountId: same[0].id, previousConfig: prev, untouched };
  }
  return { action: "create", accountId: null, previousConfig: {}, untouched };
}

/**
 * publicConfig-ul scris: mediul e cel al contului (neschimbat la update);
 * setările de tracking aprobate (statusMap, format timestamp) se păstrează
 * DOAR din contul aceluiași mediu.
 */
export function buildPlatformPublicConfig({ environment, input = {}, previousConfig = {} }) {
  const env = requireSetupEnvironment(environment);
  const kept = Object.fromEntries(
    ["statusMap", "statusSyncTimestampFormat", "lockerServiceId", "pudoServiceId"]
      .filter((k) => previousConfig[k] !== undefined)
      .map((k) => [k, previousConfig[k]])
  );
  return {
    ...kept,
    environment: env,
    pickupPointId: input.pickupPointId || null,
    contactPersonId: input.contactPersonId || null,
    serviceId: input.serviceId || null,
  };
}
