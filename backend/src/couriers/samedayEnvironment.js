// backend/src/couriers/samedayEnvironment.js
//
// Separarea STRICTĂ a mediilor Sameday (demo / production). Un singur loc de
// decizie, folosit de clientul HTTP (providers/sameday/client.js ->
// resolveBaseUrl, prin care trec TOATE apelurile: autentificare, servicii,
// nomenclator, OOH, estimare cost, AWB, etichetă, anulare, status-sync,
// verificarea Admin, scripturile), de selecția contului PLATFORM
// (platformAccount.js) și de operațiile pe AWB-uri existente (awbService.js).
//
// Reguli (fără valori implicite):
//   SAMEDAY_ACTIVE_ENVIRONMENT = "demo" | "production"  - OBLIGATORIU pe server.
//     Lipsă / altă valoare -> niciun cont PLATFORM selectat și niciun apel la
//     Sameday (eroare `active_environment_missing`, înainte de rețea).
//   Mediul unui cont (publicConfig.environment) trebuie să fie EXPLICIT și
//     identic cu mediul activ; lipsă != production.
//   Production din DEV / local (NODE_ENV != "production") -> refuzat, cu
//     excepția aprobării explicite SAMEDAY_ALLOW_PRODUCTION_FROM_NONPROD=1.
//   Demo pe un server de producție (NODE_ENV = "production") -> refuzat, cu
//     excepția COURIER_ALLOW_SANDBOX=1 (regula existentă).
// Decizia folosește DOAR env-ul procesului - niciun apel extern.

import { CourierValidationError } from "./errors.js";

export const SAMEDAY_ENVIRONMENTS = Object.freeze(["demo", "production"]);

export const SAMEDAY_BASE_URLS = Object.freeze({
  production: "https://api.sameday.ro",
  demo: "https://sameday-api.demo.zitec.com",
});

export const SAMEDAY_ENVIRONMENT_REASONS = Object.freeze({
  ACTIVE_MISSING: "active_environment_missing",
  ACCOUNT_MISSING: "account_environment_missing",
  MISMATCH: "environment_mismatch",
  PRODUCTION_FROM_NONPROD: "production_blocked_outside_production",
  DEMO_ON_PRODUCTION: "demo_blocked_on_production",
  AWB_UNKNOWN: "awb_environment_unknown",
  AWB_MISMATCH: "awb_environment_mismatch",
});

const MESSAGES = {
  active_environment_missing: "Mediul Sameday activ (SAMEDAY_ACTIVE_ENVIRONMENT) nu este setat pe server. Integrarea Sameday este oprită.",
  account_environment_missing: "Contul Sameday nu are mediul (demo / production) setat explicit. Nu este folosit.",
  environment_mismatch: "Contul Sameday aparține altui mediu decât cel activ pe server. Nu este folosit.",
  production_blocked_outside_production: "Accesul la Sameday Production este blocat în afara serverului de producție.",
  demo_blocked_on_production: "Mediul de test Sameday nu este disponibil pe serverul de producție.",
  awb_environment_unknown: "AWB-ul nu are mediul Sameday salvat. Operația este blocată până la verificarea manuală a AWB-ului.",
  awb_environment_mismatch: "AWB-ul a fost creat în alt mediu Sameday decât cel activ. Operația este blocată.",
};

/**
 * Mediul nu permite apelul. Extinde CourierValidationError (eșec SIGUR,
 * nimic trimis la Sameday) - aceeași semantică pe care o aveau erorile de
 * mediu din resolveBaseUrl.
 */
export class SamedayEnvironmentError extends CourierValidationError {
  constructor(reason) {
    super(MESSAGES[reason] || MESSAGES.active_environment_missing, ["environment"]);
    this.name = "SamedayEnvironmentError";
    this.code = "sameday_environment_blocked";
    this.reason = reason;
    // AWB existent din alt mediu / fără mediu: conflict de stare; altfel configurare server
    this.httpStatus = reason === "awb_environment_unknown" || reason === "awb_environment_mismatch" ? 409 : 503;
  }
}

const norm = (v) => String(v ?? "").trim().toLowerCase();

/** Mediul activ al serverului: "demo" | "production" | null (fără implicit). */
export function activeSamedayEnvironment(env = process.env) {
  const value = norm(env.SAMEDAY_ACTIVE_ENVIRONMENT);
  return SAMEDAY_ENVIRONMENTS.includes(value) ? value : null;
}

/** Mediul declarat explicit (cont / AWB): "demo" | "production" | null. */
export function explicitEnvironment(value) {
  const v = norm(value);
  return SAMEDAY_ENVIRONMENTS.includes(v) ? v : null;
}

/**
 * Motivul pentru care `environment` NU poate fi folosit acum, sau null.
 * Fără excepții - pentru afișare / selecție.
 */
export function samedayEnvironmentIssue(environment, env = process.env) {
  const active = activeSamedayEnvironment(env);
  if (!active) return SAMEDAY_ENVIRONMENT_REASONS.ACTIVE_MISSING;
  const wanted = explicitEnvironment(environment);
  if (!wanted) return SAMEDAY_ENVIRONMENT_REASONS.ACCOUNT_MISSING;
  if (wanted !== active) return SAMEDAY_ENVIRONMENT_REASONS.MISMATCH;
  const isProdServer = norm(env.NODE_ENV) === "production";
  if (wanted === "production" && !isProdServer && env.SAMEDAY_ALLOW_PRODUCTION_FROM_NONPROD !== "1") {
    return SAMEDAY_ENVIRONMENT_REASONS.PRODUCTION_FROM_NONPROD;
  }
  if (wanted === "demo" && isProdServer && env.COURIER_ALLOW_SANDBOX !== "1") {
    return SAMEDAY_ENVIRONMENT_REASONS.DEMO_ON_PRODUCTION;
  }
  return null;
}

export function samedayEnvironmentMessage(reason) {
  return MESSAGES[reason] || null;
}

/**
 * URL-ul de bază pentru `environment`, DOAR dacă e permis acum; altfel
 * SamedayEnvironmentError (înainte de orice cerere).
 */
export function assertSamedayEnvironment(environment, env = process.env) {
  const reason = samedayEnvironmentIssue(environment, env);
  if (reason) throw new SamedayEnvironmentError(reason);
  return SAMEDAY_BASE_URLS[explicitEnvironment(environment)];
}

/**
 * Mediul salvat pe un AWB existent (CourierAwb.providerMeta.environment) vs.
 * mediul contului cu care s-ar face operația. AWB-urile vechi (fără mediu)
 * NU sunt presupuse production: blocate (`awb_environment_unknown`).
 * @returns {string|null} motivul blocării sau null
 */
export function awbEnvironmentIssue(row, accountEnvironment) {
  const saved = explicitEnvironment(row?.providerMeta?.environment);
  if (!saved) return SAMEDAY_ENVIRONMENT_REASONS.AWB_UNKNOWN;
  if (saved !== explicitEnvironment(accountEnvironment)) return SAMEDAY_ENVIRONMENT_REASONS.AWB_MISMATCH;
  return null;
}
