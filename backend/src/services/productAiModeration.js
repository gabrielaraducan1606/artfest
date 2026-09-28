// backend/src/services/productAiModeration.js

/*
 * Moderare AI automată la adăugarea/editarea produselor (OpenAI Vision).
 *
 * Trei rezultate finale, mapate pe statusurile EXISTENTE ale produsului
 * (fără enum nou, fără sistem admin paralel):
 *
 *   AUTO_APPROVE        -> moderationStatus APPROVED (produsul continuă
 *                          automat în fluxul actual de publicare)
 *   NEEDS_ADMIN_REVIEW  -> moderationStatus PENDING (coada admin existentă,
 *                          exact ca înainte de moderarea AI)
 *   BLOCK_PUBLICATION   -> moderationStatus CHANGES_REQUESTED + mesaj clar
 *                          pentru vendor, per imagine (nu se publică până
 *                          nu înlocuiește imaginea)
 *
 * Reguli de siguranță:
 * - dubiu / confidence mic / eroare OpenAI -> NEEDS_ADMIN_REVIEW, niciodată
 *   auto-aprobare și niciodată respingere;
 * - BLOCK doar pentru încălcări CLARE (contact extern evident, material
 *   promoțional în locul produsului); logo/watermark -> admin;
 * - nu se atinge imaginea (doar URL-ul public e trimis la OpenAI);
 * - rezultatele per imagine sunt cache-uite după URL (o imagine înlocuită
 *   are alt URL), iar clasificarea după hash-ul textului + imaginea
 *   principală -> editările fără legătură (stoc, preț, disponibilitate)
 *   nu produc apeluri AI.
 *
 * Kill switch: PRODUCT_AI_MODERATION=off -> nu se face nicio analiză,
 * produsul rămâne PENDING (comportamentul dinainte).
 */

import crypto from "node:crypto";

import {
  isGpsrComplete,
  getGpsrMissingFields,
  GPSR_PRODUCT_FIELDS,
} from "../lib/gpsrCompliance.js";

export const MODERATION_VERSION = "product-moderation-v1";

export const DECISIONS = Object.freeze({
  AUTO_APPROVE: "AUTO_APPROVE",
  NEEDS_ADMIN_REVIEW: "NEEDS_ADMIN_REVIEW",
  BLOCK_PUBLICATION: "BLOCK_PUBLICATION",
});

export const PRODUCT_TYPES = Object.freeze([
  "HANDMADE",
  "PERSONALIZED",
  "DIGITAL",
  "INDUSTRIAL",
  "POSSIBLE_RESELL",
  "UNKNOWN",
]);

/*
 * Praguri conservatoare. BLOCK cere o detecție sigură; orice detecție
 * nesigură de date de contact merge la admin, nu la vendor.
 */
export const THRESHOLDS = Object.freeze({
  BLOCK_MIN_CONFIDENCE: 0.85,
  AUTO_APPROVE_MIN_IMAGE_CONFIDENCE: 0.75,
  AUTO_APPROVE_MIN_HANDMADE_CONFIDENCE: 0.7,
  AUTO_APPROVE_MIN_CLASSIFICATION_CONFIDENCE: 0.7,
  PRODUCT_NOT_VISIBLE_MIN_CONFIDENCE: 0.7,
});

// Probleme care pot bloca publicarea (contact extern / material promoțional)
const CONTACT_ISSUES = Object.freeze({
  hasPhoneNumber: "PHONE_NUMBER",
  hasEmail: "EMAIL",
  hasUrl: "URL",
  hasSocialHandle: "SOCIAL_HANDLE",
  hasQrCode: "QR_CODE",
});

export const VENDOR_ISSUE_MESSAGES = Object.freeze({
  PHONE_NUMBER:
    "Am detectat un număr de telefon în această imagine. Te rugăm să încarci o imagine fără date de contact.",
  EMAIL:
    "Am detectat o adresă de email în această imagine. Te rugăm să încarci o imagine fără date de contact.",
  URL:
    "Am detectat un website sau un link extern în această imagine. Pentru publicarea pe Artfest, imaginea trebuie să fie fără date de contact externe.",
  SOCIAL_HANDLE:
    "Am detectat un cont de social media (de exemplu @utilizator) în această imagine. Pentru publicarea pe Artfest, imaginea trebuie să fie fără date de contact externe.",
  QR_CODE:
    "Am detectat un cod QR în această imagine. Te rugăm să folosești o imagine fără coduri care trimit în afara platformei.",
  PROMOTIONAL_MATERIAL:
    "Imaginea pare să fie un material promoțional, nu o fotografie clară a produsului. Te rugăm să adaugi o imagine în care produsul este vizibil.",
});

