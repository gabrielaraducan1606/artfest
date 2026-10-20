// services/analytics.js
//
// ARHITECTURA TRACKING (audit conversii 2026-10-14, etapa 2):
//
//   index.html  - Consent Mode v2 BASIC (default din alegerea salvată);
//                 gtag.js Google Ads (AW-18196187164) doar cu marketing,
//                 GTM doar cu statistici (artfestApplyConsentTags).
//   GTM         - Google tag GA4 (G-Z6L2YX2Q7W), TikTok; al doilea Google
//                 tag AW din container trebuie pus pe pauză (manual).
//   acest fișier - TOATE evenimentele ecommerce, pe O SINGURĂ cale:
//                 gtag("event", …) (comenzi în dataLayer procesate de
//                 gtag.js). NU mai împingem și obiecte {event: …} în
//                 dataLayer - ar dubla evenimentele dacă cineva adaugă
//                 în GTM taguri GA4 pe evenimente custom.
//   conversia Google Ads „Cumpărare” - DOAR din trackPurchase (pagina
//                 /multumim), cu transaction_id = Order.id.

import {
  readConsent,
} from "../src/lib/cookieConsent.js";

import {
  INTERNAL_TRAFFIC_STORAGE_KEY,
  buildEcommercePayload,
  buildItem,
  buildItems,
  buildPurchasePayload,
  getUserRoleLabel,
  isInternalRole,
  isProductionHost,
  resolveUnitPrice,
  round2,
} from "./analyticsEcommerce.js";

/* =========================================================
   GOOGLE ADS
========================================================= */

/*
 * ID-ul contului Google Ads (tag-ul global e în index.html) și eticheta
 * acțiunii de conversie „Cumpărare”. Eticheta se poate seta din mediu
 * (Vercel -> Environment Variables): VITE_GOOGLE_ADS_CONVERSION_LABEL.
 * Fără variabilă se folosește eticheta deja configurată în cod.
 * O etichetă goală / placeholder ("ETICHETA") NU trimite conversia.
 */
export const GOOGLE_ADS_ID = "AW-18196187164";

const DEFAULT_GOOGLE_ADS_CONVERSION_LABEL = "MUkKCJu2u7YcEJyQz-RD";

export const GOOGLE_ADS_CONVERSION_LABEL = String(
  import.meta.env?.VITE_GOOGLE_ADS_CONVERSION_LABEL ||
    DEFAULT_GOOGLE_ADS_CONVERSION_LABEL
).trim();

export const GOOGLE_ADS_PURCHASE_CONVERSION_ID =
  GOOGLE_ADS_CONVERSION_LABEL &&
  GOOGLE_ADS_CONVERSION_LABEL !== "ETICHETA"
    ? `${GOOGLE_ADS_ID}/${GOOGLE_ADS_CONVERSION_LABEL}`
    : null;

/* =========================================================
   META PIXEL
========================================================= */

export const META_PIXEL_ID =
  "2103931987183002";

let metaPixelInitialized = false;

const isDev =
  Boolean(import.meta.env?.DEV);

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

/*
 * Consent Mode BASIC: fără acord pentru statistici NU punem evenimente
 * GA4 în dataLayer. Altfel ar aștepta în coadă și ar fi procesate
 * retroactiv de GTM în momentul în care se încarcă (după un acord dat
 * ulterior) - adică trimise pentru acțiuni făcute înainte de acord.
 */
function hasAnalyticsConsent() {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  try {
    return (
      readConsent()?.analytics ===
      true
    );
  } catch {
    return false;
  }
}

/*
 * Încarcă tagurile permise de consimțământ (GTM / Google Ads) - funcția
 * e definită în index.html; idempotentă.
 */
function applyConsentTags(consent) {
  try {
    window.artfestApplyConsentTags?.(
      consent
    );
  } catch (error) {
    console.warn(
      "[GOOGLE] tag loading failed:",
      error
    );
  }
}

/*
 * Conversiile Google Ads se trimit DOAR de pe domeniul de producție -
 * localhost / preview-uri Vercel nu trebuie să creeze conversii în cont.
 */
function isProductionSite() {
  try {
    return isProductionHost(
      window.location.hostname
    );
  } catch {
    return false;
  }
}

