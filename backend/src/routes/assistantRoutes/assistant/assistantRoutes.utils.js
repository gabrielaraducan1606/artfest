// src/routes/assistant/assistantProducts.utils.js

/* ======================================================
   Configurare cache
====================================================== */

const SEARCH_CACHE_TTL_MS =
  2 * 60 * 60 * 1000;

const SEARCH_CACHE_CLEANUP_MS =
  10 * 60 * 1000;

const searchCache = new Map();

/*
 * Curățăm periodic căutările expirate.
 *
 * Cache-ul acesta este potrivit pentru dezvoltare și pentru
 * o singură instanță Node.
 *
 * Pentru producție cu mai multe instanțe, mută datele în:
 * - Redis;
 * - un model Prisma;
 * - alt storage partajat.
 */
const cleanupTimer = setInterval(() => {
  deleteExpiredSearches();
}, SEARCH_CACHE_CLEANUP_MS);

cleanupTimer.unref?.();

/* ======================================================
   Texte și normalizare
====================================================== */

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanDisplayText(
  value,
  maxLength = 1000
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeArray(
  value,
  max = 10
) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return Array.from(
    new Set(
      source
        .map((item) =>
          normalizeText(item)
        )
        .filter(Boolean)
    )
  ).slice(0, max);
}

export function normalizeNullableInteger(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(
    0,
    Math.round(parsed)
  );
}

/* ======================================================
   Buget
====================================================== */

export function normalizeBudget({
  minPriceCents,
  maxPriceCents,
  budgetLabel,
} = {}) {
  const normalizedMin =
    normalizeNullableInteger(
      minPriceCents
    );

  const normalizedMax =
    normalizeNullableInteger(
      maxPriceCents
    );

  /*
   * Dacă frontend-ul trimite explicit min/max,
   * acestea au prioritate față de etichetă.
   */
  if (
    normalizedMin !== null ||
    normalizedMax !== null
  ) {
    return {
      minPriceCents:
        normalizedMin,

      maxPriceCents:
        normalizedMax,
    };
  }

  const normalizedLabel =
    cleanDisplayText(
      budgetLabel,
      100
    );

  switch (normalizedLabel) {
    case "Sub 100 lei":
      return {
        minPriceCents: 0,
        maxPriceCents: 10000,
      };

    case "100–250 lei":
    case "100-250 lei":
      return {
        minPriceCents: 10000,
        maxPriceCents: 25000,
      };

    case "250–500 lei":
    case "250-500 lei":
      return {
        minPriceCents: 25000,
        maxPriceCents: 50000,
      };

    case "Peste 500 lei":
      return {
        minPriceCents: 50000,
        maxPriceCents: null,
      };

    default:
      return {
        minPriceCents: null,
        maxPriceCents: null,
      };
  }
}

/* ======================================================
   JSON AI
====================================================== */