export const VENDOR_REVIEW_MESSAGE =
  "Produsul a fost trimis pentru o verificare suplimentară. Nu trebuie să faci nimic momentan.";

export const VENDOR_GPSR_MESSAGE =
  "Produsul este aproape gata de publicare. Completează informațiile de siguranță GPSR pentru a putea fi aprobat automat.";

/*
 * Ce lipsește, în cuvinte simple (grupat - vendorul completează o
 * secțiune, nu câmpuri tehnice). Ordinea = ordinea din formular.
 */
const GPSR_MISSING_LABELS = [
  ["isOwnManufacturer", "cine este producătorul produsului"],
  ["manufacturerName", "datele producătorului (nume, adresă, email)"],
  ["manufacturerAddress", "datele producătorului (nume, adresă, email)"],
  ["manufacturerEmail", "datele producătorului (nume, adresă, email)"],
  ["manufacturerInEU", "dacă producătorul este stabilit în UE"],
  ["responsiblePersonName", "persoana responsabilă din UE"],
  ["responsiblePersonAddress", "persoana responsabilă din UE"],
  ["responsiblePersonEmail", "persoana responsabilă din UE"],
  ["safetyWarnings", "avertismentele de siguranță (sau confirmarea că nu se aplică)"],
  ["isForChildren", "dacă produsul este destinat copiilor"],
];

export function describeMissingGpsr(product) {
  const missing = new Set(getGpsrMissingFields(product));
  const labels = [];

  for (const [field, label] of GPSR_MISSING_LABELS) {
    if (missing.has(field) && !labels.includes(label)) {
      labels.push(label);
    }
  }

  return labels;
}

export const VENDOR_BLOCK_SUMMARY =
  "Produsul nu poate fi publicat încă din cauza unor imagini. După ce înlocuiești imaginile marcate și salvezi, produsul este verificat din nou automat.";

const MAX_IMAGES_PER_CALL = 6;

/* =========================================================
   Config
========================================================= */

export function isProductAiModerationEnabled(env = process.env) {
  const flag = String(env.PRODUCT_AI_MODERATION || "on")
    .trim()
    .toLowerCase();

  return !["off", "false", "0", "disabled"].includes(flag);
}

function getModel(env = process.env) {
  return String(env.PRODUCT_AI_MODERATION_MODEL || "gpt-4.1").trim();
}

function getTimeoutMs(env = process.env) {
  const value = Number(env.PRODUCT_AI_MODERATION_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

/* =========================================================
   Snapshot text / câmpuri relevante
========================================================= */

/*
 * Câmpurile care influențează clasificarea (și care, dacă se schimbă,
 * cer o nouă clasificare). Stocul, prețul, disponibilitatea etc. NU sunt
 * aici - nu produc apeluri AI.
 */
export const MODERATION_TEXT_FIELDS = Object.freeze([
  "title",
  "description",
  "category",
  "materialMain",
  "technique",
  "styleTags",
  "occasionTags",
  "dimensions",
  "careInstructions",
  "specialNotes",
  "optionsSchema",
  "customSchema",
  "repeatedGroups",
  "quoteSchema",
]);

function stableStringify(value) {
  if (value === undefined) return "null";

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function buildModerationText(product = {}) {
  const parts = {};

  for (const field of MODERATION_TEXT_FIELDS) {
    const value = product?.[field];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      continue;
    }

    parts[field] = value;
  }

  return parts;
}

export function hashModerationText(product = {}) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(buildModerationText(product)))
    .digest("hex");
}

function normalizeImageList(images) {
  return (Array.isArray(images) ? images : [])
    .map((url) => String(url || "").trim())
    .filter(Boolean);
}

/*
 * Pentru PUT: s-a schimbat EFECTIV vreun câmp de conținut față de ce e în
 * DB? (frontendul poate retrimite tot payload-ul, inclusiv valori
 * neschimbate - asta nu trebuie să retrimită produsul la verificare.)
 */
export function hasActualContentChange(product = {}, patch = {}, fields = []) {
  return fields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(patch, field) &&
      stableStringify(patch[field] ?? null) !==
        stableStringify(product?.[field] ?? null)
  );
}

/* =========================================================
   Plan de analiză (cache)
========================================================= */

