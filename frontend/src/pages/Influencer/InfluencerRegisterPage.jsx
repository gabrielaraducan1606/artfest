import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { api } from "../../lib/api";
import styles from "./InfluencerRegisterPage.module.css";

/* =========================================================
   GOOGLE IDENTITY SERVICES

   Cont NOU (invitație validă, niciun cont existent) prin
   Google - mirror STRUCTURAL al Register.jsx (același script,
   același buton oficial Google), dar SEPARAT / independent:
   NU importă nimic din Register.jsx/Login.jsx și NU modifică
   POST /api/auth/google - risc zero de regresie pentru
   login-ul Google de USER/VENDOR.

   Pentru un cont Google EXISTENT (acest email are deja un cont
   Artfest), pagina arată deja butonul "Conectează-te" ->
   /autentificare?influencerInvite=<token> - Login.jsx are DEJA
   Google + acceptarea invitației complet funcțională acolo
   (finishLogin -> POST /api/influencer/accept-existing), nu
   duplicăm acel flux aici.
========================================================= */

const GOOGLE_SCRIPT_ID =
  "google-identity-services-script";

const GOOGLE_SCRIPT_SRC =
  "https://accounts.google.com/gsi/client";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

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
        existingScript.removeEventListener("load", handleLoad);
        existingScript.removeEventListener("error", handleError);
      };

      existingScript.addEventListener("load", handleLoad);
      existingScript.addEventListener("error", handleError);

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
        new Error("Scriptul Google nu a putut fi încărcat.")
      );
    };

    document.head.appendChild(script);
  });
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeLegalMeta(items) {
  const result = {};

  for (const item of items || []) {
    if (!item?.type) {
      continue;
    }

    result[item.type] =
      item;
  }

  return result;
}

