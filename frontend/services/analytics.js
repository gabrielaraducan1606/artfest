// services/analytics.js

import {
  readConsent,
} from "../src/lib/cookieConsent.js";

/* =========================================================
   GOOGLE ADS
========================================================= */

export const GOOGLE_ADS_PURCHASE_CONVERSION_ID =
  "AW-18196187164/MUkKCJu2u7YcEJyQz-RD";

/* =========================================================
   META PIXEL
========================================================= */

export const META_PIXEL_ID =
  "2103931987183002";

let metaPixelInitialized = false;

/* =========================================================
   CONSENT HELPERS
========================================================= */

function hasMarketingConsent() {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  try {
    const consent =
      readConsent();

    return (
      consent?.marketing === true
    );
  } catch {
    return false;
  }
}

/* =========================================================
   GOOGLE / DATA LAYER
========================================================= */

function pushToDataLayer(
  eventName,
  params = {}
) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  window.dataLayer =
    window.dataLayer || [];

  window.dataLayer.push({
    event: eventName,
    ...params,
  });
}

/* =========================================================
   META LOADER
========================================================= */

function loadMetaScript() {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return false;
  }

  /*
   * Dacă fbq există deja,
   * nu mai încărcăm scriptul.
   */
  if (
    typeof window.fbq === "function"
  ) {
    return true;
  }

  const fbq = function () {
    if (fbq.callMethod) {
      fbq.callMethod.apply(
        fbq,
        arguments
      );
    } else {
      fbq.queue.push(
        arguments
      );
    }
  };

  window.fbq =
    fbq;

  window._fbq =
    fbq;

  fbq.push =
    fbq;

  fbq.loaded =
    true;

  fbq.version =
    "2.0";

  fbq.queue =
    [];

  const script =
    document.createElement(
      "script"
    );

  script.async =
    true;

  script.src =
    "https://connect.facebook.net/en_US/fbevents.js";

  const firstScript =
    document.getElementsByTagName(
      "script"
    )[0];

  if (
    firstScript?.parentNode
  ) {
    firstScript.parentNode.insertBefore(
      script,
      firstScript
    );
  } else {
    document.head.appendChild(
      script
    );
  }

  return true;
}

/* =========================================================
   META INITIALIZATION
========================================================= */

export function initMetaPixel() {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  /*
   * Meta nu se încarcă
   * fără consimțământ marketing.
   */
  if (
    !hasMarketingConsent()
  ) {
    return false;
  }

  /*
   * Dacă este deja inițializat,
   * doar confirmăm consent-ul.
   */
  if (
    metaPixelInitialized
  ) {
    try {
      window.fbq?.(
        "consent",
        "grant"
      );
    } catch {
      // ignore
    }

    return true;
  }

  const loaded =
    loadMetaScript();

  if (!loaded) {
    return false;
  }

  try {
    /*
     * Utilizatorul a acordat
     * consimțământul pentru marketing.
     */
    window.fbq(
      "consent",
      "grant"
    );

    window.fbq(
      "init",
      META_PIXEL_ID
    );

    metaPixelInitialized =
      true;

    console.log(
      "[META] Pixel initialized:",
      META_PIXEL_ID
    );

    return true;
  } catch (error) {
    console.warn(
      "[META] Pixel init failed:",
      error
    );

    return false;
  }
}

/* =========================================================
   META REVOKE
========================================================= */

function revokeMetaConsent() {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  if (
    typeof window.fbq !== "function"
  ) {
    return;
  }

  try {
    window.fbq(
      "consent",
      "revoke"
    );

    console.log(
      "[META] Marketing consent revoked"
    );
  } catch (error) {
    console.warn(
      "[META] Consent revoke failed:",
      error
    );
  }
}

/* =========================================================
   META EVENT HELPER
========================================================= */

function trackMetaEvent(
  eventName,
  params = {}
) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  /*
   * Fără marketing consent
   * nu trimitem absolut nimic.
   */
  if (
    !hasMarketingConsent()
  ) {
    return;
  }

  const initialized =
    initMetaPixel();

  if (
    !initialized ||
    typeof window.fbq !== "function"
  ) {
    return;
  }

  try {
    window.fbq(
      "track",
      eventName,
      params
    );
  } catch (error) {
    console.warn(
      `[META] ${eventName} failed:`,
      error
    );
  }
}

/* =========================================================
   GENERIC GOOGLE EVENT
========================================================= */

export const trackEvent = (
  eventName,
  params = {}
) => {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  pushToDataLayer(
    eventName,
    params
  );

  if (
    typeof window.gtag === "function"
  ) {
    window.gtag(
      "event",
      eventName,
      params
    );
  }
};

/* =========================================================
   PAGE VIEW
========================================================= */

export const trackPageView =
  () => {
    if (
      typeof window === "undefined"
    ) {
      return;
    }

    /*
     * Nu trimitem manual page_view
     * către Google aici pentru a evita
     * dublarea dacă GA îl trimite deja.
     */

    trackMetaEvent(
      "PageView"
    );
  };

/* =========================================================
   VIEW CONTENT
========================================================= */

