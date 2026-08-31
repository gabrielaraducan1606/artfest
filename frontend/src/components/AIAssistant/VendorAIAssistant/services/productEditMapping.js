// src/components/AIAssistant/VendorAIAssistant/services/productEditMapping.js

/*
 * Mapare produs complet (GET /api/vendors/products/:id) -> draft de
 * editare (form pentru ProductModalWizard, via
 * useProductEditorController). Extras din CatalogProduse.jsx
 * (openEditProduct) ca să fie folosit STRICT o singură dată, atât de
 * ecranul "Produsele mele" cât și de flow-ul de chat EDIT_PRODUCT -
 * fără să dubleze cele ~80 de linii de mapare a câmpurilor.
 */
export function mapFullProductToEditDraft(full) {
  return {
    id: full.id || full._id || "",
    title: full.title || "",
    description: full.description || "",
    price:
      typeof full.price === "number"
        ? full.price
        : Number.isFinite(Number(full.priceCents))
          ? Number(full.priceCents) / 100
          : "",
    currency: full.currency || "RON",
    images: Array.isArray(full.images) ? full.images : [],
    videoUrl: full.videoUrl || null,
    videoMuted: !!full.videoMuted,
    category: full.category || "",
    color: full.color || "",
    isActive: full.isActive !== false,
    isHidden: !!full.isHidden,
    availability: String(
      full.availability || "READY"
    ).toUpperCase(),
    leadTimeDays: Number.isFinite(Number(full.leadTimeDays))
      ? String(Number(full.leadTimeDays))
      : "",
    readyQty:
      full.readyQty === null || full.readyQty === undefined
        ? ""
        : Number.isFinite(Number(full.readyQty))
          ? String(Number(full.readyQty))
          : "",
    nextShipDate: full.nextShipDate
      ? String(full.nextShipDate).slice(0, 10)
      : "",
    acceptsCustom: !!full.acceptsCustom,
    orderMode:
      full.orderMode === "DIRECT"
        ? "READY_TO_BUY"
        : full.orderMode === "CUSTOMIZABLE"
          ? "OPTIONS"
          : full.orderMode || "READY_TO_BUY",
    optionsSchema: Array.isArray(full.optionsSchema)
      ? full.optionsSchema
      : Array.isArray(full.optionsSchema?.fields)
        ? full.optionsSchema.fields
        : [],
    customSchema: Array.isArray(full.customSchema)
      ? full.customSchema
      : Array.isArray(full.customSchema?.fields)
        ? full.customSchema.fields
        : [],
    repeatedGroups: Array.isArray(full.repeatedGroups)
      ? full.repeatedGroups
      : [],
    quoteSchema: Array.isArray(full.quoteSchema)
      ? full.quoteSchema
      : Array.isArray(full.quoteSchema?.fields)
        ? full.quoteSchema.fields
        : [],
    materialMain: full.materialMain || "",
    technique: full.technique || "",
    styleTags: Array.isArray(full.styleTags)
      ? full.styleTags.join(", ")
      : full.styleTags || "",
    occasionTags: Array.isArray(full.occasionTags)
      ? full.occasionTags.join(", ")
      : full.occasionTags || "",
    dimensions: full.dimensions || "",
    careInstructions: full.careInstructions || "",
    specialNotes: full.specialNotes || "",
    aiVisionAnalysis: full.aiVisionAnalysis || null,
    aiOrderAnalysis: full.aiOrderAnalysis || null,
    aiGeneratedFields: Array.isArray(full.aiGeneratedFields)
      ? full.aiGeneratedFields
      : [],
    aiSourceImages: Array.isArray(full.aiSourceImages)
      ? full.aiSourceImages
      : [],
    aiAnalysisVersion: full.aiAnalysisVersion || null,
    aiConfidence: full.aiConfidence ?? null,
    aiAnalyzedAt: full.aiAnalyzedAt || null,
    aiManuallyEdited: full.aiManuallyEdited === true,
  };
}

