// src/pages/Auth/Register/Register.jsx

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AlertTriangle,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react";

import { api } from "../../../lib/api";
import { trackSignup } from "../../../../services/analytics.js";

import styles from "./Register.module.css";

const OB_TICKET_PARAM = "obpf";
const REFERRAL_STORAGE_KEY = "artfest.referralCode";
const OB_TICKET_PREFIX = "onboarding.ticket.";

const GOOGLE_SCRIPT_ID =
  "google-identity-services-script";

const GOOGLE_SCRIPT_SRC =
  "https://accounts.google.com/gsi/client";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

/* =========================================================
 * Google Identity Services
 * ========================================================= */

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve(window.google);
      return;
    }

    const existingScript =
      document.getElementById(GOOGLE_SCRIPT_ID);

    if (existingScript) {
      const handleLoad = () => {
        cleanup();

        if (window.google?.accounts?.id) {
          resolve(window.google);
        } else {
          reject(
            new Error(
              "Google Identity Services nu s-a încărcat corect."
            )
          );
        }
      };

      const handleError = () => {
        cleanup();

        reject(
          new Error(
            "Scriptul Google nu a putut fi încărcat."
          )
        );
      };

      const cleanup = () => {
        existingScript.removeEventListener(
          "load",
          handleLoad
        );

        existingScript.removeEventListener(
          "error",
          handleError
        );
      };

      existingScript.addEventListener(
        "load",
        handleLoad
      );

      existingScript.addEventListener(
        "error",
        handleError
      );

      return;
    }

    const script = document.createElement("script");

    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google?.accounts?.id) {
        resolve(window.google);
      } else {
        reject(
          new Error(
            "Google Identity Services nu s-a încărcat corect."
          )
        );
      }
    };

    script.onerror = () => {
      reject(
        new Error(
          "Scriptul Google nu a putut fi încărcat."
        )
      );
    };

    document.head.appendChild(script);
  });
}

/* =========================================================
 * Helpers
 * ========================================================= */

function appendTicket(urlLike, ticket) {
  try {
    const url = new URL(
      urlLike,
      window.location.origin
    );

    url.searchParams.set(
      OB_TICKET_PARAM,
      ticket
    );

    return (
      url.pathname +
      url.search +
      url.hash
    );
  } catch {
    const separator =
      urlLike.includes("?")
        ? "&"
        : "?";

    return `${urlLike}${separator}${OB_TICKET_PARAM}=${encodeURIComponent(
      ticket
    )}`;
  }
}

function createOnboardingTicket() {
  const ticket =
    globalThis.crypto?.randomUUID?.() ||
    Math.random()
      .toString(36)
      .slice(2);

  const payload = {
    ts: Date.now(),
    intent: "vendor",
  };

  sessionStorage.setItem(
    OB_TICKET_PREFIX + ticket,
    JSON.stringify(payload)
  );

  return ticket;
}

function absLegalUrl(pathname) {
  const path = (pathname || "").trim();

  if (!path) {
    return "#";
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const relativePath =
    path.startsWith("/")
      ? path
      : `/${path}`;

  const base = (
    import.meta.env.VITE_LEGAL_BASE_URL ||
    (
      import.meta.env.VITE_API_URL ||
      window.location.origin
    ).replace(/\/api$/i, "")
  ).replace(/\/+$/, "");

  return `${base}${relativePath}`;
}

function suggestEmailTypos(value) {
  const normalized = value
    .trim()
    .toLowerCase();

  if (!normalized.includes("@")) {
    return {
      hint: "",
      suggestion: "",
    };
  }

  const [
    username,
    rawDomain = "",
  ] = normalized.split("@");

  if (!username || !rawDomain) {
    return {
      hint: "",
      suggestion: "",
    };
  }

  const fixes = [
    ["gmal.com", "gmail.com"],
    ["gmial.com", "gmail.com"],
    ["gnail.com", "gmail.com"],
    ["gmail.con", "gmail.com"],
    ["gmail.co", "gmail.com"],
    ["yaho.com", "yahoo.com"],
    ["yaaho.com", "yahoo.com"],
    ["yahoo.con", "yahoo.com"],
    ["outllok.com", "outlook.com"],
    ["hotnail.com", "hotmail.com"],
    [".con", ".com"],
    [".c0m", ".com"],
    [" .ro", ".ro"],
    [".ro ", ".ro"],
  ];

  let domain = rawDomain;

  for (const [bad, good] of fixes) {
    if (domain.endsWith(bad)) {
      domain =
        domain.slice(
          0,
          domain.length - bad.length
        ) + good;
    }
  }

  const commonDomains = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "proton.me",
    "mail.com",
    "live.com",
    "yahoo.ro",
    "gmail.ro",
  ];

  if (!domain.includes(".")) {
    const guess =
      commonDomains.find((candidate) =>
        candidate.startsWith(domain)
      ) ||
      (
        domain === "gmail"
          ? "gmail.com"
          : ""
      );

    if (guess) {
      domain = guess;
    }
  }

  const suggestion =
    `${username}@${domain}`;

  if (suggestion !== normalized) {
    return {
      hint: "Ai vrut să scrii:",
      suggestion,
    };
  }

  return {
    hint: "",
    suggestion: "",
  };
}

