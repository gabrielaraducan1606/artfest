import { Router } from "express";
import { toFile } from "openai/uploads";

import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";

import { openai } from "../lib/openai.js";

import {
  CATEGORIES,
  CATEGORY_LABELS,
} from "../constants/categories.js";

import {
  COLORS,
  COLOR_LABELS,
} from "../constants/colors.js";

import {
  MAX_BATCH_CLUSTER_IMAGES,
} from "../constants/aiLimits.js";

const router = Router();

const aiVendorAccess = [
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
];

const ORDER_MODES = new Set([
  "READY_TO_BUY",
  "OPTIONS",
  "QUOTE_ONLY",
]);

const AVAILABILITIES = new Set([
  "READY",
  "MADE_TO_ORDER",
  "PREORDER",
  "SOLD_OUT",
]);

/* ======================================================
   Helpers
====================================================== */

function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Încercăm să extragem primul obiect JSON.
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(
        raw.slice(start, end + 1)
      );
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function makeSchemaKey(value) {
  return normalizeText(value)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function cleanArray(value, max = 8) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      source
        .map((item) =>
          String(item || "").trim()
        )
        .filter(Boolean)
    )
  ).slice(0, max);
}

function cleanOptionValues(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || "").trim()
        )
        .filter(Boolean)
    )
  ).slice(0, 50);
}

function cleanSchemaArray(
  value,
  { selectOnly = false } = {}
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowedTypes = selectOnly
    ? new Set(["select"])
    : new Set([
        "text",
        "textarea",
        "date",
        "file",
      ]);

  const seen = new Set();

  return value
    .map((field) => {
      const label = String(
        field?.label || ""
      ).trim();

      const key = makeSchemaKey(
        field?.key || label
      );

      if (
        !key ||
        !label ||
        seen.has(key)
      ) {
        return null;
      }

      seen.add(key);

      const rawType = String(
        field?.type || ""
      ).trim();

      const type = allowedTypes.has(rawType)
        ? rawType
        : selectOnly
          ? "select"
          : "text";

      return {
        key,
        label,
        type,
        required: !!field?.required,

        ...(type === "select"
          ? {
              options: cleanOptionValues(
                field?.options
              ),

              sellerCanAddValues:
                field?.sellerCanAddValues !==
                false,
            }
          : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function defaultQuoteSchema() {
  return [
    {
      key: "description",
      label: "Descriere cerere",
      type: "textarea",
      required: true,
    },
    {
      key: "inspiration_images",
      label: "Poze inspirație",
      type: "file",
      required: false,
    },
  ];
}

function normalizeConfidence(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(
    0,
    Math.min(1, parsed)
  );
}

function normalizeImageUrls(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || "").trim()
        )
        .filter(
          (item) =>
            /^https?:\/\//i.test(item) ||
            /^data:image\//i.test(item)
        )
    )
  ).slice(0, 4);
}

function normalizeOrderMode(
  value,
  fallback = "READY_TO_BUY"
) {
  const mode = String(value || "")
    .trim()
    .toUpperCase();

  if (mode === "DIRECT") {
    return "READY_TO_BUY";
  }

  if (mode === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  return ORDER_MODES.has(mode)
    ? mode
    : fallback;
}

function normalizeAvailability(
  value,
  fallback = ""
) {
  const availability = String(value || "")
    .trim()
    .toUpperCase();

  return AVAILABILITIES.has(availability)
    ? availability
    : fallback;
}

function cleanHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const role =
        entry?.role === "assistant"
          ? "assistant"
          : "user";

      const text = String(
        entry?.text ||
          entry?.content ||
          ""
      )
        .trim()
        .slice(0, 1500);

      if (!text) {
        return null;
      }

      return {
        role,
        text,
      };
    })
    .filter(Boolean)
    .slice(-10);
}

