// src/pages/Auth/Register/Register.jsx

/**
 * Formular de înregistrare (creare cont).
 *
 * - Poate fi afișat ca pagină separată sau în interiorul unui modal.
 * - Permite crearea unui cont normal sau a unui cont de vendor/partener.
 * - Integrare cu backend:
 *   - POST /api/auth/signup
 *   - GET  /api/auth/exists?email=
 *   - POST /api/auth/resend-verification
 *   - GET  /api/legal?types=tos,privacy (meta pentru consimțăminte)
 *
 * UX:
 * - Sugestii anti-typo pentru email (gmail, yahoo etc.)
 * - Verificare în timp real dacă emailul există deja
 * - Password strength bar + CapsLock hint + toggle vizibilitate
 * - Vendor opt-in + confirmare entitate juridică
 * - Consimțăminte legale (TOS, Privacy, Marketing)
 * - Flow de retrimitere email de confirmare pentru conturi nevalidate
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./Register.module.css";

const OB_TICKET_PARAM = "obpf";
const OB_TICKET_PREFIX = "onboarding.ticket.";

/* ===================== Utils ===================== */
/**
 * Adaugă un "ticket" de onboarding în query-ul unui URL (ex: /onboarding?obpf=...).
 * Folosit ca fallback pentru backend-uri mai vechi care nu întorc explicit ruta de onboarding.
 */
function appendTicket(urlLike, ticket) {
  try {
    const u = new URL(urlLike, window.location.origin);
    u.searchParams.set(OB_TICKET_PARAM, ticket);
    return u.pathname + u.search + u.hash;
  } catch {
    const sep = urlLike.includes("?") ? "&" : "?";
    return `${urlLike}${sep}${OB_TICKET_PARAM}=${encodeURIComponent(ticket)}`;
  }
}

/**
 * Construiește un URL către documentele legale:
 * - dacă primește deja URL absolut (http/https) -> îl folosește
 * - altfel -> prefixează cu VITE_API_URL dacă există, sau lasă relativ
 */