/*
 * Ce trebuie analizat efectiv, pe baza rezultatului anterior:
 * - imaginile ale căror URL-uri au deja rezultat valid (aceeași versiune)
 *   sunt reutilizate, fără apel AI;
 * - clasificarea se reface doar dacă s-a schimbat textul relevant sau
 *   imaginea principală (sau nu există una validă).
 */
export function planModerationRun({ images, textHash, previous }) {
  const urls = normalizeImageList(images);

  const previousValid =
    previous && previous.version === MODERATION_VERSION ? previous : null;

  const cachedByUrl = new Map();

  for (const item of previousValid?.images || []) {
    if (item?.url && item.analyzed === true && item.checks) {
      cachedByUrl.set(item.url, item);
    }
  }

  const reused = [];
  const toAnalyze = [];

  urls.forEach((url, index) => {
    const cached = cachedByUrl.get(url);

    if (cached) {
      reused.push({ ...cached, index });
    } else {
      toAnalyze.push({ index, url });
    }
  });

  const coverUrl = urls[0] || null;

  const previousClassification = previousValid?.classification || null;

  const classificationReusable = Boolean(
    previousClassification &&
      previousClassification.analyzed === true &&
      previousValid.textHash === textHash &&
      previousClassification.coverUrl === coverUrl
  );

  return {
    urls,
    coverUrl,
    reused,
    toAnalyze,
    needsClassification: !classificationReusable,
    previousClassification: classificationReusable
      ? previousClassification
      : null,
  };
}

/* =========================================================
   Structured Output (JSON Schema strict)
========================================================= */

const IMAGE_CHECK_FIELDS = [
  "hasPhoneNumber",
  "hasEmail",
  "hasUrl",
  "hasSocialHandle",
  "hasQrCode",
  "hasLogo",
  "hasWatermark",
  "hasPromotionalText",
  "isPromotionalMaterial",
  "productVisible",
  "looksLikeStockPhoto",
];

export const MODERATION_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["images", "classification"],
  properties: {
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["imageIndex", ...IMAGE_CHECK_FIELDS, "confidence", "reasons"],
        properties: {
          imageIndex: { type: "integer" },
          ...Object.fromEntries(
            IMAGE_CHECK_FIELDS.map((field) => [field, { type: "boolean" }])
          ),
          confidence: { type: "number" },
          reasons: { type: "array", items: { type: "string" } },
        },
      },
    },
    classification: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "handmadeConfidence",
        "possibleResell",
        "textHasContactInfo",
        "confidence",
        "reasons",
        "signals",
      ],
      properties: {
        type: { type: "string", enum: [...PRODUCT_TYPES] },
        handmadeConfidence: { type: "number" },
        possibleResell: { type: "boolean" },
        textHasContactInfo: { type: "boolean" },
        confidence: { type: "number" },
        reasons: { type: "array", items: { type: "string" } },
        signals: { type: "array", items: { type: "string" } },
      },
    },
  },
});

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(1, Math.max(0, numeric));
}

function cleanStrings(value, max = 8) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item) => item.trim().slice(0, 300));
}

/*
 * Validare strictă a răspunsului (pe lângă json_schema): orice abatere ->
 * null -> tratat ca AI_ANALYSIS_UNAVAILABLE (NEEDS_ADMIN_REVIEW).
 */
export function validateModerationResponse(parsed, expectedIndexes = []) {
  if (!parsed || typeof parsed !== "object") return null;
  if (!Array.isArray(parsed.images)) return null;

  const byIndex = new Map();

  for (const item of parsed.images) {
    if (!item || typeof item !== "object") return null;
    if (!Number.isInteger(item.imageIndex)) return null;

    for (const field of IMAGE_CHECK_FIELDS) {
      if (typeof item[field] !== "boolean") return null;
    }

    const confidence = clamp01(item.confidence);
    if (confidence === null) return null;

    byIndex.set(item.imageIndex, {
      checks: Object.fromEntries(
        IMAGE_CHECK_FIELDS.map((field) => [field, item[field]])
      ),
      confidence,
      reasons: cleanStrings(item.reasons),
    });
  }

  for (const index of expectedIndexes) {
    if (!byIndex.has(index)) return null;
  }

  const c = parsed.classification;

  if (!c || typeof c !== "object") return null;
  if (!PRODUCT_TYPES.includes(c.type)) return null;
  if (typeof c.possibleResell !== "boolean") return null;
  if (typeof c.textHasContactInfo !== "boolean") return null;

  const handmadeConfidence = clamp01(c.handmadeConfidence);
  const classificationConfidence = clamp01(c.confidence);

  if (handmadeConfidence === null || classificationConfidence === null) {
    return null;
  }

  return {
    imagesByIndex: byIndex,
    classification: {
      type: c.type,
      handmadeConfidence,
      possibleResell: c.possibleResell,
      textHasContactInfo: c.textHasContactInfo,
      confidence: classificationConfidence,
      reasons: cleanStrings(c.reasons),
      signals: cleanStrings(c.signals),
    },
  };
}