function cleanProductContext(value) {
  const product =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};

  return {
    title: String(product.title || "")
      .trim()
      .slice(0, 160),

    description: String(
      product.description || ""
    )
      .trim()
      .slice(0, 5000),

    category: String(
      product.category || ""
    )
      .trim()
      .slice(0, 100),

    color: String(product.color || "")
      .trim()
      .slice(0, 100),

    materialMain: String(
      product.materialMain || ""
    )
      .trim()
      .slice(0, 200),

    technique: String(
      product.technique || ""
    )
      .trim()
      .slice(0, 200),

    dimensions: String(
      product.dimensions || ""
    )
      .trim()
      .slice(0, 200),

    price:
      product.price === "" ||
      product.price == null
        ? null
        : Number(product.price),

    availability:
      normalizeAvailability(
        product.availability
      ),

    readyQty:
      product.readyQty === "" ||
      product.readyQty == null
        ? null
        : Number(product.readyQty),

    leadTimeDays:
      product.leadTimeDays === "" ||
      product.leadTimeDays == null
        ? null
        : Number(product.leadTimeDays),

    orderMode: normalizeOrderMode(
      product.orderMode
    ),

    optionsSchema: cleanSchemaArray(
      product.optionsSchema,
      {
        selectOnly: true,
      }
    ),

    customSchema: cleanSchemaArray(
      product.customSchema
    ),

    quoteSchema: cleanSchemaArray(
      product.quoteSchema
    ),
  };
}

function sanitizeAssistantPatch(
  rawPatch,
  currentProduct
) {
  const raw =
    rawPatch &&
    typeof rawPatch === "object" &&
    !Array.isArray(rawPatch)
      ? rawPatch
      : {};

  const patch = {};

  const mode = normalizeOrderMode(
    raw.orderMode,
    currentProduct.orderMode ||
      "READY_TO_BUY"
  );

  patch.orderMode = mode;

  const availability =
    normalizeAvailability(
      raw.availability,
      currentProduct.availability || ""
    );

  if (availability) {
    patch.availability =
      availability;
  }

  if (
    raw.price !== null &&
    raw.price !== undefined &&
    raw.price !== "" &&
    Number.isFinite(Number(raw.price))
  ) {
    patch.price = Math.max(
      0,
      Number(raw.price)
    );
  }

  if (
    raw.readyQty !== null &&
    raw.readyQty !== undefined &&
    raw.readyQty !== "" &&
    Number.isFinite(
      Number(raw.readyQty)
    )
  ) {
    patch.readyQty = Math.max(
      0,
      Math.floor(
        Number(raw.readyQty)
      )
    );
  }

  if (
    raw.leadTimeDays !== null &&
    raw.leadTimeDays !== undefined &&
    raw.leadTimeDays !== "" &&
    Number.isFinite(
      Number(raw.leadTimeDays)
    )
  ) {
    patch.leadTimeDays = Math.max(
      1,
      Math.floor(
        Number(raw.leadTimeDays)
      )
    );
  }

  if (mode === "READY_TO_BUY") {
    patch.optionsSchema = [];
    patch.customSchema = [];
    patch.quoteSchema = [];
  }

  if (mode === "OPTIONS") {
    patch.optionsSchema =
      cleanSchemaArray(
        raw.optionsSchema,
        {
          selectOnly: true,
        }
      );

    patch.customSchema =
      cleanSchemaArray(
        raw.customSchema
      );

    patch.quoteSchema = [];
  }

  if (mode === "QUOTE_ONLY") {
    patch.price = 0;
    patch.optionsSchema = [];
    patch.customSchema = [];

    const quoteSchema =
      cleanSchemaArray(
        raw.quoteSchema
      );

    patch.quoteSchema =
      quoteSchema.length
        ? quoteSchema
        : defaultQuoteSchema();
  }

  return patch;
}

