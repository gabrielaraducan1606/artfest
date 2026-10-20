// backend/src/services/aiUsageService.js
//
// Limitele PERSISTENTE ale AI-ului (tabel AiUsageDaily) - folosit acum de
// „Găsește produse cu AI” din colecțiile vânzătorilor.
//
// Toate deciziile de cotă sunt instrucțiuni ATOMICE în baza de date
// (UPDATE ... WHERE requests < limită / WHERE lockedUntil expirat), deci:
//  - nu se resetează la repornirea backendului;
//  - rămân corecte cu mai multe instanțe și cu cereri simultane;
//  - o singură solicitare AI în desfășurare per vânzător (lockedUntil).
//
// Restituirea cotei: DOAR când e sigur că OpenAI NU a procesat / facturat
// cererea (eroare înainte de trimitere sau răspuns 4xx). La timeout, erori
// 5xx sau de conexiune cota rămâne consumată și se adaugă un cost estimat
// conservator (cererea poate fi fost procesată și facturată).

import { bucharestDayKey } from "./collectionAiQuery.js";

export const VENDOR_COLLECTIONS_FEATURE = "vendor_collections";

/* =========================================================
   Configurare (variabile de mediu, citite la fiecare cerere)
========================================================= */

// modele permise (un model mai scump nu poate fi activat doar din env)
export const ALLOWED_AI_MODELS = {
  // USD per 1M tokeni (orientativ - verifică tariful curent OpenAI)
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "gpt-4.1-nano": { inputPerM: 0.1, outputPerM: 0.4 },
};
export const DEFAULT_AI_MODEL = "gpt-4.1-mini";

function intEnv(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numEnv(value, fallback, min, max) {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Configurația AI pentru colecțiile vânzătorilor. Implicit DEZACTIVAT:
 * funcția pornește doar cu AI_VENDOR_COLLECTIONS_ENABLED=1 (comutator).
 */
export function getVendorCollectionsAiConfig(env = process.env) {
  const enabledFlag = String(env.AI_VENDOR_COLLECTIONS_ENABLED ?? "").trim().toLowerCase();
  const requestedModel = String(env.AI_VENDOR_COLLECTIONS_MODEL || DEFAULT_AI_MODEL).trim();
  const model = ALLOWED_AI_MODELS[requestedModel] ? requestedModel : DEFAULT_AI_MODEL;
  const price = ALLOWED_AI_MODELS[model];
  const timeoutMs = intEnv(env.AI_VENDOR_COLLECTIONS_TIMEOUT_MS, 20000, 5000, 60000);

  return {
    feature: VENDOR_COLLECTIONS_FEATURE,
    enabled: ["1", "true", "on", "yes"].includes(enabledFlag) && Boolean(env.OPENAI_API_KEY),
    switchOn: ["1", "true", "on", "yes"].includes(enabledFlag),
    hasApiKey: Boolean(env.OPENAI_API_KEY),
    vendorDailyLimit: intEnv(env.AI_VENDOR_COLLECTIONS_VENDOR_DAILY_LIMIT, 5, 0, 1000),
    globalDailyLimit: intEnv(env.AI_VENDOR_COLLECTIONS_GLOBAL_DAILY_LIMIT, 50, 0, 100000),
    monthlyBudgetUsd: numEnv(env.AI_VENDOR_COLLECTIONS_MONTHLY_BUDGET_USD, 5, 0, 10000),
    model,
    timeoutMs,
    maxOutputTokens: intEnv(env.AI_VENDOR_COLLECTIONS_MAX_OUTPUT_TOKENS, 1500, 200, 4000),
    // lock-ul ține cât timeout-ul + o marjă (expiră singur dacă procesul cade)
    lockMs: timeoutMs + 15000,
    inputPerM: numEnv(env.AI_VENDOR_COLLECTIONS_PRICE_INPUT_PER_M, price.inputPerM, 0, 1000),
    outputPerM: numEnv(env.AI_VENDOR_COLLECTIONS_PRICE_OUTPUT_PER_M, price.outputPerM, 0, 1000),
  };
}

/** Cost estimat în micro-USD (1 USD = 1.000.000). */
export function costMicroUsd({ inputTokens = 0, outputTokens = 0 }, config) {
  // prețul e per 1M tokeni => micro-USD per token = prețul în USD
  return Math.ceil(Number(inputTokens || 0) * config.inputPerM + Number(outputTokens || 0) * config.outputPerM);
}

/** Tokeni estimați dintr-un text (~4 caractere / token), conservator. */
export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 3.5);
}

/**
 * A fost cererea posibil procesată și facturată de OpenAI?
 *  - eroare cu status HTTP 4xx (inclusiv 429): NU - OpenAI a refuzat-o;
 *  - timeout, abort, eroare de conexiune, 5xx, status lipsă: POSIBIL.
 */
export function openAiFailureMayBeBilled(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return false;
  return true;
}

/* =========================================================
   Chei / rânduri
========================================================= */

function keys(feature, vendorId, day) {
  return {
    vendor: { feature, scope: "vendor", subjectId: String(vendorId), day },
    global: { feature, scope: "global", subjectId: "all", day },
  };
}

async function ensureRows(db, rows) {
  // createMany + skipDuplicates: sigur la cereri simultane (fără cursă la creare)
  await db.aiUsageDaily.createMany({ data: rows, skipDuplicates: true });
}

async function monthSpentMicro(db, feature, day) {
  const month = day.slice(0, 7);
  const agg = await db.aiUsageDaily.aggregate({
    where: { feature, scope: "global", day: { startsWith: month } },
    _sum: { costMicroUsd: true },
  });
  return Number(agg?._sum?.costMicroUsd || 0);
}

