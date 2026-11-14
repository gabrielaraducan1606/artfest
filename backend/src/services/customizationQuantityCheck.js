// backend/src/services/customizationQuantityCheck.js
//
// Verificarea cantității pentru produsele personalizate cu mai multe
// fotografii: clientul a încărcat N fotografii, dar a ales mai puține
// bucăți. Frontend-ul aplică întâi reguli simple (fără AI); doar dacă
// produsul e ambiguu ajunge aici.
//
// AI-ul primește DOAR textul public al produsului (titlu, descriere,
// categorie, câmpurile de personalizare) - niciodată fotografiile, linkurile
// lor sau datele clientului - și răspunde cu un singur tip:
//   per_photo       - probabil o bucată pentru fiecare fotografie;
//   single_product  - probabil un singur produs cu mai multe fotografii;
//   unclear         - nu se poate spune.
// Clasificarea depinde doar de produs, deci se păstrează în cache per
// produs (+ updatedAt): cel mult un apel AI per produs per zi per instanță.
// Orice problemă (fără cheie, timeout, plafon, răspuns invalid) -> unclear;
// frontend-ul întreabă atunci clientul, fără să blocheze cumpărarea.

// clientul OpenAI se încarcă doar la primul apel real (testele injectează unul fals)
async function defaultOpenai() {
  const { openai } = await import("../lib/openai.js");
  return openai;
}

export const QUANTITY_KINDS = Object.freeze(["per_photo", "single_product", "unclear"]);

const ALLOWED_MODELS = new Set(["gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.1"]);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const HOUR_MS = 60 * 60 * 1000;

export function getQuantityCheckConfig(env = process.env) {
  const flag = String(env.CUSTOMIZATION_QTY_AI ?? "").trim().toLowerCase();
  const requested = String(env.CUSTOMIZATION_QTY_AI_MODEL || "gpt-4.1-mini").trim();
  const timeout = Number(env.CUSTOMIZATION_QTY_AI_TIMEOUT_MS);
  const perHour = Number(env.CUSTOMIZATION_QTY_AI_PER_HOUR);

  return {
    enabled: !["off", "false", "0", "disabled"].includes(flag) && Boolean(env.OPENAI_API_KEY),
    model: ALLOWED_MODELS.has(requested) ? requested : "gpt-4.1-mini",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 10000) : 4000,
    perHour: Number.isFinite(perHour) && perHour > 0 ? Math.floor(perHour) : 100,
  };
}

function text(value, max) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function fieldsOf(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

/* Doar conținutul public al produsului. */
export function buildQuantityFacts(product) {
  const fields = fieldsOf(product?.customSchema)
    .slice(0, 12)
    .map((field) => ({
      eticheta: text(field?.label, 80),
      tip: text(field?.type || "text", 20),
      descriere: text(field?.description || field?.placeholder, 200),
    }))
    .filter((field) => field.eticheta || field.descriere);

  return {
    titlu: text(product?.title, 160),
    categorie: text(product?.category, 64),
    descriere: text(product?.description, 1200),
    campuriPersonalizare: fields,
  };
}

export function buildQuantityPrompt(facts) {
  return `Ești un verificator pentru un marketplace de produse handmade.
Un client a încărcat mai multe fotografii decât numărul de bucăți ales pentru produsul de mai jos.
Decide, DOAR din textul produsului, ce reprezintă o bucată din acest produs:
- "per_photo": fiecare fotografie devine de regulă un produs separat (ex. magneți foto, printuri, insigne);
- "single_product": un singur produs folosește mai multe fotografii (ex. colaj, album, calendar, tablou cu mai multe poze);
- "unclear": textul nu permite o concluzie sigură.
Nu presupune prețuri și nu inventa reguli. Dacă ai dubii, răspunde "unclear".
Răspunde STRICT cu JSON: {"kind":"per_photo"|"single_product"|"unclear"}

Produs:
${JSON.stringify(facts)}`;
}

export function parseQuantityKind(outputText) {
  try {
    const parsed = JSON.parse(String(outputText || ""));
    return QUANTITY_KINDS.includes(parsed?.kind) ? parsed.kind : "unclear";
  } catch {
    return "unclear";
  }
}

export function createQuantityChecker({
  openai = null,
  config = getQuantityCheckConfig(),
  now = () => Date.now(),
  logger = console,
} = {}) {
  const cache = new Map(); // `${id}:${updatedAt}` -> { kind, at }
  const inflight = new Map();
  let windowStart = 0;
  let callsInWindow = 0;

  function readCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (now() - entry.at > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return entry.kind;
  }

  function writeCache(key, kind) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { kind, at: now() });
  }

  function takeBudget() {
    const at = now();
    if (at - windowStart >= HOUR_MS) {
      windowStart = at;
      callsInWindow = 0;
    }
    if (callsInWindow >= config.perHour) return false;
    callsInWindow += 1;
    return true;
  }

  async function callAi(product) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const client = openai || (await defaultOpenai());
      const response = await client.responses.create(
        {
          model: config.model,
          temperature: 0,
          max_output_tokens: 30,
          text: { format: { type: "json_object" } },
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: buildQuantityPrompt(buildQuantityFacts(product)) }],
            },
          ],
        },
        { signal: controller.signal }
      );
      return { kind: parseQuantityKind(response?.output_text), cacheable: true };
    } catch (err) {
      logger.warn?.("[customization-qty] AI indisponibil:", err?.name === "AbortError" ? "timeout" : err?.message || err);
      return { kind: "unclear", cacheable: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {Promise<{ kind: string, source: "cache"|"ai"|"disabled"|"limit"|"error" }>} */
  async function classify(product) {
    if (!product?.id) return { kind: "unclear", source: "error" };

    const key = `${product.id}:${product.updatedAt ? new Date(product.updatedAt).getTime() : 0}`;
    const cached = readCache(key);
    if (cached) return { kind: cached, source: "cache" };

    if (!config.enabled) return { kind: "unclear", source: "disabled" };

    if (inflight.has(key)) return inflight.get(key);

    if (!takeBudget()) return { kind: "unclear", source: "limit" };

    const promise = callAi(product)
      .then(({ kind, cacheable }) => {
        if (cacheable) writeCache(key, kind);
        return { kind, source: cacheable ? "ai" : "error" };
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  return { classify };
}
