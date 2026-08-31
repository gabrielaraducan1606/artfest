// src/components/AIAssistant/Vendor/services/vendorProductAI.js

import {
  uploadFile,
} from "../../../../lib/uploadFile.js";

/* =========================================================
   Helpers imagini
========================================================= */

function normalizeImages(
  images = []
) {
  return Array.isArray(
    images
  )
    ? images.filter(Boolean)
    : [];
}

function makeAbsoluteUrl(
  value
) {
  const url = String(
    value || ""
  ).trim();

  if (!url) {
    return null;
  }

  if (
    /^https?:\/\//i.test(
      url
    ) ||
    /^data:image\//i.test(
      url
    )
  ) {
    return url;
  }

  if (
    typeof window ===
    "undefined"
  ) {
    return url;
  }

  try {
    return new URL(
      url,
      window.location.origin
    ).toString();
  } catch {
    return null;
  }
}

function getExistingImageUrl(
  image
) {
  if (
    typeof image ===
    "string"
  ) {
    return makeAbsoluteUrl(
      image
    );
  }

  return makeAbsoluteUrl(
    image?.url ||
      image?.src ||
      image?.imageUrl ||
      ""
  );
}

async function uploadProductImage(
  image
) {
  const existingUrl =
    getExistingImageUrl(
      image
    );

  if (existingUrl) {
    return existingUrl;
  }

  if (
    typeof File !==
      "undefined" &&
    image?.file instanceof
      File
  ) {
    const uploadedUrl =
      await uploadFile(
        image.file
      );

    const absoluteUrl =
      makeAbsoluteUrl(
        uploadedUrl
      );

    if (!absoluteUrl) {
      throw new Error(
        "Serverul nu a returnat un URL valid pentru fotografie."
      );
    }

    return absoluteUrl;
  }

  throw new Error(
    "Una dintre fotografii nu este validă."
  );
}

/* =========================================================
   Helpers request
========================================================= */

async function readApiResponse(
  response
) {
  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    return response
      .json()
      .catch(() => null);
  }

  const text =
    await response
      .text()
      .catch(() => "");

  return text
    ? {
        message: text,
      }
    : null;
}

function normalizeProductContext(
  product
) {
  const source =
    product &&
    typeof product ===
      "object" &&
    !Array.isArray(
      product
    )
      ? product
      : {};

  return {
    title:
      String(
        source.title || ""
      ).trim(),

    description:
      String(
        source.description ||
          ""
      ).trim(),

    category:
      String(
        source.category || ""
      ).trim(),

    color:
      String(
        source.color || ""
      ).trim(),

    materialMain:
      String(
        source.materialMain ||
          ""
      ).trim(),

    technique:
      String(
        source.technique ||
          ""
      ).trim(),

    dimensions:
      String(
        source.dimensions ||
          ""
      ).trim(),

    price:
      source.price === "" ||
      source.price == null
        ? null
        : Number(
            source.price
          ),

    availability:
      String(
        source.availability ||
          ""
      ).trim(),

    readyQty:
      source.readyQty === "" ||
      source.readyQty == null
        ? null
        : Number(
            source.readyQty
          ),

    leadTimeDays:
      source.leadTimeDays ===
        "" ||
      source.leadTimeDays ==
        null
        ? null
        : Number(
            source.leadTimeDays
          ),

    orderMode:
      String(
        source.orderMode ||
          "READY_TO_BUY"
      ).trim(),

    optionsSchema:
      Array.isArray(
        source.optionsSchema
      )
        ? source.optionsSchema
        : [],

    customSchema:
      Array.isArray(
        source.customSchema
      )
        ? source.customSchema
        : [],

    quoteSchema:
      Array.isArray(
        source.quoteSchema
      )
        ? source.quoteSchema
        : [],
  };
}

/* =========================================================
   Upload fotografii
========================================================= */

/*
 * maxImages implicit 10 - păstrează EXACT comportamentul de
 * dinainte pentru fluxul single-product (deja limitat separat la
 * MAX_IMAGES=10 în VendorAssistant.jsx). Fluxul de import în bulk
 * (batch) permite până la 50 de fotografii per import - fără acest
 * parametru, imaginile 11-50 ar fi fost trunchiate SILENȚIOS aici,
 * pierzând fotografii încărcate deja de vendor.
 */