/* =========================================================
   GOOGLE CONSENT MODE v2

   `gtag` e definit ca shim în index.html (push simplu în dataLayer),
   ÎNAINTE de containerul GTM - vezi comentariul de acolo. Orice tag
   Google (GA4/Ads) configurat în interiorul containerului GTM citește
   starea de consimțământ din aceleași comenzi `consent` din
   dataLayer, deci nu trebuie să blocăm manual fiecare eveniment
   individual (spre deosebire de Meta, mai jos, care nu are un
   mecanism echivalent) - blocăm doar SEMNALUL de consimțământ, la
   sursă, cât mai devreme posibil.
========================================================= */

function callGtag(...args) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  try {
    /*
     * Fallback defensiv (cerință explicită) - deși index.html
     * definește mereu shim-ul `gtag`, nu presupunem asta orbește
     * (ex. teste, medii unde scriptul din index.html nu a rulat).
     * `dataLayer` există mereu (inițializat tot în index.html) -
     * dacă `gtag` lipsește dintr-un motiv neașteptat, împingem
     * direct în dataLayer în același format, ca să nu pierdem
     * comanda.
     */
    if (typeof window.gtag === "function") {
      window.gtag(...args);
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(args);
  } catch (error) {
    console.warn(
      "[GOOGLE] gtag call failed:",
      error
    );
  }
}

function buildConsentModePayload(consent) {
  const analyticsGranted =
    consent?.analytics === true;

  const marketingGranted =
    consent?.marketing === true;

  return {
    analytics_storage: analyticsGranted
      ? "granted"
      : "denied",

    ad_storage: marketingGranted
      ? "granted"
      : "denied",

    ad_user_data: marketingGranted
      ? "granted"
      : "denied",

    ad_personalization: marketingGranted
      ? "granted"
      : "denied",
  };
}

/**
 * Trimite starea de consimțământ CURENTĂ către Google (GA4/Ads, prin
 * GTM) - apelată atât la sincronizarea inițială (ce a ales
 * utilizatorul într-o vizită anterioară), cât și la orice schimbare
 * live din bannerul de cookie-uri.
 */
function updateGoogleConsent(consent) {
  callGtag(
    "consent",
    "update",
    buildConsentModePayload(consent)
  );
}

/**
 * Sincronizează starea Google cu preferința deja salvată (dacă
 * există). index.html aplică deja alegerea salvată ca stare
 * implicită, înaintea GTM; aici o reconfirmăm (idempotent) după
 * încărcarea aplicației.
 */
function syncGoogleConsentFromStorage() {
  try {
    updateGoogleConsent(
      readConsent()
    );
  } catch {
    // păstrăm starea implicită din index.html dacă citirea eșuează
  }
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

/*
 * Parametrii Meta din itemii GA4 (aceleași ID-uri ca feed-ul Meta Catalog).
 */
function toMetaContents(items) {
  const list = Array.isArray(items) ? items : [];

  return {
    content_type: "product",
    ...(list.length
      ? {
          content_ids: list.map((item) => item.item_id),
          contents: list.map((item) => ({
            id: item.item_id,
            quantity: item.quantity,
          })),
          num_items: list.reduce(
            (sum, item) => sum + Number(item.quantity || 0),
            0
          ),
        }
      : {}),
  };
}

/* =========================================================
   GENERIC GOOGLE EVENT
========================================================= */

/*
 * O SINGURĂ cale: gtag("event", …), DOAR cu acord pentru statistici
 * (Consent Mode Basic - vezi hasAnalyticsConsent).
 */
/*
 * D4: evenimentele GA4 au send_to EXPLICIT către proprietatea GA4 -
 * nu mai ajung și la destinația Google Ads (AW), deci nu pot alimenta
 * accidental o acțiune de conversie Ads bazată pe evenimentele tagului.
 */
export const GA4_MEASUREMENT_ID = "G-Z6L2YX2Q7W";

export const trackEvent = (
  eventName,
  params = {}
) => {
  if (
    typeof window === "undefined" ||
    !hasAnalyticsConsent()
  ) {
    return;
  }

  callGtag(
    "event",
    eventName,
    {
      ...params,
      send_to:
        GA4_MEASUREMENT_ID,
    }
  );
};

/* =========================================================
   TRAFIC INTERN (GA4 traffic_type + user_role)
========================================================= */

let lastIdentityKey = null;

/*
 * Apelată la încărcarea sesiunii (src/components/Analytics/
 * AnalyticsIdentity.jsx). Administratorii și vânzătorii sunt marcați
 * `traffic_type=internal` - GA4 îi poate exclude cu filtrul „Internal
 * traffic” (pornit întâi în modul Testing, reversibil). Marcajul e
 * reținut pe dispozitiv, ca și vizitele lor ulterioare fără login să
 * fie marcate (index.html îl aplică înaintea GTM). user_role e o
 * valoare ne-personală pentru segmentare.
 */
export function setAnalyticsIdentity(me) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  let internal = false;

  try {
    if (isInternalRole(me?.role)) {
      localStorage.setItem(
        INTERNAL_TRAFFIC_STORAGE_KEY,
        "1"
      );
    }

    internal =
      localStorage.getItem(
        INTERNAL_TRAFFIC_STORAGE_KEY
      ) === "1";
  } catch {
    internal = isInternalRole(me?.role);
  }

  const roleLabel =
    getUserRoleLabel(me);

  const key =
    `${internal}:${roleLabel}`;

  if (key === lastIdentityKey) {
    return;
  }

  lastIdentityKey = key;

  if (internal) {
    callGtag("set", {
      traffic_type: "internal",
    });
  }

  callGtag(
    "set",
    "user_properties",
    {
      user_role: roleLabel,
    }
  );
}

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
     * Nu trimitem manual page_view către Google: tag-ul GA4 din GTM
     * îl trimite (și la schimbările de rută, prin Enhanced
     * Measurement „browser history”).
     */

    trackMetaEvent(
      "PageView"
    );
  };

