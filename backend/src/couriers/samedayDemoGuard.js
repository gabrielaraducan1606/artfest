// backend/src/couriers/samedayDemoGuard.js
//
// Garda scriptului scripts/samedayDemoProbe.mjs (verificări DEMO aprobate
// pas cu pas). PURĂ + testabilă fără rețea:
//   - fiecare rulare = UN pas, numit explicit (--step <nume>), cu aprobarea
//     explicită --i-approve-demo-requests; pașii care CREEAZĂ / ANULEAZĂ ceva
//     în DEMO cer în plus --i-approve-demo-writes și COURIER_AWB_LIVE_ENABLED=true
//     setat de operator în comandă (scriptul nu îl setează singur);
//   - mediul: SAMEDAY_ACTIVE_ENVIRONMENT=demo, NODE_ENV != production, iar URL-ul
//     rezolvat de regula comună (samedayEnvironment.js) trebuie să fie EXACT
//     originea DEMO - verificat ÎNAINTE de orice cerere;
//   - credentiale DEMO separate (SAMEDAY_DEMO_API_USERNAME / _PASSWORD), nu
//     credentialele production și nu contul din baza de date;
//   - fetch-ul procesului e restrâns la originea DEMO: orice altă destinație
//     (inclusiv api.sameday.ro) e refuzată înainte de conectare.

import { assertSamedayEnvironment, SAMEDAY_BASE_URLS } from "./samedayEnvironment.js";

export const DEMO_ORIGIN = "https://sameday-api.demo.zitec.com";

export const DEMO_READ_STEPS = Object.freeze(["services", "pickup-points", "status-list", "status-sync-format"]);
export const DEMO_WRITE_STEPS = Object.freeze(["estimate", "awb-outbound", "awb-return", "recovery", "cancel"]);

export class DemoProbeRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "DemoProbeRefused";
  }
}

const refuse = (m) => {
  throw new DemoProbeRefused(`${m} Nicio cerere nu a fost trimisă.`);
};

/**
 * Verifică TOATE condițiile; întoarce { step, write, baseUrl, credentials }.
 * @param {{ env: Object, argv: string[] }} input
 */
export function assertDemoProbeAllowed({ env = process.env, argv = process.argv } = {}) {
  const i = argv.indexOf("--step");
  const step = i >= 0 ? String(argv[i + 1] || "") : "";
  const write = DEMO_WRITE_STEPS.includes(step);
  if (!DEMO_READ_STEPS.includes(step) && !write) {
    refuse(`Pas necunoscut. Folosește --step cu unul din: ${[...DEMO_READ_STEPS, ...DEMO_WRITE_STEPS].join(", ")}.`);
  }
  if (!argv.includes("--i-approve-demo-requests")) refuse("Lipsește aprobarea explicită --i-approve-demo-requests.");
  if (write) {
    if (!argv.includes("--i-approve-demo-writes")) refuse(`Pasul „${step}” scrie în DEMO: lipsește --i-approve-demo-writes.`);
    if (step !== "estimate" && String(env.COURIER_AWB_LIVE_ENABLED ?? "").trim().toLowerCase() !== "true") {
      refuse(`Pasul „${step}” creează / anulează AWB în DEMO: setează COURIER_AWB_LIVE_ENABLED=true în comandă.`);
    }
  }
  if (String(env.NODE_ENV ?? "").trim().toLowerCase() === "production") refuse("Scriptul DEMO nu rulează cu NODE_ENV=production.");
  if (String(env.SAMEDAY_ACTIVE_ENVIRONMENT ?? "").trim().toLowerCase() !== "demo") {
    refuse("SAMEDAY_ACTIVE_ENVIRONMENT trebuie să fie exact „demo” pentru acest script.");
  }
  let baseUrl;
  try {
    baseUrl = assertSamedayEnvironment("demo", env);
  } catch (e) {
    refuse(`Mediul DEMO nu este permis: ${e?.message || "eroare"}`);
  }
  if (baseUrl !== DEMO_ORIGIN || SAMEDAY_BASE_URLS.demo !== DEMO_ORIGIN) refuse("URL-ul rezolvat nu este originea DEMO.");
  const username = String(env.SAMEDAY_DEMO_API_USERNAME ?? "").trim();
  const password = String(env.SAMEDAY_DEMO_API_PASSWORD ?? "").trim();
  if (!username || !password) refuse("Lipsesc SAMEDAY_DEMO_API_USERNAME / SAMEDAY_DEMO_API_PASSWORD (credentiale DEMO separate).");
  return { step, write, baseUrl, credentials: { username, password } };
}

/** Originea unei adrese, sau null dacă nu e un URL valid. */
function originOf(input) {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    return new URL(String(raw)).origin;
  } catch {
    return null;
  }
}

/**
 * fetch restrâns la originea DEMO. `hooks.afterResponse(url, init, res)` poate
 * simula pierderea răspunsului (pasul `recovery`).
 * @returns {Function} fetch-ul înlocuitor
 */
export function demoOnlyFetch(realFetch, hooks = {}) {
  return async function guardedFetch(input, init) {
    if (originOf(input) !== DEMO_ORIGIN) {
      throw new DemoProbeRefused("Cerere blocată: destinația nu este originea Sameday DEMO.");
    }
    const res = await realFetch(input, init);
    if (typeof hooks.afterResponse === "function") await hooks.afterResponse(String(input?.url || input), init, res);
    return res;
  };
}
