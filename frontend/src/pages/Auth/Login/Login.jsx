import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../../../lib/api";
import Register from "../Register/Register";
import styles from "./Login.module.css";

/* ========= util: sugestii anti-typo email (în afara componentei) ========= */
function suggestEmailTypos(value) {
  const v = value.trim().toLowerCase();
  if (!v.includes("@")) return { hint: "", suggestion: "" };

  const [user, domRaw = ""] = v.split("@");
  if (!user || !domRaw) return { hint: "", suggestion: "" };

  const fixes = [
    ["gmal.com", "gmail.com"], ["gmial.com", "gmail.com"], ["gnail.com", "gmail.com"],
    ["gmail.con", "gmail.com"], ["gmail.co", "gmail.com"],
    ["yaho.com", "yahoo.com"], ["yaaho.com", "yahoo.com"], ["yahoo.con", "yahoo.com"],
    ["outllok.com", "outlook.com"], ["hotnail.com", "hotmail.com"],
    [".con", ".com"], [".c0m", ".com"], [" .ro", ".ro"], [".ro ", ".ro"],
  ];

  let dom = domRaw;
  for (const [bad, good] of fixes) {
    if (dom.endsWith(bad)) dom = dom.slice(0, dom.length - bad.length) + good;
  }

  const common = [
    "gmail.com","yahoo.com","outlook.com","hotmail.com",
    "icloud.com","proton.me","mail.com","live.com",
    "yahoo.ro","gmail.ro"
  ];
  if (!dom.includes(".")) {
    const guess = common.find((d) => d.startsWith(dom)) || (dom === "gmail" ? "gmail.com" : "");
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
  const [tab, setTab] = useState("login");
  useEffect(() => {
    if (inModal) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("auth");
      setTab(t === "register" ? "register" : "login");
    } catch {""}
  }, [inModal]);

  // state
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem("lastEmail") || ""; } catch { return ""; }
  });
  const [emailHint, setEmailHint] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState("");

  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);  // toggle persistent
  const [peekPw, setPeekPw] = useState(false);  // press & hold
  const [pwFocused, setPwFocused] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [remember, setRemember] = useState(true);

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cooldownSec, setCooldownSec] = useState(0); // pt. 429

  const emailRef = useRef(null);
  const pwRef = useRef(null);
  const liveRef = useRef(null);

  const loginAbortRef = useRef(null);
  const existsAbortRef = useRef(null);

  const showTabs = !inModal;
  const normalizeEmail = (s = "") => s.trim().toLowerCase();

  // anti-typo hint & suggestion (dinamice)
  useEffect(() => {
    const { hint, suggestion } = suggestEmailTypos(email);
    setEmailHint(hint);
    setEmailSuggestion(suggestion);
  }, [email]);

  // online/offline
  useEffect(() => {
    function up() { setOffline(false); }
    function down() { setOffline(true); }
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // debounce /exists + abort
  useEffect(() => {
    if (!email || !email.includes("@")) { setEmailHint(""); return; }
    try { existsAbortRef.current?.abort?.(); } catch {""}
    const ctrl = new AbortController();
    existsAbortRef.current = ctrl;

    const t = setTimeout(async () => {
      try {
        const e = normalizeEmail(email);
        if (!e) return;
        const r = await api(`/api/auth/exists?email=${encodeURIComponent(e)}`, { signal: ctrl.signal });
        const exists = !!r?.exists;
        if (exists === false) setEmailHint((h) => h || "Verifică adresa: nu pare să existe un cont.");
      } catch {""}
    }, 450);

    return () => { clearTimeout(t); ctrl.abort(); };
  }, [email]);

  // cooldown soft pentru 429
  useEffect(() => {
    if (!cooldownSec) return;
    const id = setInterval(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldownSec]);

  function mapBackendError(e, existsFlag) {
    const code = e?.data?.error || e?.error || e?.message || "";
    if (code === "user_not_found") return "Nu există niciun cont cu acest email. Vă rugăm să creați unul.";
    if (code === "wrong_password")
      return existsFlag === false
        ? "Nu există niciun cont cu acest email. Vă rugăm să creați unul."
        : "Parola este incorectă. Încearcă din nou sau resetează parola.";
    if (code === "invalid_payload") return "Te rugăm să completezi emailul și parola.";
    return e?.message || "Autentificarea a eșuat. Încearcă din nou.";
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (offline) { setErr("Ești offline. Verifică conexiunea la internet."); return; }

    setErr("");
    setLoading(true);
    const cleanEmail = normalizeEmail(email);

    // abort cereri vechi
    try { loginAbortRef.current?.abort?.(); } catch {""}
    const ctrl = new AbortController();
    loginAbortRef.current = ctrl;

    try {
      const resp = await api("/api/auth/login", {
        method: "POST",
        body: { email: cleanEmail, password, remember: !!remember },
        signal: ctrl.signal,
      });
      if (resp && resp.__unauth) {
        const fake = new Error("wrong_password");
        fake.status = 401;
        fake.data = { error: "wrong_password" };
        throw fake;
      }
      const { user } = resp || {};

      try {
        if (remember) localStorage.setItem("lastEmail", cleanEmail);
        else localStorage.removeItem("lastEmail");
      } catch {""}

      onLoggedIn?.(user);
      try { window.dispatchEvent(new CustomEvent("auth:login")); } catch {""}
      window.location.assign(redirectTo);
    } catch (e2) {
      if (e2?.name === "AbortError") return;
      if (e2?.status === 429 || e2?.data?.error === "too_many_attempts") {
        setErr("Prea multe încercări. Mai încearcă în câteva secunde.");
        setCooldownSec((s) => (s && s > 0 ? s : 20));
      } else if (!navigator.onLine) {
        setErr("Ești offline. Reîncearcă atunci când revii online.");
      } else {
        const exists = await (async () => {
          try {
            const r = await api(`/api/auth/exists?email=${encodeURIComponent(cleanEmail)}`);
            return !!r?.exists;
          } catch { return null; }
        })();
        const msg = mapBackendError(e2, exists);
        setErr(msg);
        try {
          liveRef.current?.focus?.();
          pwRef.current?.focus();
          pwRef.current?.select?.();
        } catch {""}
      }
    } finally {
      setLoading(false);
    }
  }

  function handlePwKey(ev) {
    // CapsLock hint — păstrat
    try { setCapsOn(!!ev.getModifierState?.("CapsLock")); } catch {""}

    // Alt/Option/Cmd+V -> toggle vizibilitate
    if ((ev.altKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      setShowPw((v) => !v);
    }
    // Ctrl/Cmd+Enter -> submit
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      try { (ev.target?.form || document.querySelector("form"))?.requestSubmit?.(); } catch {""}
    }
    // Esc -> curăță eroarea
    if (ev.key === "Escape") setErr("");
  }

  // UI logic
  const showToggle = pwFocused || password.length > 0;
  const pwType = (showPw || peekPw) ? "text" : "password";

  function applyEmailSuggestion() {
    if (emailSuggestion) setEmail(emailSuggestion);
    setEmailHint("");
  }

  function onEmailKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      pwRef.current?.focus();
    }
  }

  return (
    <section className={`${styles.wrap} ${inModal ? styles.wrapModal : ""}`} aria-labelledby={inModal ? undefined : "login-title"}>
      {!inModal && (
        <header className={styles.header}>
          <h1 id="login-title" className={styles.title}>Conectează-te sau creează cont</h1>
          <p className={styles.subtitle}>Intră în cont pentru a continua.</p>
        </header>
      )}

      {showTabs && (
        <div className={styles.tabBar} role="tablist" aria-label="Autentificare sau Înregistrare">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "login"}
            className={`${styles.tabBtn} ${tab === "login" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("login")}
          >
            Autentificare
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "register"}
            className={`${styles.tabBtn} ${tab === "register" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("register")}
          >
            Înregistrare
          </button>
        </div>
      )}

      {(inModal || tab === "login") && (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
          {/* aria-live politeness + focusable pentru cititoare ecran */}
          <div ref={liveRef} tabIndex={-1} aria-live="polite" aria-atomic="true" className={styles.srOnly} />

          {offline && <div className={styles.offline} role="status">Ești offline — verifică rețeaua.</div>}

          <div className={styles.fieldGroup}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              id="email"
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
              aria-invalid={!!err && err.toLowerCase().includes("email")}
            />
            {(emailHint || emailSuggestion) && (
              <div className={styles.suggestionRow}>
                {emailHint && <small className={styles.hint}>{emailHint}</small>}
                {emailSuggestion && (
                  <button type="button" className={styles.pill} onClick={applyEmailSuggestion}>
                    Aplicați: <strong>{emailSuggestion}</strong>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="password" className={styles.label}>Parolă</label>

            <div className={`${styles.inputGroup} ${showToggle ? styles.hasToggle : ""}`}>
              <input
                id="password"
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
                aria-describedby={capsOn ? "caps-hint" : undefined}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!err && err.toLowerCase().includes("parola")}
              />

              {showToggle && (
                <button
                  type="button"
                  className={styles.togglePw}
                  aria-label={(showPw || peekPw) ? "Ascunde parola" : "Afișează parola"}
                  aria-pressed={showPw || peekPw}
                  onClick={() => setShowPw((v) => !v)}                       // tap → toggle persistent
                  onMouseDown={(e) => { e.preventDefault(); setPeekPw(true); }} // press&hold (mouse)
                  onMouseUp={() => setPeekPw(false)}
                  onMouseLeave={() => setPeekPw(false)}
                  onTouchStart={() => { setPeekPw(true); try { pwRef.current?.focus({ preventScroll: true }); } catch {""} }} // press&hold (touch) fără preventDefault
                  onTouchEnd={() => setPeekPw(false)}
                  onTouchCancel={() => setPeekPw(false)}
                  title="Click pentru toggle, ține apăsat pentru a previzualiza"
                >
                  {(showPw || peekPw) ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              )}
            </div>

            {capsOn && <div id="caps-hint" className={styles.capsHint}>Atenție: CapsLock este activ.</div>}
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
              {err?.toLowerCase?.().includes("creează cont") && (
                inModal && onSwitchToRegister
                  ? <button type="button" className={styles.linkBtn} onClick={onSwitchToRegister}>Creează cont</button>
                  : !inModal && <button type="button" className={styles.linkBtn} onClick={() => setTab("register")}>Creează cont</button>
              )}
            </div>
          )}

          <button
            className={styles.primaryBtn}
            disabled={loading || !email || !password || cooldownSec > 0 || offline}
            aria-busy={loading ? "true" : "false"}
            title={cooldownSec > 0 ? `Așteaptă ${cooldownSec}s` : undefined}
          >
            {loading ? "Se conectează…" : cooldownSec > 0 ? `Așteaptă ${cooldownSec}s` : "Intră"}
          </button>

          <div className={styles.footerRow}>
            <a className={styles.link} href="/reset-parola">Ai uitat parola?</a>
            {inModal && onSwitchToRegister
              ? <button type="button" className={styles.linkBtn} onClick={onSwitchToRegister}>Creează cont</button>
              : !inModal && <button type="button" className={styles.linkBtn} onClick={() => setTab("register")}>Creează cont</button>}
          </div>
        </form>
      )}

      {!inModal && tab === "register" && (
        <div className={styles.card} role="tabpanel" aria-label="Înregistrare">
          <Register inModal={false} defaultAsVendor={false} />
        </div>
      )}
    </section>
  );
}