/* =========================================================
   Decizii (pure)
========================================================= */

/*
 * Verdict pentru O imagine. blockIssues = ce poate vedea vendorul ca
 * motiv de blocare; reviewIssues = semnale pentru admin (nu sperie
 * vendorul).
 */
export function decideImage(imageResult) {
  if (!imageResult || imageResult.analyzed !== true || !imageResult.checks) {
    return {
      decision: DECISIONS.NEEDS_ADMIN_REVIEW,
      blockIssues: [],
      reviewIssues: ["AI_ANALYSIS_UNAVAILABLE"],
    };
  }

  const { checks } = imageResult;
  const confidence = clamp01(imageResult.confidence) ?? 0;
  const sure = confidence >= THRESHOLDS.BLOCK_MIN_CONFIDENCE;

  const blockIssues = [];
  const reviewIssues = [];

  for (const [field, code] of Object.entries(CONTACT_ISSUES)) {
    if (checks[field] === true) {
      // detecție nesigură de contact -> admin, nu blocare
      (sure ? blockIssues : reviewIssues).push(code);
    }
  }

  if (checks.isPromotionalMaterial === true) {
    if (sure && checks.productVisible === false) {
      blockIssues.push("PROMOTIONAL_MATERIAL");
    } else {
      reviewIssues.push("POSSIBLE_PROMOTIONAL_MATERIAL");
    }
  }

  // logo / watermark: deocamdată NU blocăm - admin decide
  if (checks.hasLogo === true) reviewIssues.push("LOGO");
  if (checks.hasWatermark === true) reviewIssues.push("WATERMARK");
  if (checks.hasPromotionalText === true) reviewIssues.push("PROMOTIONAL_TEXT");

  if (
    checks.productVisible === false &&
    !blockIssues.includes("PROMOTIONAL_MATERIAL")
  ) {
    reviewIssues.push("PRODUCT_NOT_VISIBLE");
  }

  if (checks.looksLikeStockPhoto === true) {
    reviewIssues.push("POSSIBLE_STOCK_PHOTO");
  }

  if (confidence < THRESHOLDS.AUTO_APPROVE_MIN_IMAGE_CONFIDENCE) {
    reviewIssues.push("LOW_CONFIDENCE");
  }

  const decision = blockIssues.length
    ? DECISIONS.BLOCK_PUBLICATION
    : reviewIssues.length
      ? DECISIONS.NEEDS_ADMIN_REVIEW
      : DECISIONS.AUTO_APPROVE;

  return { decision, blockIssues, reviewIssues };
}

export function decideClassification(classification) {
  if (!classification || classification.analyzed !== true) {
    return { ok: false, reviewIssues: ["AI_ANALYSIS_UNAVAILABLE"] };
  }

  const reviewIssues = [];
  const type = classification.type;

  if (type === "POSSIBLE_RESELL" || classification.possibleResell === true) {
    reviewIssues.push("POSSIBLE_RESELL");
  }

  if (type === "INDUSTRIAL") reviewIssues.push("POSSIBLE_INDUSTRIAL");
  if (type === "DIGITAL") reviewIssues.push("DIGITAL_PRODUCT");
  if (type === "UNKNOWN") reviewIssues.push("UNCLEAR_PRODUCT_TYPE");

  if (
    (type === "HANDMADE" || type === "PERSONALIZED") &&
    (clamp01(classification.handmadeConfidence) ?? 0) <
      THRESHOLDS.AUTO_APPROVE_MIN_HANDMADE_CONFIDENCE
  ) {
    reviewIssues.push("UNCLEAR_HANDMADE");
  }

  if (
    (clamp01(classification.confidence) ?? 0) <
    THRESHOLDS.AUTO_APPROVE_MIN_CLASSIFICATION_CONFIDENCE
  ) {
    reviewIssues.push("LOW_CONFIDENCE");
  }

  if (classification.textHasContactInfo === true) {
    reviewIssues.push("TEXT_CONTACT_INFO");
  }

  return { ok: reviewIssues.length === 0, reviewIssues };
}