function absLegalUrl(pathname) {
  const p = pathname || "";
  if (/^https?:\/\//i.test(p)) return p;

  const rel = p.startsWith("/") ? p : `/${p}`;

  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  if (base) return `${base}${rel}`;

  return rel;
}

// Sugestii anti-typo pentru email (gmail, yahoo etc.)
function suggestEmailTypos(value) {
  const v = value.trim().toLowerCase();
  if (!v.includes("@")) return { hint: "", suggestion: "" };
  const [user, domRaw = ""] = v.split("@");
  if (!user || !domRaw) return { hint: "", suggestion: "" };

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
  for (const [bad, good] of fixes) {
    if (dom.endsWith(bad)) {
      dom = dom.slice(0, dom.length - bad.length) + good;
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
      common.find((d) => d.startsWith(dom)) ||
      (dom === "gmail" ? "gmail.com" : "");
    if (guess) dom = guess;
  }
  const suggestion = `${user}@${dom}`;
  return suggestion !== v
    ? { hint: "Ai vrut să scrii:", suggestion }
    : { hint: "", suggestion: "" };
}

/* ===================== useLegalMeta (cache + backoff) ===================== */
/**
 * Cache pe 6 ore pentru meta-informații legale (TOS, Privacy etc.)
 * - memCache: cache în memorie pe durata sesiunii
 * - localStorage: cache persistent
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const LS_PREFIX = "legal:v1:";
const memCache = new Map(); // key -> { ts, data }

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!ts || !data) return null;
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}
function saveToStorage(key, data) {
  try {
    localStorage.setItem(
      LS_PREFIX + key,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // ignorăm erorile de storage (ex: private mode)
  }
}

/**
 * Fetch cu retry + backoff pentru /api/legal.
 * Respectă eventualul header Retry-After pentru 429/503.
 */
async function fetchWithBackoff(url, { signal, tries = 4 } = {}) {
  let delay = 500;
  for (let i = 0; i < tries; i++) {
    try {
      return await api(url, { signal });
    } catch (e) {
      const status = e?.status || e?.data?.status;
      let retryAfterMs = 0;
      try {
        const ra = e?.headers?.get?.("Retry-After");
        if (ra && /^\d+$/.test(ra)) retryAfterMs = parseInt(ra, 10) * 1000;
      } catch {
        // ignorăm erorile de parsing ale headerului
      }
      if (status === 429 || status === 503) {
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((r) =>
          setTimeout(r, Math.max(retryAfterMs, delay) + jitter)
        );
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
  const err = new Error("too_many_requests");
  err.status = 429;
  throw err;
}

/**
 * Hook pentru încărcarea meta-ului legal (Termeni, Privacy etc.)
 * - acceptă o listă de "types" (ex: ["tos", "privacy"])
 * - folosește cache în memorie + localStorage
 */
function useLegalMeta(types = []) {
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(!!types.length);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const depKey = useMemo(
    () => (types && types.length ? types.join(",") : ""),
    [types]
  );

  useEffect(() => {
    let active = true;
    if (!depKey) {
      setMeta({});
      setLoading(false);
      setError("");
      return;
    }

    // întâi încercăm să citim din cache (memorie + localStorage)
    const cached = memCache.get(depKey) || loadFromStorage(depKey);
    if (cached) {
      setMeta(cached);
      setLoading(false);
      setError("");
    }

    (async () => {
      setLoading(true);
      setError("");
      try {
        abortRef.current?.abort?.();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        const arr = await fetchWithBackoff(
          `/api/legal?types=${encodeURIComponent(depKey)}`,
          { signal: ctrl.signal }
        );
        if (!active) return;

        const map = {};
        for (const d of arr || []) map[d.type] = d;
        setMeta(map);
        memCache.set(depKey, map);
        saveToStorage(depKey, map);
      } catch (e) {
        if (!active) return;
        if (!cached) {
          setError(
            e?.status === 429
              ? "Nu am putut încărca informațiile legale (limită atinsă). Folosim link-urile implicite."
              : "Nu am putut încărca informațiile legale."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      abortRef.current?.abort?.();
    };
  }, [depKey]);

  return { meta, loading, error };
}

/* ===================== Component ===================== */
export default function Register({ defaultAsVendor = false, inModal = false }) {
  // Ce tipuri de documente legale vrem să încărcăm
  const legalTypes = useMemo(() => ["tos", "privacy"], []);
  const { meta: legal, error: legalError } = useLegalMeta(legalTypes);

  // fields
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState("");
  const [emailExists, setEmailExists] = useState(null);

  const [password, setPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [peekPw, setPeekPw] = useState(false);

  const [pwFocused, setPwFocused] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [asVendor, setAsVendor] = useState(defaultAsVendor);

  // Vendor: confirmare că este entitate juridică
  const [vendorEntityConfirm, setVendorEntityConfirm] = useState(false);

  // consents (legal & marketing)
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  // ui
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  // UX pentru email neconfirmat (re-send verification)
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendOk, setResendOk] = useState(false);

  // Idempotency-Key pentru signup (aceeași pe toată durata formularului)
  const idemRef = useRef(
    globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  );
  const emailAbortRef = useRef(null);
  const liveRef = useRef(null);
  const pwRef = useRef(null);

  // password score (0..5) pentru bara de complexitate
  const score = useMemo(() => {
    const len = password.length >= 8 ? 1 : 0;
    const lower = /[a-z]/.test(password) ? 1 : 0;
    const upper = /[A-Z]/.test(password) ? 1 : 0;
    const digit = /\d/.test(password) ? 1 : 0;
    const symbol = /[^A-Za-z0-9]/.test(password) ? 1 : 0;
    return len + lower + upper + digit + symbol; // 0..5
  }, [password]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  // Condiții pentru activarea butonului "Creează cont"
  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    emailExists !== true &&
    password.length >= 8 &&
    score >= 3 &&
    tosAccepted &&
    privacyAcknowledged &&
    (!asVendor || vendorEntityConfirm); // ✅ vendorii trebuie să confirme că sunt entități juridice

  /* -------------------------- Online / Offline ----------------------- */
  useEffect(() => {
    const up = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  /* ------------- Email: sugestii anti-typo + exists (debounced) ------ */
  useEffect(() => {
    const { hint, suggestion } = suggestEmailTypos(email);
    setEmailHint(hint);
    setEmailSuggestion(suggestion);

    try {
      emailAbortRef.current?.abort?.();
    } catch {
      // ignorăm
    }
    const ctrl = new AbortController();
    emailAbortRef.current = ctrl;

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setEmailExists(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const r = await api(
          `/api/auth/exists?email=${encodeURIComponent(normalized)}`,
          { signal: ctrl.signal }
        );
        setEmailExists(!!r?.exists);
      } catch {
        setEmailExists(null);
      }
    }, 450);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [email]);

  function applyEmailSuggestion() {
    if (emailSuggestion) setEmail(emailSuggestion);
    setEmailHint("");
  }

  /* ------------------------ Key handler pentru parolă ---------------- */
  function handlePwKey(ev) {
    try {
      setCapsOn(!!ev.getModifierState?.("CapsLock"));
    } catch {
      // ignorăm
    }
    // Alt/Option/Cmd+V -> toggle vizibilitate parolă
    if ((ev.altKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      setShowPw((v) => !v);
    }
    // Ctrl/Cmd+Enter -> submit formular
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      try {
        (ev.target?.form || document.querySelector("form"))?.requestSubmit?.();
      } catch {
        // ignorăm
      }
    }
    // Esc -> curăță eroarea globală
    if (ev.key === "Escape") setErr("");
  }

  /* ------------------ Re-trimitere email de verificare ---------------- */
  async function handleResend() {
    if (!unverifiedEmail) return;
    try {
      setResendBusy(true);
      await api("/api/auth/resend-verification", {
        method: "POST",
        body: { email: unverifiedEmail },
      });
      setResendOk(true);
    } catch {
      // ignorăm, afișăm doar fallback general
    } finally {
      setResendBusy(false);
    }
  }

  /* ------------------------------ Submit ------------------------------ */
  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    if (offline) {
      setErr("Ești offline. Verifică conexiunea la internet.");
      return;
    }

    setErr("");
    setResendOk(false);
    setUnverifiedEmail("");
    setLoading(true);
    try {
      const consents = [];
      if (tosAccepted) {
  const v = legal?.tos?.version ?? "1.0.0";
  const cs = legal?.tos?.checksum ?? null;

  consents.push({
    type: "tos",
    version: String(v),
    checksum: cs === null ? null : String(cs),
  });
}

if (privacyAcknowledged) {
  const v = legal?.privacy?.version ?? "1.0.0";
  const cs = legal?.privacy?.checksum ?? null;

  consents.push({
    type: "privacy_ack",
    version: String(v),
    checksum: cs === null ? null : String(cs),
  });
}

if (marketingOptIn) {
  consents.push({ type: "marketing_email_optin", version: "1.0.0" });
}

      const body = {
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        name: fullName || undefined,
        asVendor,
        entitySelfDeclared: asVendor ? !!vendorEntityConfirm : false, // 🔥 trimitem și către backend
        consents,
        // Politică anti-link extern (backend poate onora acest flag)
        noExternalLinks: true,
      };

      const res = await api("/api/auth/signup", {
        method: "POST",
        headers: { "Idempotency-Key": idemRef.current },
        body,
      });

      // ✉️ email verification flow — backend ne spune că trebuie confirmat emailul
      if (res?.status === "pending_verification") {
        try {
          sessionStorage.setItem("onboarding.intent", asVendor ? "vendor" : "");
        } catch {
          // ignorăm
        }
        const next =
          res?.next ||
          `/verify-email?email=${encodeURIComponent(
            email.trim().toLowerCase()
          )}`;
        window.location.assign(next);
        return;
      }

      // fallback (dacă backendul n-a fost actualizat încă pentru vendors)
      if (asVendor) {
        try {
          const ticket =
            crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
          const payload = { ts: Date.now(), intent: "vendor" };
          sessionStorage.setItem(
            OB_TICKET_PREFIX + ticket,
            JSON.stringify(payload)
          );
          const next = res?.next || "/onboarding";
          window.location.assign(appendTicket(next, ticket));
          return;
        } catch {
          // ignorăm erorile de storage
        }
      }

      // utilizator obișnuit: redirect la next sau desktop
      window.location.assign(res?.next || (asVendor ? "/onboarding" : "/desktop"));
   } catch (e2) {
  console.error("Register error:", e2);

  const fieldErrors = e2?.data?.details?.fieldErrors;
  const formErrors = e2?.data?.details?.formErrors;

  const nice =
    fieldErrors
      ? Object.entries(fieldErrors)
          .map(([k, v]) => `${k}: ${(v || []).join(", ")}`)
          .join(" • ")
      : "";

  const msg =
    (e2?.status === 409 &&
      (e2?.data?.error === "email_exists_unverified"
        ? "Există deja un cont cu acest email, dar nu este confirmat."
        : "Acest email este deja folosit.")) ||
    e2?.data?.message ||
    nice ||
    (formErrors && formErrors.length ? formErrors.join(" • ") : "") ||
    e2?.message ||
    "Înregistrarea a eșuat.";

  setErr(msg);

  setUnverifiedEmail(
    e2?.data?.error === "email_exists_unverified"
      ? email.trim().toLowerCase()
      : ""
  );

  try {
    liveRef.current?.focus?.();
    if (e2?.status === 409) {
      document.getElementById("reg-email")?.focus();
    } else {
      pwRef.current?.focus();
      pwRef.current?.select?.();
    }
  } catch {
    // nu e critic dacă focus-ul eșuează
  }
}
finally {
      setLoading(false);
    }
  }

  const pwType = showPw || peekPw ? "text" : "password";
  const showPwToggle = pwFocused || password.length > 0;

  // ✅ folosim meta-ul din /api/legal dacă există, altfel fallback hardcoded
  const tosUrl =
    legal?.tos?.url && legal.tos.url !== "#"
      ? legal.tos.url
      : "/termenii-si-conditiile";

  const privacyUrl =
    legal?.privacy?.url && legal.privacy.url !== "#"
      ? legal.privacy.url
      : "/confidentialitate";

  /* --------------------------- Formularul ----------------------------- */
  const form = (
    <form className={styles.body} onSubmit={onSubmit} noValidate>
      {/* aria-live pentru erori + focusable pentru screen readers */}
      <div
        ref={liveRef}
        tabIndex={-1}
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      />
      {offline && (
        <div className={styles.error} role="status">
          Ești offline — verifică rețeaua.
        </div>
      )}
      {legalError && (
        <div className={styles.legalNotice} role="status">
          {legalError}
        </div>
      )}

      {/* ====== Partner/Vendor opt-in box ====== */}
      <div
        role="group"
        aria-labelledby="vendor-box-title"
        className={`${styles.vendorBox} ${asVendor ? styles.vendorBoxActive : ""}`}
      >
        <label className={styles.vendorCheck}>
          <input
            type="checkbox"
            checked={asVendor}
            onChange={(e) => {
              const checked = e.target.checked;
              setAsVendor(checked);
              if (!checked) setVendorEntityConfirm(false);
              try {
                sessionStorage.setItem("onboarding.intent", checked ? "vendor" : "");
              } catch {
                // ignorăm
              }
            }}
          />
          <span id="vendor-box-title" className={styles.vendorTitle}>
            Sunt <strong>furnizor de servicii / partener Artfest</strong>
            <span className={styles.vendorSubtitle}> (PFA / SRL / II / IF)</span>
          </span>
        </label>

        <p className={styles.vendorNote}>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            <strong>Doar pentru furnizori (entități juridice).</strong> Clienții
            care doresc să comande <u>nu bifează</u> această opțiune.
          </span>
        </p>

        {asVendor && (
          <label className={styles.entityConfirmRow}>
            <input
              type="checkbox"
              checked={vendorEntityConfirm}
              onChange={(e) => setVendorEntityConfirm(e.target.checked)}
              aria-required="true"
            />
            <span className={styles.spanConfirm}>
              Confirm că reprezint o <strong>entitate juridică</strong> (PFA /
              SRL / II / IF) și dețin un <strong>CUI/CIF</strong> valid.
            </span>
          </label>
        )}
      </div>

      {/* ====== Name ====== */}
      <div className={styles.nameRow}>
        <label className={styles.nameCol}>
          <span className={styles.srOnly}>Prenume</span>
          <input
            className={styles.field}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Prenume"
            autoComplete="given-name"
            required
          />
        </label>
        <label className={styles.nameCol}>
          <span className={styles.srOnly}>Nume</span>
          <input
            className={styles.field}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Nume"
            autoComplete="family-name"
            required
          />
        </label>
      </div>

      {/* ====== Email ====== */}
      <div className={styles.fieldGroup}>
        <label className={styles.srOnly} htmlFor="reg-email">
          Email
        </label>
        <input
          id="reg-email"
          className={styles.field}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          required
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Email"
          aria-invalid={emailExists === true}
        />
        {(emailHint || emailSuggestion || emailExists === true) && (
          <div className={styles.suggestionRow}>
            {emailHint && <small className={styles.hint}>{emailHint}</small>}
            {emailSuggestion && (
              <button type="button" className={styles.pill} onClick={applyEmailSuggestion}>
                Aplicați: <strong>{emailSuggestion}</strong>
              </button>
            )}
            {emailExists === true && (
              <small className={styles.error} role="alert">
                Acest email este deja folosit.{" "}
                <a href="/login" className={styles.inlineLink}>
                  Autentifică-te
                </a>{" "}
                sau{" "}
                <a
                  href={`/reset-parola?email=${encodeURIComponent(
                    email.trim().toLowerCase()
                  )}`}
                  className={styles.inlineLink}
                >
                  resetează parola
                </a>
                .
              </small>
            )}
          </div>
        )}
      </div>

      {/* ====== Password ====== */}
      <div>
        <div className={`${styles.inputGroup} ${showPwToggle ? styles.hasToggle : ""}`}>
          <input
            ref={pwRef}
            className={styles.field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyUp={handlePwKey}
            onKeyDown={handlePwKey}
            onFocus={() => setPwFocused(true)}
            onBlur={() => setPwFocused(false)}
            type={pwType}
            placeholder="Parolă (min 8)"
            required
            autoComplete="new-password"
            aria-describedby="pw-hint"
            aria-label="Parolă"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {showPwToggle && (
            <button
              type="button"
              className={styles.togglePw}
              aria-label={showPw || peekPw ? "Ascunde parola" : "Afișează parola"}
              aria-pressed={showPw || peekPw}
              onClick={() => setShowPw((v) => !v)}
              onMouseDown={(e) => {
                e.preventDefault();
                setPeekPw(true);
              }}
              onMouseUp={() => setPeekPw(false)}
              onMouseLeave={() => setPeekPw(false)}
              onTouchStart={() => {
                setPeekPw(true);
                try {
                  pwRef.current?.focus({ preventScroll: true });
                } catch {
                  // ignorăm
                }
              }}
              onTouchEnd={() => setPeekPw(false)}
              onTouchCancel={() => setPeekPw(false)}
            >
              {showPw || peekPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>

        <div
          className={styles.progress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={score}
        >
          <div className={styles.bar} style={{ width: `${(score / 5) * 100}%` }} />
        </div>
        <small id="pw-hint" className={styles.hint}>
          Recomandat: minim 8 caractere și o combinație de litere mari/mici, cifre
          și simboluri.
        </small>
        {capsOn && pwFocused && (
          <div className={styles.capsHint}>
            <AlertTriangle size={14} aria-hidden="true" />
            <span>CapsLock este activ – ai grijă la literele mari.</span>
          </div>
        )}
      </div>

      {/* ===== LEGAL ===== */}
      <div className={styles.legalGroup}>
        <label className={styles.legalRow}>
          <input
            type="checkbox"
            checked={tosAccepted && privacyAcknowledged}
            onChange={(e) => {
              const v = e.target.checked;
              setTosAccepted(v);
              setPrivacyAcknowledged(v);
            }}
            required
          />
          <span>
            Prin crearea contului, confirm că am citit și accept{" "}
            <a
              className={styles.legalLink}
              href={absLegalUrl(tosUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Termenii și Condițiile
            </a>{" "}
            și{" "}
            <a
              className={styles.legalLink}
              href={absLegalUrl(privacyUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Politica de confidențialitate
            </a>
            .
          </span>
        </label>

        <label className={styles.legalRow}>
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
          />
          <span className={styles.legalMuted}>
            Accept să primesc noutăți și oferte prin email/SMS (opțional).
          </span>
        </label>
      </div>

      {/* Buton principal */}
      <button
        className={styles.primaryBtn}
        disabled={loading || !canSubmit}
        aria-busy={loading ? "true" : "false"}
      >
        {loading ? "Se înregistrează…" : "Creează cont"}
      </button>

      {/* Eroare globală */}
      {err && (
        <div className={styles.error} role="alert">
          {err}
        </div>
      )}

      {/* UI pentru retrimitere email de confirmare (când email-ul există, dar e neconfirmat) */}
      {unverifiedEmail && (
        <div className={styles.info} role="status" style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8 }}>
            Nu găsești emailul de confirmare? Îl putem retrimite către{" "}
            <strong>{unverifiedEmail}</strong>.
          </div>
          {!resendOk ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleResend}
              disabled={resendBusy}
            >
              {resendBusy ? "Se retrimite…" : "Trimite din nou emailul de confirmare"}
            </button>
          ) : (
            <div>Gata! Verifică inboxul (și Spam/Promo).</div>
          )}
        </div>
      )}
    </form>
  );

  // Varianta "în modal" — doar formularul, fără header/card extra
  if (inModal) return form;

  // Varianta pagină completă
  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h2 className={styles.title}>Creează cont</h2>
        <p className={styles.subtitle}>Îți faci cont în câteva secunde.</p>
      </header>
      <div className={styles.card}>{form}</div>
    </section>
  );
}
