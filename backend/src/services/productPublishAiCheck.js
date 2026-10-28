// backend/src/services/productPublishAiCheck.js
//
// Verificarea AI de dinainte de publicare - DOAR aspecte subiective, ca
// RECOMANDĂRI (nu blochează niciodată publicarea):
//   - descriere neclară;
//   - categorie posibil nepotrivită;
//   - contradicții între descriere și configurare (variante / personalizare);
//   - informații importante lipsă.
// Validările structurale (câmpuri goale, variante fără valori, prețuri,
// combinații, GPSR, stoc) sunt deterministe, în editor
// (frontend/src/utils/productPublishCheck.js) - NU se trimit aici.
//
// Nu aruncă: orice eroare / timeout / răspuns invalid -> { available: false }.
// Cache în memorie pe conținut (același draft = fără apel nou) + limită
// simplă per vânzător (în memorie, per instanță - nu e o cotă persistentă).

import crypto from "node:crypto";

import { CATEGORY_LABELS, CATEGORY_SET } from "../constants/categories.js";

export const AI_RECOMMENDATION_KINDS = Object.freeze({
  UNCLEAR_DESCRIPTION: "UNCLEAR_DESCRIPTION",
  CATEGORY_MISMATCH: "CATEGORY_MISMATCH",
  CONTRADICTION: "CONTRADICTION",
  MISSING_INFO: "MISSING_INFO",
});

// unde duce butonul „Vezi” din editor
export const AI_RECOMMENDATION_TARGETS = Object.freeze([
  "description",
  "category",
  "title",
  "options",
  "custom",
  "details",
]);

const MAX_RECOMMENDATIONS = 4;
const MAX_MESSAGE_LENGTH = 240;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const ALLOWED_MODELS = new Set(["gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.1"]);

export function getPublishAiCheckConfig(env = process.env) {
  const flag = String(env.PRODUCT_PUBLISH_AI_CHECK ?? "").trim().toLowerCase();
  const requested = String(env.PRODUCT_PUBLISH_AI_CHECK_MODEL || "gpt-4.1-mini").trim();
  const timeout = Number(env.PRODUCT_PUBLISH_AI_CHECK_TIMEOUT_MS);
  const perHour = Number(env.PRODUCT_PUBLISH_AI_CHECK_PER_HOUR);

  return {
    enabled: !["off", "false", "0", "disabled"].includes(flag) && Boolean(env.OPENAI_API_KEY),
    model: ALLOWED_MODELS.has(requested) ? requested : "gpt-4.1-mini",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 30000) : 12000,
    perHour: Number.isFinite(perHour) && perHour > 0 ? Math.floor(perHour) : 30,
  };
}

/* ---------------- textul trimis (doar conținut, fără date de contact) ---------------- */

function text(value, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

function fieldsOf(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

function choiceLabel(option) {
  if (typeof option === "string") return option.trim();
  if (option && typeof option === "object") return text(option.label ?? option.value ?? option.key, 60);
  return "";
}

const ORDER_MODE_LABELS = {
  DIRECT: "se cumpără direct (stoc)",
  READY_TO_BUY: "se cumpără direct (stoc)",
  OPTIONS: "clientul alege variante / personalizează înainte de comandă",
  CUSTOMIZABLE: "clientul alege variante / personalizează înainte de comandă",
  QUOTE_ONLY: "clientul cere ofertă",
};

export function buildPublishAiInput(draft = {}) {
  const category = text(draft.category, 64);

  return {
    title: text(draft.title, 200),
    description: text(draft.description, 3000),
    category: category
      ? { key: category, label: CATEGORY_LABELS[category] || category, known: CATEGORY_SET.has(category) }
      : null,
    orderMode: ORDER_MODE_LABELS[String(draft.orderMode || "").toUpperCase()] || "necunoscut",
    material: text(draft.materialMain, 120),
    technique: text(draft.technique, 160),
    dimensions: text(draft.dimensions, 120),
    leadTimeDays: Number(draft.leadTimeDays) || null,
    variants: fieldsOf(draft.optionsSchema)
      .slice(0, 12)
      .map((field) => ({
        label: text(field?.label || field?.key, 80),
        values: (Array.isArray(field?.options) ? field.options : []).slice(0, 20).map(choiceLabel).filter(Boolean),
      })),
    personalization: fieldsOf(draft.customSchema)
      .slice(0, 12)
      .map((field) => ({
        label: text(field?.label || field?.key, 80),
        type: text(field?.type, 20) || "text",
        required: field?.required === true,
      })),
    perPersonGroups: fieldsOf(draft.repeatedGroups)
      .slice(0, 6)
      .map((group) => ({
        label: text(group?.label || group?.title, 80),
        fields: fieldsOf(group?.fields).slice(0, 10).map((f) => text(f?.label || f?.key, 60)),
      })),
    quoteQuestions: fieldsOf(draft.quoteSchema)
      .slice(0, 12)
      .map((field) => text(field?.label || field?.key, 80))
      .filter(Boolean),
  };
}

export function publishAiInputHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendations"],
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "target", "message"],
        properties: {
          kind: { type: "string", enum: Object.values(AI_RECOMMENDATION_KINDS) },
          target: { type: "string", enum: AI_RECOMMENDATION_TARGETS },
          message: { type: "string" },
        },
      },
    },
  },
};