/*
 * Decizia finală pentru produs. BLOCK > REVIEW > AUTO_APPROVE.
 * previouslyRejectedByAdmin: un produs respins / cu modificări cerute de
 * un admin nu se poate auto-aproba la retrimitere - revine la admin.
 */
export function decideProductModeration({
  images = [],
  classification = null,
  previouslyRejectedByAdmin = false,
  gpsrComplete = true,
}) {
  const imageVerdicts = images.map((image) => ({
    image,
    verdict: decideImage(image),
  }));

  const classificationVerdict = decideClassification(classification);

  const reasons = new Set();

  for (const { verdict } of imageVerdicts) {
    verdict.blockIssues.forEach((code) => reasons.add(code));
    verdict.reviewIssues.forEach((code) => reasons.add(code));
  }

  classificationVerdict.reviewIssues.forEach((code) => reasons.add(code));

  if (!images.length) reasons.add("NO_IMAGES");

  const anyBlock = imageVerdicts.some(
    ({ verdict }) => verdict.decision === DECISIONS.BLOCK_PUBLICATION
  );

  const anyReview =
    !images.length ||
    !classificationVerdict.ok ||
    imageVerdicts.some(
      ({ verdict }) => verdict.decision === DECISIONS.NEEDS_ADMIN_REVIEW
    );

  let decision = anyBlock
    ? DECISIONS.BLOCK_PUBLICATION
    : anyReview
      ? DECISIONS.NEEDS_ADMIN_REVIEW
      : DECISIONS.AUTO_APPROVE;

  if (decision === DECISIONS.AUTO_APPROVE && previouslyRejectedByAdmin) {
    decision = DECISIONS.NEEDS_ADMIN_REVIEW;
    reasons.add("PREVIOUSLY_REJECTED_BY_ADMIN");
  }

  /*
   * GPSR: un produs altfel conform nu se publică automat fără datele de
   * siguranță. Nu e blocare (BLOCK are prioritate, fiind evaluat mai
   * sus) și nu schimbă aprobarea manuală - doar oprește auto-aprobarea.
   * Vendorul primește un mesaj acționabil (vezi
   * buildVendorModerationReport), nu mesajul neutru.
   */
  if (decision === DECISIONS.AUTO_APPROVE && gpsrComplete === false) {
    decision = DECISIONS.NEEDS_ADMIN_REVIEW;
    reasons.add("GPSR_INCOMPLETE");
  }

  const confidences = [
    ...images.map((image) => clamp01(image?.confidence)),
    clamp01(classification?.confidence),
  ].filter((value) => value !== null);

  return {
    decision,
    confidence: confidences.length ? Math.min(...confidences) : 0,
    reasons: [...reasons],
    images: imageVerdicts.map(({ image, verdict }) => ({
      ...image,
      decision: verdict.decision,
      issues: [...verdict.blockIssues, ...verdict.reviewIssues],
      blockIssues: verdict.blockIssues,
      message: verdict.blockIssues.length
        ? verdict.blockIssues
            .map((code) => VENDOR_ISSUE_MESSAGES[code])
            .filter(Boolean)
            .join(" ")
        : null,
    })),
  };
}

/* =========================================================
   Apel OpenAI
========================================================= */