async function imageUrlToFile(
  imageUrl
) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(
      "Nu am putut descărca imaginea."
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "image/png";

  if (
    !contentType.startsWith("image/")
  ) {
    throw new Error(
      "URL-ul nu pare să fie o imagine validă."
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  return toFile(
    buffer,
    "product-image.png",
    {
      type: contentType,
    }
  );
}

/* ======================================================
   Test
====================================================== */

router.get(
  "/test",
  authRequired,
  requireRole("ADMIN"),
  (_req, res) => {
    return res.json({
      ok: true,
      message: "AI route works",
    });
  }
);

/* ======================================================
   Analiză generală produs după imagini
====================================================== */

router.post(
  "/product-analyze",
  aiVendorAccess,
  async (req, res) => {
    try {
      const images =
        normalizeImageUrls(
          req.body?.images
        );

      if (!images.length) {
        return res.status(400).json({
          error: "no_images",
          message:
            "Încarcă cel puțin o imagine pentru analiză AI.",
        });
      }

      const categoriesText =
        CATEGORIES.map(
          (key) =>
            `${key} = ${
              CATEGORY_LABELS[key] ||
              key
            }`
        ).join("\n");

      const colorsText = COLORS.map(
        (key) =>
          `${key} = ${
            COLOR_LABELS[key] || key
          }`
      ).join("\n");

      const response =
        await openai.responses.create({
          model: "gpt-4.1",

          text: {
            format: {
              type: "json_object",
            },
          },

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",

                  text: `
Analizează produsul handmade din imagini pentru un marketplace românesc.

Returnează EXCLUSIV JSON valid, fără markdown.

Trebuie să analizezi:
1. tipul produsului;
2. categoria;
3. materialele și tehnica;
4. culorile;
5. modul probabil de comandă;
6. eventualele variante și personalizări.

Moduri permise:

- READY_TO_BUY:
  produs standard, potrivit pentru cumpărare directă.

- OPTIONS:
  produs care pare să permită alegerea unor variante
  sau completarea unor date de personalizare.

- QUOTE_ONLY:
  proiect complex sau unicat pentru care este probabil
  necesară stabilirea ulterioară a prețului.

Reguli importante:

- Scrie în limba română.
- Nu inventa prețul, stocul sau timpul de realizare.
- Imaginea poate sugera modul comenzii, dar nu confirmă
  informații comerciale.
- Citește și textul vizibil din imagini:
  etichete, arome, culori, variante, dimensiuni, nume sau mesaje.
- Dacă există indicii de text, nume, etichetă ori fotografie
  personalizată, sugerează OPTIONS.
- Dacă există variante vizibile sau listate, sugerează OPTIONS.
- Dacă produsul pare un proiect unic, complex sau făcut complet
  la comandă, poți sugera QUOTE_ONLY.
- Dacă nu există indicii de personalizare, sugerează READY_TO_BUY.
- orderModeConfidence trebuie să fie între 0 și 1.
- Pune întrebări pentru lucrurile care nu pot fi deduse din imagini.
- Alege category DOAR din lista permisă.
- Alege color DOAR din lista permisă.
- Dacă sunt mai multe culori, folosește "multicolor".
- Titlul trebuie să aibă maximum 80 de caractere.
- Descrierea trebuie să aibă 2-4 paragrafe scurte.

Categorii permise:

${categoriesText}

Culori permise:

${colorsText}

Schema exactă a răspunsului:

{
  "title": "",
  "description": "",
  "category": "",
  "materialMain": "",
  "technique": "",
  "color": "",
  "styleTags": [],
  "occasionTags": [],
  "careInstructions": "",
  "specialNotes": "",

  "visualProductType": "",

  "likelyOrderMode": "READY_TO_BUY",
  "orderModeConfidence": 0,
  "orderModeReason": "",

  "likelyOptions": [
    {
      "key": "culoare",
      "label": "Culoare",
      "type": "select",
      "required": true,
      "options": []
    }
  ],

  "likelyCustomFields": [
    {
      "key": "mesaj",
      "label": "Mesaj",
      "type": "textarea",
      "required": false
    }
  ],

  "questions": [],
  "confidence": 0,
  "analysisVersion": "product-vision-v1"
}
`,
                },

                ...images.map(
                  (url) => ({
                    type: "input_image",
                    image_url: url,
                  })
                ),
              ],
            },
          ],
        });

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        return res.status(500).json({
          error: "invalid_ai_json",
          message:
            "Modelul AI nu a returnat un răspuns JSON valid.",
        });
      }

      const likelyOrderMode =
        normalizeOrderMode(
          parsed.likelyOrderMode
        );

      return res.json({
        title: String(
          parsed.title || ""
        )
          .trim()
          .slice(0, 80),

        description: String(
          parsed.description || ""
        ).trim(),

        category:
          CATEGORIES.includes(
            parsed.category
          )
            ? parsed.category
            : "alte",

        materialMain: String(
          parsed.materialMain || ""
        ).trim(),

        technique: String(
          parsed.technique || ""
        ).trim(),

        color: COLORS.includes(
          parsed.color
        )
          ? parsed.color
          : "multicolor",

        styleTags: cleanArray(
          parsed.styleTags
        ),

        occasionTags: cleanArray(
          parsed.occasionTags
        ),

        careInstructions: String(
          parsed.careInstructions || ""
        ).trim(),

        specialNotes: String(
          parsed.specialNotes || ""
        ).trim(),

        visualProductType: String(
          parsed.visualProductType ||
            ""
        )
          .trim()
          .slice(0, 160),

        likelyOrderMode,

        orderModeConfidence:
          normalizeConfidence(
            parsed.orderModeConfidence
          ) ?? 0,

        orderModeReason: String(
          parsed.orderModeReason || ""
        )
          .trim()
          .slice(0, 1000),

        likelyOptions:
          cleanSchemaArray(
            parsed.likelyOptions,
            {
              selectOnly: true,
            }
          ),

        likelyCustomFields:
          cleanSchemaArray(
            parsed.likelyCustomFields
          ),

        questions: cleanArray(
          parsed.questions,
          8
        ),

        confidence:
          normalizeConfidence(
            parsed.confidence
          ) ?? 0,

        analysisVersion: String(
          parsed.analysisVersion ||
            "product-vision-v1"
        )
          .trim()
          .slice(0, 80),
      });
    } catch (err) {
      console.error(
        "AI product analyze error:",
        err
      );

      return res.status(500).json({
        error:
          "ai_product_analyze_failed",

        message:
          err?.message ||
          "Analiza AI a eșuat.",
      });
    }
  }
);

