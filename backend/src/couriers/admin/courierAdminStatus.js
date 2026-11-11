// backend/src/couriers/admin/courierAdminStatus.js
//
// Pagina Admin „Curieri” - strat GENERIC, multi-curier:
//   - fiecare curier are un adaptor { describe(), check() } (azi doar Sameday);
//   - curierii din enum-ul CourierProvider fără adaptor apar „În curând”;
//   - ultimul rezultat al verificării stă în memoria serverului (nu în DB):
//     după o repornire, starea e „Netestat” până la o nouă verificare;
//   - „Verifică conexiunea”: o singură verificare în zbor per curier și o
//     pauză minimă între verificări (nu consumăm limita Sameday de
//     12 autentificări / IP / minut cu click-uri repetate).

import { checkSameday, COURIER_STATUS, describeSamedayStatus } from "./samedayAdminCheck.js";

export const CHECK_COOLDOWN_MS = 30_000;

/** Adaptoarele implementate. Curier nou = o intrare aici (+ modulul lui). */
export const ADMIN_COURIER_ADAPTERS = Object.freeze({
  SAMEDAY: { name: "Sameday", describe: describeSamedayStatus, check: checkSameday },
});

/** Ordinea afișată; cei fără adaptor = „În curând” (valori din enum-ul Prisma CourierProvider). */
export const ADMIN_COURIER_ORDER = Object.freeze([
  ["SAMEDAY", "Sameday"],
  ["FAN_COURIER", "Fan Courier"],
  ["CARGUS", "Cargus"],
  ["GLS", "GLS"],
  ["DPD", "DPD"],
]);

export function createCourierAdminService({ adapters = ADMIN_COURIER_ADAPTERS, cooldownMs = CHECK_COOLDOWN_MS, now = () => Date.now() } = {}) {
  const lastResults = new Map();
  const inflight = new Map();

  async function describe(providerId, deps = {}) {
    const adapter = adapters[providerId];
    const name = adapter?.name || ADMIN_COURIER_ORDER.find(([id]) => id === providerId)?.[1] || providerId;
    if (!adapter) return { provider: providerId, name, implemented: false };
    const last = lastResults.get(providerId) || null;
    const setup = await adapter.describe(deps);
    return {
      provider: providerId,
      name,
      implemented: true,
      ...setup,
      // starea vine DOAR dintr-o verificare reală; altfel „Netestat” (sau „Neconectat” fără credentiale)
      status: last?.status || (setup.credentials.env === "missing" && setup.credentials.platformAccount === "missing" ? COURIER_STATUS.NOT_CONNECTED : COURIER_STATUS.UNTESTED),
      lastCheck: last,
    };
  }

  async function list(deps = {}) {
    return Promise.all(ADMIN_COURIER_ORDER.map(([id]) => describe(id, deps)));
  }

  /**
   * @returns {Promise<{ result?: Object, throttled?: boolean, retryAfterSec?: number, notImplemented?: boolean }>}
   */
  async function check(providerId, deps = {}) {
    const adapter = adapters[providerId];
    if (!adapter) return { notImplemented: true };

    const last = lastResults.get(providerId);
    if (inflight.has(providerId)) return { result: await inflight.get(providerId) };
    if (last && now() - last.at < cooldownMs) {
      return { throttled: true, retryAfterSec: Math.ceil((cooldownMs - (now() - last.at)) / 1000), result: last };
    }

    const promise = (async () => {
      const result = await adapter.check(deps);
      const stored = { ...result, provider: providerId, at: now() };
      lastResults.set(providerId, stored);
      return stored;
    })();
    inflight.set(providerId, promise);
    try {
      return { result: await promise };
    } finally {
      inflight.delete(providerId);
    }
  }

  return { list, describe, check, _clear: () => lastResults.clear() };
}

let shared = null;
export function courierAdminService() {
  if (!shared) shared = createCourierAdminService();
  return shared;
}