function buildPrompt({ text, imageLabels }) {
  return `
Ești sistemul de moderare a produselor pentru Artfest, un marketplace românesc de produse handmade.

Analizează imaginile (${imageLabels}) și textul produsului. Răspunde STRICT după schema JSON cerută.

PENTRU FIECARE IMAGINE (imageIndex = numărul din eticheta „Imagine #N” de dinaintea imaginii):
- hasPhoneNumber: un număr de telefon vizibil, folosit pentru contact.
- hasEmail: o adresă de email vizibilă.
- hasUrl: un website, domeniu sau link vizibil (www, .ro, .com etc.).
- hasSocialHandle: un @utilizator sau numele unui cont de social media / aplicație de mesagerie, folosit ca date de contact.
- hasQrCode: orice cod QR vizibil.
- hasLogo: un logo grafic ADĂUGAT peste fotografie (nu marca meșterului imprimată/gravată fizic pe produs).
- hasWatermark: un watermark suprapus peste fotografie.
- hasPromotionalText: text promoțional suprapus peste fotografie (reduceri, sloganuri, prețuri).
- isPromotionalMaterial: imaginea este un banner / flyer / reclamă, NU o fotografie a produsului.
- productVisible: produsul este vizibil clar în imagine.
- looksLikeStockPhoto: pare o fotografie de catalog/stoc a unui produs de serie (fundal de catalog de producător, imagine de pe alt site).
- confidence: cât de sigur ești pe analiza ACESTEI imagini (0-1).
- reasons: motive scurte, în română, doar pentru problemele găsite.
Nu marca drept date de contact etichete de mărime, dimensiuni, prețuri sau textul decorativ al produsului (ex. un nume personalizat gravat pe produs, un mesaj pe o felicitare).

CLASIFICAREA PRODUSULUI (din imagini + text):
- type: HANDMADE (lucrat manual / artizanal), PERSONALIZED (handmade personalizat), DIGITAL (produs digital), INDUSTRIAL (produs de serie), POSSIBLE_RESELL (pare revândut), UNKNOWN (neclar).
- handmadeConfidence: 0-1, cât de probabil e handmade.
- possibleResell: true doar dacă există semnale concrete de revânzare.
- textHasContactInfo: textul produsului conține telefon / email / link / cont social pentru contact în afara platformei.
- confidence: cât de sigur ești pe clasificare (0-1).
- reasons / signals: motive și semnale scurte, în română.
Nu decide arbitrar că un produs „nu este handmade”: dacă nu e clar, folosește UNKNOWN cu confidence mic.

TEXTUL PRODUSULUI (JSON):
${JSON.stringify(text).slice(0, 6000)}
`.trim();
}

async function callOpenAiModeration({ client, model, timeoutMs, batch, text }) {
  const content = [
    {
      type: "input_text",
      text: buildPrompt({
        text,
        imageLabels: batch.map((item) => `#${item.index + 1}`).join(", "),
      }),
    },
  ];

  for (const item of batch) {
    content.push({ type: "input_text", text: `Imagine #${item.index + 1}:` });
    content.push({ type: "input_image", image_url: item.url, detail: "high" });
  }

  const response = await client.responses.create(
    {
      model,
      text: {
        format: {
          type: "json_schema",
          name: "product_moderation",
          strict: true,
          schema: MODERATION_JSON_SCHEMA,
        },
      },
      input: [{ role: "user", content }],
    },
    { timeout: timeoutMs }
  );

  let parsed = null;

  try {
    parsed = JSON.parse(response?.output_text || "");
  } catch {
    parsed = null;
  }

  // imageIndex din prompt e 1-based (eticheta „Imagine #N”)
  const validated = validateModerationResponse(
    parsed,
    batch.map((item) => item.index + 1)
  );

  if (!validated) {
    throw new Error("invalid_ai_response");
  }

  return validated;
}

/* =========================================================
   Rulare completă (nu aruncă niciodată)
========================================================= */

/*
 * Returnează noul obiect aiModeration (de salvat în Product.aiModeration).
 * Orice eroare/timeout/răspuns invalid -> imaginile/clasificarea
 * neanalizate rămân `analyzed: false` -> NEEDS_ADMIN_REVIEW cu motiv
 * intern AI_ANALYSIS_UNAVAILABLE (fără să fie cache-uite, deci se
 * reîncearcă la următoarea salvare).
 */