export const trackViewContent =
  (product) => {
    if (!product) {
      return;
    }

    const value =
      Number(
        product?.price ??
          (
            product?.finalPriceCents != null
              ? Number(
                  product.finalPriceCents
                ) / 100
              : 0
          )
      ) || 0;

    const currency =
      product?.currency ||
      "RON";

    /*
     * Google / GA
     */
    trackEvent(
      "view_item",
      {
        currency,
        value,

        items: [
          {
            item_id:
              product?.id,

            item_name:
              product?.title,

            price:
              value,

            quantity:
              1,
          },
        ],
      }
    );

    /*
     * Meta
     */
    trackMetaEvent(
      "ViewContent",
      {
        content_ids:
          product?.id
            ? [
                String(
                  product.id
                ),
              ]
            : [],

        content_name:
          product?.title ||
          "",

        content_type:
          "product",

        value,
        currency,
      }
    );
  };

/* =========================================================
   ADD TO CART
========================================================= */

export const trackAddToCart =
  (product) => {
    if (!product) {
      return;
    }

    const quantity =
      Number(
        product?.quantity ||
          product?.qty ||
          1
      ) || 1;

    const unitPrice =
      Number(
        product?.price ??
          (
            product?.finalPriceCents != null
              ? Number(
                  product.finalPriceCents
                ) / 100
              : 0
          )
      ) || 0;

    const value =
      unitPrice * quantity;

    const currency =
      product?.currency ||
      "RON";

    /*
     * Google / GA
     */
    trackEvent(
      "add_to_cart",
      {
        currency,
        value,

        items: [
          {
            item_id:
              product?.id,

            item_name:
              product?.title,

            price:
              unitPrice,

            quantity,
          },
        ],
      }
    );

    /*
     * Meta
     */
    trackMetaEvent(
      "AddToCart",
      {
        content_ids:
          product?.id
            ? [
                String(
                  product.id
                ),
              ]
            : [],

        content_name:
          product?.title ||
          "",

        content_type:
          "product",

        value,
        currency,
      }
    );
  };

/* =========================================================
   BEGIN CHECKOUT
========================================================= */

export const trackBeginCheckout =
  (
    total,
    options = {}
  ) => {
    const value =
      Number(
        total || 0
      );

    const currency =
      options?.currency ||
      "RON";

    const numItems =
      Number(
        options?.numItems ||
          0
      );

    /*
     * Google / GA
     */
    trackEvent(
      "begin_checkout",
      {
        currency,
        value,
      }
    );

    /*
     * Meta
     */
    trackMetaEvent(
      "InitiateCheckout",
      {
        currency,
        value,

        ...(numItems > 0
          ? {
              num_items:
                numItems,
            }
          : {}),
      }
    );
  };

/* =========================================================
   SIGN UP
========================================================= */

export const trackSignup =
  () => {
    /*
     * Google / GA
     */
    trackEvent(
      "sign_up",
      {
        method:
          "email",
      }
    );

    /*
     * Meta
     */
    trackMetaEvent(
      "CompleteRegistration",
      {
        status:
          true,
      }
    );
  };

/* =========================================================
   PURCHASE
========================================================= */

export const trackPurchase =
  (order) => {
    const value =
      Number(
        order?.total ||
          0
      );

    const currency =
      order?.currency ||
      "RON";

    const transactionId =
      String(
        order?.id ||
          ""
      );

    console.log(
      "PURCHASE EVENT",
      {
        transactionId,
        value,
        currency,
      }
    );

    /*
     * Google Analytics
     */
    trackEvent(
      "purchase",
      {
        transaction_id:
          transactionId,

        value,
        currency,
      }
    );

    /*
     * Google Ads conversion
     */
    if (
      typeof window !==
        "undefined" &&
      typeof window.gtag ===
        "function"
    ) {
      window.gtag(
        "event",
        "conversion",
        {
          send_to:
            GOOGLE_ADS_PURCHASE_CONVERSION_ID,

          value,
          currency,

          transaction_id:
            transactionId,
        }
      );

      console.log(
        "GOOGLE ADS CONVERSION FIRED"
      );
    }

    /*
     * Meta Pixel
     */
    trackMetaEvent(
      "Purchase",
      {
        value,
        currency,

        content_type:
          "product",
      }
    );
  };

/* =========================================================
   COOKIE CONSENT LISTENER
========================================================= */

export function setupAnalyticsConsentListener() {
  if (
    typeof window === "undefined"
  ) {
    return () => {};
  }

  /*
   * Dacă omul a acceptat deja
   * marketingul într-o vizită anterioară,
   * inițializăm Pixelul.
   *
   * PageView va fi trimis separat
   * de trackPageView() din main.jsx.
   */
  if (
    hasMarketingConsent()
  ) {
    initMetaPixel();
  }

  const handleConsentChange =
    (event) => {
      const consent =
        event?.detail;

      /*
       * Marketing acceptat.
       */
      if (
        consent?.marketing === true
      ) {
        const initialized =
          initMetaPixel();

        /*
         * Dacă omul tocmai a apăsat
         * "Accept toate", este deja
         * pe o pagină, deci trimitem
         * PageView pentru pagina curentă.
         */
        if (initialized) {
          trackMetaEvent(
            "PageView"
          );
        }

        return;
      }

      /*
       * Marketing refuzat / retras.
       */
      revokeMetaConsent();
    };

  window.addEventListener(
    "cookie:consent",
    handleConsentChange
  );

  return () => {
    window.removeEventListener(
      "cookie:consent",
      handleConsentChange
    );
  };
}