/* =========================================================
 * Legal metadata cache
 * ========================================================= */

const CACHE_TTL_MS =
  6 * 60 * 60 * 1000;

const LS_PREFIX = "legal:v1:";
const memCache = new Map();

function loadFromStorage(key) {
  try {
    const raw =
      localStorage.getItem(
        LS_PREFIX + key
      );

    if (!raw) {
      return null;
    }

    const {
      ts,
      data,
    } = JSON.parse(raw);

    if (!ts || !data) {
      return null;
    }

    if (
      Date.now() - ts >
      CACHE_TTL_MS
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function saveToStorage(key, data) {
  try {
    localStorage.setItem(
      LS_PREFIX + key,
      JSON.stringify({
        ts: Date.now(),
        data,
      })
    );
  } catch {
    // ignore
  }
}

async function fetchWithBackoff(
  url,
  {
    signal,
    tries = 4,
  } = {}
) {
  let delay = 500;

  for (
    let attempt = 0;
    attempt < tries;
    attempt += 1
  ) {
    try {
      return await api(url, {
        signal,
      });
    } catch (error) {
      const status =
        error?.status ||
        error?.data?.status;

      let retryAfterMs = 0;

      try {
        const retryAfter =
          error?.headers?.get?.(
            "Retry-After"
          );

        if (
          retryAfter &&
          /^\d+$/.test(retryAfter)
        ) {
          retryAfterMs =
            Number.parseInt(
              retryAfter,
              10
            ) * 1000;
        }
      } catch {
        // ignore
      }

      if (
        status === 429 ||
        status === 503
      ) {
        const jitter =
          Math.floor(
            Math.random() * 250
          );

        await new Promise((resolve) => {
          setTimeout(
            resolve,
            Math.max(
              retryAfterMs,
              delay
            ) + jitter
          );
        });

        delay *= 2;
        continue;
      }

      throw error;
    }
  }

  const error =
    new Error(
      "too_many_requests"
    );

  error.status = 429;

  throw error;
}

function useLegalMeta(types = []) {
  const [meta, setMeta] =
    useState({});

  const [loading, setLoading] =
    useState(!!types.length);

  const [error, setError] =
    useState("");

  const abortRef =
    useRef(null);

  const dependencyKey = useMemo(
    () =>
      types?.length
        ? types.join(",")
        : "",
    [types]
  );

  useEffect(() => {
    let active = true;

    if (!dependencyKey) {
      setMeta({});
      setLoading(false);
      setError("");
      return undefined;
    }

    const cached =
      memCache.get(
        dependencyKey
      ) ||
      loadFromStorage(
        dependencyKey
      );

    if (cached) {
      setMeta(cached);
      setLoading(false);
      setError("");
    }

    async function loadLegalMeta() {
      setLoading(true);
      setError("");

      try {
        abortRef.current?.abort?.();

        const controller =
          new AbortController();

        abortRef.current =
          controller;

        const result =
          await fetchWithBackoff(
            `/api/legal?types=${encodeURIComponent(
              dependencyKey
            )}`,
            {
              signal:
                controller.signal,
            }
          );

        if (!active) {
          return;
        }

        const mapped = {};

        for (
          const item of result || []
        ) {
          mapped[item.type] = item;
        }

        setMeta(mapped);

        memCache.set(
          dependencyKey,
          mapped
        );

        saveToStorage(
          dependencyKey,
          mapped
        );
      } catch (loadError) {
        if (!active) {
          return;
        }

        if (!cached) {
          setError(
            loadError?.status === 429
              ? "Nu am putut încărca informațiile legale deoarece limita de cereri a fost atinsă. Folosim linkurile implicite."
              : "Nu am putut încărca informațiile legale."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadLegalMeta();

    return () => {
      active = false;
      abortRef.current?.abort?.();
    };
  }, [dependencyKey]);

  return {
    meta,
    loading,
    error,
  };
}

/* =========================================================
 * Component
 * ========================================================= */

export default function Register({
  defaultAsVendor = false,
  inModal = false,
}) {
  const legalTypes = useMemo(
    () => [
      "tos",
      "privacy",
      "vendor_terms",
    ],
    []
  );

  const {
    meta: legal,
    error: legalError,
  } = useLegalMeta(legalTypes);

  /* ---------------- Referral ---------------- */

  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const referral =
      params.get("ref");

    if (referral) {
      localStorage.setItem(
        REFERRAL_STORAGE_KEY,
        referral
      );
    }
  }, []);

  /* ---------------- Form fields ---------------- */

  const [email, setEmail] =
    useState("");

  const [
    emailHint,
    setEmailHint,
  ] = useState("");

  const [
    emailSuggestion,
    setEmailSuggestion,
  ] = useState("");

  const [
    emailExists,
    setEmailExists,
  ] = useState(null);

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    showPw,
    setShowPw,
  ] = useState(false);

  const [
    peekPw,
    setPeekPw,
  ] = useState(false);

  const [
    pwFocused,
    setPwFocused,
  ] = useState(false);

  const [
    capsOn,
    setCapsOn,
  ] = useState(false);

  const [
    firstName,
    setFirstName,
  ] = useState("");

  const [
    lastName,
    setLastName,
  ] = useState("");

  /* ---------------- Vendor ---------------- */

  const [
    asVendor,
    setAsVendor,
  ] = useState(defaultAsVendor);

  const [
    vendorEntityConfirm,
    setVendorEntityConfirm,
  ] = useState(false);

  const [
    vendorTermsAccepted,
    setVendorTermsAccepted,
  ] = useState(false);

  /* ---------------- Consents ---------------- */

  const [
    tosAccepted,
    setTosAccepted,
  ] = useState(false);

  const [
    privacyAcknowledged,
    setPrivacyAcknowledged,
  ] = useState(false);

  const [
    marketingOptIn,
    setMarketingOptIn,
  ] = useState(false);

  /* ---------------- UI state ---------------- */

  const [err, setErr] =
    useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    googleLoading,
    setGoogleLoading,
  ] = useState(false);

  const [
    googleReady,
    setGoogleReady,
  ] = useState(false);

  const [
    googleError,
    setGoogleError,
  ] = useState("");

  const [
    offline,
    setOffline,
  ] = useState(
    !navigator.onLine
  );

  const [
    unverifiedEmail,
    setUnverifiedEmail,
  ] = useState("");

  const [
    resendBusy,
    setResendBusy,
  ] = useState(false);

  const [
    resendOk,
    setResendOk,
  ] = useState(false);

  /* ---------------- Refs ---------------- */

  const idemRef = useRef(
    globalThis.crypto?.randomUUID?.() ||
      Math.random()
        .toString(36)
        .slice(2)
  );

  const emailAbortRef =
    useRef(null);

  const liveRef =
    useRef(null);

  const pwRef =
    useRef(null);

  const googleButtonRef =
    useRef(null);

  const googleCallbackRef =
    useRef(null);

  /* ---------------- Derived values ---------------- */

  const score = useMemo(() => {
    const lengthScore =
      password.length >= 8
        ? 1
        : 0;

    const lowerScore =
      /[a-z]/.test(password)
        ? 1
        : 0;

    const upperScore =
      /[A-Z]/.test(password)
        ? 1
        : 0;

    const digitScore =
      /\d/.test(password)
        ? 1
        : 0;

    const symbolScore =
      /[^A-Za-z0-9]/.test(
        password
      )
        ? 1
        : 0;

    return (
      lengthScore +
      lowerScore +
      upperScore +
      digitScore +
      symbolScore
    );
  }, [password]);

  const fullName =
    `${firstName.trim()} ${lastName.trim()}`.trim();

  const vendorRequirementsAccepted =
    !asVendor ||
    (
      vendorEntityConfirm &&
      vendorTermsAccepted
    );

  const mandatoryConsentsAccepted =
    tosAccepted &&
    privacyAcknowledged;

 const canUseGoogle =
  googleReady &&
  mandatoryConsentsAccepted &&
  vendorRequirementsAccepted &&
  !offline &&
  !googleLoading;

  const canSubmit =
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!email.trim() &&
    emailExists !== true &&
    password.length >= 8 &&
    score >= 3 &&
    mandatoryConsentsAccepted &&
    vendorRequirementsAccepted;

  /* =========================================================
   * Consents builder
   * ========================================================= */

  function buildConsents() {
    const consents = [];

    if (tosAccepted) {
      const version =
        legal?.tos?.version ??
        "1.0.0";

      const checksum =
        legal?.tos?.checksum ??
        null;

      consents.push({
        type: "tos",
        version: String(version),
        checksum:
          checksum === null
            ? null
            : String(checksum),
      });
    }

    if (privacyAcknowledged) {
      const version =
        legal?.privacy?.version ??
        "1.0.0";

      const checksum =
        legal?.privacy?.checksum ??
        null;

      consents.push({
        type: "privacy_ack",
        version: String(version),
        checksum:
          checksum === null
            ? null
            : String(checksum),
      });
    }

    if (
      asVendor &&
      vendorTermsAccepted
    ) {
      const version =
        legal?.vendor_terms?.version ??
        "1.0.0";

      const checksum =
        legal?.vendor_terms?.checksum ??
        null;

      consents.push({
        type: "vendor_terms",
        version: String(version),
        checksum:
          checksum === null
            ? null
            : String(checksum),
      });
    }

    if (marketingOptIn) {
      consents.push({
        type:
          "marketing_email_optin",
        version: "1.0.0",
      });
    }

    return consents;
  }

  function getReferralCode() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return (
      params.get("ref") ||
      localStorage.getItem(
        REFERRAL_STORAGE_KEY
      ) ||
      null
    );
  }

  function clearReferralCode() {
    try {
      localStorage.removeItem(
        REFERRAL_STORAGE_KEY
      );
    } catch {
      // ignore
    }
  }

  /* =========================================================
   * Redirect after successful registration
   * ========================================================= */

  function redirectAfterSuccess(
    response,
    vendorIntent
  ) {
    if (vendorIntent) {
      try {
        sessionStorage.setItem(
          "onboarding.intent",
          "vendor"
        );

        const ticket =
          createOnboardingTicket();

        const next =
          response?.next ||
          "/onboarding";

        window.location.assign(
          appendTicket(
            next,
            ticket
          )
        );

        return;
      } catch {
        window.location.assign(
          response?.next ||
            "/onboarding"
        );

        return;
      }
    }

    window.location.assign(
      response?.next ||
        "/desktop-user"
    );
  }

  /* =========================================================
   * Google callback
   * ========================================================= */

  async function handleGoogleCredential(
    googleResponse
  ) {
    const credential =
      googleResponse?.credential;

    if (!credential) {
      setGoogleError(
        "Google nu a returnat datele necesare autentificării."
      );

      return;
    }

    if (!mandatoryConsentsAccepted) {
      setGoogleError(
        "Acceptă Termenii și Condițiile și Politica de confidențialitate înainte să continui cu Google."
      );

      return;
    }

    if (
      asVendor &&
      !vendorEntityConfirm
    ) {
      setGoogleError(
        "Declarația privind responsabilitatea fiscală este obligatorie pentru furnizori."
      );

      return;
    }

    if (
      asVendor &&
      !vendorTermsAccepted
    ) {
      setGoogleError(
        "Acordul Master pentru Vânzători este obligatoriu."
      );

      return;
    }

    if (!navigator.onLine) {
      setGoogleError(
        "Ești offline. Verifică conexiunea la internet."
      );

      return;
    }

    setErr("");
    setGoogleError("");
    setGoogleLoading(true);

    const referral =
      getReferralCode();

    try {
     const response =
  await api(
    "/api/auth/google",
    {
      method: "POST",

      body: {
        credential,

        remember: true,

        mode:
          "register",

        asVendor:
          !!asVendor,

        entitySelfDeclared:
          asVendor
            ? !!vendorEntityConfirm
            : false,

        entityMeta:
          asVendor &&
          vendorEntityConfirm
            ? {
                pageUrl:
                  window.location.href,

                referrer:
                  document.referrer ||
                  null,
              }
            : undefined,

        consents:
          buildConsents(),

        ref:
          referral ||
          undefined,
      },
    }
  );

      if (response?.isNewUser) {
  trackSignup();
}

if (referral) {
  clearReferralCode();
}

      redirectAfterSuccess(
        response,
        asVendor
      );
    } catch (error) {
      console.error(
        "Google register error:",
        error
      );

      setGoogleError(
        error?.data?.message ||
          error?.message ||
          "Înregistrarea cu Google a eșuat. Încearcă din nou."
      );
    } finally {
      setGoogleLoading(false);
    }
  }

  googleCallbackRef.current =
    handleGoogleCredential;

  /* =========================================================
   * Google button setup
   * ========================================================= */

  useEffect(() => {
    let active = true;

    async function setupGoogle() {
      if (!GOOGLE_CLIENT_ID) {
        if (active) {
          setGoogleReady(false);

          setGoogleError(
            "Lipsește VITE_GOOGLE_CLIENT_ID din configurația frontendului."
          );
        }

        return;
      }

      try {
        await loadGoogleIdentityScript();

        if (
          !active ||
          !googleButtonRef.current
        ) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id:
            GOOGLE_CLIENT_ID,

          callback: (
            response
          ) => {
            googleCallbackRef.current?.(
              response
            );
          },

          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside:
            true,
          context: "signup",
        });

        googleButtonRef.current.innerHTML =
          "";

        const availableWidth =
  googleButtonRef.current
    ?.parentElement
    ?.clientWidth || 360;

window.google.accounts.id.renderButton(
  googleButtonRef.current,
  {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signup_with",
    shape: "pill",
    logo_alignment: "left",
    width: Math.min(
      400,
      Math.max(
        240,
        availableWidth
      )
    ),
    locale: "ro",
  }
);

        if (active) {
          setGoogleReady(true);
          setGoogleError("");
        }
      } catch (error) {
        console.error(
          "Google Identity Services error:",
          error
        );

        if (active) {
          setGoogleReady(false);

          setGoogleError(
            "Butonul Google nu a putut fi încărcat. Reîncarcă pagina."
          );
        }
      }
    }

    setupGoogle();

    return () => {
      active = false;
    };
  }, []);

  /* =========================================================
   * Online/offline
   * ========================================================= */

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
    };

    const handleOffline = () => {
      setOffline(true);
    };

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, []);

  /* =========================================================
   * Email validation
   * ========================================================= */

  useEffect(() => {
    const {
      hint,
      suggestion,
    } = suggestEmailTypos(
      email
    );

    setEmailHint(hint);
    setEmailSuggestion(
      suggestion
    );

    try {
      emailAbortRef.current?.abort?.();
    } catch {
      // ignore
    }

    const controller =
      new AbortController();

    emailAbortRef.current =
      controller;

    const normalized =
      email
        .trim()
        .toLowerCase();

    if (!normalized) {
      setEmailExists(null);
      return undefined;
    }

    const timer =
      setTimeout(
        async () => {
          try {
            const response =
              await api(
                `/api/auth/exists?email=${encodeURIComponent(
                  normalized
                )}`,
                {
                  signal:
                    controller.signal,
                }
              );

            setEmailExists(
              !!response?.exists
            );
          } catch {
            setEmailExists(null);
          }
        },
        450
      );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [email]);

  /* =========================================================
   * UI handlers
   * ========================================================= */

  function applyEmailSuggestion() {
    if (emailSuggestion) {
      setEmail(
        emailSuggestion
      );
    }

    setEmailHint("");
  }

  function handlePwKey(event) {
    try {
      setCapsOn(
        !!event.getModifierState?.(
          "CapsLock"
        )
      );
    } catch {
      // ignore
    }

    if (
      (
        event.altKey ||
        event.metaKey
      ) &&
      (
        event.key === "v" ||
        event.key === "V"
      )
    ) {
      event.preventDefault();

      setShowPw(
        (current) =>
          !current
      );
    }

    if (
      (
        event.ctrlKey ||
        event.metaKey
      ) &&
      event.key === "Enter"
    ) {
      try {
        (
          event.target?.form ||
          document.querySelector(
            "form"
          )
        )?.requestSubmit?.();
      } catch {
        // ignore
      }
    }

    if (event.key === "Escape") {
      setErr("");
      setGoogleError("");
    }
  }

  async function handleResend() {
    if (!unverifiedEmail) {
      return;
    }

    try {
      setResendBusy(true);

      await api(
        "/api/auth/resend-verification",
        {
          method: "POST",
          body: {
            email:
              unverifiedEmail,
          },
        }
      );

      setResendOk(true);
    } catch {
      // ignore
    } finally {
      setResendBusy(false);
    }
  }

  /* =========================================================
   * Classic registration
   * ========================================================= */

  async function onSubmit(event) {
    event.preventDefault();

    if (
      !canSubmit ||
      loading ||
      googleLoading
    ) {
      return;
    }

    if (offline) {
      setErr(
        "Ești offline. Verifică conexiunea la internet."
      );

      return;
    }

    setErr("");
    setGoogleError("");
    setResendOk(false);
    setUnverifiedEmail("");
    setLoading(true);

    const referral =
      getReferralCode();

    const normalizedEmail =
      email
        .trim()
        .toLowerCase();

    const body = {
      email:
        normalizedEmail,

      password,

      firstName:
        firstName.trim() ||
        undefined,

      lastName:
        lastName.trim() ||
        undefined,

      name:
        fullName ||
        undefined,

      asVendor:
        !!asVendor,

      entitySelfDeclared:
        asVendor
          ? !!vendorEntityConfirm
          : false,

      entityMeta:
        asVendor &&
        vendorEntityConfirm
          ? {
              pageUrl:
                window.location.href,

              referrer:
                document.referrer ||
                null,
            }
          : undefined,

      consents:
        buildConsents(),

      noExternalLinks: true,

      ref:
        referral ||
        undefined,
    };

    try {
      const response =
        await api(
          "/api/auth/signup",
          {
            method: "POST",

            headers: {
              "Idempotency-Key":
                idemRef.current,
            },

            body,
          }
        );

      trackSignup();

      if (referral) {
        clearReferralCode();
      }

      if (
        response?.status ===
        "pending_verification"
      ) {
        try {
          sessionStorage.setItem(
            "onboarding.intent",
            asVendor
              ? "vendor"
              : ""
          );
        } catch {
          // ignore
        }

        const next =
          response?.next ||
          `/verify-email?email=${encodeURIComponent(
            normalizedEmail
          )}`;

        window.location.assign(
          next
        );

        return;
      }

      redirectAfterSuccess(
        response,
        asVendor
      );
    } catch (error) {
      console.error(
        "Register error:",
        error
      );

      const fieldErrors =
        error?.data?.details
          ?.fieldErrors;

      const formErrors =
        error?.data?.details
          ?.formErrors;

      const formattedFieldErrors =
        fieldErrors
          ? Object.entries(
              fieldErrors
            )
              .map(
                ([
                  key,
                  values,
                ]) =>
                  `${key}: ${(values || []).join(
                    ", "
                  )}`
              )
              .join(" • ")
          : "";

      const message =
        (
          error?.status === 409 &&
          (
            error?.data?.error ===
            "email_exists_unverified"
              ? "Există deja un cont cu acest email, dar nu este confirmat."
              : "Acest email este deja folosit."
          )
        ) ||
        error?.data?.message ||
        formattedFieldErrors ||
        (
          formErrors?.length
            ? formErrors.join(
                " • "
              )
            : ""
        ) ||
        error?.message ||
        "Înregistrarea a eșuat.";

      setErr(message);

      setUnverifiedEmail(
        error?.data?.error ===
          "email_exists_unverified"
          ? normalizedEmail
          : ""
      );

      try {
        liveRef.current?.focus?.();

        if (
          error?.status === 409
        ) {
          document
            .getElementById(
              "reg-email"
            )
            ?.focus();
        } else {
          pwRef.current?.focus();
          pwRef.current?.select?.();
        }
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
   * Legal URLs
   * ========================================================= */

  const tosUrl =
    legal?.tos?.url &&
    legal.tos.url !== "#"
      ? legal.tos.url
      : "/termenii-si-conditiile";

  const privacyUrl =
    legal?.privacy?.url &&
    legal.privacy.url !== "#"
      ? legal.privacy.url
      : "/confidentialitate";

  const vendorTermsUrl =
    legal?.vendor_terms?.url &&
    legal.vendor_terms.url !== "#"
      ? legal.vendor_terms.url
      : "/acord-vanzatori";

  const passwordType =
    showPw || peekPw
      ? "text"
      : "password";

  const showPasswordToggle =
    pwFocused ||
    password.length > 0;

  /* =========================================================
   * Form
   * ========================================================= */

  const form = (
    <form
      className={styles.body}
      onSubmit={onSubmit}
      noValidate
    >
      <div
        ref={liveRef}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      />

      {offline && (
        <div
          className={styles.error}
          role="status"
        >
          Ești offline — verifică rețeaua.
        </div>
      )}

      {legalError && (
        <div
          className={
            styles.legalNotice
          }
          role="status"
        >
          {legalError}
        </div>
      )}

      {/* Tip cont */}
      <div
        role="group"
        aria-labelledby="vendor-box-title"
        className={`${styles.vendorBox} ${
          asVendor
            ? styles.vendorBoxActive
            : ""
        }`}
      >
        <label
          className={
            styles.vendorCheck
          }
        >
          <input
            type="checkbox"
            checked={asVendor}
            onChange={(event) => {
              const checked =
                event.target.checked;

              setAsVendor(checked);
              setGoogleError("");

              if (!checked) {
                setVendorEntityConfirm(
                  false
                );

                setVendorTermsAccepted(
                  false
                );
              }

              try {
                sessionStorage.setItem(
                  "onboarding.intent",
                  checked
                    ? "vendor"
                    : ""
                );
              } catch {
                // ignore
              }
            }}
          />

          <span
            id="vendor-box-title"
            className={
              styles.vendorTitle
            }
          >
            Sunt{" "}
            <strong>
              furnizor de servicii /
              partener Artfest
            </strong>
          </span>
        </label>

        <p
          className={
            styles.vendorNote
          }
        >
          <AlertTriangle
            size={14}
            aria-hidden="true"
          />

          <span>
            <strong>
              Doar pentru furnizori.
            </strong>{" "}
            Clienții care doresc să
            comande <u>nu bifează</u>{" "}
            această opțiune.
          </span>
        </p>

        {asVendor && (
          <>
            <label
              className={
                styles.entityConfirmRow
              }
            >
              <input
                type="checkbox"
                checked={
                  vendorEntityConfirm
                }
                onChange={(event) => {
                  setVendorEntityConfirm(
                    event.target
                      .checked
                  );

                  setGoogleError("");
                }}
                aria-required="true"
              />

              <span
                className={
                  styles.spanConfirm
                }
              >
                Declar că sunt
                responsabil(ă) pentru
                obligațiile fiscale și
                pentru legalitatea
                activităților
                desfășurate prin
                platformă, fie ca
                persoană fizică, fie
                printr-o entitate
                juridică.
              </span>
            </label>

            <label
              className={`${styles.legalRow} ${styles.vendorTermsRow}`}
            >
              <input
                type="checkbox"
                checked={
                  vendorTermsAccepted
                }
                onChange={(event) => {
                  setVendorTermsAccepted(
                    event.target
                      .checked
                  );

                  setGoogleError("");
                }}
                required
              />

              <span>
                Accept{" "}
                <a
                  className={
                    styles.legalLink
                  }
                  href={absLegalUrl(
                    vendorTermsUrl
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Acordul Master pentru
                  Vânzători
                </a>
                .
              </span>
            </label>
          </>
        )}
      </div>

      {/* Consimțăminte generale */}
      <div
        className={
          styles.legalGroup
        }
      >
        <label
          className={
            styles.legalRow
          }
        >
          <input
            type="checkbox"
            checked={
              tosAccepted &&
              privacyAcknowledged
            }
            onChange={(event) => {
              const checked =
                event.target.checked;

              setTosAccepted(checked);
              setPrivacyAcknowledged(
                checked
              );

              setGoogleError("");
            }}
            required
          />

          <span>
            Prin crearea contului,
            confirm că am citit și
            accept{" "}
            <a
              className={
                styles.legalLink
              }
              href={absLegalUrl(
                tosUrl
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Termenii și Condițiile
            </a>{" "}
            și{" "}
            <a
              className={
                styles.legalLink
              }
              href={absLegalUrl(
                privacyUrl
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Politica de
              confidențialitate
            </a>
            .
          </span>
        </label>

        <label
          className={
            styles.legalRow
          }
        >
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(event) => {
              setMarketingOptIn(
                event.target.checked
              );
            }}
          />

          <span
            className={
              styles.legalMuted
            }
          >
            Accept să primesc noutăți
            și oferte prin email/SMS
            (opțional).
          </span>
        </label>
      </div>

      {/* Prenume și nume */}
      <div
        className={
          styles.nameRow
        }
      >
        <label
          className={
            styles.nameCol
          }
        >
          <span
            className={
              styles.srOnly
            }
          >
            Prenume
          </span>

          <input
            className={
              styles.field
            }
            value={firstName}
            onChange={(event) =>
              setFirstName(
                event.target.value
              )
            }
            placeholder="Prenume"
            autoComplete="given-name"
            required
          />
        </label>

        <label
          className={
            styles.nameCol
          }
        >
          <span
            className={
              styles.srOnly
            }
          >
            Nume
          </span>

          <input
            className={
              styles.field
            }
            value={lastName}
            onChange={(event) =>
              setLastName(
                event.target.value
              )
            }
            placeholder="Nume"
            autoComplete="family-name"
            required
          />
        </label>
      </div>

      {/* Email */}
      <div
        className={
          styles.fieldGroup
        }
      >
        <label
          className={
            styles.srOnly
          }
          htmlFor="reg-email"
        >
          Email
        </label>

        <input
          id="reg-email"
          className={
            styles.field
          }
          value={email}
          onChange={(event) =>
            setEmail(
              event.target.value
            )
          }
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Email"
          aria-invalid={
            emailExists === true
          }
        />

        {(
          emailHint ||
          emailSuggestion ||
          emailExists === true
        ) && (
          <div
            className={
              styles.suggestionRow
            }
          >
            {emailHint && (
              <small
                className={
                  styles.hint
                }
              >
                {emailHint}
              </small>
            )}

            {emailSuggestion && (
              <button
                type="button"
                className={
                  styles.pill
                }
                onClick={
                  applyEmailSuggestion
                }
              >
                Aplicați:{" "}
                <strong>
                  {emailSuggestion}
                </strong>
              </button>
            )}

            {emailExists === true && (
              <small
                className={
                  styles.error
                }
                role="alert"
              >
                Acest email este deja
                folosit.{" "}
                <a
                  href="/autentificare"
                  className={
                    styles.inlineLink
                  }
                >
                  Autentifică-te
                </a>{" "}
                sau{" "}
                <a
                  href={`/reset-parola?email=${encodeURIComponent(
                    email
                      .trim()
                      .toLowerCase()
                  )}`}
                  className={
                    styles.inlineLink
                  }
                >
                  resetează parola
                </a>
                .
              </small>
            )}
          </div>
        )}
      </div>

      {/* Parolă */}
      <div>
        <div
          className={`${styles.inputGroup} ${
            showPasswordToggle
              ? styles.hasToggle
              : ""
          }`}
        >
          <input
            ref={pwRef}
            className={
              styles.field
            }
            value={password}
            onChange={(event) =>
              setPassword(
                event.target.value
              )
            }
            onKeyUp={handlePwKey}
            onKeyDown={handlePwKey}
            onFocus={() =>
              setPwFocused(true)
            }
            onBlur={() =>
              setPwFocused(false)
            }
            type={passwordType}
            placeholder="Parolă (min 8)"
            required
            autoComplete="new-password"
            aria-describedby="pw-hint"
            aria-label="Parolă"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />

          {showPasswordToggle && (
            <button
              type="button"
              className={
                styles.togglePw
              }
              aria-label={
                showPw || peekPw
                  ? "Ascunde parola"
                  : "Afișează parola"
              }
              aria-pressed={
                showPw || peekPw
              }
              onClick={() =>
                setShowPw(
                  (current) =>
                    !current
                )
              }
              onMouseDown={(event) => {
                event.preventDefault();
                setPeekPw(true);
              }}
              onMouseUp={() =>
                setPeekPw(false)
              }
              onMouseLeave={() =>
                setPeekPw(false)
              }
              onTouchStart={() => {
                setPeekPw(true);

                try {
                  pwRef.current?.focus({
                    preventScroll: true,
                  });
                } catch {
                  // ignore
                }
              }}
              onTouchEnd={() =>
                setPeekPw(false)
              }
              onTouchCancel={() =>
                setPeekPw(false)
              }
            >
              {showPw || peekPw ? (
                <EyeOff size={18} />
              ) : (
                <Eye size={18} />
              )}
            </button>
          )}
        </div>

        <div
          className={
            styles.progress
          }
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={score}
        >
          <div
            className={
              styles.bar
            }
            style={{
              width:
                `${(score / 5) * 100}%`,
            }}
          />
        </div>

        <small
          id="pw-hint"
          className={
            styles.hint
          }
        >
          Recomandat: minim 8
          caractere și o combinație de
          litere mari/mici, cifre și
          simboluri.
        </small>

        {capsOn && pwFocused && (
          <div
            className={
              styles.capsHint
            }
          >
            <AlertTriangle
              size={14}
              aria-hidden="true"
            />

            <span>
              CapsLock este activ – ai
              grijă la literele mari.
            </span>
          </div>
        )}
      </div>

      {/* Submit clasic */}
      <button
        type="submit"
        className={
          styles.primaryBtn
        }
        disabled={
          loading ||
          googleLoading ||
          !canSubmit
        }
        aria-busy={
          loading
            ? "true"
            : "false"
        }
      >
        {loading
          ? "Se înregistrează…"
          : "Creează cont"}
      </button>
{/* Separator Google */}
<div
  className={
    styles.authSeparator
  }
  aria-hidden="true"
>
  <span
    className={
      styles.authSeparatorLine
    }
  />

  <span
    className={
      styles.authSeparatorText
    }
  >
    sau creează cont cu Google
  </span>

  <span
    className={
      styles.authSeparatorLine
    }
  />
</div>

{/* Google */}
<div
  className={
    styles.googleSection
  }
>
  <div
    className={
      styles.googleButtonWrap
    }
    style={{
      pointerEvents:
        canUseGoogle
          ? "auto"
          : "none",

      opacity:
        canUseGoogle
          ? 1
          : 0.5,
    }}
  >
    <div
  ref={googleButtonRef}
  aria-label="Continuă cu Google"
  className={
    styles.googleButtonInner
  }
  hidden={googleLoading}
/>
  </div>

  {googleLoading && (
    <div
      role="status"
      className={
        styles.googleLoading
      }
    >
      Se creează contul cu Google…
    </div>
  )}

  {!googleReady &&
    !googleError &&
    !googleLoading && (
      <small
        className={
          styles.googleLoadingHint
        }
      >
        Se încarcă autentificarea Google…
      </small>
    )}

  {!canUseGoogle &&
    googleReady &&
    !googleLoading && (
      <small
        className={
          styles.hint
        }
      >
        Acceptă condițiile obligatorii de mai sus pentru a continua cu Google.
      </small>
    )}

  {googleError && (
    <div
      className={
        styles.error
      }
      role="alert"
    >
      {googleError}
    </div>
  )}
</div>
      {err && (
        <div
          className={
            styles.error
          }
          role="alert"
        >
          {err}
        </div>
      )}

      {unverifiedEmail && (
        <div
          className={
            styles.info
          }
          role="status"
          style={{
            marginTop: 8,
          }}
        >
          <div
            style={{
              marginBottom: 8,
            }}
          >
            Nu găsești emailul de
            confirmare? Îl putem
            retrimite către{" "}
            <strong>
              {unverifiedEmail}
            </strong>
            .
          </div>

          {!resendOk ? (
            <button
              type="button"
              className={
                styles.primaryBtn
              }
              onClick={
                handleResend
              }
              disabled={
                resendBusy
              }
            >
              {resendBusy
                ? "Se retrimite…"
                : "Trimite din nou emailul de confirmare"}
            </button>
          ) : (
            <div>
              Gata! Verifică inboxul
              și folderele Spam sau
              Promo.
            </div>
          )}
        </div>
      )}
    </form>
  );

  if (inModal) {
    return form;
  }

  return (
    <section
      className={
        styles.wrap
      }
    >
      <header
        className={
          styles.header
        }
      >
        <h2
          className={
            styles.title
          }
        >
          Creează cont
        </h2>

        <p
          className={
            styles.subtitle
          }
        >
          Îți faci cont în câteva
          secunde.
        </p>
      </header>

      <div
        className={
          styles.card
        }
      >
        {form}
      </div>
    </section>
  );
}