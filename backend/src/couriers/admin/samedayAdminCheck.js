// backend/src/couriers/admin/samedayAdminCheck.js
//
// Starea integrării Sameday pentru pagina Admin „Curieri”.
//
// Trei niveluri, raportate SEPARAT (nu un singur „OK”):
//   A. credentialele API din env (SAMEDAY_API_USERNAME / SAMEDAY_API_PASSWORD) - doar prezență;
//   B. contul PLATFORM din DB (CourierAccount) - cel folosit de checkout / AWB;
//   C. conexiunea reală, DOAR la „Verifică conexiunea”, strict read-only:
//        POST /api/authenticate -> GET /api/client/pickup-points -> GET /api/client/services
//      (fără AWB, fără estimate-cost, fără scrieri în DB / configurație).
//
// Siguranță:
//   - mediul vine DOAR de pe server (contul PLATFORM, altfel SAMEDAY_API_ENVIRONMENT);
//     nu se schimbă din UI și nu se schimbă automat; trebuie să fie egal cu
//     SAMEDAY_ACTIVE_ENVIRONMENT și permis pe acest server (couriers/samedayEnvironment.js),
//     altfel niciun request;
//   - Production NU se verifică fără COURIER_ADMIN_CHECK_ALLOW_PRODUCTION=1
//     (aprobare explicită) - fără request;
//   - răspunsul nu conține username / parolă / token / credentiale criptate;
//     din persoanele de contact doar id + nume (fără telefon, email, CNP);
//   - în loguri doar codul erorii.

import { prisma as defaultDb } from "../../db.js";
import { findPlatformCourierAccount, platformConfig } from "../platformAccount.js";
import { openCredentials } from "../credentials/store.js";
import { getSamedaySession, samedayGet } from "../providers/sameday/client.js";
import { mapSamedayService } from "../providers/sameday/awbMapper.js";
import { classifySamedayServices } from "../providers/sameday/catalog.js";
import { CourierAuthError, CourierTimeoutError, CourierUnavailableError, CourierValidationError } from "../errors.js";
import { activeSamedayEnvironment, samedayEnvironmentIssue, samedayEnvironmentMessage } from "../samedayEnvironment.js";

export const COURIER_STATUS = Object.freeze({
  CONNECTED: "CONNECTED",
  NOT_CONNECTED: "NOT_CONNECTED",
  INCOMPLETE: "INCOMPLETE",
  AUTH_ERROR: "AUTH_ERROR",
  UNAVAILABLE: "UNAVAILABLE",
  UNTESTED: "UNTESTED",
});

export const ENVIRONMENTS = Object.freeze(["demo", "production"]);

const ENV_LABEL = { demo: "Demo", production: "Production" };

const clean = (v) => String(v ?? "").trim();

/** Sursa credentialelor + mediul, fără niciun apel extern și fără secrete. */
export async function describeSamedaySetup({ db = defaultDb, env = process.env } = {}) {
  const envCredentials = Boolean(clean(env.SAMEDAY_API_USERNAME) && clean(env.SAMEDAY_API_PASSWORD));

  let account = null;
  try {
    account = await findPlatformCourierAccount(db, env);
    if (account && account.provider !== "SAMEDAY") account = null;
  } catch {
    account = null;
  }

  let platformAccount = "missing";
  if (account) {
    if (account.status === "INVALID_CREDENTIALS") platformAccount = "invalid_credentials";
    else if (account.status !== "ACTIVE") platformAccount = "inactive";
    else platformAccount = "configured";
  }
  const cfg = account ? platformConfig(account) : null;

  // mediul: contul PLATFORM (folosit de checkout), altfel env-ul serverului; fără valoare -> necunoscut
  const envVar = clean(env.SAMEDAY_API_ENVIRONMENT).toLowerCase();
  const environment = cfg?.environment || (ENVIRONMENTS.includes(envVar) ? envVar : null);
  const environmentSource = cfg ? "platform_account" : environment ? "server_env" : null;

  return {
    account,
    activeEnvironment: activeSamedayEnvironment(env),
    envCredentials,
    platformAccount,
    environment,
    environmentSource,
    configuration: {
      pickupPointId: cfg?.pickupPointId || null,
      contactPersonId: cfg?.contactPersonId || null,
      homeServiceId: cfg?.serviceId || null,
      lockerServiceId: clean(account?.publicConfig?.lockerServiceId) || null,
      pudoServiceId: clean(account?.publicConfig?.pudoServiceId) || null,
    },
  };
}

/** Persoanele de contact: doar id + nume (Swagger întoarce și telefon / email / CNP - nu pleacă în UI). */
function safeContacts(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list
    .filter((c) => c && c.id != null)
    .map((c) => ({ id: String(c.id), name: clean(c.name) || null, isDefault: c.defaultContactPerson === true }));
}