function splitTags(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/*
 * Payload-ul de salvare (identic pentru PUT la editare și POST la
 * produs nou) - extras din CatalogProduse.jsx (handleSaveProduct) ca
 * să fie reutilizat STRICT o singură dată, atât de "Produsele mele"
 * cât și de flow-ul de chat EDIT_PRODUCT (VendorAssistant.jsx), fără
 * să dubleze cele ~250 de linii de mapare a câmpurilor.
 */
export function buildProductSavePayload(
  prodFormValue,
  { title, description, numericPrice }
) {
  const availability = String(
    prodFormValue.availability || "READY"
  ).toUpperCase();

  const payload = {
    title,
    description,

    /*
     * BUGFIX (audit) - QUOTE_ONLY trimite acum prețul orientativ real,
     * exact ca celelalte moduri. Dacă lipsește sau e <= 0, request-ul
     * ajunge la validarea existentă din backend (updateProduct din
     * vendorProductRoutes.js, care cere deja price > 0 pentru toate
     * modurile) - nu mai inventăm 0 aici.
     */
    price: numericPrice,

    currency: prodFormValue.currency || "RON",

    images: Array.isArray(prodFormValue.images)
      ? prodFormValue.images
      : [],

    videoUrl: prodFormValue.videoUrl || null,

    videoMuted: prodFormValue.videoUrl
      ? !!prodFormValue.videoMuted
      : false,

    category: String(
      prodFormValue.category || ""
    ).trim(),

    color:
      String(prodFormValue.color || "").trim() || null,

    materialMain:
      String(prodFormValue.materialMain || "").trim() ||
      null,

    technique:
      String(prodFormValue.technique || "").trim() ||
      null,

    styleTags: splitTags(prodFormValue.styleTags),
    occasionTags: splitTags(prodFormValue.occasionTags),

    dimensions:
      String(prodFormValue.dimensions || "").trim() ||
      null,

    careInstructions:
      String(
        prodFormValue.careInstructions || ""
      ).trim() || null,

    specialNotes:
      String(prodFormValue.specialNotes || "").trim() ||
      null,

    aiVisionAnalysis: prodFormValue.aiVisionAnalysis || null,
    aiOrderAnalysis: prodFormValue.aiOrderAnalysis || null,

    aiGeneratedFields: Array.isArray(
      prodFormValue.aiGeneratedFields
    )
      ? prodFormValue.aiGeneratedFields
      : [],

    aiSourceImages: Array.isArray(
      prodFormValue.aiSourceImages
    )
      ? prodFormValue.aiSourceImages
      : [],

    aiAnalysisVersion: prodFormValue.aiAnalysisVersion || null,
    aiConfidence: prodFormValue.aiConfidence ?? null,
    aiAnalyzedAt: prodFormValue.aiAnalyzedAt || null,

    aiManuallyEdited:
      prodFormValue.aiManuallyEdited === true,

    isActive: prodFormValue.isActive !== false,
    isHidden: !!prodFormValue.isHidden,
    acceptsCustom: !!prodFormValue.acceptsCustom,

    availability,

    orderMode: prodFormValue.orderMode || "READY_TO_BUY",

    optionsSchema:
      prodFormValue.orderMode === "OPTIONS" &&
      Array.isArray(prodFormValue.optionsSchema)
        ? prodFormValue.optionsSchema
        : [],

    customSchema:
      prodFormValue.orderMode === "OPTIONS" &&
      Array.isArray(prodFormValue.customSchema)
        ? prodFormValue.customSchema
        : [],

    repeatedGroups:
      prodFormValue.orderMode === "OPTIONS" &&
      Array.isArray(prodFormValue.repeatedGroups)
        ? prodFormValue.repeatedGroups
        : [],

    quoteSchema:
      prodFormValue.orderMode === "QUOTE_ONLY" &&
      Array.isArray(prodFormValue.quoteSchema)
        ? prodFormValue.quoteSchema
        : [],
  };

  /*
   * Disponibilitate
   */
  if (availability === "READY") {
    payload.readyQty =
      prodFormValue.readyQty === "" ||
      prodFormValue.readyQty === null ||
      prodFormValue.readyQty === undefined
        ? null
        : Math.max(0, Number(prodFormValue.readyQty) || 0);

    payload.leadTimeDays = null;
    payload.nextShipDate = null;
  } else if (availability === "MADE_TO_ORDER") {
    payload.readyQty = 0;

    payload.leadTimeDays = Math.max(
      1,
      Number(prodFormValue.leadTimeDays) || 1
    );

    payload.nextShipDate = null;
  } else if (availability === "PREORDER") {
    payload.readyQty = 0;
    payload.leadTimeDays = null;

    payload.nextShipDate = prodFormValue.nextShipDate
      ? new Date(
          `${prodFormValue.nextShipDate}T12:00:00`
        ).toISOString()
      : null;
  } else if (availability === "SOLD_OUT") {
    payload.readyQty = 0;
    payload.leadTimeDays = null;
    payload.nextShipDate = null;
  }

  return payload;
}

/*
 * Fetch produs complet + mapare la draft, într-un singur loc -
 * folosit de ambele suprafețe de editare (CatalogProduse și chat).
 * Aruncă cu mesaj prietenos dacă răspunsul nu e ok.
 */
export async function fetchProductEditDraft(productId) {
  const response = await fetch(
    `/api/vendors/products/${encodeURIComponent(productId)}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }
  );

  let full = null;

  try {
    full = await response.json();
  } catch {
    full = null;
  }

  if (!response.ok) {
    throw new Error(
      full?.message ||
        full?.error ||
        "Nu am putut încărca produsul pentru editare."
    );
  }

  return {
    full,
    draft: mapFullProductToEditDraft(full),
  };
}

/*
 * Categorii de produs (pentru combobox-ul din ProductDetailsSection) -
 * ACELEAȘI endpointuri ca "Produsele mele" (CatalogProduse.jsx).
 */
export async function fetchProductCategories() {
  const endpoints = [
    "/api/public/categories/detailed",
    "/api/public/categories",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();

      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.categories)
            ? data.categories
            : [];

      if (items.length) {
        return items;
      }
    } catch (error) {
      console.warn(
        `[productEditMapping] categories ${endpoint}:`,
        error
      );
    }
  }

  return [];
}

/*
 * Listă lean de produse (selector) - ACELAȘI endpoint ca "Produsele
 * mele" (CatalogProduse.jsx), ca lista din chat să reflecte mereu
 * exact ce vede vendorul acolo. Nu se face fetch full pe niciun
 * produs din listă - doar după selectare (fetchProductEditDraft).
 */
export async function fetchLeanProductList() {
  const response = await fetch(
    "/api/vendor/catalog/products",
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Nu am putut încărca produsele."
    );
  }

  return Array.isArray(data?.items) ? data.items : [];
}