/* =========================================================
   VIEW ITEM
========================================================= */

export const trackViewContent =
  (product) => {
    const item =
      buildItem(product, {
        quantity: 1,
      });

    if (!item) {
      return;
    }

    const payload =
      buildEcommercePayload({
        currency:
          product?.currency,
        items: [item],
      });

    trackEvent(
      "view_item",
      payload
    );

    trackMetaEvent(
      "ViewContent",
      {
        ...toMetaContents([item]),
        content_name:
          item.item_name,
        value:
          payload.value,
        currency:
          payload.currency,
      }
    );
  };

/* =========================================================
   ADD TO CART - DOAR după confirmarea adăugării (API sau coș guest)
========================================================= */

export const trackAddToCart =
  (product, options = {}) => {
    const item =
      buildItem(product, {
        quantity:
          options.quantity ??
          product?.quantity ??
          product?.qty,
      });

    if (!item) {
      return;
    }

    const payload =
      buildEcommercePayload({
        currency:
          product?.currency,
        items: [item],
      });

    trackEvent(
      "add_to_cart",
      payload
    );

    trackMetaEvent(
      "AddToCart",
      {
        ...toMetaContents([item]),
        content_name:
          item.item_name,
        value:
          payload.value,
        currency:
          payload.currency,
      }
    );
  };

/* =========================================================
   REMOVE FROM CART - DOAR după confirmarea eliminării
========================================================= */

/*
 * Un rând (cu `quantity` = unitățile eliminate) sau mai multe rânduri
 * eliminate complet (golire magazin / coș) - un singur eveniment.
 */
export const trackRemoveFromCart =
  (rowOrRows, options = {}) => {
    const rows =
      (Array.isArray(rowOrRows)
        ? rowOrRows
        : [rowOrRows]
      ).filter(Boolean);

    const items =
      rows
        .map((row) =>
          buildItem(row, {
            quantity:
              rows.length === 1
                ? options.quantity
                : undefined,
          })
        )
        .filter(Boolean);

    if (!items.length) {
      return;
    }

    trackEvent(
      "remove_from_cart",
      buildEcommercePayload({
        currency:
          rows[0]?.product?.currency ||
          rows[0]?.currency,
        items,
      })
    );
  };

/* =========================================================
   VIEW CART
========================================================= */

export const trackViewCart =
  (rows, options = {}) => {
    const items =
      buildItems(rows);

    if (!items.length) {
      return;
    }

    trackEvent(
      "view_cart",
      buildEcommercePayload({
        currency:
          options.currency,
        value:
          options.value,
        items,
      })
    );
  };

/* =========================================================
   BEGIN CHECKOUT / ADD SHIPPING INFO / ADD PAYMENT INFO
   (o singură dată per vizită în checkout - gardă în Checkout.jsx)
========================================================= */

function buildCheckoutPayload(
  total,
  options = {}
) {
  const items =
    buildItems(
      options.items
    );

  return {
    items,
    payload:
      buildEcommercePayload({
        currency:
          options.currency,
        value:
          total,
        items,
        ...(options.extra || {}),
      }),
  };
}