/** Punctul de ridicare (adresa depozitului Artfest - nu e dată personală a unui client). */
export function safePickupPoint(p, configuredId = null) {
  const id = p?.id != null ? String(p.id) : null;
  return {
    id,
    alias: clean(p?.alias) || null,
    address: clean(p?.address) || null,
    city: clean(p?.city?.name) || null,
    county: clean(p?.county?.name) || null,
    postalCode: clean(p?.postalCode) || null,
    isDefault: p?.defaultPickupPoint === true,
    active: p?.status !== false,
    isConfigured: Boolean(configuredId && id === String(configuredId)),
    contacts: safeContacts(p?.pickupPointContactPerson),
  };
}

const listOf = (data) => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);

/**
 * Evaluarea, după un răspuns reușit de la Sameday. Pură (testabilă).
 * @returns {{ status, message, issues: {code,message}[], services, pickupPoints }}
 */
export function evaluateSamedayCheck({ setup, pickupPoints = [], services = [] }) {
  const cfg = setup.configuration;
  const issues = [];
  const classified = classifySamedayServices(services, {
    serviceId: cfg.homeServiceId,
    lockerServiceId: cfg.lockerServiceId,
    pudoServiceId: cfg.pudoServiceId,
  });
  const svc = (method) => (classified[method] ? { active: true, id: classified[method].id, name: classified[method].name, source: classified[method].source } : { active: false, id: null, name: null, source: null });
  const servicesView = { HOME: svc("HOME"), LOCKER: svc("LOCKER"), PUDO: svc("PUDO") };

  const points = pickupPoints.map((p) => safePickupPoint(p, cfg.pickupPointId));
  const configured = points.find((p) => p.isConfigured) || null;

  if (setup.platformAccount !== "configured") {
    issues.push({ code: "platform_account_missing", message: "Contul PLATFORM Sameday nu este configurat în baza de date (checkout-ul nu îl poate folosi încă)." });
  }
  if (!points.length) {
    issues.push({ code: "no_pickup_points", message: "Contul Sameday nu are niciun punct de ridicare." });
  } else if (!cfg.pickupPointId) {
    issues.push({ code: "pickup_point_not_configured", message: "Punctul de ridicare Artfest nu este ales în configurație." });
  } else if (!configured) {
    issues.push({ code: "pickup_point_not_found", message: "Punctul de ridicare configurat nu există în contul Sameday." });
  } else if (!configured.active) {
    issues.push({ code: "pickup_point_inactive", message: "Punctul de ridicare configurat este dezactivat în contul Sameday." });
  }
  if (configured && cfg.contactPersonId && !configured.contacts.some((c) => c.id === String(cfg.contactPersonId))) {
    issues.push({ code: "contact_person_invalid", message: "Persoana de contact configurată nu aparține punctului de ridicare." });
  }
  if (!services.length) {
    issues.push({ code: "no_services", message: "Contul Sameday nu are servicii active." });
  } else if (!servicesView.HOME.active) {
    issues.push({ code: "home_service_missing", message: "Serviciul de livrare la adresă (24H) nu este activ pe cont." });
  }
  if (servicesView.HOME.active && cfg.homeServiceId && servicesView.HOME.source !== "config") {
    issues.push({ code: "home_service_config_mismatch", message: "Serviciul de livrare configurat nu este activ pe cont; se folosește serviciul recunoscut după denumire." });
  } else if (servicesView.HOME.active && !cfg.homeServiceId) {
    issues.push({ code: "home_service_not_configured", message: "Serviciul de livrare la adresă nu este ales în configurație (necesar la AWB)." });
  }

  const status = issues.length ? COURIER_STATUS.INCOMPLETE : COURIER_STATUS.CONNECTED;
  return {
    status,
    message: status === COURIER_STATUS.CONNECTED ? "Conexiunea cu Sameday funcționează." : "Autentificarea a reușit, dar configurarea este incompletă.",
    issues,
    services: servicesView,
    allServices: services.map((s) => ({ id: String(s.id), name: s.name || null, deliveryType: s.deliveryType || null })),
    pickupPoints: points,
  };
}

/** Eroare Sameday -> status + mesaj sigur (fără textul brut al API-ului). */
export function statusForError(error, environment) {
  const envLabel = ENV_LABEL[environment] || "configurat";
  if (error instanceof CourierAuthError) {
    return {
      status: COURIER_STATUS.AUTH_ERROR,
      code: "auth_rejected",
      message: environment === "demo" ? "Autentificarea a fost respinsă pe mediul Demo." : `Credentialele nu au fost acceptate pe mediul ${envLabel}.`,
    };
  }
  if (error instanceof CourierTimeoutError) {
    return { status: COURIER_STATUS.UNAVAILABLE, code: "timeout", message: "Sameday nu a răspuns la timp. Încearcă din nou mai târziu." };
  }
  if (error instanceof CourierUnavailableError) {
    return { status: COURIER_STATUS.UNAVAILABLE, code: "unavailable", message: "Sameday este indisponibil temporar. Încearcă din nou mai târziu." };
  }
  if (error instanceof CourierValidationError) {
    return { status: COURIER_STATUS.INCOMPLETE, code: "environment_invalid", message: "Mediul Sameday configurat pe server nu poate fi folosit pentru verificare." };
  }
  return { status: COURIER_STATUS.UNAVAILABLE, code: "unexpected", message: "Verificarea nu a putut fi finalizată. Încearcă din nou mai târziu." };
}