/* ======================================================
   Grupare AI a fotografiilor pentru import în bulk

   STRICT clustering - primește toate fotografiile unui lot și
   întoarce DOAR grupurile (ce fotografii aparțin aceluiași
   produs) + o încredere + o etichetă scurtă orientativă. NU
   generează descriere/categorie/preț complet - asta rămâne
   exclusiv la /product-analyze, apelat separat per grup, DUPĂ
   ce vendorul confirmă/corectează gruparea (vezi
   handleAnalyzeBatchGroups / handleAnalyzeGroupProducts pe
   frontend - VendorAssistant.jsx).
====================================================== */

function normalizeBatchImages(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const item of value) {
    const id = String(item?.id || "").trim();
    const url = String(item?.url || "").trim();

    if (!id || !url) {
      continue;
    }

    if (
      !/^https?:\/\//i.test(url) &&
      !/^data:image\//i.test(url)
    ) {
      continue;
    }

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push({ id, url });
  }

  return result;
}

router.post(
  "/product-batch-group",
  aiVendorAccess,
  async (req, res) => {
    try {
      const images = normalizeBatchImages(
        req.body?.images
      );

      if (!images.length) {
        return res.status(400).json({
          error: "no_images",
          message:
            "Trimite cel puțin o fotografie pentru grupare.",
        });
      }

      /*
       * Defensiv - frontend-ul e cel care împarte batch-urile mari
       * în loturi de MAX_BATCH_CLUSTER_IMAGES (vezi comentariul
       * din constants/aiLimits.js), dar backend-ul nu are voie să
       * trunchieze silențios peste limită (ar pierde fotografii
       * fără să spună nimănui) - respinge explicit în schimb.
       */
      if (
        images.length >
        MAX_BATCH_CLUSTER_IMAGES
      ) {
        return res.status(400).json({
          error: "too_many_images",

          message: `Poți grupa maximum ${MAX_BATCH_CLUSTER_IMAGES} fotografii într-un singur pas.`,
        });
      }

      /*
       * O singură fotografie - un singur grup, evident, fără
       * să mai cheltuim un apel AI pentru asta.
       */
      if (images.length === 1) {
        return res.json({
          groups: [
            {
              imageIds: [
                images[0].id,
              ],

              confidence: 1,
              label: "",
            },
          ],
        });
      }

      const response =
        await openai.responses.create({
          model: "gpt-4.1",

          text: {
            format: {
              type: "json_object",
            },
          },

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",

                  text: `
Ai ${images.length} fotografii încărcate de un vânzător pe un
marketplace românesc de produse handmade, într-un singur import.
Mai multe fotografii pot aparține ACELUIAȘI produs (unghiuri
diferite, detalii, ambalaj), iar altele pot fi produse diferite.

Fotografiile sunt numerotate mai jos, în ordine, de la 1 la ${images.length}.
Fiecare fotografie este introdusă printr-o etichetă text "Imagine N"
urmată imediat de imaginea respectivă.

Sarcina ta: grupează fotografiile pe produse distincte.

Reguli:
- Fiecare fotografie trebuie să apară în EXACT UN grup.
- Nu inventa fotografii - folosește DOAR numerele 1-${images.length}.
- Referă fotografiile STRICT prin numărul lor (imageIndexes),
  NICIODATĂ prin descriere sau altă identificare.
- confidence (0-1) reflectă cât de sigur ești de gruparea UNUI
  grup anume - pune o valoare mică dacă fotografiile din acel grup
  ar putea la fel de bine fi produse diferite.
- label este o etichetă scurtă orientativă (2-4 cuvinte, română),
  NU o descriere completă de produs.

Răspunde EXCLUSIV cu JSON valid, fără markdown, în formatul:

{
  "groups": [
    { "imageIndexes": [1, 2], "confidence": 0.9, "label": "Cercei aurii" },
    { "imageIndexes": [3], "confidence": 0.6, "label": "Brățară piele" }
  ]
}
`,
                },

                ...images.flatMap(
                  (image, index) => [
                    {
                      type: "input_text",
                      text: `Imagine ${index + 1}:`,
                    },
                    {
                      type: "input_image",
                      image_url: image.url,
                    },
                  ]
                ),
              ],
            },
          ],
        });

      const parsed = safeJsonParse(
        response.output_text
      );

      const rawGroups = Array.isArray(
        parsed?.groups
      )
        ? parsed.groups
        : [];

      const assigned = new Set();
      const groups = [];

      for (const rawGroup of rawGroups) {
        const indexes = Array.isArray(
          rawGroup?.imageIndexes
        )
          ? rawGroup.imageIndexes
          : [];

        const imageIds = [];

        for (const rawIndex of indexes) {
          const index = Number(rawIndex);

          if (
            !Number.isInteger(index) ||
            index < 1 ||
            index > images.length
          ) {
            continue;
          }

          const image =
            images[index - 1];

          if (
            !image ||
            assigned.has(image.id)
          ) {
            continue;
          }

          assigned.add(image.id);
          imageIds.push(image.id);
        }

        if (!imageIds.length) {
          continue;
        }

        groups.push({
          imageIds,

          confidence:
            normalizeConfidence(
              rawGroup?.confidence
            ) ?? 0,

          label: String(
            rawGroup?.label || ""
          )
            .trim()
            .slice(0, 60),
        });
      }

      /*
       * Orice fotografie pe care modelul n-a menționat-o deloc
       * devine propriul ei grup, cu confidence null (frontend-ul
       * o marchează explicit "de verificat") - nicio fotografie nu
       * se pierde din grupare, indiferent cât de neclar/incomplet
       * răspunde modelul.
       */
      for (const image of images) {
        if (assigned.has(image.id)) {
          continue;
        }

        groups.push({
          imageIds: [image.id],
          confidence: null,
          label: "",
        });
      }

      return res.json({ groups });
    } catch (err) {
      console.error(
        "AI product batch group error:",
        err
      );

      return res.status(500).json({
        error:
          "ai_product_batch_group_failed",

        message:
          err?.message ||
          "Gruparea AI a fotografiilor a eșuat.",
      });
    }
  }
);