export const trackBeginCheckout =
  (
    total,
    options = {}
  ) => {
    const { items, payload } =
      buildCheckoutPayload(
        total,
        options
      );

    if (!items.length) {
      return;
    }

    trackEvent(
      "begin_checkout",
      payload
    );

    trackMetaEvent(
      "InitiateCheckout",
      {
        ...toMetaContents(items),
        value:
          payload.value,
        currency:
          payload.currency,
      }
    );
  };

export const trackAddShippingInfo =
  (
    total,
    options = {}
  ) => {
    const { items, payload } =
      buildCheckoutPayload(
        total,
        {
          ...options,
          extra: {
            shipping_tier:
              options.shippingTier ||
              "curier",
          },
        }
      );

    if (!items.length) {
      return;
    }

    trackEvent(
      "add_shipping_info",
      payload
    );
  };

export const trackAddPaymentInfo =
  (
    total,
    options = {}
  ) => {
    const { items, payload } =
      buildCheckoutPayload(
        total,
        {
          ...options,
          extra: {
            payment_type:
              options.paymentType ===
              "CARD"
                ? "card"
                : "ramburs",
          },
        }
      );

    if (!items.length) {
      return;
    }

    trackEvent(
      "add_payment_info",
      payload
    );
  };

/* =========================================================
   SIGN UP
========================================================= */

export const trackSignup =
  () => {
    trackEvent(
      "sign_up",
      {
        method:
          "email",
      }
    );

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

   Apelat DOAR din /multumim (src/pages/Checkout/thankYouPurchase.js
   -> trackPurchaseOnce), după ce backend-ul confirmă comanda: COD
   plasat sau CARD plătit (PAID/paidAt). O dată per comandă.
========================================================= */

export const trackPurchase =
  (order) => {
    const payload =
      buildPurchasePayload(
        order
      );

    if (!payload) {
      return false;
    }

    /*
     * GA4 (prin Google tag-ul din GTM).
     */
    trackEvent(
      "purchase",
      payload
    );

    /*
     * Google Ads - conversia „Cumpărare” (eticheta de mai sus), cu
     * același transaction_id ca în GA4. Gate explicit pe consimțământul
     * de marketing (pe lângă Consent Mode) și pe domeniul de producție.
     */
    if (
      GOOGLE_ADS_PURCHASE_CONVERSION_ID &&
      hasMarketingConsent() &&
      isProductionSite()
    ) {
      callGtag(
        "event",
        "conversion",
        {
          send_to:
            GOOGLE_ADS_PURCHASE_CONVERSION_ID,

          value:
            payload.value,

          currency:
            payload.currency,

          transaction_id:
            payload.transaction_id,
        }
      );
    }

    /*
     * Meta Pixel.
     */
    trackMetaEvent(
      "Purchase",
      {
        ...toMetaContents(
          payload.items
        ),
        value:
          payload.value,
        currency:
          payload.currency,
      }
    );

    if (isDev) {
      console.info(
        "[analytics] purchase",
        payload
      );
    }

    return true;
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
   * Sincronizăm ÎNTOTDEAUNA starea Google cu preferința deja salvată
   * (index.html o aplică deja ca stare implicită; reconfirmarea e
   * idempotentă).
   */
  syncGoogleConsentFromStorage();

  // idempotent - index.html le-a încărcat deja pentru alegerea salvată
  try {
    applyConsentTags(
      readConsent()
    );
  } catch {
    // ignore
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
       * Actualizăm Google (analytics_storage/ad_storage/...) la
       * FIECARE schimbare, indiferent care categorie s-a schimbat -
       * separat de logica specifică Meta de mai jos.
       */
      updateGoogleConsent(
        consent
      );

      /*
       * BASIC: abia acum se încarcă tagurile permise (GTM cu statistici,
       * Google Ads cu marketing). Starea de consimțământ e deja în
       * dataLayer înaintea lor.
       */
      applyConsentTags(
        consent
      );

      /*
       * Semnal pentru GTM: tagurile non-Google (ex. TikTok) trebuie să
       * pornească la ACEST eveniment (cu „Require additional consent”),
       * nu la încărcarea paginii - aplicația e SPA, după „Accept” nu
       * mai există un page load nou. Fără trigger în GTM nu are efect.
       */
      try {
        window.dataLayer =
          window.dataLayer || [];

        window.dataLayer.push({
          event:
            "artfest_consent_update",
          consent_analytics:
            consent?.analytics === true,
          consent_marketing:
            consent?.marketing === true,
        });
      } catch {
        // ignore
      }

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

// reexport pentru apelanți care calculează valori de coș
export {
  resolveUnitPrice,
  round2,
};