/**
 * Verificarea reală, read-only. Nu scrie nimic în DB.
 * @param {Object} [deps]  injectate în teste: db, env, client { getSession, get }, now
 */
export async function checkSameday({ db = defaultDb, env = process.env, client = null, now = () => new Date() } = {}) {
  const setup = await describeSamedaySetup({ db, env });
  const started = Date.now();
  const base = {
    environment: setup.environment,
    environmentSource: setup.environmentSource,
    credentials: { env: setup.envCredentials ? "available" : "missing", platformAccount: setup.platformAccount, testedWith: null },
    configuration: setup.configuration,
    checkedAt: now().toISOString(),
  };

  // credentialele cu care testăm: întâi contul PLATFORM (cel folosit de checkout), altfel env
  let credentials = null;
  let testedWith = null;
  let accountId = null;
  if (setup.account && setup.platformAccount !== "inactive") {
    try {
      credentials = openCredentials(setup.account);
      testedWith = "platform_account";
      accountId = setup.account.id;
    } catch {
      credentials = null;
    }
  }
  if (!credentials && setup.envCredentials) {
    credentials = { username: clean(env.SAMEDAY_API_USERNAME), password: clean(env.SAMEDAY_API_PASSWORD) };
    testedWith = "server_env";
    // cheie de sesiune separată (tokenul nu se amestecă cu al contului PLATFORM)
    accountId = "admin-check:SAMEDAY:server_env";
  }

  if (!credentials) {
    return { ...base, status: COURIER_STATUS.NOT_CONNECTED, code: "credentials_missing", message: "Nu există credentiale API Sameday pe server.", issues: [], services: null, pickupPoints: [] };
  }
  base.credentials.testedWith = testedWith;

  if (!setup.environment) {
    return { ...base, status: COURIER_STATUS.INCOMPLETE, code: "environment_missing", message: "Mediul Sameday (Demo / Production) nu este setat pe server.", issues: [], services: null, pickupPoints: [] };
  }
  // mediul activ lipsă / alt mediu / production din DEV -> niciun request
  const envIssue = samedayEnvironmentIssue(setup.environment, env);
  if (envIssue) {
    return { ...base, status: COURIER_STATUS.INCOMPLETE, code: envIssue, message: samedayEnvironmentMessage(envIssue), issues: [], services: null, pickupPoints: [] };
  }
  // Production: doar cu aprobare explicită, setată pe server - altfel niciun request
  if (setup.environment === "production" && env.COURIER_ADMIN_CHECK_ALLOW_PRODUCTION !== "1") {
    return {
      ...base,
      status: COURIER_STATUS.UNTESTED,
      code: "production_check_not_allowed",
      message: "Verificarea pe mediul Production nu este activată pe server. Necesită aprobare explicită.",
      issues: [],
      services: null,
      pickupPoints: [],
    };
  }

  const api = client || { getSession: getSamedaySession, get: samedayGet };
  const ctx = { accountId, credentials, publicConfig: { environment: setup.environment } };
  try {
    await api.getSession(ctx, { forceRefresh: true });
    const pickupData = await api.get(ctx, "/api/client/pickup-points?page=1&countPerPage=50");
    const servicesData = await api.get(ctx, "/api/client/services?page=1&countPerPage=500");
    const services = listOf(servicesData).map(mapSamedayService).filter((s) => s.id != null);
    const evaluated = evaluateSamedayCheck({ setup, pickupPoints: listOf(pickupData).slice(0, 50), services });
    return { ...base, ...evaluated, code: evaluated.status === COURIER_STATUS.CONNECTED ? "ok" : "incomplete", durationMs: Date.now() - started };
  } catch (error) {
    const mapped = statusForError(error, setup.environment);
    // în log doar codul (fără credentiale / token / răspuns brut)
    console.warn(`[admin/couriers] verificare Sameday: ${mapped.code}`);
    return { ...base, ...mapped, issues: [], services: null, pickupPoints: [], durationMs: Date.now() - started };
  }
}

/** Starea fără apel extern (pentru încărcarea paginii). */
export async function describeSamedayStatus({ db = defaultDb, env = process.env } = {}) {
  const setup = await describeSamedaySetup({ db, env });
  return {
    environment: setup.environment,
    environmentSource: setup.environmentSource,
    activeEnvironment: setup.activeEnvironment,
    credentials: { env: setup.envCredentials ? "available" : "missing", platformAccount: setup.platformAccount, testedWith: null },
    configuration: setup.configuration,
    productionCheckAllowed: env.COURIER_ADMIN_CHECK_ALLOW_PRODUCTION === "1",
  };
}