export async function runProductModeration({
  product,
  previous = null,
  previouslyRejectedByAdmin = false,
  client,
  env = process.env,
  now = () => new Date(),
}) {
  const text = buildModerationText(product);
  const textHash = hashModerationText(product);

  const plan = planModerationRun({
    images: product?.images,
    textHash,
    previous,
  });

  const analyzedAt = now().toISOString();
  const model = getModel(env);
  const fresh = new Map();

  let classification = plan.previousClassification;
  let aiCalls = 0;
  let aiError = null;

  const work = [...plan.toAnalyze];

  // clasificarea are nevoie de imaginea principală + text
  if (
    plan.needsClassification &&
    plan.coverUrl &&
    !work.some((item) => item.index === 0)
  ) {
    work.unshift({ index: 0, url: plan.coverUrl });
  }

  const batches = [];

  for (let i = 0; i < work.length; i += MAX_IMAGES_PER_CALL) {
    batches.push(work.slice(i, i + MAX_IMAGES_PER_CALL));
  }

  for (const batch of batches) {
    try {
      if (!client?.responses?.create) {
        throw new Error("openai_client_unavailable");
      }

      aiCalls += 1;

      const result = await callOpenAiModeration({
        client,
        model,
        timeoutMs: getTimeoutMs(env),
        batch,
        text,
      });

      for (const item of batch) {
        const imageResult = result.imagesByIndex.get(item.index + 1);

        fresh.set(item.url, {
          index: item.index,
          url: item.url,
          analyzed: true,
          checks: imageResult.checks,
          confidence: imageResult.confidence,
          reasons: imageResult.reasons,
          analyzedAt,
        });
      }

      if (plan.needsClassification && !classification) {
        classification = {
          ...result.classification,
          analyzed: true,
          coverUrl: plan.coverUrl,
          analyzedAt,
        };
      }
    } catch (error) {
      aiError = error;
      console.error(
        "[product-ai-moderation] OpenAI analysis failed:",
        error?.message || error
      );
    }
  }

  const images = plan.urls.map((url, index) => {
    const cached = plan.reused.find((item) => item.url === url);
    const analyzed = fresh.get(url);

    if (analyzed) return { ...analyzed, index };
    if (cached) return { ...cached, index };

    return { index, url, analyzed: false };
  });

  if (!classification) {
    classification = { analyzed: false, coverUrl: plan.coverUrl };
  }

  const decisionResult = decideProductModeration({
    images,
    classification,
    previouslyRejectedByAdmin,
    gpsrComplete: isGpsrComplete(product),
  });

  const reasons = new Set(decisionResult.reasons);

  if (aiError) reasons.add("AI_ANALYSIS_UNAVAILABLE");

  return {
    version: MODERATION_VERSION,
    decision: decisionResult.decision,
    confidence: decisionResult.confidence,
    reasons: [...reasons],
    images: decisionResult.images,
    classification,
    // persistent până la o aprobare de admin - vezi
    // isAdminReviewRequired (altfel, după primul reset, a doua editare
    // ar fi putut auto-aproba un produs respins manual)
    adminReviewRequired: previouslyRejectedByAdmin === true,
    textHash,
    model,
    aiCalls,
    analyzedAt,
  };
}

/*
 * Un produs respins / cu modificări cerute MANUAL de un admin nu se poate
 * auto-aproba la nicio retrimitere ulterioară, până când un admin îl
 * aprobă explicit (atunci statusul devine APPROVED și regula nu se mai
 * aplică). Primul reset șterge reviewedByUserId, deci marcajul trebuie
 * citit și din aiModeration.adminReviewRequired.
 */
export function isAdminReviewRequired(product) {
  if (!product) return false;

  const status = String(product.moderationStatus || "").toUpperCase();

  if (
    ["REJECTED", "CHANGES_REQUESTED"].includes(status) &&
    Boolean(product.reviewedByUserId)
  ) {
    return true;
  }

  return (
    status !== "APPROVED" &&
    product.aiModeration?.adminReviewRequired === true
  );
}

/* =========================================================
   Mapare pe produs + raport vendor
========================================================= */

export function buildBlockMessage(aiModeration) {
  const lines = (aiModeration?.images || [])
    .filter((image) => image.blockIssues?.length)
    .map((image) => `Imaginea ${image.index + 1}: ${image.message}`);

  return [VENDOR_BLOCK_SUMMARY, ...lines].join("\n");
}

/*
 * Patch-ul de status pentru produs, pe statusurile EXISTENTE.
 * Nu atinge isActive/isHidden: un produs ne-APPROVED nu apare public
 * (la fel ca orice produs PENDING nou).
 */
export function buildModerationStatusPatch(aiModeration, now = new Date()) {
  switch (aiModeration?.decision) {
    case DECISIONS.AUTO_APPROVE:
      return {
        moderationStatus: "APPROVED",
        moderationMessage: null,
        reviewedAt: now,
        reviewedByUserId: null,
        approvedAt: now,
      };

    case DECISIONS.BLOCK_PUBLICATION:
      return {
        moderationStatus: "CHANGES_REQUESTED",
        moderationMessage: buildBlockMessage(aiModeration),
        reviewedAt: now,
        reviewedByUserId: null,
        approvedAt: null,
      };

    default:
      return {
        moderationStatus: "PENDING",
        moderationMessage: null,
        reviewedAt: null,
        reviewedByUserId: null,
        approvedAt: null,
      };
  }
}

/*
 * Ce vede vendorul - fără coduri tehnice / motive interne. Doar pentru
 * produse ne-aprobate (produsele aprobate nu au nevoie de raport, iar
 * mapProduct e folosit și în listări publice).
 */
