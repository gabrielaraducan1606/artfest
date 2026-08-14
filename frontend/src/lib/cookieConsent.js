// src/lib/cookiesConsent.js

import { api } from "./api.js";

const CONSENT_KEY =
  "cookie:consent:v1";

const ANONYMOUS_ID_KEY =
  "cookie:anonymous-id:v1";

export const COOKIE_CONSENT_VERSION =
  "1.0";

export const defaultConsent = {
  necessary: true,
  analytics: false,
  marketing: false,
};

/* =========================================================
   ANONYMOUS ID
========================================================= */

function createAnonymousId() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // fallback mai jos
  }

  return [
    "anon",
    Date.now(),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("_");
}

export function getAnonymousId() {
  if (
    typeof window === "undefined"
  ) {
    return null;
  }

  try {
    let anonymousId =
      localStorage.getItem(
        ANONYMOUS_ID_KEY
      );

    if (!anonymousId) {
      anonymousId =
        createAnonymousId();

      localStorage.setItem(
        ANONYMOUS_ID_KEY,
        anonymousId
      );
    }

    return anonymousId;
  } catch {
    return null;
  }
}

/* =========================================================
   READ CONSENT
========================================================= */

export function readConsent() {
  if (
    typeof window === "undefined"
  ) {
    return {
      ...defaultConsent,
    };
  }

  try {
    const raw =
      localStorage.getItem(
        CONSENT_KEY
      );

    if (!raw) {
      return {
        ...defaultConsent,
      };
    }

    const obj =
      JSON.parse(raw);

    return {
      necessary: true,

      analytics:
        obj?.analytics === true,

      marketing:
        obj?.marketing === true,

      timestamp:
        obj?.timestamp ||
        Date.now(),

      consentVersion:
        obj?.consentVersion ||
        COOKIE_CONSENT_VERSION,
    };
  } catch {
    return {
      ...defaultConsent,
    };
  }
}

/* =========================================================
   ACTION
========================================================= */

function inferAction({
  analytics,
  marketing,
}) {
  if (
    analytics === true &&
    marketing === true
  ) {
    return "ACCEPT_ALL";
  }

  if (
    analytics === false &&
    marketing === false
  ) {
    return "NECESSARY_ONLY";
  }

  return "CUSTOM";
}

/* =========================================================
   BACKEND
========================================================= */

async function persistConsent({
  consent,
  action,
  source,
}) {
  try {
    const anonymousId =
      getAnonymousId();

    await api(
      "/api/cookies/consent",
      {
        method: "POST",

        body: JSON.stringify({
          anonymousId,

          necessary: true,

          analytics:
            consent.analytics ===
            true,

          marketing:
            consent.marketing ===
            true,

          consentVersion:
            COOKIE_CONSENT_VERSION,

          action,

          source,
        }),
      }
    );
  } catch (error) {
    console.warn(
      "[COOKIE CONSENT] salvarea în backend a eșuat:",
      error
    );
  }
}

/* =========================================================
   SAVE CONSENT
========================================================= */

export function saveConsent(
  partial,
  options = {}
) {
  const previous =
    readConsent();

  const value = {
    ...defaultConsent,
    ...previous,
    ...partial,

    necessary: true,

    consentVersion:
      COOKIE_CONSENT_VERSION,

    timestamp:
      Date.now(),
  };

  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify(value)
    );
  } catch (error) {
    console.warn(
      "[COOKIE CONSENT] localStorage failed:",
      error
    );
  }

  try {
    window.dispatchEvent(
      new CustomEvent(
        "cookie:consent",
        {
          detail: value,
        }
      )
    );
  } catch {
    // ignore
  }

  const action =
    options.action ||
    inferAction(value);

  const source =
    options.source ||
    "COOKIE_BANNER";

  void persistConsent({
    consent: value,
    action,
    source,
  });

  return value;
}

/* =========================================================
   HAS DECISION
========================================================= */

export function hasAnyDecision() {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  try {
    return Boolean(
      localStorage.getItem(
        CONSENT_KEY
      )
    );
  } catch {
    return false;
  }
}