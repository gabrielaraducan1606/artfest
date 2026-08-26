// src/pages/Auth/Login/Login.jsx

/**
 * Pagina / componenta de Login.
 *
 * - Poate funcționa ca pagină full (cu tab-uri Login / Register)
 *   sau ca modal.
 * - Integrare backend:
 *   - POST /api/auth/login
 *   - POST /api/auth/google
 *   - GET  /api/auth/exists?email=
 * - Google Identity Services:
 *   - încarcă scriptul Google
 *   - afișează butonul oficial Google
 *   - trimite credential-ul către backend
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  Eye,
  EyeOff,
} from "lucide-react";

import { api } from "../../../lib/api";
import Register from "../Register/Register";
import { useAuth } from "../Context/context.js";

import styles from "./Login.module.css";

const GOOGLE_SCRIPT_ID =
  "google-identity-services-script";

const GOOGLE_SCRIPT_SRC =
  "https://accounts.google.com/gsi/client";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

/* =========================================================
 * Încarcă Google Identity Services o singură dată.
 * ========================================================= */
function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (
      window.google?.accounts?.id
    ) {
      resolve(window.google);
      return;
    }

    const existingScript =
      document.getElementById(
        GOOGLE_SCRIPT_ID
      );

    if (existingScript) {
      const onLoad = () => {
        cleanup();

        if (
          window.google?.accounts?.id
        ) {
          resolve(window.google);
        } else {
          reject(
            new Error(
              "Google Identity Services nu s-a încărcat corect."
            )
          );
        }
      };

      const onError = () => {
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
          onLoad
        );

        existingScript.removeEventListener(
          "error",
          onError
        );
      };

      existingScript.addEventListener(
        "load",
        onLoad
      );

      existingScript.addEventListener(
        "error",
        onError
      );

      return;
    }

    const script =
      document.createElement("script");

    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (
        window.google?.accounts?.id
      ) {
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
 * Sugestii anti-typo pentru email.
 * ========================================================= */
function suggestEmailTypos(value) {
  const v = value
    .trim()
    .toLowerCase();

  if (!v.includes("@")) {
    return {
      hint: "",
      suggestion: "",
    };
  }

  const [
    user,
    domRaw = "",
  ] = v.split("@");

  if (!user || !domRaw) {
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

  let dom = domRaw;

  for (
    const [bad, good] of fixes
  ) {
    if (dom.endsWith(bad)) {
      dom =
        dom.slice(
          0,
          dom.length - bad.length
        ) + good;
    }
  }

  const common = [
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

  if (!dom.includes(".")) {
    const guess =
      common.find((d) =>
        d.startsWith(dom)
      ) ||
      (dom === "gmail"
        ? "gmail.com"
        : "");

    if (guess) {
      dom = guess;
    }
  }

  const suggestion =
    `${user}@${dom}`;

  if (suggestion !== v) {
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

export default function Login({
  inModal = false,
  onLoggedIn,
  redirectTo = null,
  onSwitchToRegister,
}) {
  const { refresh } = useAuth();
const influencerInviteToken = (() => {
  if (inModal) return "";

  try {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return (
      params.get(
        "influencerInvite"
      ) || ""
    ).trim();
  } catch {
    return "";
  }
})();

  /* ---------------- Tab login / register ---------------- */

  const [tab, setTab] =
    useState("login");

  useEffect(() => {
    if (inModal) return;

    try {
      const sp =
        new URLSearchParams(
          window.location.search
        );

      const t = sp.get("auth");

      setTab(
        t === "register"
          ? "register"
          : "login"
      );
    } catch {
      // ignore
    }
  }, [inModal]);

  /* ---------------- ID-uri ---------------- */

  const baseId = useId();
  const emailId = useId();
  const passwordId = useId();

  const loginPanelId =
    `${baseId}-login-panel`;

  const registerPanelId =
    `${baseId}-register-panel`;

  const capsHintId =
    `${baseId}-caps-hint`;

  /* ---------------- State login ---------------- */

  const [email, setEmail] =
    useState(() => {
      try {
        return (
          localStorage.getItem(
            "lastEmail"
          ) || ""
        );
      } catch {
        return "";
      }
    });

  const [
    emailTypoHint,
    setEmailTypoHint,
  ] = useState("");

  const [
    emailExistsHint,
    setEmailExistsHint,
  ] = useState("");

  const [
    emailSuggestion,
    setEmailSuggestion,
  ] = useState("");

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
    remember,
    setRemember,
  ] = useState(true);

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
    cooldownSec,
    setCooldownSec,
  ] = useState(0);

  /* ---------------- Refs ---------------- */

  const emailRef =
    useRef(null);

  const pwRef =
    useRef(null);

  const liveRef =
    useRef(null);

  const googleButtonRef =
    useRef(null);

  const googleCallbackRef =
    useRef(null);

  const loginAbortRef =
    useRef(null);

  const existsAbortRef =
    useRef(null);

  const normalizeEmail = (
    s = ""
  ) =>
    s
      .trim()
      .toLowerCase();

  /* =========================================================
   * Redirect comun după login clasic sau Google.
   * ========================================================= */
  async function finishLogin(
  response
) {
  let user =
    response?.user || null;

  try {
    await refresh();
  } catch {
    // Loginul poate fi reușit chiar dacă /me
    // are temporar o eroare.
  }

  /*
   * Dacă utilizatorul a venit dintr-o
   * invitație de influencer și loginul
   * a reușit, acceptăm invitația pe
   * contul existent.
   */
  if (influencerInviteToken) {
    try {
      const accepted =
        await api(
          "/api/influencer/accept-existing",
          {
            method: "POST",

            body: {
              token:
                influencerInviteToken,
            },
          }
        );

      if (accepted?.ok) {
        user = {
          ...(user || {}),
          ...(accepted?.user || {}),
          role: "INFLUENCER",
        };

        /*
         * Backendul tocmai a emis JWT
         * nou cu role=INFLUENCER.
         * Reîmprospătăm contextul Auth.
         */
        try {
          await refresh();
        } catch {
          // Cookie-ul este deja actualizat.
        }

        onLoggedIn?.(user);

        try {
          window.dispatchEvent(
            new CustomEvent(
              "auth:login"
            )
          );
        } catch {
          // ignore
        }

        window.location.assign(
          accepted?.next ||
            "/influencer"
        );

        return;
      }
    } catch (error) {
      console.error(
        "Accept influencer invite error:",
        error
      );

      const code =
        error?.data?.error ||
        error?.error ||
        "";

      if (
        code ===
        "invitation_email_mismatch"
      ) {
        setErr(
          "Invitația de influencer aparține unui alt cont. Conectează-te cu emailul pe care ai primit invitația."
        );

        return;
      }

      if (
        code ===
        "invitation_expired" ||
        code ===
        "invitation_unavailable" ||
        code ===
        "invitation_already_used"
      ) {
        setErr(
          "Invitația de influencer nu mai este disponibilă. Cere administratorului un link nou."
        );

        return;
      }

      if (
        code ===
        "role_incompatible"
      ) {
        setErr(
          "Acest cont are deja un alt tip de profil Artfest și nu poate fi transformat automat în cont de influencer."
        );

        return;
      }

      if (
        code ===
        "already_influencer"
      ) {
        try {
          await refresh();
        } catch {
          // ignore
        }

        window.location.assign(
          "/influencer"
        );

        return;
      }

      setErr(
        error?.data?.message ||
          error?.message ||
          "Autentificarea a reușit, dar invitația de influencer nu a putut fi acceptată."
      );

      return;
    }
  }

  onLoggedIn?.(user);

  try {
    window.dispatchEvent(
      new CustomEvent(
        "auth:login"
      )
    );
  } catch {
    // ignore
  }

  let next =
    response?.next || "";

  /*
   * Dacă autentificarea a fost pornită
   * dintr-o acțiune din platformă,
   * respectăm redirect-ul contextual.
   */
  if (redirectTo) {
    next = redirectTo;
  }

  /*
   * Dacă nu avem redirect contextual,
   * mergem în dashboard în funcție de rol.
   */
  if (!next) {
    const role =
      user?.role;

    if (role === "ADMIN") {
      next = "/admin";
    } else if (
      role === "VENDOR"
    ) {
      next = "/desktop";
    } else if (
      role === "INFLUENCER"
    ) {
      next = "/influencer";
    } else {
      next = "/desktop-user";
    }
  }

  window.location.assign(
    next
  );
}
  /* =========================================================
   * Răspunsul primit de la Google.
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

    if (!navigator.onLine) {
      setGoogleError(
        "Ești offline. Verifică conexiunea la internet."
      );

      return;
    }

    setErr("");
    setGoogleError("");
    setGoogleLoading(true);

    try {
    const response =
  await api(
    "/api/auth/google",
    {
      method: "POST",

      body: {
        credential,

        remember:
          !!remember,

        mode:
          "login",
      },
    }
  );
      await finishLogin(
        response
      );
    } catch (error) {
      console.error(
        "Google login error:",
        error
      );

      setGoogleError(
        error?.data?.message ||
          error?.message ||
          "Autentificarea cu Google a eșuat. Încearcă din nou."
      );
    } finally {
      setGoogleLoading(false);
    }
  }

  /*
   * Păstrăm callbackul actual într-un ref,
   * astfel încât Google să folosească mereu
   * valoarea curentă pentru remember.
   */
  googleCallbackRef.current =
    handleGoogleCredential;

  /* =========================================================
   * Încarcă și afișează butonul Google.
   * ========================================================= */
useEffect(() => {
  let active = true;

  async function setupGoogle() {
    /*
     * Dacă suntem pe pagina cu taburi și tabul de login
     * nu este activ, nu inițializăm Google pentru login.
     *
     * În modal nu există taburi, deci loginul rămâne activ.
     */
    if (!inModal && tab !== "login") {
      return;
    }

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

      /*
       * Reinițializăm Google cu callbackul specific
       * formularului de autentificare.
       *
       * Este important când utilizatorul revine din tabul
       * de înregistrare în tabul de autentificare.
       */
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,

        callback: (response) => {
          googleCallbackRef.current?.(
            response
          );
        },

        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
      });

      googleButtonRef.current.innerHTML =
        "";

      window.google.accounts.id.renderButton(
        googleButtonRef.current,
        {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: Math.min(
  400,
  Math.max(
    240,
    googleButtonRef.current
      ?.parentElement
      ?.clientWidth || 360
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
}, [inModal, tab]);
  /* ---------------- Autofocus ---------------- */

  useEffect(() => {
    if (inModal) return;

    try {
      emailRef.current?.focus();
    } catch {
      // ignore
    }
  }, [inModal]);

  /* ---------------- Sugestii email ---------------- */

  useEffect(() => {
    const {
      hint,
      suggestion,
    } = suggestEmailTypos(
      email
    );

    setEmailTypoHint(hint);
    setEmailSuggestion(
      suggestion
    );
  }, [email]);

  /* ---------------- Online / offline ---------------- */

  useEffect(() => {
    function up() {
      setOffline(false);
    }

    function down() {
      setOffline(true);
    }

    window.addEventListener(
      "online",
      up
    );

    window.addEventListener(
      "offline",
      down
    );

    return () => {
      window.removeEventListener(
        "online",
        up
      );

      window.removeEventListener(
        "offline",
        down
      );
    };
  }, []);

  /* ---------------- aria-live ---------------- */

  useEffect(() => {
    if (!liveRef.current) {
      return;
    }

    liveRef.current.textContent =
      err || googleError || "";
  }, [err, googleError]);

  /* ---------------- Verificare cont existent ---------------- */

  useEffect(() => {
    if (offline) {
      setEmailExistsHint("");
      return;
    }

    if (
      !email ||
      !email.includes("@")
    ) {
      setEmailExistsHint("");
      return;
    }

    try {
      existsAbortRef.current?.abort?.();
    } catch {
      // ignore
    }

    const ctrl =
      new AbortController();

    existsAbortRef.current =
      ctrl;

    const timer =
      setTimeout(
        async () => {
          try {
            const cleanEmail =
              normalizeEmail(
                email
              );

            if (!cleanEmail) {
              return;
            }

            const response =
              await api(
                `/api/auth/exists?email=${encodeURIComponent(
                  cleanEmail
                )}`,
                {
                  signal:
                    ctrl.signal,
                }
              );

            const exists =
              !!response?.exists;

            if (
              exists === false
            ) {
              setEmailExistsHint(
                "Verifică adresa: nu pare să existe un cont."
              );
            } else {
              setEmailExistsHint(
                ""
              );
            }
          } catch {
            // ignore
          }
        },
        450
      );

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [email, offline]);

  /* ---------------- Cooldown ---------------- */

  useEffect(() => {
    if (!cooldownSec) {
      return;
    }

    const id =
      setInterval(() => {
        setCooldownSec(
          (seconds) =>
            Math.max(
              0,
              seconds - 1
            )
        );
      }, 1000);

    return () =>
      clearInterval(id);
  }, [cooldownSec]);

  /* =========================================================
   * Mapare erori backend.
   * ========================================================= */
  function mapBackendError(
    error,
    existsFlag
  ) {
    const code =
      error?.data?.error ||
      error?.error ||
      error?.message ||
      "";

    if (
      code ===
      "user_not_found"
    ) {
      return "Nu există niciun cont cu acest e-mail. Creează un cont nou.";
    }

    if (
      code ===
      "old_password_used"
    ) {
      return "Această parolă a fost folosită anterior și a fost înlocuită. Te rugăm să folosești parola nouă sau să îți resetezi parola.";
    }

    if (
      code ===
      "wrong_password"
    ) {
      return existsFlag === false
        ? "Nu există niciun cont cu acest e-mail. Creează un cont nou."
        : "Parola este incorectă. Încearcă din nou sau resetează-ți parola.";
    }

    if (
      code ===
      "password_login_unavailable"
    ) {
      return "Acest cont folosește autentificarea cu Google. Apasă butonul „Continuă cu Google”.";
    }

    if (
      code ===
      "invalid_payload"
    ) {
      return "Te rugăm să completezi e-mailul și parola.";
    }

    if (
      code ===
      "email_not_verified"
    ) {
      return "Te rugăm să îți confirmi adresa de email. Ți-am trimis un link de activare.";
    }

    if (
      code ===
      "account_locked"
    ) {
      return "Contul tău este blocat. Te rugăm să contactezi echipa de suport.";
    }

    if (
      code ===
      "too_many_attempts"
    ) {
      return "Prea multe încercări de conectare. Te rugăm să încerci din nou peste câteva minute.";
    }

    return (
      error?.data?.message ||
      error?.message ||
      "Autentificarea a eșuat. Încearcă din nou."
    );
  }

  /* =========================================================
   * Login clasic.
   * ========================================================= */
  async function onSubmit(event) {
    event.preventDefault();

    if (
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

    if (
      !email ||
      !password
    ) {
      setErr(
        "Te rugăm să completezi e-mailul și parola."
      );

      return;
    }

    setErr("");
    setGoogleError("");
    setLoading(true);

    const cleanEmail =
      normalizeEmail(email);

    try {
      loginAbortRef.current?.abort?.();
    } catch {
      // ignore
    }

    const ctrl =
      new AbortController();

    loginAbortRef.current =
      ctrl;

    try {
      const response =
        await api(
          "/api/auth/login",
          {
            method: "POST",

            body: {
              email:
                cleanEmail,

              password,

              remember:
                !!remember,
            },

            signal:
              ctrl.signal,
          }
        );

      try {
        if (remember) {
          localStorage.setItem(
            "lastEmail",
            cleanEmail
          );
        } else {
          localStorage.removeItem(
            "lastEmail"
          );
        }
      } catch {
        // ignore
      }

      await finishLogin(
        response
      );
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        return;
      }

      if (
        error?.status ===
          403 &&
        error?.data?.error ===
          "email_not_verified"
      ) {
        const url =
          `/verify-email?email=${encodeURIComponent(
            cleanEmail
          )}`;

        try {
          window.location.assign(
            url
          );
        } catch {
          setErr(
            error?.data?.message ||
              "Te rugăm să îți confirmi adresa de email înainte de a te conecta."
          );
        }

        return;
      }

      if (
        error?.status ===
          429 ||
        error?.data?.error ===
          "too_many_attempts"
      ) {
        setErr(
          "Prea multe încercări. Mai încearcă în câteva secunde."
        );

        setCooldownSec(
          (seconds) =>
            seconds &&
            seconds > 0
              ? seconds
              : 20
        );
      } else if (
        !navigator.onLine
      ) {
        setErr(
          "Ești offline. Reîncearcă atunci când revii online."
        );
      } else {
        const exists =
          await (async () => {
            try {
              const response =
                await api(
                  `/api/auth/exists?email=${encodeURIComponent(
                    cleanEmail
                  )}`
                );

              return !!response?.exists;
            } catch {
              return null;
            }
          })();

        const message =
          mapBackendError(
            error,
            exists
          );

        setErr(message);

        try {
          liveRef.current?.focus?.();
          pwRef.current?.focus();
          pwRef.current?.select?.();
        } catch {
          // ignore
        }
      }
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- Tastatură parolă ---------------- */

  function handlePwKey(
    event
  ) {
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
      (event.altKey ||
        event.metaKey) &&
      (event.key === "v" ||
        event.key === "V")
    ) {
      event.preventDefault();

      setShowPw(
        (value) => !value
      );
    }

    if (
      (event.ctrlKey ||
        event.metaKey) &&
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

    if (
      event.key === "Escape"
    ) {
      setErr("");
      setGoogleError("");
    }
  }

  const showToggle =
    pwFocused ||
    password.length > 0;

  const pwType =
    showPw || peekPw
      ? "text"
      : "password";

  function applyEmailSuggestion() {
    if (emailSuggestion) {
      const clean =
        normalizeEmail(
          emailSuggestion
        );

      setEmail(clean);
    }

    setEmailTypoHint("");
    setEmailExistsHint("");
  }

  function onEmailKeyDown(
    event
  ) {
    if (
      event.key === "Enter"
    ) {
      event.preventDefault();
      pwRef.current?.focus();
    }
  }

  return (
    <section
      className={`${styles.wrap} ${
        inModal
          ? styles.wrapModal
          : ""
      }`}
      aria-labelledby={
        inModal
          ? undefined
          : "login-title"
      }
    >
      {!inModal && (
        <header
          className={
            styles.header
          }
        >
          <h1
            id="login-title"
            className={
              styles.title
            }
          >
            Conectează-te sau
            creează cont
          </h1>

          <p
            className={
              styles.subtitle
            }
          >
            Intră în cont pentru a
            continua.
          </p>
        </header>
      )}

      {!inModal && (
        <div
          className={
            styles.tabBar
          }
          role="tablist"
          aria-label="Autentificare sau Înregistrare"
        >
          <button
            type="button"
            role="tab"
            aria-selected={
              tab === "login"
            }
            aria-controls={
              loginPanelId
            }
            id={`${baseId}-tab-login`}
            tabIndex={
              tab === "login"
                ? 0
                : -1
            }
            className={`${styles.tabBtn} ${
              tab === "login"
                ? styles.tabBtnActive
                : ""
            }`}
            onClick={() =>
              setTab("login")
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "ArrowRight"
              ) {
                setTab(
                  "register"
                );
              }
            }}
          >
            Autentificare
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={
              tab === "register"
            }
            aria-controls={
              registerPanelId
            }
            id={`${baseId}-tab-register`}
            tabIndex={
              tab === "register"
                ? 0
                : -1
            }
            className={`${styles.tabBtn} ${
              tab ===
              "register"
                ? styles.tabBtnActive
                : ""
            }`}
            onClick={() =>
              setTab("register")
            }
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "ArrowLeft"
              ) {
                setTab("login");
              }
            }}
          >
            Înregistrare
          </button>
        </div>
      )}

      {(inModal ||
        tab === "login") && (
        <form
          className={
            styles.card
          }
          onSubmit={onSubmit}
          noValidate
          id={loginPanelId}
          role={
            !inModal
              ? "tabpanel"
              : undefined
          }
          aria-labelledby={
            !inModal
              ? `${baseId}-tab-login`
              : undefined
          }
        >
          <div
            ref={liveRef}
            tabIndex={-1}
            aria-live="polite"
            aria-atomic="true"
            className={
              styles.srOnly
            }
          />

          {offline && (
            <div
              className={
                styles.offline
              }
              role="status"
            >
              Ești offline —
              verifică rețeaua.
            </div>
          )}

        

          <div
            className={
              styles.fieldGroup
            }
          >
            <label
              htmlFor={emailId}
              className={
                styles.label
              }
            >
              Email
            </label>

            <input
              id={emailId}
              name="email"
              autoComplete="email"
              className={
                styles.input
              }
              value={email}
              ref={emailRef}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              onKeyDown={
                onEmailKeyDown
              }
              placeholder="nume@exemplu.ro"
              type="email"
              required
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={
                !!err &&
                err
                  .toLowerCase()
                  .includes(
                    "e-mail"
                  )
              }
            />

            {(emailTypoHint ||
              emailExistsHint ||
              emailSuggestion) && (
              <div
                className={
                  styles.suggestionRow
                }
              >
                {emailTypoHint && (
                  <small
                    className={
                      styles.hint
                    }
                  >
                    {
                      emailTypoHint
                    }
                  </small>
                )}

                {emailExistsHint && (
                  <small
                    className={
                      styles.hint
                    }
                  >
                    {
                      emailExistsHint
                    }
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
                      {
                        emailSuggestion
                      }
                    </strong>
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            className={
              styles.fieldGroup
            }
          >
            <label
              htmlFor={
                passwordId
              }
              className={
                styles.label
              }
            >
              Parolă
            </label>

            <div
              className={`${styles.inputGroup} ${
                showToggle
                  ? styles.hasToggle
                  : ""
              }`}
            >
              <input
                id={passwordId}
                name="password"
                autoComplete="current-password"
                className={
                  styles.input
                }
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                onKeyUp={
                  handlePwKey
                }
                onKeyDown={
                  handlePwKey
                }
                onFocus={() =>
                  setPwFocused(true)
                }
                onBlur={() =>
                  setPwFocused(false)
                }
                placeholder="••••••••"
                type={pwType}
                required
                minLength={6}
                ref={pwRef}
                aria-describedby={
                  capsOn
                    ? capsHintId
                    : undefined
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={
                  !!err &&
                  err
                    .toLowerCase()
                    .includes(
                      "parola"
                    )
                }
              />

              {showToggle && (
                <button
                  type="button"
                  className={
                    styles.togglePw
                  }
                  aria-label={
                    showPw ||
                    peekPw
                      ? "Ascunde parola"
                      : "Afișează parola"
                  }
                  aria-pressed={
                    showPw ||
                    peekPw
                  }
                  onClick={() =>
                    setShowPw(
                      (value) =>
                        !value
                    )
                  }
                  onMouseDown={(
                    event
                  ) => {
                    event.preventDefault();
                    setPeekPw(
                      true
                    );
                  }}
                  onMouseUp={() =>
                    setPeekPw(
                      false
                    )
                  }
                  onMouseLeave={() =>
                    setPeekPw(
                      false
                    )
                  }
                  onTouchStart={() => {
                    setPeekPw(
                      true
                    );

                    try {
                      pwRef.current?.focus(
                        {
                          preventScroll:
                            true,
                        }
                      );
                    } catch {
                      // ignore
                    }
                  }}
                  onTouchEnd={() =>
                    setPeekPw(
                      false
                    )
                  }
                  onTouchCancel={() =>
                    setPeekPw(
                      false
                    )
                  }
                  title="Click pentru toggle, ține apăsat pentru a previzualiza"
                >
                  {showPw ||
                  peekPw ? (
                    <EyeOff
                      size={18}
                    />
                  ) : (
                    <Eye
                      size={18}
                    />
                  )}
                </button>
              )}
            </div>

            {capsOn && (
              <div
                id={capsHintId}
                className={
                  styles.capsHint
                }
              >
                Atenție: CapsLock
                este activ.
              </div>
            )}
          </div>

          <label
            className={
              styles.checkRow
            }
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) =>
                setRemember(
                  event.target
                    .checked
                )
              }
              aria-label="Ține-mă minte"
            />

            <span
              className={
                styles.checkLabel
              }
            >
              Ține-mă minte pe
              acest dispozitiv
            </span>
          </label>

          {err && (
            <div
              className={
                styles.error
              }
              role="alert"
            >
              {err}{" "}

              {(err
                .toLowerCase()
                .includes(
                  "parola"
                ) ||
                err
                  .toLowerCase()
                  .includes(
                    "eșuat"
                  )) && (
                <a
                  className={
                    styles.linkBtn
                  }
                  href="/reset-parola"
                >
                  Resetează parola
                </a>
              )}

              {err
                .toLowerCase()
                .includes(
                  "creează un cont"
                ) &&
                (inModal &&
                onSwitchToRegister ? (
                  <button
                    type="button"
                    className={
                      styles.linkBtn
                    }
                    onClick={
                      onSwitchToRegister
                    }
                  >
                    Creează cont
                  </button>
                ) : (
                  !inModal && (
                    <button
                      type="button"
                      className={
                        styles.linkBtn
                      }
                      onClick={() =>
                        setTab(
                          "register"
                        )
                      }
                    >
                      Creează cont
                    </button>
                  )
                ))}
            </div>
          )}

          <button
            type="submit"
            className={
              styles.primaryBtn
            }
            disabled={
              loading ||
              googleLoading ||
              !email ||
              !password ||
              cooldownSec >
                0 ||
              offline
            }
            aria-busy={
              loading
                ? "true"
                : "false"
            }
            title={
              cooldownSec > 0
                ? `Așteaptă ${cooldownSec}s`
                : undefined
            }
          >
            {loading
              ? "Se conectează…"
              : cooldownSec >
                  0
              ? `Așteaptă ${cooldownSec}s`
              : "Intră"}
          </button>
          {/* Separator Google */}
<div
  className={styles.authSeparator}
  aria-hidden="true"
>
  <span
    className={styles.authSeparatorLine}
  />

  <span
    className={styles.authSeparatorText}
  >
    sau continuă cu Google
  </span>

  <span
    className={styles.authSeparatorLine}
  />
</div>
{/* Google Sign-In */}
<div
  className={
    styles.googleSection
  }
>
  <div
    ref={googleButtonRef}
    aria-label="Continuă cu Google"
    className={
      styles.googleButtonWrap
    }
    style={{
      display:
        googleLoading
          ? "none"
          : "flex",
    }}
  />

  {googleLoading && (
    <div
      role="status"
      className={
        styles.googleLoading
      }
    >
      Se conectează cu Google…
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
        Se încarcă autentificarea
        Google…
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
          <div
            className={
              styles.footerRow
            }
          >
            <a
              className={
                styles.link
              }
              href="/reset-parola"
            >
              Ai uitat parola?
            </a>

            {inModal &&
            onSwitchToRegister ? (
              <button
                type="button"
                className={
                  styles.linkBtn
                }
                onClick={
                  onSwitchToRegister
                }
              >
                Creează cont
              </button>
            ) : (
              !inModal && (
                <button
                  type="button"
                  className={
                    styles.linkBtn
                  }
                  onClick={() =>
                    setTab(
                      "register"
                    )
                  }
                >
                  Creează cont
                </button>
              )
            )}
          </div>
        </form>
      )}

      {!inModal &&
        tab === "register" && (
          <div
            className={
              styles.card
            }
            role="tabpanel"
            aria-label="Înregistrare"
            id={registerPanelId}
            aria-labelledby={`${baseId}-tab-register`}
          >
            <Register
              inModal={false}
              defaultAsVendor={
                false
              }
            />
          </div>
        )}
    </section>
  );
}