function buildAuthUrl(token) {
  const params =
    new URLSearchParams();

  params.set(
    "influencerInvite",
    token
  );

  return `/autentificare?${params.toString()}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function InfluencerRegisterPage() {
  const navigate =
    useNavigate();

  const [
    searchParams,
  ] =
    useSearchParams();

  const token =
    (
      searchParams.get(
        "token"
      ) ||
      ""
    ).trim();

  /* ---------------------------------------------------------
     INVITE
  --------------------------------------------------------- */

  const [
    loadingInvite,
    setLoadingInvite,
  ] =
    useState(true);

  const [
    inviteError,
    setInviteError,
  ] =
    useState("");

  const [
    invite,
    setInvite,
  ] =
    useState(null);

  /*
   * Calculate DEVREME (nu doar în JSX, la finalul componentei) -
   * setupGoogle() (mai jos) are nevoie de `accountExists` în lista
   * de dependențe, ca să re-randeze butonul Google în ramura corectă
   * (cont nou vs. cont existent) imediat ce invitația se încarcă.
   */
  const accountExists =
    !!invite?.accountExists;

  const alreadyInfluencer =
    !!invite?.alreadyInfluencer;

  const existingRole =
    String(
      invite?.existingRole ||
        ""
    ).toUpperCase();

  const incompatibleRole =
    accountExists &&
    existingRole &&
    existingRole !==
      "USER" &&
    existingRole !==
      "INFLUENCER";

  /*
   * Ramura care arată efectiv un buton Google pe această pagină:
   * "register" pentru cont nou, "login" pentru cont existent
   * compatibil (rol USER). Pentru alreadyInfluencer/incompatibleRole
   * nu arătăm niciun buton Google aici - utilizatorul e îndrumat
   * direct spre /autentificare.
   */
  const googleMode =
    alreadyInfluencer ||
    incompatibleRole
      ? null
      : accountExists
      ? "login"
      : "register";

  /* ---------------------------------------------------------
     PRENUME / NUME

     InfluencerInvite ține azi doar `name` (legacy, un singur câmp) -
     precompletăm best-effort (primul cuvânt = prenume, restul = nume)
     din invite.name, dar influencerul le poate corecta aici înainte
     de creare - vezi raportul de standardizare Prenume/Nume.
  --------------------------------------------------------- */

  const [
    firstName,
    setFirstName,
  ] =
    useState("");

  const [
    lastName,
    setLastName,
  ] =
    useState("");

  useEffect(() => {
    if (!invite) {
      return;
    }

    const parts =
      String(
        invite.name || ""
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    setFirstName(
      parts[0] || ""
    );

    setLastName(
      parts.slice(1).join(" ")
    );
  }, [invite]);

  /* ---------------------------------------------------------
     LEGAL
  --------------------------------------------------------- */

  const [
    legal,
    setLegal,
  ] =
    useState({});

  const [
    legalLoading,
    setLegalLoading,
  ] =
    useState(true);

  const [
    legalError,
    setLegalError,
  ] =
    useState("");

  /* ---------------------------------------------------------
     PASSWORD
  --------------------------------------------------------- */

  const [
    password,
    setPassword,
  ] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] =
    useState("");

  const [
    showPassword,
    setShowPassword,
  ] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] =
    useState(false);

  /* ---------------------------------------------------------
     CONSENTS
  --------------------------------------------------------- */

  const [
    tosAccepted,
    setTosAccepted,
  ] =
    useState(false);

  const [
    privacyAccepted,
    setPrivacyAccepted,
  ] =
    useState(false);

  const [
    influencerTermsAccepted,
    setInfluencerTermsAccepted,
  ] =
    useState(false);

  const [
    marketingAccepted,
    setMarketingAccepted,
  ] =
    useState(false);

  /* ---------------------------------------------------------
     SUBMIT
  --------------------------------------------------------- */

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    submitError,
    setSubmitError,
  ] =
    useState("");

  const [
    success,
    setSuccess,
  ] =
    useState(false);

  /* ---------------------------------------------------------
     GOOGLE (cont nou prin invitație)
  --------------------------------------------------------- */

  const [
    googleReady,
    setGoogleReady,
  ] =
    useState(false);

  const [
    googleLoading,
    setGoogleLoading,
  ] =
    useState(false);

  const [
    googleError,
    setGoogleError,
  ] =
    useState("");

  /* ---------------------------------------------------------
     GOOGLE (cont existent, compatibil - rol USER)

     Buton separat, aceeași convenție "mirror structural, separat" -
     reutilizează POST /api/auth/google (mode: "login") + POST
     /api/influencer/accept-existing, exact ca Login.jsx (finishLogin),
     dar direct pe pagina de invitație, fără pasul intermediar
     "Conectează-te". NU modifică Login.jsx.
  --------------------------------------------------------- */

  const [
    googleExistingLoading,
    setGoogleExistingLoading,
  ] =
    useState(false);

  const [
    googleExistingError,
    setGoogleExistingError,
  ] =
    useState("");

  const googleButtonRef =
    useRef(null);

  const googleCallbackRef =
    useRef(null);

  /* =========================================================
     LOAD INVITE
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      setLoadingInvite(
        true
      );

      setInviteError(
        ""
      );

      if (!token) {
        setInvite(
          null
        );

        setInviteError(
          "Linkul de invitație nu conține un token valid."
        );

        setLoadingInvite(
          false
        );

        return;
      }

      try {
        const data =
          await api(
            `/api/influencer/invite?token=${encodeURIComponent(
              token
            )}`
          );

        if (!active) {
          return;
        }

        if (
          data?.ok ===
          false
        ) {
          throw Object.assign(
            new Error(
              data?.message ||
                "Invitația nu este validă."
            ),
            {
              data,
            }
          );
        }

        if (
          !data?.invite
        ) {
          throw new Error(
            "Backendul nu a returnat invitația."
          );
        }

        setInvite(
          data.invite
        );
      } catch (
        error
      ) {
        if (!active) {
          return;
        }

        setInvite(
          null
        );

        setInviteError(
          mapInviteError(
            error?.data
              ?.error ||
              error?.error,

            error?.data
              ?.message ||
              error?.message
          )
        );
      } finally {
        if (active) {
          setLoadingInvite(
            false
          );
        }
      }
    }

    loadInvite();

    return () => {
      active =
        false;
    };
  }, [token]);

  /* =========================================================
     LOAD LEGAL META
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadLegal() {
      setLegalLoading(
        true
      );

      setLegalError(
        ""
      );

      try {
        const response =
          await api(
            "/api/legal?types=tos,privacy,influencer_terms"
          );

        if (!active) {
          return;
        }

        setLegal(
          normalizeLegalMeta(
            response
          )
        );
      } catch (
        error
      ) {
        if (!active) {
          return;
        }

        console.error(
          "Influencer legal metadata error:",
          error
        );

        setLegal({});

        setLegalError(
          "Nu am putut încărca versiunile documentelor legale. Poți continua folosind documentele publice Artfest."
        );
      } finally {
        if (active) {
          setLegalLoading(
            false
          );
        }
      }
    }

    loadLegal();

    return () => {
      active =
        false;
    };
  }, []);

  /* =========================================================
     PASSWORD
  ========================================================= */

  const passwordScore =
    useMemo(() => {
      let score =
        0;

      if (
        password.length >=
        8
      ) {
        score +=
          1;
      }

      if (
        /[a-z]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /[A-Z]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /\d/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /[^A-Za-z0-9]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      return score;
    }, [password]);

  const passwordsMatch =
    confirmPassword.length >
      0 &&
    password ===
      confirmPassword;

  const canSubmit =
    !submitting &&
    !success &&
    firstName.trim().length >
      0 &&
    lastName.trim().length >
      0 &&
    password.length >=
      8 &&
    passwordScore >=
      3 &&
    passwordsMatch &&
    tosAccepted &&
    privacyAccepted &&
    influencerTermsAccepted;

  /*
   * Google nu cere firstName/lastName/parolă (Google le furnizează
   * pe primele; parola nu există în acest flux) - dar cere ACELEAȘI
   * consimțăminte obligatorii ca formularul cu parolă.
   */
  const canUseGoogle =
    googleReady &&
    !googleLoading &&
    !submitting &&
    !success &&
    tosAccepted &&
    privacyAccepted &&
    influencerTermsAccepted;

  /*
   * Cont existent: accept-existing scrie consimțământul
   * influencer_terms automat, server-side (identic cu fluxul din
   * Login.jsx) - nu cerem checkbox-uri aici, la fel ca butonul
   * Google din Login.jsx.
   */
  const canUseGoogleExisting =
    googleReady &&
    !googleExistingLoading;

  /* =========================================================
     CONSENTS
  ========================================================= */

  function buildConsents() {
    const consents =
      [];

    if (
      tosAccepted
    ) {
      consents.push({
        type:
          "tos",

        version:
          String(
            legal?.tos
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal?.tos
            ?.checksum ??
          null,
      });
    }

    if (
      privacyAccepted
    ) {
      consents.push({
        type:
          "privacy_ack",

        version:
          String(
            legal?.privacy
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal?.privacy
            ?.checksum ??
          null,
      });
    }

    if (
      influencerTermsAccepted
    ) {
      consents.push({
        type:
          "influencer_terms",

        version:
          String(
            legal
              ?.influencer_terms
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal
            ?.influencer_terms
            ?.checksum ??
          null,
      });
    }

    if (
      marketingAccepted
    ) {
      consents.push({
        type:
          "marketing_email_optin",

        version:
          "1.0.0",

        checksum:
          null,
      });
    }

    return consents;
  }

  /* =========================================================
     GOOGLE - CONT NOU PRIN INVITAȚIE

     mode: "register" fără asVendor creează un cont USER simplu
     (identic cu Register.jsx, pe partea non-vendor). NU trimitem
     "influencer_terms" în consents - authGoogleRoutes.js nu-l
     acceptă (schema lui e comună cu USER/VENDOR) - acceptarea lui
     e scrisă de /api/influencer/accept-existing, exact ca la
     fluxul cu parolă (POST /register, mai jos) și la fluxul
     existent din Login.jsx (finishLogin).

     Dacă emailul Google corespunde unui cont deja existent,
     backend-ul refuză crearea (google_email_already_registered) -
     arătăm îndrumarea către "Conectează-te" (Login.jsx are deja
     Google + acceptarea invitației complet funcțională).
  ========================================================= */

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

    if (
      !tosAccepted ||
      !privacyAccepted ||
      !influencerTermsAccepted
    ) {
      setGoogleError(
        "Acceptă Termenii, Politica de confidențialitate și Acordul Programului de Influenceri înainte să continui cu Google."
      );

      return;
    }

    if (!navigator.onLine) {
      setGoogleError(
        "Ești offline. Verifică conexiunea la internet."
      );

      return;
    }

    setSubmitError("");
    setGoogleError("");
    setGoogleLoading(true);

    try {
      const consents =
        [];

      if (tosAccepted) {
        consents.push({
          type: "tos",
          version: String(
            legal?.tos
              ?.version ||
              "1.0.0"
          ),
          checksum:
            legal?.tos
              ?.checksum ??
            null,
        });
      }

      if (privacyAccepted) {
        consents.push({
          type: "privacy_ack",
          version: String(
            legal?.privacy
              ?.version ||
              "1.0.0"
          ),
          checksum:
            legal?.privacy
              ?.checksum ??
            null,
        });
      }

      if (marketingAccepted) {
        consents.push({
          type: "marketing_email_optin",
          version: "1.0.0",
          checksum: null,
        });
      }

      const registerResponse =
        await api(
          "/api/auth/google",
          {
            method: "POST",

            body: {
              credential,
              remember: true,
              mode: "register",
              asVendor: false,
              consents,
            },
          }
        );

      if (
        registerResponse?.ok ===
        false
      ) {
        throw Object.assign(
          new Error(
            registerResponse?.message ||
              "Înregistrarea cu Google a eșuat."
          ),
          { data: registerResponse }
        );
      }

      /*
       * Acum suntem autentificați ca USER (cookie setat de
       * /api/auth/google). Acceptăm invitația - exact rutina
       * folosită deja de Login.jsx (finishLogin) pentru un cont
       * EXISTENT; aici rulează imediat după crearea contului nou.
       */
      const accepted =
        await api(
          "/api/influencer/accept-existing",
          {
            method: "POST",
            body: { token },
          }
        );

      if (accepted?.ok === false) {
        throw Object.assign(
          new Error(
            accepted?.message ||
              "Contul Google a fost creat, dar invitația nu a putut fi acceptată."
          ),
          { data: accepted }
        );
      }

      window.location.assign(
        accepted?.next ||
          "/influencer"
      );
    } catch (error) {
      const errorCode =
        error?.data?.error ||
        error?.error ||
        "";

      if (
        errorCode ===
        "google_email_already_registered"
      ) {
        setGoogleError(
          "Există deja un cont Artfest cu acest email Google. Conectează-te cu contul existent pentru a accepta invitația."
        );

        return;
      }

      if (
        errorCode ===
        "already_influencer"
      ) {
        window.location.assign(
          "/influencer"
        );

        return;
      }

      if (
        errorCode ===
          "invitation_email_mismatch"
      ) {
        setGoogleError(
          "Contul Google folosit nu corespunde emailului invitat. Folosește contul Google al adresei invitate sau conectează-te separat."
        );

        return;
      }

      if (
        errorCode === "invitation_expired" ||
        errorCode === "invitation_unavailable" ||
        errorCode === "invitation_already_used"
      ) {
        setGoogleError(
          "Invitația de influencer nu mai este disponibilă. Cere administratorului un link nou."
        );

        return;
      }

      if (
        errorCode ===
        "role_incompatible"
      ) {
        setGoogleError(
          "Contul Google creat are deja un alt tip de profil Artfest și nu poate fi transformat automat în cont de influencer."
        );

        return;
      }

      console.error(
        "Influencer Google register error:",
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

  /* =========================================================
     GOOGLE - CONT EXISTENT (rol USER, compatibil)

     mode: "login" - identică cu finishLogin() din Login.jsx:
     POST /api/auth/google (mode: "login") asociază automat contul
     Google la contul Artfest existent DOAR când emailul Google
     verificat e identic cu emailul contului (authGoogleRoutes.js),
     apoi acceptăm invitația exact ca la Login.jsx.
  ========================================================= */

  async function handleGoogleExistingCredential(
    googleResponse
  ) {
    const credential =
      googleResponse?.credential;

    if (!credential) {
      setGoogleExistingError(
        "Google nu a returnat datele necesare autentificării."
      );

      return;
    }

    if (!navigator.onLine) {
      setGoogleExistingError(
        "Ești offline. Verifică conexiunea la internet."
      );

      return;
    }

    setGoogleExistingError("");
    setGoogleExistingLoading(true);

    try {
      const loginResponse =
        await api(
          "/api/auth/google",
          {
            method: "POST",

            body: {
              credential,
              remember: true,
              mode: "login",
            },
          }
        );

      if (
        loginResponse?.ok ===
        false
      ) {
        throw Object.assign(
          new Error(
            loginResponse?.message ||
              "Autentificarea cu Google a eșuat."
          ),
          { data: loginResponse }
        );
      }

      const accepted =
        await api(
          "/api/influencer/accept-existing",
          {
            method: "POST",
            body: { token },
          }
        );

      if (accepted?.ok === false) {
        throw Object.assign(
          new Error(
            accepted?.message ||
              "Autentificarea a reușit, dar invitația nu a putut fi acceptată."
          ),
          { data: accepted }
        );
      }

      window.location.assign(
        accepted?.next ||
          "/influencer"
      );
    } catch (error) {
      const errorCode =
        error?.data?.error ||
        error?.error ||
        "";

      if (
        errorCode ===
        "google_account_not_registered"
      ) {
        setGoogleExistingError(
          "Nu am găsit un cont Artfest asociat acestui cont Google. Folosește „Conectează-te cu parola” sau creează un cont nou."
        );

        return;
      }

      if (
        errorCode ===
        "account_locked"
      ) {
        setGoogleExistingError(
          "Contul este blocat. Te rugăm să contactezi echipa de suport."
        );

        return;
      }

      if (
        errorCode ===
        "google_account_conflict"
      ) {
        setGoogleExistingError(
          "Acest cont Artfest este deja asociat unui alt cont Google. Conectează-te cu parola."
        );

        return;
      }

      if (
        errorCode ===
        "google_account_unverified"
      ) {
        setGoogleExistingError(
          "Contul Google folosit nu are emailul verificat. Încearcă alt cont Google sau conectează-te cu parola."
        );

        return;
      }

      if (
        errorCode ===
          "invitation_email_mismatch"
      ) {
        setGoogleExistingError(
          "Contul Google folosit nu corespunde emailului invitat."
        );

        return;
      }

      if (
        errorCode === "invitation_expired" ||
        errorCode === "invitation_unavailable" ||
        errorCode === "invitation_already_used"
      ) {
        setGoogleExistingError(
          "Invitația de influencer nu mai este disponibilă. Cere administratorului un link nou."
        );

        return;
      }

      if (
        errorCode ===
        "role_incompatible"
      ) {
        setGoogleExistingError(
          "Acest cont are deja un alt tip de profil Artfest și nu poate fi transformat automat în cont de influencer."
        );

        return;
      }

      if (
        errorCode ===
        "already_influencer"
      ) {
        window.location.assign(
          "/influencer"
        );

        return;
      }

      console.error(
        "Influencer Google login error:",
        error
      );

      setGoogleExistingError(
        error?.data?.message ||
          error?.message ||
          "Autentificarea cu Google a eșuat. Încearcă din nou."
      );
    } finally {
      setGoogleExistingLoading(false);
    }
  }

  googleCallbackRef.current =
    googleMode === "login"
      ? handleGoogleExistingCredential
      : handleGoogleCredential;

  /* =========================================================
     GOOGLE - încărcare script + randare buton
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function setupGoogle() {
      if (!GOOGLE_CLIENT_ID) {
        if (active) {
          setGoogleReady(false);
        }

        return;
      }

      /*
       * Cât timp invitația încă se verifică, nicio ramură (cont nou /
       * cont existent) nu e montată, deci `googleButtonRef.current`
       * e null - ieșim fără să marcăm `googleReady`, iar efectul
       * REVINE automat (vezi deps mai jos) imediat ce `loadingInvite`
       * devine false, când ref-ul chiar există în DOM. Fără asta,
       * dacă scriptul Google se încarcă mai repede decât invitația,
       * butonul putea rămâne nerandat definitiv (rasă de timing).
       */
      if (
        loadingInvite ||
        !googleMode
      ) {
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

        window.google.accounts.id.initialize(
          {
            client_id:
              GOOGLE_CLIENT_ID,

            callback: (
              response
            ) =>
              googleCallbackRef.current?.(
                response
              ),
          }
        );

        googleButtonRef.current.innerHTML =
          "";

        window.google.accounts.id.renderButton(
          googleButtonRef.current,
          {
            type: "standard",
            theme: "outline",
            size: "large",
            text:
              googleMode ===
              "login"
                ? "continue_with"
                : "signup_with",
            shape: "rectangular",
            logo_alignment:
              "left",
          }
        );

        if (active) {
          setGoogleReady(true);
        }
      } catch (error) {
        console.error(
          "Google Identity Services setup error:",
          error
        );

        if (active) {
          setGoogleReady(false);
        }
      }
    }

    setupGoogle();

    return () => {
      active = false;
    };
  }, [
    loadingInvite,
    googleMode,
  ]);

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      !canSubmit ||
      submitting
    ) {
      return;
    }

    setSubmitting(
      true
    );

    setSubmitError(
      ""
    );

    try {
      const data =
        await api(
          "/api/influencer/register",
          {
            method:
              "POST",

            body: {
              token,

              firstName:
                firstName.trim(),

              lastName:
                lastName.trim(),

              password,
              confirmPassword,

              consents:
                buildConsents(),
            },
          }
        );

      if (
        data?.ok ===
        false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              "Nu am putut crea contul."
          ),
          {
            data,
          }
        );
      }

      setSuccess(
        true
      );

      const next =
        data?.next ||
        `/verify-email?email=${encodeURIComponent(
          invite?.email ||
            ""
        )}`;

      window.setTimeout(
        () => {
          navigate(
            next
          );
        },
        900
      );
    } catch (
      error
    ) {
      const errorCode =
        error?.data
          ?.error ||
        error?.error ||
        "";

      if (
        errorCode ===
          "account_already_exists" ||
        errorCode ===
          "already_influencer"
      ) {
        setSubmitError(
          errorCode ===
            "already_influencer"
            ? "Acest cont este deja asociat unui profil de influencer. Conectează-te folosind contul existent."
            : "Există deja un cont Artfest cu acest email. Conectează-te în contul existent pentru a accepta invitația."
        );

        return;
      }

      setSubmitError(
        mapRegisterError(
          errorCode,

          error?.data
            ?.message ||
            error?.message
        )
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  /* =========================================================
     LOADING
  ========================================================= */

  if (
    loadingInvite
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.card
          }
        >
          <div
            className={
              styles.loading
            }
          >
            Se verifică invitația…
          </div>
        </section>
      </main>
    );
  }

  /* =========================================================
     INVALID INVITE
  ========================================================= */

  if (
    inviteError ||
    !invite
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.card
          }
        >
          <div
            className={
              styles.iconCircle
            }
          >
            !
          </div>

          <h1
            className={
              styles.title
            }
          >
            Invitație indisponibilă
          </h1>

          <p
            className={
              styles.subtitle
            }
          >
            {inviteError ||
              "Nu am putut valida invitația."}
          </p>

          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={() =>
              navigate(
                "/"
              )
            }
          >
            Înapoi la Artfest
          </button>
        </section>
      </main>
    );
  }

  /* =========================================================
     PAGE

     (accountExists/alreadyInfluencer/existingRole/incompatibleRole/
     googleMode sunt calculate mai sus, imediat după `invite`.)
  ========================================================= */

  return (
    <main
      className={
        styles.page
      }
    >
      <section
        className={
          styles.card
        }
      >
        <div
          className={
            styles.badge
          }
        >
          Invitație privată Artfest
        </div>

        <h1
          className={
            styles.title
          }
        >
          Bun venit în programul de influenceri Artfest
        </h1>

        <p
          className={
            styles.subtitle
          }
        >
          Creează-ți contul de influencer Artfest pentru a activa colaborarea.
        </p>

        <div
          className={
            styles.inviteSummary
          }
        >
          <SummaryRow
            label="Email"
            value={
              invite.email ||
              "—"
            }
          />
        </div>

        {/* =====================================================
            CONT DEJA INFLUENCER
        ===================================================== */}

        {alreadyInfluencer ? (
          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Ai deja un cont de influencer Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Acest email este deja asociat unui profil de influencer. Te poți autentifica direct.
            </div>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={() =>
                navigate(
                  "/autentificare"
                )
              }
            >
              Conectează-te
            </button>
          </div>
        ) : incompatibleRole ? (
          /* ===================================================
             VENDOR / ADMIN EXISTENT
          =================================================== */

          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Acest email are deja un alt tip de cont Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Contul existent are rolul{" "}
              <strong>
                {existingRole}
              </strong>
              . Momentan acest cont nu poate fi transformat automat într-un cont de influencer.
            </div>
          </div>
        ) : accountExists ? (
          /* ===================================================
             USER EXISTENT
          =================================================== */

          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Ai deja un cont Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Continuă cu Google sau conectează-te cu parola pentru a accepta invitația de influencer.
            </div>

            {!!GOOGLE_CLIENT_ID && (
              <div
                className={
                  styles.googleSection
                }
              >
                <div
                  ref={
                    googleButtonRef
                  }
                  className={
                    styles.googleButton
                  }
                  style={
                    !canUseGoogleExisting
                      ? {
                          opacity: 0.6,
                          pointerEvents:
                            "none",
                        }
                      : undefined
                  }
                />

                {googleExistingLoading && (
                  <div
                    className={
                      styles.hint
                    }
                  >
                    Se continuă cu Google…
                  </div>
                )}

                {googleExistingError && (
                  <div
                    className={
                      styles.errorBox
                    }
                  >
                    {googleExistingError}
                  </div>
                )}
              </div>
            )}

            <div
              className={
                styles.googleDivider
              }
            >
              sau
            </div>

            <button
              type="button"
              className={
                styles.secondaryButton
              }
              onClick={() =>
                navigate(
                  buildAuthUrl(
                    token
                  )
                )
              }
            >
              Conectează-te cu parola
            </button>
          </div>
        ) : (
          /* ===================================================
             CONT NOU
          =================================================== */

          <form
            onSubmit={
              handleSubmit
            }
            className={
              styles.form
            }
            noValidate
          >
            {/* =====================================================
                GOOGLE - cont nou prin invitație (CTA principal, sus)
            ===================================================== */}

            {!!GOOGLE_CLIENT_ID && (
              <div
                className={
                  styles.googleSection
                }
              >
                <div
                  ref={
                    googleButtonRef
                  }
                  className={
                    styles.googleButton
                  }
                  style={
                    !canUseGoogle
                      ? {
                          opacity: 0.5,
                          pointerEvents:
                            "none",
                        }
                      : undefined
                  }
                />

                {!canUseGoogle &&
                  googleReady && (
                    <div
                      className={
                        styles.hint
                      }
                    >
                      Completează formularul de mai jos și acceptă Termenii, Politica de confidențialitate și Acordul Programului de Influenceri pentru a continua cu Google.
                    </div>
                  )}

                {googleLoading && (
                  <div
                    className={
                      styles.hint
                    }
                  >
                    Se continuă cu Google…
                  </div>
                )}

                {googleError && (
                  <div
                    className={
                      styles.errorBox
                    }
                  >
                    {googleError}

                    {googleError.includes(
                      "cont Artfest"
                    ) && (
                      <>
                        <br />

                        <button
                          type="button"
                          className={
                            styles.secondaryButton
                          }
                          onClick={() =>
                            navigate(
                              buildAuthUrl(
                                token
                              )
                            )
                          }
                        >
                          Conectează-te
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div
              className={
                styles.googleDivider
              }
            >
              sau
            </div>

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-first-name"
                className={
                  styles.label
                }
              >
                Prenume
              </label>

              <input
                id="influencer-first-name"
                type="text"
                className={
                  styles.input
                }
                value={
                  firstName
                }
                onChange={(
                  event
                ) =>
                  setFirstName(
                    event.target
                      .value
                  )
                }
                autoComplete="given-name"
                placeholder="Ex: Dora"
              />
            </div>

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-last-name"
                className={
                  styles.label
                }
              >
                Nume
              </label>

              <input
                id="influencer-last-name"
                type="text"
                className={
                  styles.input
                }
                value={
                  lastName
                }
                onChange={(
                  event
                ) =>
                  setLastName(
                    event.target
                      .value
                  )
                }
                autoComplete="family-name"
                placeholder="Ex: Popescu"
              />
            </div>

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-email"
                className={
                  styles.label
                }
              >
                Email
              </label>

              <input
                id="influencer-email"
                type="email"
                className={
                  styles.input
                }
                value={
                  invite.email ||
                  ""
                }
                disabled
              />

              <div
                className={
                  styles.hint
                }
              >
                Emailul este preluat din invitația ta și nu poate fi schimbat aici.
              </div>
            </div>

            {/* PAROLA */}

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-password"
                className={
                  styles.label
                }
              >
                Parolă
              </label>

              <div
                className={
                  styles.passwordWrap
                }
              >
                <input
                  id="influencer-password"
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  className={
                    styles.input
                  }
                  value={
                    password
                  }
                  onChange={(
                    event
                  ) =>
                    setPassword(
                      event.target
                        .value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Minimum 8 caractere"
                />

                <button
                  type="button"
                  className={
                    styles.passwordToggle
                  }
                  onClick={() =>
                    setShowPassword(
                      (
                        current
                      ) =>
                        !current
                    )
                  }
                >
                  {showPassword
                    ? "Ascunde"
                    : "Arată"}
                </button>
              </div>

              <PasswordStrength
                score={
                  passwordScore
                }
                password={
                  password
                }
              />
            </div>

            {/* CONFIRMARE PAROLA */}

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-confirm-password"
                className={
                  styles.label
                }
              >
                Confirmă parola
              </label>

              <div
                className={
                  styles.passwordWrap
                }
              >
                <input
                  id="influencer-confirm-password"
                  type={
                    showConfirmPassword
                      ? "text"
                      : "password"
                  }
                  className={
                    styles.input
                  }
                  value={
                    confirmPassword
                  }
                  onChange={(
                    event
                  ) =>
                    setConfirmPassword(
                      event.target
                        .value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Repetă parola"
                />

                <button
                  type="button"
                  className={
                    styles.passwordToggle
                  }
                  onClick={() =>
                    setShowConfirmPassword(
                      (
                        current
                      ) =>
                        !current
                    )
                  }
                >
                  {showConfirmPassword
                    ? "Ascunde"
                    : "Arată"}
                </button>
              </div>

              {confirmPassword &&
                !passwordsMatch && (
                  <div
                    className={
                      styles.fieldError
                    }
                  >
                    Parolele nu coincid.
                  </div>
                )}

              {passwordsMatch && (
                <div
                  className={
                    styles.fieldSuccess
                  }
                >
                  Parolele coincid.
                </div>
              )}
            </div>

            {/* LEGAL */}

            <div
              className={
                styles.consents
              }
            >
              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    tosAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setTosAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Accept{" "}
                  <a
                    href="/termenii-si-conditiile"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Termenii și Condițiile
                  </a>{" "}
                  Artfest
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    privacyAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setPrivacyAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Am citit{" "}
                  <a
                    href="/confidentialitate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Politica de confidențialitate
                  </a>
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    influencerTermsAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setInfluencerTermsAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Accept{" "}
                  <a
                    href="/legal/influencer_terms.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Acordul privind Programul de Influenceri Artfest
                  </a>
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    marketingAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setMarketingAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Doresc să primesc noutăți și oferte Artfest prin email.
                </span>
              </label>
            </div>

            {legalLoading && (
              <div
                className={
                  styles.hint
                }
              >
                Se verifică versiunile documentelor legale…
              </div>
            )}

            {legalError && (
              <div
                className={
                  styles.hint
                }
              >
                {legalError}
              </div>
            )}

            {/* ERROR */}

            {submitError && (
              <div
                className={
                  styles.errorBox
                }
              >
                {submitError}

                {(
                  submitError.includes(
                    "cont Artfest"
                  ) ||
                  submitError.includes(
                    "deja asociat"
                  )
                ) && (
                  <>
                    <br />

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      onClick={() =>
                        navigate(
                          buildAuthUrl(
                            token
                          )
                        )
                      }
                    >
                      Conectează-te
                    </button>
                  </>
                )}
              </div>
            )}

            {/* SUCCESS */}

            {success && (
              <div
                className={
                  styles.successBox
                }
              >
                Contul a fost creat. Te redirecționăm către verificarea emailului…
              </div>
            )}

            <button
              type="submit"
              className={
                styles.primaryButton
              }
              disabled={
                !canSubmit
              }
            >
              {submitting
                ? "Se creează contul…"
                : "Creează contul"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function SummaryRow({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.summaryRow
      }
    >
      <span
        className={
          styles.summaryLabel
        }
      >
        {label}
      </span>

      <span
        className={
          styles.summaryValue
        }
      >
        {value}
      </span>
    </div>
  );
}

function PasswordStrength({
  score,
  password,
}) {
  if (!password) {
    return null;
  }

  let label =
    "Slabă";

  if (
    score >=
    4
  ) {
    label =
      "Puternică";
  } else if (
    score >=
    3
  ) {
    label =
      "Acceptabilă";
  }

  return (
    <div
      className={
        styles.passwordStrength
      }
    >
      <div
        className={
          styles.strengthBars
        }
      >
        {[
          1,
          2,
          3,
          4,
          5,
        ].map(
          (
            item
          ) => (
            <span
              key={
                item
              }
              className={`${styles.strengthBar} ${
                item <=
                score
                  ? styles.strengthBarActive
                  : ""
              }`}
            />
          )
        )}
      </div>

      <div
        className={
          styles.strengthLabel
        }
      >
        Parolă:{" "}
        {label}
      </div>
    </div>
  );
}

/* =========================================================
   ERRORS
========================================================= */

function mapInviteError(
  error,
  message
) {
  switch (error) {
    case "token_required":
      return "Linkul de invitație nu este complet.";

    case "invalid_invitation":
      return "Invitația nu este validă.";

    case "invitation_expired":
      return "Invitația a expirat. Cere administratorului un link nou.";

    case "invitation_already_used":
      return "Această invitație a fost deja folosită.";

    default:
      return (
        message ||
        "Nu am putut verifica invitația."
      );
  }
}

function mapRegisterError(
  error,
  message
) {
  switch (error) {
    case "passwords_do_not_match":
      return "Parolele nu coincid.";

    case "weak_password":
      return "Parola este prea slabă.";

    case "mandatory_consents_required":
      return "Trebuie să accepți Termenii, Politica de confidențialitate și Acordul Programului de Influenceri.";

    case "influencer_terms_required":
      return "Trebuie să accepți Acordul privind Programul de Influenceri Artfest.";

    case "invalid_invitation":
      return "Invitația nu este validă.";

    case "invitation_expired":
    case "invitation_unavailable":
      return "Invitația nu mai este disponibilă.";

    case "invitation_already_used":
      return "Această invitație a fost deja folosită.";

    case "referral_code_already_exists":
      return "Nu am putut finaliza activarea profilului. Încearcă din nou.";

    case "account_already_exists":
      return "Există deja un cont Artfest cu acest email.";

    case "already_influencer":
      return "Acest cont este deja influencer.";

    case "influencer_registration_conflict":
      return "Contul nu a putut fi creat deoarece există deja date asociate acestei invitații.";

    default:
      return (
        message ||
        "Nu am putut crea contul de influencer."
      );
  }
}