/* =========================================================
   Status (pentru interfață)
========================================================= */

export async function getAiUsageStatus(db, { vendorId, config, now = new Date() }) {
  const day = bucharestDayKey(now);
  const k = keys(config.feature, vendorId, day);

  const [vendorRow, globalRow, spent] = await Promise.all([
    db.aiUsageDaily.findFirst({ where: k.vendor }),
    db.aiUsageDaily.findFirst({ where: k.global }),
    monthSpentMicro(db, config.feature, day),
  ]);

  const vendorUsed = Number(vendorRow?.requests || 0);
  const globalUsed = Number(globalRow?.requests || 0);
  const budgetReached = spent >= Math.round(config.monthlyBudgetUsd * 1e6);
  const globalReached = globalUsed >= config.globalDailyLimit;

  return {
    enabled: config.enabled,
    dailyLimit: config.vendorDailyLimit,
    used: vendorUsed,
    remaining: Math.max(0, config.vendorDailyLimit - vendorUsed),
    // platforma a atins limita zilei sau bugetul lunii -> AI indisponibil azi
    available: config.enabled && !budgetReached && !globalReached,
    inProgress: Boolean(vendorRow?.lockedUntil && new Date(vendorRow.lockedUntil) > now),
  };
}

/* =========================================================
   Rezervare / finalizare
========================================================= */

/**
 * Rezervă atomic o solicitare AI pentru vânzător.
 * @returns {Promise<{ ok: true, reservation } | { ok: false, reason }>}
 *   reason: "disabled" | "monthly_budget" | "in_progress" |
 *           "vendor_daily_limit" | "global_daily_limit"
 */
export async function reserveAiCall(db, { vendorId, config, now = new Date() }) {
  if (!config.enabled) return { ok: false, reason: "disabled" };

  const day = bucharestDayKey(now);
  const k = keys(config.feature, vendorId, day);
  await ensureRows(db, [k.vendor, k.global]);

  // bugetul lunar (orientativ): verificat înainte de orice apel
  if ((await monthSpentMicro(db, config.feature, day)) >= Math.round(config.monthlyBudgetUsd * 1e6)) {
    return { ok: false, reason: "monthly_budget" };
  }

  // o singură solicitare în desfășurare per vânzător (atomic, multi-instanță)
  const lockValue = new Date(now.getTime() + config.lockMs);
  const lock = await db.aiUsageDaily.updateMany({
    where: { ...k.vendor, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: lockValue },
  });
  if (!lock?.count) return { ok: false, reason: "in_progress" };

  const releaseLock = () =>
    db.aiUsageDaily.updateMany({ where: { ...k.vendor, lockedUntil: lockValue }, data: { lockedUntil: null } });

  // cota vânzătorului: incrementare DOAR sub limită (atomic)
  const vendorQuota = await db.aiUsageDaily.updateMany({
    where: { ...k.vendor, requests: { lt: config.vendorDailyLimit } },
    data: { requests: { increment: 1 } },
  });
  if (!vendorQuota?.count) {
    await releaseLock();
    return { ok: false, reason: "vendor_daily_limit" };
  }

  // cota globală
  const globalQuota = await db.aiUsageDaily.updateMany({
    where: { ...k.global, requests: { lt: config.globalDailyLimit } },
    data: { requests: { increment: 1 } },
  });
  if (!globalQuota?.count) {
    // niciun apel AI nu a avut loc -> cota vânzătorului se restituie
    await db.aiUsageDaily.updateMany({ where: k.vendor, data: { requests: { decrement: 1 } } });
    await releaseLock();
    return { ok: false, reason: "global_daily_limit" };
  }

  return { ok: true, reservation: { keys: k, lockValue, day } };
}

/**
 * Încheie o rezervare.
 *  - "billed":         răspuns primit -> se înregistrează tokenii reali și costul;
 *  - "not_sent":       cererea NU a ajuns la OpenAI / a fost refuzată (4xx)
 *                      -> cota se restituie (vânzător + global);
 *  - "maybe_billed":   timeout / 5xx / conexiune -> cota rămâne consumată și se
 *                      adaugă un cost estimat conservator (input estimat +
 *                      plafonul de tokeni generați).
 * Lock-ul se eliberează mereu (doar dacă e încă al nostru).
 */
export async function finishAiCall(db, reservation, { outcome, usage = null, estimatedInputTokens = 0, config }) {
  const { keys: k, lockValue } = reservation;
  const both = [k.vendor, k.global];

  try {
    if (outcome === "billed") {
      const inputTokens = Number(usage?.input_tokens || 0);
      const outputTokens = Number(usage?.output_tokens || 0);
      const cost = costMicroUsd({ inputTokens, outputTokens }, config);
      for (const where of both) {
        await db.aiUsageDaily.updateMany({
          where,
          data: {
            inputTokens: { increment: inputTokens },
            outputTokens: { increment: outputTokens },
            costMicroUsd: { increment: cost },
          },
        });
      }
    } else if (outcome === "not_sent") {
      for (const where of both) {
        await db.aiUsageDaily.updateMany({
          where: { ...where, requests: { gt: 0 } },
          data: { requests: { decrement: 1 }, failures: { increment: 1 } },
        });
      }
    } else {
      // maybe_billed
      const cost = costMicroUsd({ inputTokens: estimatedInputTokens, outputTokens: config.maxOutputTokens }, config);
      for (const where of both) {
        await db.aiUsageDaily.updateMany({
          where,
          data: { failures: { increment: 1 }, costMicroUsd: { increment: cost } },
        });
      }
    }
  } finally {
    await db.aiUsageDaily.updateMany({ where: { ...k.vendor, lockedUntil: lockValue }, data: { lockedUntil: null } });
  }
}
