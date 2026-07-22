// src/components/AiAssistant/quotes/quoteApi.js

/* =========================================================
   Configurare
========================================================= */

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "";

/* =========================================================
   Request helper
========================================================= */

async function apiRequest(
  endpoint,
  options = {}
) {
  const {
    method = "GET",
    body,
    headers = {},
    signal,
  } = options;

  const requestHeaders = {
    Accept:
      "application/json",

    ...headers,
  };

  const requestOptions = {
    method,

    credentials:
      "include",

    headers:
      requestHeaders,

    signal,
  };

  /*
   * Adăugăm Content-Type doar când
   * trimitem JSON.
   *
   * Pentru FormData nu setăm manual
   * Content-Type.
   */
  if (
    body !== undefined &&
    body !== null
  ) {
    if (
      body instanceof FormData
    ) {
      requestOptions.body =
        body;
    } else {
      requestHeaders[
        "Content-Type"
      ] =
        "application/json";

      requestOptions.body =
        JSON.stringify(
          body
        );
    }
  }

  let response;

  try {
    response =
      await fetch(
        `${API_BASE_URL}${endpoint}`,
        requestOptions
      );
  } catch (error) {
    const networkError =
      new Error(
        "Nu s-a putut realiza conexiunea cu serverul."
      );

    networkError.cause =
      error;

    throw networkError;
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  let data =
    null;

  try {
    if (
      contentType.includes(
        "application/json"
      )
    ) {
      data =
        await response.json();
    } else {
      const text =
        await response.text();

      data =
        text
          ? {
              message:
                text,
            }
          : null;
    }
  } catch {
    data =
      null;
  }

  if (
    !response.ok
  ) {
    const error =
      new Error(
        data?.message ||
          data?.error ||
          `Cererea a eșuat cu statusul ${response.status}.`
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}

/* =========================================================
   Helpers
========================================================= */

function requireId(
  value,
  label = "ID"
) {
  const normalized =
    String(
      value || ""
    ).trim();

  if (!normalized) {
    throw new Error(
      `${label} lipsește.`
    );
  }

  return encodeURIComponent(
    normalized
  );
}

function requireMessage(
  value
) {
  const normalized =
    String(
      value || ""
    ).trim();

  if (!normalized) {
    throw new Error(
      "Mesajul nu poate fi gol."
    );
  }

  return normalized;
}

/* =========================================================
   CLIENT — creare cerere ofertă
========================================================= */

export async function createQuoteRequest({
  productId = null,
  vendorId = null,
  quantity,
  requestData = {},
  quoteSchemaAnswers = {},
}) {
  const normalizedProductId =
    productId
      ? requireId(
          productId,
          "ID-ul produsului"
        )
      : null;

  const normalizedVendorId =
    vendorId
      ? requireId(
          vendorId,
          "ID-ul magazinului"
        )
      : null;

  if (
    !normalizedProductId &&
    !normalizedVendorId
  ) {
    throw new Error(
      "Nu am putut identifica produsul sau magazinul pentru cererea de ofertă."
    );
  }

  const normalizedQuantity =
    Number(
      quantity
    );

  if (
    !Number.isFinite(
      normalizedQuantity
    ) ||
    normalizedQuantity <= 0
  ) {
    throw new Error(
      "Cantitatea trebuie să fie mai mare decât 0."
    );
  }

  return apiRequest(
    "/api/assistant/quotes",
    {
      method:
        "POST",

      body: {
        productId:
          normalizedProductId,

        vendorId:
          normalizedVendorId,

        quantity:
          normalizedQuantity,

        requestData:
          requestData &&
          typeof requestData ===
            "object"
            ? requestData
            : {},

        quoteSchemaAnswers:
          quoteSchemaAnswers &&
          typeof quoteSchemaAnswers ===
            "object"
            ? quoteSchemaAnswers
            : {},
      },
    }
  );
}
/* =========================================================
   CLIENT — lista cererilor
========================================================= */

export async function fetchMyQuotes({
  signal,
} = {}) {
  return apiRequest(
    "/api/assistant/quotes/me",
    {
      signal,
    }
  );
}

/* =========================================================
   CLIENT — detalii cerere
========================================================= */

export async function fetchQuote(
  quoteId,
  {
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/assistant/quotes/${id}`,
    {
      signal,
    }
  );
}

/* =========================================================
   CLIENT — mesaje
========================================================= */

export async function fetchQuoteMessages(
  quoteId,
  {
    offset = 0,
    limit = 100,
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const params =
    new URLSearchParams();

  params.set(
    "offset",
    String(
      Math.max(
        0,
        Number(
          offset
        ) || 0
      )
    )
  );

  params.set(
    "limit",
    String(
      Math.min(
        200,
        Math.max(
          1,
          Number(
            limit
          ) || 100
        )
      )
    )
  );

  return apiRequest(
    `/api/assistant/quotes/${id}/messages?${params.toString()}`,
    {
      signal,
    }
  );
}

export async function sendQuoteMessage(
  quoteId,
  message,
  {
    attachments = [],
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const body =
    requireMessage(
      message
    );

  return apiRequest(
    `/api/assistant/quotes/${id}/messages`,
    {
      method:
        "POST",

      body: {
        body,

        attachments:
          Array.isArray(
            attachments
          )
            ? attachments
            : [],
      },
    }
  );
}

/* =========================================================
   CLIENT — marcare conversație citită
========================================================= */

export async function markQuoteRead(
  quoteId
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/assistant/quotes/${id}/read`,
    {
      method:
        "PATCH",
    }
  );
}

/* =========================================================
   CLIENT — lista ofertelor
========================================================= */

export async function fetchQuoteOffers(
  quoteId,
  {
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/assistant/quotes/${id}/offers`,
    {
      signal,
    }
  );
}

/* =========================================================
   CLIENT — detalii ofertă
========================================================= */

export async function fetchQuoteOffer(
  quoteId,
  offerId,
  {
    signal,
  } = {}
) {
  const normalizedQuoteId =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const normalizedOfferId =
    requireId(
      offerId,
      "ID-ul ofertei"
    );

  return apiRequest(
    `/api/assistant/quotes/${normalizedQuoteId}/offers/${normalizedOfferId}`,
    {
      signal,
    }
  );
}

/* =========================================================
   CLIENT — acceptare ofertă
========================================================= */

export async function acceptQuoteOffer(
  quoteId,
  offerId,
  {
    shippingAddress = {},
  } = {}
) {
  const normalizedQuoteId =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const normalizedOfferId =
    requireId(
      offerId,
      "ID-ul ofertei"
    );

  return apiRequest(
    `/api/assistant/quotes/${normalizedQuoteId}/offers/${normalizedOfferId}/accept`,
    {
      method:
        "POST",

      body: {
        shippingAddress:
          shippingAddress &&
          typeof shippingAddress ===
            "object" &&
          !Array.isArray(
            shippingAddress
          )
            ? shippingAddress
            : {},
      },
    }
  );
}

/* =========================================================
   CLIENT — refuzare ofertă
========================================================= */

export async function rejectQuoteOffer(
  quoteId,
  offerId,
  {
    reason = null,
  } = {}
) {
  const normalizedQuoteId =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const normalizedOfferId =
    requireId(
      offerId,
      "ID-ul ofertei"
    );

  return apiRequest(
    `/api/assistant/quotes/${normalizedQuoteId}/offers/${normalizedOfferId}/reject`,
    {
      method:
        "POST",

      body: {
        reason:
          reason
            ? String(
                reason
              ).trim()
            : null,
      },
    }
  );
}

/* =========================================================
   CLIENT — comandă creată din ofertă
========================================================= */

export async function fetchQuoteOrder(
  quoteId,
  {
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/assistant/quotes/${id}/order`,
    {
      signal,
    }
  );
}

/* =========================================================
   VENDOR — lista cererilor
========================================================= */

export async function fetchVendorQuotes({
  signal,
} = {}) {
  return apiRequest(
    "/api/vendor/quotes",
    {
      signal,
    }
  );
}

/* =========================================================
   VENDOR — detalii cerere
========================================================= */

export async function fetchVendorQuote(
  quoteId,
  {
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/vendor/quotes/${id}`,
    {
      signal,
    }
  );
}

/* =========================================================
   VENDOR — mesaje
========================================================= */

export async function fetchVendorQuoteMessages(
  quoteId,
  {
    offset = 0,
    limit = 100,
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const params =
    new URLSearchParams();

  params.set(
    "offset",
    String(
      Math.max(
        0,
        Number(
          offset
        ) || 0
      )
    )
  );

  params.set(
    "limit",
    String(
      Math.min(
        200,
        Math.max(
          1,
          Number(
            limit
          ) || 100
        )
      )
    )
  );

  return apiRequest(
    `/api/vendor/quotes/${id}/messages?${params.toString()}`,
    {
      signal,
    }
  );
}

export async function sendVendorQuoteMessage(
  quoteId,
  message,
  {
    attachments = [],
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const body =
    requireMessage(
      message
    );

  return apiRequest(
    `/api/vendor/quotes/${id}/messages`,
    {
      method:
        "POST",

      body: {
        body,

        attachments:
          Array.isArray(
            attachments
          )
            ? attachments
            : [],
      },
    }
  );
}

/* =========================================================
   VENDOR — marcare conversație citită
========================================================= */

export async function markVendorQuoteRead(
  quoteId
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/vendor/quotes/${id}/read`,
    {
      method:
        "PATCH",
    }
  );
}

/* =========================================================
   VENDOR — trimitere ofertă structurată
========================================================= */

export async function createVendorQuoteOffer(
  quoteId,
  {
    quantity,
    unitPrice,
    shippingPrice = 0,
    currency = "RON",
    productionDays = null,
    validUntil = null,
    notes = null,
  }
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const normalizedQuantity =
    Number(
      quantity
    );

  const normalizedUnitPrice =
    Number(
      unitPrice
    );

  const normalizedShippingPrice =
    Number(
      shippingPrice || 0
    );

  if (
    !Number.isFinite(
      normalizedQuantity
    ) ||
    normalizedQuantity <= 0
  ) {
    throw new Error(
      "Cantitatea ofertei trebuie să fie mai mare decât 0."
    );
  }

  if (
    !Number.isFinite(
      normalizedUnitPrice
    ) ||
    normalizedUnitPrice < 0
  ) {
    throw new Error(
      "Prețul unitar nu este valid."
    );
  }

  if (
    !Number.isFinite(
      normalizedShippingPrice
    ) ||
    normalizedShippingPrice < 0
  ) {
    throw new Error(
      "Costul transportului nu este valid."
    );
  }

  const normalizedProductionDays =
    productionDays === null ||
    productionDays === undefined ||
    productionDays === ""
      ? null
      : Number(
          productionDays
        );

  if (
    normalizedProductionDays !==
      null &&
    (
      !Number.isFinite(
        normalizedProductionDays
      ) ||
      normalizedProductionDays <
        0
    )
  ) {
    throw new Error(
      "Termenul de producție nu este valid."
    );
  }

  return apiRequest(
    `/api/vendor/quotes/${id}/offers`,
    {
      method:
        "POST",

      body: {
        quantity:
          normalizedQuantity,

        unitPrice:
          normalizedUnitPrice,

        shippingPrice:
          normalizedShippingPrice,

        currency:
          String(
            currency ||
              "RON"
          )
            .trim()
            .toUpperCase(),

        productionDays:
          normalizedProductionDays,

        validUntil:
          validUntil ||
          null,

        notes:
          notes
            ? String(
                notes
              ).trim()
            : null,
      },
    }
  );
}

/* =========================================================
   VENDOR — lista ofertelor
========================================================= */

export async function fetchVendorQuoteOffers(
  quoteId,
  {
    signal,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/vendor/quotes/${id}/offers`,
    {
      signal,
    }
  );
}

/* =========================================================
   VENDOR — retragere ofertă
========================================================= */

export async function withdrawVendorQuoteOffer(
  quoteId,
  offerId
) {
  const normalizedQuoteId =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  const normalizedOfferId =
    requireId(
      offerId,
      "ID-ul ofertei"
    );

  return apiRequest(
    `/api/vendor/quotes/${normalizedQuoteId}/offers/${normalizedOfferId}/withdraw`,
    {
      method:
        "POST",
    }
  );
}

/* =========================================================
   VENDOR — refuzare cerere
========================================================= */

export async function rejectVendorQuoteRequest(
  quoteId,
  {
    reason = null,
  } = {}
) {
  const id =
    requireId(
      quoteId,
      "ID-ul cererii"
    );

  return apiRequest(
    `/api/vendor/quotes/${id}/reject`,
    {
      method:
        "POST",

      body: {
        reason:
          reason
            ? String(
                reason
              ).trim()
            : null,
      },
    }
  );
}

/* =========================================================
   CLIENT — atașament conversație ofertă
========================================================= */

export async function sendQuoteAttachment(
  threadId,
  file
) {
  const id =
    requireId(
      threadId,
      "ID-ul conversației"
    );

  if (
    !file ||
    !(file instanceof File)
  ) {
    throw new Error(
      "Fotografia lipsește."
    );
  }

  const formData =
    new FormData();

  formData.append(
    "files",
    file
  );

  return apiRequest(
    `/api/user-inbox/threads/${id}/attachments`,
    {
      method:
        "POST",

      body:
        formData,
    }
  );
}

/* =========================================================
   VENDOR — atașament conversație ofertă
========================================================= */

export async function sendVendorQuoteAttachment(
  threadId,
  file
) {
  const id =
    requireId(
      threadId,
      "ID-ul conversației"
    );

  if (
    !file ||
    !(file instanceof File)
  ) {
    throw new Error(
      "Fotografia lipsește."
    );
  }

  const formData =
    new FormData();

  formData.append(
    "files",
    file
  );

  return apiRequest(
    `/api/inbox/threads/${id}/attachments`,
    {
      method:
        "POST",

      body:
        formData,
    }
  );
}