/* ======================================================
   Asistent conversațional pentru modul de comandă
====================================================== */

router.post(
  "/product-order-assistant",
  aiVendorAccess,
  async (req, res) => {
    try {
      /*
       * Suportă atât formatul nou:
       * { message, form/product, history, images, visionAnalysis }
       *
       * cât și formatul vechi:
       * { sellerNotes, product }
       */
      const message = String(
        req.body?.message ??
          req.body?.sellerNotes ??
          ""
      )
        .trim()
        .slice(0, 3000);

      const history = cleanHistory(
        req.body?.history
      );

      const rawProduct =
        req.body?.product ||
        req.body?.form ||
        {};

      const product =
        cleanProductContext(
          rawProduct
        );

      const images =
        normalizeImageUrls(
          Array.isArray(
            req.body?.images
          ) &&
            req.body.images.length
            ? req.body.images
            : rawProduct?.images
        );

      const visionAnalysis =
        req.body?.visionAnalysis &&
        typeof req.body
          .visionAnalysis ===
          "object" &&
        !Array.isArray(
          req.body.visionAnalysis
        )
          ? req.body.visionAnalysis
          : null;

      if (
        !message &&
        !images.length &&
        !visionAnalysis
      ) {
        return res.status(400).json({
          error: "missing_context",

          message:
            "Adaugă o imagine sau câteva detalii despre produs.",
        });
      }

      const response =
        await openai.responses.create({
          model: "gpt-4.1",

          text: {
            format: {
              type: "json_object",
            },
          },

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",

                  text: `
Ești asistentul conversațional ArtFest pentru configurarea comenzilor produselor handmade.

Trebuie să deduci modul probabil de comandă folosind împreună:

1. imaginile produsului;
2. analiza vizuală anterioară;
3. informațiile deja completate în formular;
4. mesajul curent al vânzătorului;
5. istoricul conversației.

Moduri permise:

- READY_TO_BUY:
  produs standard, cumpărare directă.

- OPTIONS:
  clientul alege variante și/sau completează
  date pentru personalizare.

- QUOTE_ONLY:
  proiect complex sau unicat, cu preț stabilit ulterior.

Reguli:

- Nu folosi CUSTOMIZABLE.
- Personalizarea se reprezintă prin:
  orderMode = OPTIONS
  și câmpuri în customSchema.

- Imaginile pot sugera modul comenzii, dar nu confirmă
  stocul, prețul sau timpul de realizare.

- Nu inventa:
  prețul,
  cantitatea în stoc,
  termenul de realizare.

- Dacă informația nu este sigură, păstrează valoarea existentă
  și formulează o întrebare.

- Citește textul vizibil din imagini:
  etichete, arome, culori, variante, nume, mesaje și dimensiuni.

- Dacă există indicii clare de variante sau personalizare,
  folosește OPTIONS.

- Dacă există indicii clare de proiect complex, unicat
  sau preț dependent de cerințe, folosește QUOTE_ONLY.

- Dacă nu există indicii de personalizare,
  păstrează sau sugerează READY_TO_BUY.

- Pentru OPTIONS poți returna simultan:
  optionsSchema și customSchema.

- Pentru QUOTE_ONLY:
  price trebuie să fie 0.

- Răspunde în română.
- Returnează EXCLUSIV JSON valid, fără markdown.

Produs curent:

${JSON.stringify(
  product,
  null,
  2
)}

Analiză vizuală existentă:

${JSON.stringify(
  visionAnalysis,
  null,
  2
)}

Istoric conversație:

${JSON.stringify(
  history,
  null,
  2
)}

Mesaj curent:

${message}

Schema exactă:

{
  "message": "",

  "patch": {
    "price": null,
    "readyQty": null,
    "leadTimeDays": null,

    "availability": "",

    "orderMode": "READY_TO_BUY",

    "optionsSchema": [
      {
        "key": "aroma",
        "label": "Aromă",
        "type": "select",
        "required": true,
        "options": []
      }
    ],

    "customSchema": [
      {
        "key": "mesaj",
        "label": "Mesaj",
        "type": "textarea",
        "required": false
      }
    ],

    "quoteSchema": []
  },

  "suggestions": [],
  "visionAnalysis": {},
  "confidence": 0,
  "orderModeReason": "",
  "questions": [],
  "analysisVersion": "product-order-vision-v1"
}
`,
                },

                ...images.map(
                  (url) => ({
                    type: "input_image",
                    image_url: url,
                  })
                ),
              ],
            },
          ],
        });

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        return res.status(500).json({
          error: "invalid_ai_json",

          message:
            "Modelul AI nu a returnat un răspuns JSON valid.",
        });
      }

      const safePatch =
        sanitizeAssistantPatch(
          parsed.patch || parsed,
          product
        );

      const confidence =
        normalizeConfidence(
          parsed.confidence
        );

      const safeVisionAnalysis =
        parsed.visionAnalysis &&
        typeof parsed
          .visionAnalysis ===
          "object" &&
        !Array.isArray(
          parsed.visionAnalysis
        )
          ? parsed.visionAnalysis
          : visionAnalysis;

      return res.json({
        message: String(
          parsed.message ||
            "Am analizat imaginile și configurația produsului."
        )
          .trim()
          .slice(0, 2000),

        patch: safePatch,

        suggestions: cleanArray(
          parsed.suggestions,
          6
        ),

        visionAnalysis:
          safeVisionAnalysis || null,

        confidence,

        orderModeReason: String(
          parsed.orderModeReason ||
            ""
        )
          .trim()
          .slice(0, 1000),

        questions: cleanArray(
          parsed.questions,
          8
        ),

        analysisVersion: String(
          parsed.analysisVersion ||
            "product-order-vision-v1"
        )
          .trim()
          .slice(0, 80),
      });
    } catch (err) {
      console.error(
        "AI product order assistant error:",
        err
      );

      return res.status(500).json({
        error:
          "ai_product_order_assistant_failed",

        message:
          err?.message ||
          "Configurarea comenzii cu AI a eșuat.",
      });
    }
  }
);