export function safeJsonParse(value) {
  let raw = String(value || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Încercăm și extragerea primului obiect JSON.
  }

  const objectStart =
    raw.indexOf("{");

  const objectEnd =
    raw.lastIndexOf("}");

  if (
    objectStart >= 0 &&
    objectEnd > objectStart
  ) {
    try {
      return JSON.parse(
        raw.slice(
          objectStart,
          objectEnd + 1
        )
      );
    } catch {
      // Continuăm cu încercarea pentru array.
    }
  }

  const arrayStart =
    raw.indexOf("[");

  const arrayEnd =
    raw.lastIndexOf("]");

  if (
    arrayStart >= 0 &&
    arrayEnd > arrayStart
  ) {
    try {
      return JSON.parse(
        raw.slice(
          arrayStart,
          arrayEnd + 1
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

/* ======================================================
   Normalizare produs pentru frontend
====================================================== */

function getFirstImageUrl(images) {
  if (
    !Array.isArray(images) ||
    images.length === 0
  ) {
    return "";
  }

  const firstImage =
    images[0];

  if (
    typeof firstImage ===
    "string"
  ) {
    return firstImage;
  }

  if (
    firstImage &&
    typeof firstImage ===
      "object"
  ) {
    return (
      firstImage.url ||
      firstImage.imageUrl ||
      firstImage.src ||
      ""
    );
  }

  return "";
}

function normalizeImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => {
      if (
        typeof image ===
        "string"
      ) {
        return image;
      }

      if (
        image &&
        typeof image ===
          "object"
      ) {
        return (
          image.url ||
          image.imageUrl ||
          image.src ||
          ""
        );
      }

      return "";
    })
    .filter(Boolean);
}

function normalizePriceCents(
  product
) {
  if (
    Number.isInteger(
      product?.priceCents
    )
  ) {
    return Math.max(
      0,
      product.priceCents
    );
  }

  if (
    typeof product?.price ===
      "number" &&
    Number.isFinite(
      product.price
    )
  ) {
    return Math.max(
      0,
      Math.round(
        product.price * 100
      )
    );
  }

  return 0;
}

function normalizeSimilarity(
  similarity
) {
  if (
    typeof similarity !==
      "number" ||
    !Number.isFinite(
      similarity
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(1, similarity)
  );
}

export function normalizeProductForResponse(
  product,
  similarity = null
) {
  const images =
    normalizeImages(
      product?.images
    );

  const service =
    product?.service || null;

  const serviceProfile =
    service?.profile || null;

  const vendor =
    service?.vendor || null;

  return {
    id: String(
      product?.id || ""
    ),

    /*
     * Dacă adaugi ulterior slug în modelul Product,
     * codul îl va folosi automat.
     */
    slug:
      product?.slug || null,

    title:
      cleanDisplayText(
        product?.title ||
          "Produs Artfest",
        300
      ),

    description:
      cleanDisplayText(
        product?.description,
        1200
      ),

    imageUrl:
      getFirstImageUrl(
        product?.images
      ),

    images,

    priceCents:
      normalizePriceCents(
        product
      ),

    currency:
      cleanDisplayText(
        product?.currency ||
          "RON",
        10
      ),

    category:
      product?.category || null,

    color:
      product?.color || null,

    materialMain:
      product?.materialMain ||
      null,

    technique:
      product?.technique ||
      null,

    dimensions:
      product?.dimensions ||
      null,

    specialNotes:
      product?.specialNotes ||
      null,

    styleTags:
      Array.isArray(
        product?.styleTags
      )
        ? product.styleTags
        : [],

    occasionTags:
      Array.isArray(
        product?.occasionTags
      )
        ? product.occasionTags
        : [],

    availability:
      product?.availability ||
      null,

    orderMode:
      product?.orderMode ||
      null,

    acceptsCustom:
      product?.acceptsCustom ===
      true,

    popularityScore:
      Number(
        product?.popularityScore ||
          0
      ),

    similarity:
      normalizeSimilarity(
        similarity
      ),

    service: service
      ? {
          id:
            service.id || null,

          displayName:
            serviceProfile
              ?.displayName ||
            vendor?.displayName ||
            null,

          slug:
            serviceProfile?.slug ||
            null,

          vendorId:
            vendor?.id || null,
        }
      : null,
  };
}

/* ======================================================
   Cache căutări
====================================================== */

function createSearchId() {
  return `vs_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function saveSearch({
  userId = null,
  type,
  query = "",
  analysis = null,
  filters = {},
  products = [],
  nextSuggestions = [],
}) {
  const searchId =
    createSearchId();

  const now = Date.now();

  searchCache.set(
    searchId,
    {
      id: searchId,

      userId:
        userId || null,

      type:
        type || "unknown",

      query:
        cleanDisplayText(
          query,
          2000
        ),

      analysis:
        analysis || null,

      filters:
        filters || {},

      products:
        Array.isArray(
          products
        )
          ? products
          : [],

      nextSuggestions:
        Array.isArray(
          nextSuggestions
        )
          ? nextSuggestions
          : [],

      createdAt: now,

      updatedAt: now,

      expiresAt:
        now +
        SEARCH_CACHE_TTL_MS,
    }
  );

  return searchId;
}

export function readSearch(
  searchId
) {
  const normalizedSearchId =
    cleanDisplayText(
      searchId,
      120
    );

  if (!normalizedSearchId) {
    return null;
  }

  const entry =
    searchCache.get(
      normalizedSearchId
    );

  if (!entry) {
    return null;
  }

  if (
    entry.expiresAt <=
    Date.now()
  ) {
    searchCache.delete(
      normalizedSearchId
    );

    return null;
  }

  return entry;
}

export function updateSearch(
  searchId,
  patch = {}
) {
  const normalizedSearchId =
    cleanDisplayText(
      searchId,
      120
    );

  const current =
    readSearch(
      normalizedSearchId
    );

  if (!current) {
    return null;
  }

  const now = Date.now();

  const updated = {
    ...current,
    ...patch,

    id:
      current.id,

    createdAt:
      current.createdAt,

    updatedAt: now,

    expiresAt:
      now +
      SEARCH_CACHE_TTL_MS,
  };

  searchCache.set(
    normalizedSearchId,
    updated
  );

  return updated;
}

export function deleteSearch(
  searchId
) {
  const normalizedSearchId =
    cleanDisplayText(
      searchId,
      120
    );

  if (!normalizedSearchId) {
    return false;
  }

  return searchCache.delete(
    normalizedSearchId
  );
}

export function deleteExpiredSearches() {
  const now = Date.now();

  let deleted = 0;

  for (
    const [
      searchId,
      entry,
    ] of searchCache.entries()
  ) {
    if (
      entry.expiresAt <= now
    ) {
      searchCache.delete(
        searchId
      );

      deleted += 1;
    }
  }

  return deleted;
}

/* ======================================================
   Debug și statistici cache
====================================================== */

export function getSearchCacheStats() {
  deleteExpiredSearches();

  const entries =
    Array.from(
      searchCache.values()
    );

  return {
    total:
      entries.length,

    guests:
      entries.filter(
        (entry) =>
          !entry.userId
      ).length,

    authenticated:
      entries.filter(
        (entry) =>
          Boolean(entry.userId)
      ).length,

    byType:
      entries.reduce(
        (
          accumulator,
          entry
        ) => {
          const type =
            entry.type ||
            "unknown";

          accumulator[type] =
            (
              accumulator[
                type
              ] || 0
            ) + 1;

          return accumulator;
        },
        {}
      ),
  };
}