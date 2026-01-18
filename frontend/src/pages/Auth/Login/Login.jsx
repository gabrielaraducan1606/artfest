// src/pages/Auth/Login/Login.jsx

/**
 * Pagina / componenta de Login.
 *
 * - Poate funcționa ca pagină full (cu tab-uri Login / Register)
 *   sau ca modal (doar partea de login, cu callbacks).
 * - Integrare cu backend:
 *   - POST /api/auth/login
 *   - GET  /api/auth/exists?email=
 * - Integrare cu contextul de auth:
 *   - useAuth().refresh() după login pentru a încărca user-ul curent.
 * - UX:
 *   - anti-typo email (sugestii gen gmail.com etc.)
 *   - verificare existență cont pentru email
 *   - CapsLock hint pentru parolă
 *   - "Ține-mă minte" (remember) + persistare ultimului email în localStorage
 *   - cooldown când backend-ul răspunde cu too_many_attempts (429)
 */

import { useEffect, useRef, useState, useId } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../../../lib/api";
import Register from "../Register/Register";
import { useAuth } from "../Context/context.js";
import styles from "./Login.module.css";

/* ========= util: sugestii anti-typo email (în afara componentei) ========= */
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
    if (dom.endsWith(bad)) dom = dom.slice(0, dom.length - bad.length) + good;
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
      common.find((d) => d.startsWith(dom)) || (dom === "gmail" ? "gmail.com" : "");
    if (guess) dom = guess;
  }

  const suggestion = `${user}@${dom}`;
  if (suggestion !== v) return { hint: "Ai vrut să scrii:", suggestion };
  return { hint: "", suggestion: "" };
}