/* ======================================================
   Îmbunătățire imagine
====================================================== */

router.post(
  "/product-image-enhance",
  aiVendorAccess,
  async (req, res) => {
    try {
      const imageUrl = String(
        req.body?.imageUrl || ""
      ).trim();

      const variant = Number(
        req.body?.variant || 1
      );

      if (!imageUrl) {
        return res.status(400).json({
          error: "no_image",
          message:
            "Trimite imageUrl pentru editare.",
        });
      }

      const imageFile =
        await imageUrlToFile(
          imageUrl
        );

      /*
       * AUDIT UX/conservare 2026-09-17: filozofia s-a schimbat de la
       * "edit the photo" la "conservative professional photo RETOUCH"
       * - obiectivul explicit al vendorului nu mai e "o fotografie
       * nouă inspirată din produs", ci "aceeași fotografie, retușată
       * profesionist". Sursa e ground truth: unghiul de cameră,
       * perspectiva, poziția/scara produsului în cadru și compoziția
       * originală trebuie păstrate, nu doar produsul în sine. Clauza
       * finală ("If a requested improvement risks altering the
       * product... preserve the original instead") e un fail-safe
       * explicit la nivel de model - în caz de ambiguitate, modelul
       * trebuie să aleagă conservator, nu creativ.
       */
      const prompt = `
Perform a CONSERVATIVE PROFESSIONAL PHOTO RETOUCH of the provided
product photograph - comparable to Lightroom/studio retouching, NOT a
new photo and NOT a regeneration.

The source image is the ground truth. The goal is NOT "a new photo
inspired by the product" - the goal is "the exact same photo, retouched
professionally".

The product itself is LOCKED and IMMUTABLE. Preserve it pixel-faithfully,
as much as technically possible:
- exact shape
- exact silhouette
- exact geometry
- exact proportions
- exact dimensions and apparent size
- exact colors
- exact material
- exact texture (fabric weave, crochet patterns, knitting patterns,
  stitching, embroidery, brush strokes, ceramic details, wood grain,
  resin effects - whichever apply)
- exact pattern/print
- exact accessories, ornaments, and decorative elements that are part
  of the product
- exact packaging, if the packaging is part of the product itself
- exact text, inscriptions, and logos on the product
- exact number and position of the product's own components/elements
- exact visible imperfections and handmade details - these are proof
  of authenticity, never remove or "fix" them

Also preserve, as part of the same conservative retouch:
- the exact original camera angle
- the exact original perspective
- the exact original position of the product in the frame
- the exact original scale of the product
- the original composition, as much as possible

DO NOT:
- redesign, regenerate, reinterpret, or reconstruct the product
- move, rotate, or reposition the product
- reshape, smooth, beautify, or "repair" the product
- symmetrize the product
- add anything to the product, or invent product details
- remove anything from the product
- change the product's texture, material, or colors
- add artificial reflections
- invent shadows that change the perceived shape of the product
- replace any part of the product
- change the background into a completely different scene, unless
  strictly necessary to remove a genuinely distracting element
- add new props, new furniture, new room, or new decorations
- use dramatic or stylized lighting
- restyle the product in any way

Treat the product as READ ONLY. Treat only the photographic
presentation as editable - and even there, prefer the smallest
possible change that achieves a professional look.

Only perform subtle photographic improvements, comparable to
professional Lightroom/studio retouching:
- improve exposure
- correct white balance
- subtle contrast
- subtle clarity and sharpness of the overall photo (not of product
  micro-details)
- subtle noise reduction
- gentle background cleanup - remove genuinely distracting background
  imperfections, keep it clean, neutral, and minimalist
- natural shadow cleanup, preserving realistic depth
- slight background blur ONLY if the product's own edges/silhouette
  remain completely untouched and sharp
- no props, no decorations, no additional objects, no text, no logo,
  no watermark added to the background

Style: realistic studio/catalog photography, soft natural light,
no fantasy elements, no exaggerated or busy backgrounds, no strong
artistic effects.

Final requirement:
The result must look like the SAME PHOTO of the SAME real product,
only photographed/retouched more professionally - realistic, premium,
commercial, clean, and natural. It must NOT look AI generated and must
NOT look like a newly generated or restaged product photo.

If a requested improvement risks altering the product or the original
composition in any way, preserve the original instead of applying
that improvement.

Variant: ${variant}
`;

      const result =
        await openai.images.edit({
          model: "gpt-image-1",
          image: imageFile,
          prompt,

          /*
           * "auto" (nu mai "1024x1024" fix) - un canvas pătrat forțat
           * pe o fotografie ne-pătrată ar obliga modelul să recadreze/
           * repoziționeze produsul ca să umple cadrul, exact ce
           * promptul de mai sus cere să NU se întâmple. "auto" lasă
           * gpt-image-1 să păstreze proporția apropiată de original.
           */
          size: "auto",
          quality: "medium",
        });

      const b64 =
        result.data?.[0]?.b64_json;

      if (!b64) {
        return res.status(500).json({
          error:
            "no_image_generated",

          message:
            "OpenAI nu a returnat imaginea editată.",
        });
      }

      return res.json({
        ok: true,
        imageBase64: b64,

        dataUrl:
          `data:image/png;base64,${b64}`,
      });
    } catch (err) {
      console.error(
        "AI image enhance error:",
        err
      );

      return res.status(500).json({
        error:
          "ai_image_enhance_failed",

        message:
          err?.message ||
          "Editarea imaginii a eșuat.",
      });
    }
  }
);

export default router;