/*
 * Singurul lucru care a oprit auto-aprobarea e GPSR-ul incomplet (AI-ul
 * în sine era AUTO_APPROVE).
 */
export function isBlockedOnlyByGpsr(aiModeration) {
  return Boolean(
    aiModeration &&
      aiModeration.version === MODERATION_VERSION &&
      aiModeration.decision === DECISIONS.NEEDS_ADMIN_REVIEW &&
      Array.isArray(aiModeration.reasons) &&
      aiModeration.reasons.length === 1 &&
      aiModeration.reasons[0] === "GPSR_INCOMPLETE"
  );
}

/*
 * Reevaluare LOCALĂ după completarea GPSR (fără apel AI: imaginile și
 * clasificarea vin din cache-ul lui aiModeration). Doar pentru produse
 * PENDING oprite exclusiv de GPSR și doar dacă vendorul chiar a
 * schimbat un câmp GPSR. Produsele APPROVED nu sunt atinse; produsele
 * vechi fără aiModeration nu sunt reevaluate aici.
 */
export function needsGpsrReevaluation(product, gpsrPatch = {}) {
  if (!product || product.moderationStatus !== "PENDING") return false;
  if (!isBlockedOnlyByGpsr(product.aiModeration)) return false;

  return GPSR_PRODUCT_FIELDS.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(gpsrPatch, field) &&
      (gpsrPatch[field] ?? null) !== (product[field] ?? null)
  );
}

export function buildVendorModerationReport(
  aiModeration,
  moderationStatus,
  reviewedByUserId = null,
  product = null
) {
  if (!aiModeration || aiModeration.version !== MODERATION_VERSION) {
    return null;
  }

  // un admin a decis după AI -> vendorul vede mesajul adminului, nu AI-ul
  if (reviewedByUserId) {
    return null;
  }

  const status = String(moderationStatus || "").toUpperCase();

  if (
    aiModeration.decision === DECISIONS.BLOCK_PUBLICATION &&
    status === "CHANGES_REQUESTED"
  ) {
    return {
      decision: DECISIONS.BLOCK_PUBLICATION,
      message: VENDOR_BLOCK_SUMMARY,
      images: (aiModeration.images || [])
        .filter((image) => image.blockIssues?.length)
        .map((image) => ({
          index: image.index,
          position: image.index + 1,
          url: image.url,
          issues: image.blockIssues,
          messages: image.blockIssues
            .map((code) => VENDOR_ISSUE_MESSAGES[code])
            .filter(Boolean),
        })),
    };
  }

  if (
    aiModeration.decision === DECISIONS.NEEDS_ADMIN_REVIEW &&
    status === "PENDING"
  ) {
    /*
     * Oprit DOAR de GPSR -> mesaj acționabil + ce lipsește (calculat pe
     * datele curente ale produsului), fără codul intern.
     */
    const missingGpsr =
      product && isBlockedOnlyByGpsr(aiModeration)
        ? describeMissingGpsr(product)
        : [];

    if (missingGpsr.length) {
      return {
        decision: DECISIONS.NEEDS_ADMIN_REVIEW,
        action: "COMPLETE_GPSR",
        message: VENDOR_GPSR_MESSAGE,
        missing: missingGpsr,
        images: [],
      };
    }

    return {
      decision: DECISIONS.NEEDS_ADMIN_REVIEW,
      message: VENDOR_REVIEW_MESSAGE,
      images: [],
    };
  }

  return null;
}

/*
 * Rulează moderarea pentru un produs deja salvat și îi aplică statusul.
 * Nu aruncă: dacă ceva neprevăzut eșuează, produsul rămâne cum a fost
 * salvat (PENDING -> coada admin, comportamentul dinainte).
 */
export async function moderateSavedProduct({
  prisma,
  product,
  previous = null,
  previouslyRejectedByAdmin = false,
  client,
  env = process.env,
}) {
  if (!product?.id || !isProductAiModerationEnabled(env)) {
    return product;
  }

  try {
    const aiModeration = await runProductModeration({
      product,
      previous,
      previouslyRejectedByAdmin,
      client,
      env,
    });

    return await prisma.product.update({
      where: { id: product.id },
      data: {
        aiModeration,
        ...buildModerationStatusPatch(aiModeration),
      },
    });
  } catch (error) {
    console.error(
      "[product-ai-moderation] could not apply moderation:",
      error?.message || error
    );

    return product;
  }
}