function buildPrompt(input) {
  return `
Ești asistentul Artfest (marketplace de produse handmade din România) și verifici un produs ÎNAINTE ca vânzătorul să îl publice.

Dă DOAR recomandări SUBIECTIVE, din aceste 4 tipuri:
- UNCLEAR_DESCRIPTION: descrierea nu explică clar ce primește clientul (ce este, din ce e făcut, cum se personalizează).
- CATEGORY_MISMATCH: categoria aleasă pare nepotrivită pentru produs (spune ce categorie ar fi mai potrivită, în cuvinte).
- CONTRADICTION: descrierea contrazice configurarea (ex. descrierea promite gravarea numelui, dar nu există niciun câmp pentru nume; descrierea spune „3 culori”, variantele au 5).
- MISSING_INFO: lipsește o informație importantă pentru acest tip de produs (ex. dimensiuni la o ramă, mărime la un inel, material la bijuterii).

NU verifica și NU comenta: prețuri, stoc, câmpuri goale, fotografii, date legale (GPSR), structura variantelor, gramatica minoră. Acestea sunt verificate separat.
Dacă produsul e în regulă, întoarce o listă goală. Maxim ${MAX_RECOMMENDATIONS} recomandări, doar cele utile.
Fiecare mesaj: o propoziție scurtă (max 160 de caractere), în română, adresată vânzătorului cu „tu”, concretă și politicoasă.
target = unde trebuie să meargă vânzătorul: description, category, title, options (variante), custom (câmpuri de personalizare), details (material / dimensiuni).

PRODUSUL (JSON):
${JSON.stringify(input).slice(0, 7000)}
`.trim();
}

export function validatePublishAiResponse(parsed) {
  const list = Array.isArray(parsed?.recommendations) ? parsed.recommendations : null;
  if (!list) return null;

  const kinds = new Set(Object.values(AI_RECOMMENDATION_KINDS));
  const seen = new Set();

  return list
    .filter((item) => item && kinds.has(item.kind) && AI_RECOMMENDATION_TARGETS.includes(item.target))
    .map((item) => ({
      code: `AI_${item.kind}`,
      kind: item.kind,
      target: item.target,
      message: text(item.message, MAX_MESSAGE_LENGTH),
    }))
    .filter((item) => {
      if (!item.message || seen.has(item.message)) return false;
      seen.add(item.message);
      return true;
    })
    .slice(0, MAX_RECOMMENDATIONS);
}

/* ---------------- cache + limită (în memorie) ---------------- */

const cache = new Map(); // `${vendorId}:${hash}` -> { at, recommendations }
const calls = new Map(); // vendorId -> [timestamps]

function cacheGet(key, now) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key, value, now) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, ...value });
}

function takeRateSlot(vendorId, perHour, now) {
  const recent = (calls.get(vendorId) || []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= perHour) {
    calls.set(vendorId, recent);
    return false;
  }
  recent.push(now);
  calls.set(vendorId, recent);
  return true;
}

// doar pentru teste
export function resetPublishAiCheckState() {
  cache.clear();
  calls.clear();
}

/**
 * @returns {Promise<{ available: boolean, reason?: string, cached?: boolean,
 *   recommendations: Array<{ code, kind, target, message }> }>}
 */
export async function runPublishAiCheck({ vendorId, draft, client, env = process.env, now = () => Date.now() }) {
  const config = getPublishAiCheckConfig(env);
  if (!config.enabled || !client?.responses?.create) {
    return { available: false, reason: "disabled", recommendations: [] };
  }

  const input = buildPublishAiInput(draft && typeof draft === "object" ? draft : {});
  // fără titlu și descriere nu are ce analiza (lipsa lor e o eroare deterministă)
  if (!input.title || !input.description) {
    return { available: false, reason: "not_enough_content", recommendations: [] };
  }

  const key = `${vendorId}:${publishAiInputHash(input)}`;
  const cached = cacheGet(key, now());
  if (cached) return { available: true, cached: true, recommendations: cached.recommendations };

  if (!takeRateSlot(vendorId, config.perHour, now())) {
    return { available: false, reason: "rate_limited", recommendations: [] };
  }

  try {
    const response = await client.responses.create(
      {
        model: config.model,
        text: {
          format: { type: "json_schema", name: "product_publish_check", strict: true, schema: RESPONSE_SCHEMA },
        },
        input: [{ role: "user", content: [{ type: "input_text", text: buildPrompt(input) }] }],
      },
      { timeout: config.timeoutMs }
    );

    let parsed = null;
    try {
      parsed = JSON.parse(response?.output_text || "");
    } catch {
      parsed = null;
    }

    const recommendations = validatePublishAiResponse(parsed);
    if (!recommendations) throw new Error("invalid_ai_response");

    cacheSet(key, { recommendations }, now());
    return { available: true, cached: false, recommendations };
  } catch (error) {
    console.error("[publish-ai-check] OpenAI failed:", error?.message || error);
    return { available: false, reason: "ai_unavailable", recommendations: [] };
  }
}
