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

export async function uploadVendorProductImages(
  images = []
) {
  const safeImages =
    normalizeImages(
      images
    ).slice(0, 10);

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