/* ============================ Componenta ============================ */
export default function Login({
  inModal = false,
  onLoggedIn,
  redirectTo = "/desktop",
  onSwitchToRegister,
}) {
  const { refresh } = useAuth();

  /* ------------------ Tab state (Login / Register) ------------------ */
  const [tab, setTab] = useState("login");

  useEffect(() => {
    if (inModal) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("auth");
      setTab(t === "register" ? "register" : "login");
    } catch {
      // ignore
    }
  }, [inModal]);

  // ID-uri unice
  const baseId = useId();
  const emailId = useId();
  const passwordId = useId();
  const loginPanelId = `${baseId}-login-panel`;
  const registerPanelId = `${baseId}-register-panel`;
  const capsHintId = `${baseId}-caps-hint`;

  /* ----------------------------- State UI ---------------------------- */
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("lastEmail") || "";
    } catch {
      return "";
    }
  });

  const [emailTypoHint, setEmailTypoHint] = useState("");
  const [emailExistsHint, setEmailExistsHint] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState("");

  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [peekPw, setPeekPw] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [remember, setRemember] = useState(true);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cooldownSec, setCooldownSec] = useState(0);

  const emailRef = useRef(null);
  const pwRef = useRef(null);
  const liveRef = useRef(null);

  const loginAbortRef = useRef(null);
  const existsAbortRef = useRef(null);

  const normalizeEmail = (s = "") => s.trim().toLowerCase();

  /* ------------------------ Autofocus pe email ----------------------- */
  useEffect(() => {
    if (inModal) return;
    try {
      emailRef.current?.focus();
    } catch {
      // ignore
    }
  }, [inModal]);

  /* ------------------ Anti-typo hint & suggestion ------------------- */
  useEffect(() => {
    const { hint, suggestion } = suggestEmailTypos(email);
    setEmailTypoHint(hint);
    setEmailSuggestion(suggestion);
  }, [email]);

  /* -------------------------- Online / Offline ----------------------- */
  useEffect(() => {
    function up() {
      setOffline(false);
    }
    function down() {
      setOffline(true);
    }
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  /* -------------------- aria-live: ultimele erori -------------------- */
  useEffect(() => {
    if (!liveRef.current) return;
    liveRef.current.textContent = err || "";
  }, [err]);

  /* ----------------- Debounce /exists + hint "nu există" ------------ */
  useEffect(() => {
    if (offline) {
      setEmailExistsHint("");
      return;
    }

    if (!email || !email.includes("@")) {
      setEmailExistsHint("");
      return;
    }

    try {
      existsAbortRef.current?.abort?.();
    } catch {
      // ignore
    }

    const ctrl = new AbortController();
    existsAbortRef.current = ctrl;

    const t = setTimeout(async () => {
      try {
        const e = normalizeEmail(email);
        if (!e) return;
        const r = await api(`/api/auth/exists?email=${encodeURIComponent(e)}`, {
          signal: ctrl.signal,
        });
        const exists = !!r?.exists;
        if (exists === false) setEmailExistsHint("Verifică adresa: nu pare să existe un cont.");
        else setEmailExistsHint("");
      } catch {
        // ignore
      }
    }, 450);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [email, offline]);

  /* ------------------------- Cooldown pentru 429 --------------------- */
  useEffect(() => {
    if (!cooldownSec) return;
    const id = setInterval(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldownSec]);

  /* ------------------ Maparea erorilor backend -> mesaje UX --------- */
  function mapBackendError(e, existsFlag) {
    const code = e?.data?.error || e?.error || e?.message || "";

    if (code === "user_not_found") return "Nu există niciun cont cu acest e-mail. Creează un cont nou.";

    if (code === "old_password_used") {
      return "Această parolă a fost folosită anterior și a fost înlocuită. Te rugăm să folosești parola nouă sau să îți resetezi parola.";
    }

    if (code === "wrong_password") {
      return existsFlag === false
        ? "Nu există niciun cont cu acest e-mail. Creează un cont nou."
        : "Parola este incorectă. Încearcă din nou sau resetează-ți parola.";
    }

    if (code === "invalid_payload") return "Te rugăm să completezi e-mailul și parola.";

    if (code === "email_not_verified") return "Te rugăm să îți confirmi adresa de email. Ți-am trimis un link de activare.";

    if (code === "account_locked") return "Contul tău este blocat. Te rugăm să contactezi echipa de suport.";

    if (code === "too_many_attempts") {
      return "Prea multe încercări de conectare. Te rugăm să încerci din nou peste câteva minute.";
    }

    return e?.data?.message || e?.message || "Autentificarea a eșuat. Încearcă din nou.";
  }

  /* -------------------------- Submit login --------------------------- */
  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;

    if (offline) {
      setErr("Ești offline. Verifică conexiunea la internet.");
      return;
    }

    if (!email || !password) {
      setErr("Te rugăm să completezi e-mailul și parola.");
      return;
    }

    setErr("");
    setLoading(true);
    const cleanEmail = normalizeEmail(email);

    // abort cereri vechi de login (retry / double click)
    try {
      loginAbortRef.current?.abort?.();
    } catch {
      // ignore
    }
    const ctrl = new AbortController();
    loginAbortRef.current = ctrl;

    try {
      const resp = await api("/api/auth/login", {
        method: "POST",
        body: { email: cleanEmail, password, remember: !!remember },
        signal: ctrl.signal,
      });

      const { user } = resp || {};

      // Persistăm sau ștergem ultimul email în funcție de "remember"
      try {
        if (remember) localStorage.setItem("lastEmail", cleanEmail);
        else localStorage.removeItem("lastEmail");
      } catch {
        // ignore
      }

      // Reîmprospătăm contextul de auth
      try {
        await refresh();
      } catch {
        // ignore: dacă /me pică temporar, loginul tot a mers
      }

      // callback părinte (modal)
      onLoggedIn?.(user);

      // Eveniment global
      try {
        window.dispatchEvent(new CustomEvent("auth:login"));
      } catch {
        // ignore
      }

      // Redirect pe rol
      const role = user?.role;
      let next;

      if (role === "ADMIN") next = "/admin";
      else if (role === "VENDOR") next = "/desktop";
      else next = "/desktop-user";

      if (!next) next = redirectTo || "/desktop-user";

      window.location.assign(next);
    } catch (e2) {
      if (e2?.name === "AbortError") return;

      // email nu este verificat -> trimitem userul la /verify-email
      if (e2?.status === 403 && e2?.data?.error === "email_not_verified") {
        const url = `/verify-email?email=${encodeURIComponent(cleanEmail)}`;
        try {
          window.location.assign(url);
        } catch {
          setErr(
            e2?.data?.message ||
              "Te rugăm să îți confirmi adresa de email înainte de a te conecta."
          );
        }
        return;
      }

      // Too many attempts
      if (e2?.status === 429 || e2?.data?.error === "too_many_attempts") {
        setErr("Prea multe încercări. Mai încearcă în câteva secunde.");
        setCooldownSec((s) => (s && s > 0 ? s : 20));
      } else if (!navigator.onLine) {
        setErr("Ești offline. Reîncearcă atunci când revii online.");
      } else {
        // Exists pentru mesaj mai precis
        const exists = await (async () => {
          try {
            const r = await api(`/api/auth/exists?email=${encodeURIComponent(cleanEmail)}`);
            return !!r?.exists;
          } catch {
            return null;
          }
        })();

        const msg = mapBackendError(e2, exists);
        setErr(msg);

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

  /* ----------------- Handler pentru tastă la parolă ----------------- */
  function handlePwKey(ev) {
    try {
      setCapsOn(!!ev.getModifierState?.("CapsLock"));
    } catch {
      // ignore
    }

    if ((ev.altKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      setShowPw((v) => !v);
    }

    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      try {
        (ev.target?.form || document.querySelector("form"))?.requestSubmit?.();
      } catch {
        // ignore
      }
    }

    if (ev.key === "Escape") setErr("");
  }

  const showToggle = pwFocused || password.length > 0;
  const pwType = showPw || peekPw ? "text" : "password";

  function applyEmailSuggestion() {
    if (emailSuggestion) {
      const clean = normalizeEmail(emailSuggestion);
      setEmail(clean);
    }
    setEmailTypoHint("");
    setEmailExistsHint("");
  }

  function onEmailKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      pwRef.current?.focus();
    }
  }

  return (
    <section
      className={`${styles.wrap} ${inModal ? styles.wrapModal : ""}`}
      aria-labelledby={inModal ? undefined : "login-title"}
    >
      {!inModal && (
        <header className={styles.header}>
          <h1 id="login-title" className={styles.title}>
            Conectează-te sau creează cont
          </h1>
          <p className={styles.subtitle}>Intră în cont pentru a continua.</p>
        </header>
      )}

      {!inModal && (
        <div className={styles.tabBar} role="tablist" aria-label="Autentificare sau Înregistrare">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "login"}
            aria-controls={loginPanelId}
            id={`${baseId}-tab-login`}
            tabIndex={tab === "login" ? 0 : -1}
            className={`${styles.tabBtn} ${tab === "login" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("login")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setTab("register");
            }}
          >
            Autentificare
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "register"}
            aria-controls={registerPanelId}
            id={`${baseId}-tab-register`}
            tabIndex={tab === "register" ? 0 : -1}
            className={`${styles.tabBtn} ${tab === "register" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("register")}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setTab("login");
            }}
          >
            Înregistrare
          </button>
        </div>
      )}

      {(inModal || tab === "login") && (
        <form
          className={styles.card}
          onSubmit={onSubmit}
          noValidate
          id={loginPanelId}
          role={!inModal ? "tabpanel" : undefined}
          aria-labelledby={!inModal ? `${baseId}-tab-login` : undefined}
        >
          <div ref={liveRef} tabIndex={-1} aria-live="polite" aria-atomic="true" className={styles.srOnly} />

          {offline && (
            <div className={styles.offline} role="status">
              Ești offline — verifică rețeaua.
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label htmlFor={emailId} className={styles.label}>
              Email
            </label>
            <input
              id={emailId}
              name="email"
              autoComplete="email"
              className={styles.input}
              value={email}
              ref={emailRef}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onEmailKeyDown}
              placeholder="nume@exemplu.ro"
              type="email"
              required
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!err && err.toLowerCase().includes("e-mail")}
            />
            {(emailTypoHint || emailExistsHint || emailSuggestion) && (
              <div className={styles.suggestionRow}>
                {emailTypoHint && <small className={styles.hint}>{emailTypoHint}</small>}
                {emailExistsHint && <small className={styles.hint}>{emailExistsHint}</small>}
                {emailSuggestion && (
                  <button type="button" className={styles.pill} onClick={applyEmailSuggestion}>
                    Aplicați: <strong>{emailSuggestion}</strong>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor={passwordId} className={styles.label}>
              Parolă
            </label>

            <div className={`${styles.inputGroup} ${showToggle ? styles.hasToggle : ""}`}>
              <input
                id={passwordId}
                name="password"
                autoComplete="current-password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={handlePwKey}
                onKeyDown={handlePwKey}
                onFocus={() => setPwFocused(true)}
                onBlur={() => setPwFocused(false)}
                placeholder="••••••••"
                type={pwType}
                required
                minLength={6}
                ref={pwRef}
                aria-describedby={capsOn ? capsHintId : undefined}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!err && err.toLowerCase().includes("parola")}
              />

              {showToggle && (
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
                      // ignore
                    }
                  }}
                  onTouchEnd={() => setPeekPw(false)}
                  onTouchCancel={() => setPeekPw(false)}
                  title="Click pentru toggle, ține apăsat pentru a previzualiza"
                >
                  {showPw || peekPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>

            {capsOn && (
              <div id={capsHintId} className={styles.capsHint}>
                Atenție: CapsLock este activ.
              </div>
            )}
          </div>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              aria-label="Ține-mă minte"
            />
            <span className={styles.checkLabel}>Ține-mă minte pe acest dispozitiv</span>
          </label>

          {err && (
            <div className={styles.error} role="alert">
              {err}{" "}
              {(err.toLowerCase().includes("parola") || err.toLowerCase().includes("eșuat")) && (
                <a className={styles.linkBtn} href="/reset-parola">
                  Resetează parola
                </a>
              )}
              {err.toLowerCase().includes("creează un cont") &&
                (inModal && onSwitchToRegister ? (
                  <button type="button" className={styles.linkBtn} onClick={onSwitchToRegister}>
                    Creează cont
                  </button>
                ) : (
                  !inModal && (
                    <button type="button" className={styles.linkBtn} onClick={() => setTab("register")}>
                      Creează cont
                    </button>
                  )
                ))}
            </div>
          )}

          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={loading || !email || !password || cooldownSec > 0 || offline}
            aria-busy={loading ? "true" : "false"}
            title={cooldownSec > 0 ? `Așteaptă ${cooldownSec}s` : undefined}
          >
            {loading ? "Se conectează…" : cooldownSec > 0 ? `Așteaptă ${cooldownSec}s` : "Intră"}
          </button>

          <div className={styles.footerRow}>
            <a className={styles.link} href="/reset-parola">
              Ai uitat parola?
            </a>
            {inModal && onSwitchToRegister ? (
              <button type="button" className={styles.linkBtn} onClick={onSwitchToRegister}>
                Creează cont
              </button>
            ) : (
              !inModal && (
                <button type="button" className={styles.linkBtn} onClick={() => setTab("register")}>
                  Creează cont
                </button>
              )
            )}
          </div>
        </form>
      )}

      {!inModal && tab === "register" && (
        <div
          className={styles.card}
          role="tabpanel"
          aria-label="Înregistrare"
          id={registerPanelId}
          aria-labelledby={`${baseId}-tab-register`}
        >
          <Register inModal={false} defaultAsVendor={false} />
        </div>
      )}
    </section>
  );
}