export async function uploadVendorProductImages(
  images = [],
  { maxImages = 10 } = {}
) {
  const safeImages =
    normalizeImages(
      images
    ).slice(0, maxImages);

  if (
    !safeImages.length
  ) {
    throw new Error(
      "Încarcă cel puțin o fotografie."
    );
  }

  const uploadedUrls = [];

  for (
    const image of
    safeImages
  ) {
    const url =
      await uploadProductImage(
        image
      );

    uploadedUrls.push(
      url
    );
  }

  return Array.from(
    new Set(
      uploadedUrls
    )
  );
}

/* =========================================================
   Grupare AI (import în bulk)
========================================================= */

/*
 * Trebuie ținută manual în sincron cu MAX_BATCH_CLUSTER_IMAGES din
 * backend/src/constants/aiLimits.js - frontend-ul e cel care împarte
 * un batch mare în loturi succesive de această dimensiune înainte
 * de a apela /product-batch-group (vezi handleAnalyzeBatchGroups din
 * VendorAssistant.jsx), iar backend-ul respinge explicit orice
 * request peste limită (nu trunchiază silențios).
 */
export const MAX_BATCH_CLUSTER_IMAGES = 20;

/*
 * STRICT clustering - primește imagini deja încărcate (cu url real,
 * vezi uploadVendorProductImages) și întoarce doar grupurile
 * (imageIds) + confidence + label scurt. NU generează descriere/
 * categorie/preț - asta rămâne la analyzeVendorProduct, apelat
 * separat per grup, după confirmarea vendorului.
 */
export async function clusterVendorProductImages({
  images = [],
}) {
  const safeImages = images
    .filter(
      (image) =>
        image?.id && image?.url
    )
    .map((image) => ({
      id: String(image.id),
      url: String(image.url),
    }));

  if (!safeImages.length) {
    throw new Error(
      "Nu am nicio fotografie încărcată de grupat."
    );
  }

  const response = await fetch(
    "/api/ai/product-batch-group",
    {
      method: "POST",

      credentials: "include",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        images: safeImages,
      }),
    }
  );

  const data =
    await readApiResponse(
      response
    );

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Nu am putut grupa fotografiile."
    );
  }

  if (
    !data ||
    !Array.isArray(data.groups)
  ) {
    throw new Error(
      "Gruparea AI a returnat un răspuns invalid."
    );
  }

  return data.groups;
}

/* =========================================================
   Analiză generală produs
========================================================= */

export async function analyzeVendorProduct({
  images = [],
}) {
  const imageUrls =
    await uploadVendorProductImages(
      images
    );

  const response =
    await fetch(
      "/api/ai/product-analyze",
      {
        method: "POST",

        credentials:
          "include",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            images:
              imageUrls.slice(
                0,
                4
              ),
          }),
      }
    );

  const data =
    await readApiResponse(
      response
    );

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Nu am putut analiza produsul."
    );
  }

  if (
    !data ||
    typeof data !==
      "object"
  ) {
    throw new Error(
      "Analiza AI a returnat un răspuns invalid."
    );
  }

  return {
    analysis: data,
    imageUrls,
  };
}

/* =========================================================
   Analiză mod de comandă
========================================================= */

export async function analyzeVendorProductOrder({
  product,
  message,
  images = [],
  visionAnalysis = null,
  history = [],
}) {
  const cleanMessage =
    String(
      message || ""
    ).trim();

  if (
    !cleanMessage &&
    !visionAnalysis &&
    !images.length
  ) {
    throw new Error(
      "Explică pe scurt cum trebuie comandat produsul."
    );
  }

  /*
   * În mod normal imaginile sunt deja încărcate
   * după analiza generală. Dacă mai există fișiere
   * locale, le încărcăm aici.
   */
  let imageUrls = [];

  if (
    Array.isArray(
      images
    ) &&
    images.length
  ) {
    imageUrls =
      await uploadVendorProductImages(
        images
      );
  }

  const response =
    await fetch(
      "/api/ai/product-order-assistant",
      {
        method: "POST",

        credentials:
          "include",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            message:
              cleanMessage,

            product:
              normalizeProductContext(
                product
              ),

            images:
              imageUrls.slice(
                0,
                4
              ),

            visionAnalysis:
              visionAnalysis &&
              typeof visionAnalysis ===
                "object"
                ? visionAnalysis
                : null,

            history:
              Array.isArray(
                history
              )
                ? history.slice(
                    -10
                  )
                : [],
          }),
      }
    );

  const data =
    await readApiResponse(
      response
    );

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Nu am putut pregăti formularul de comandă."
    );
  }

  if (
    !data ||
    typeof data !==
      "object"
  ) {
    throw new Error(
      "Asistentul AI a returnat un răspuns invalid."
    );
  }

  return {
    result: data,
    imageUrls,
  };
}