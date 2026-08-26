// src/components/AIAssistant/Vendor/services/vendorPriceCalculatorApi.js

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

/* =========================================================
   Tură conversație calculator de preț
========================================================= */

export async function sendPriceCalculatorTurn({
  message,
  history = [],
  costDraft = null,
  productId = null,
}) {
  const cleanMessage =
    String(
      message || ""
    ).trim();

  const response =
    await fetch(
      "/api/ai/price-calculator/turn",
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

            history:
              Array.isArray(
                history
              )
                ? history.slice(
                    -10
                  )
                : [],

            costDraft:
              costDraft &&
              typeof costDraft ===
                "object"
                ? costDraft
                : null,

            productId:
              productId
                ? String(
                    productId
                  )
                : null,
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
        "Nu am putut procesa calculul de preț."
    );
  }

  if (
    !data ||
    typeof data !==
      "object"
  ) {
    throw new Error(
      "Calculatorul de preț a returnat un răspuns invalid."
    );
  }

  return data;
}
