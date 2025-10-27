import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./Register.module.css";

const OB_TICKET_PARAM = "obpf";
const OB_TICKET_PREFIX = "onboarding.ticket.";

/* ===================== Utils ===================== */
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

// Sugestii anti-typo pentru email
function suggestEmailTypos(value) {
  const v = value.trim().toLowerCase();
  if (!v.includes("@")) return { hint: "", suggestion: "" };
  const [user, domRaw = ""] = v.split("@");
  if (!user || !domRaw) return { hint: "", suggestion: "" };

  const fixes = [
    ["gmal.com","gmail.com"],["gmial.com","gmail.com"],["gnail.com","gmail.com"],
    ["gmail.con","gmail.com"],["gmail.co","gmail.com"],
    ["yaho.com","yahoo.com"],["yaaho.com","yahoo.com"],["yahoo.con","yahoo.com"],
    ["outllok.com","outlook.com"],["hotnail.com","hotmail.com"],
    [".con",".com"],[".c0m",".com"],[" .ro",".ro"],[".ro ",".ro"],
  ];
  let dom = domRaw;
  for (const [bad, good] of fixes) if (dom.endsWith(bad)) dom = dom.slice(0, dom.length - bad.length) + good;

  const common = ["gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","proton.me","mail.com","live.com","yahoo.ro","gmail.ro"];
  if (!dom.includes(".")) {
    const guess = common.find((d) => d.startsWith(dom)) || (dom === "gmail" ? "gmail.com" : "");
    if (guess) dom = guess;
  }
  const suggestion = `${user}@${dom}`;
  return suggestion !== v ? { hint: "Ai vrut să scrii:", suggestion } : { hint: "", suggestion: "" };
}

/* ===================== useLegalMeta (cache + backoff) ===================== */
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
  } catch { return null; }
}
function saveToStorage(key, data) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch {""}
}
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
      } catch {""}
      if (status === 429 || status === 503) {
        const jitter = Math.floor(Math.random() * 250);
        await new Promise(r => setTimeout(r, Math.max(retryAfterMs, delay) + jitter));
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

function useLegalMeta(types = []) {
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(!!types.length);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const depKey = useMemo(() => (types && types.length ? types.join(",") : ""), [types]);

  useEffect(() => {
    let active = true;
    if (!depKey) {
      setMeta({});
      setLoading(false);
      setError("");
      return;
    }

    const cached = memCache.get(depKey) || loadFromStorage(depKey);
    if (cached) { setMeta(cached); setLoading(false); setError(""); }

    (async () => {
      setLoading(true);
      setError("");
      try {
        abortRef.current?.abort?.();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        const arr = await fetchWithBackoff(`/api/legal?types=${encodeURIComponent(depKey)}`, { signal: ctrl.signal });
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

    return () => { active = false; abortRef.current?.abort?.(); };
  }, [depKey]);

  return { meta, loading, error };
}

/* ===================== Component ===================== */
export default function Register({ defaultAsVendor = false, inModal = false }) {
  const legalTypes = useMemo(() => ["tos", "privacy"], []);
  const { meta: legal, error: legalError } = useLegalMeta(legalTypes);

  // fields
  const [email, setEmail] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [emailSuggestion, setEmailSuggestion] = useState("");
  const [emailExists, setEmailExists] = useState(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [peekPw, setPeekPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [peekConfirm, setPeekConfirm] = useState(false);

  const [pwFocused, setPwFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [asVendor, setAsVendor] = useState(defaultAsVendor);

  // consents
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  // ui
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  // unverified UX
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendOk, setResendOk] = useState(false);

  const idemRef = useRef(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  const emailAbortRef = useRef(null);
  const liveRef = useRef(null);
  const pwRef = useRef(null);
  const confirmRef = useRef(null);

  // password score
  const score = useMemo(() => {
    const len = password.length >= 8 ? 1 : 0;
    const lower = /[a-z]/.test(password) ? 1 : 0;
    const upper = /[A-Z]/.test(password) ? 1 : 0;
    const digit = /\d/.test(password) ? 1 : 0;
    const symbol = /[^A-Za-z0-9]/.test(password) ? 1 : 0;
    return len + lower + upper + digit + symbol; // 0..5
  }, [password]);

  const pwMatches = confirm.length > 0 && password === confirm;
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    (emailExists !== true) &&
    password.length >= 8 &&
    score >= 3 &&
    pwMatches &&
    tosAccepted &&
    privacyAcknowledged;

  // online/offline
  useEffect(() => {
    const up = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // email: sugestii + exists (debounced)
  useEffect(() => {
    const { hint, suggestion } = suggestEmailTypos(email);
    setEmailHint(hint);
    setEmailSuggestion(suggestion);

    try { emailAbortRef.current?.abort?.(); } catch {""}
    const ctrl = new AbortController();
    emailAbortRef.current = ctrl;

    const normalized = email.trim().toLowerCase();
    if (!normalized) { setEmailExists(null); return; }

    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/auth/exists?email=${encodeURIComponent(normalized)}`, { signal: ctrl.signal });
        setEmailExists(!!r?.exists);
      } catch { setEmailExists(null); }
    }, 450);

    return () => { clearTimeout(t); ctrl.abort(); };
  }, [email]);

  function applyEmailSuggestion() {
    if (emailSuggestion) setEmail(emailSuggestion);
    setEmailHint("");
  }

  function handlePwKey(ev) {
    try { setCapsOn(!!ev.getModifierState?.("CapsLock")); } catch {""}
    if ((ev.altKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      setShowPw((v) => !v);
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      try { (ev.target?.form || document.querySelector("form"))?.requestSubmit?.(); } catch {""}
    }
    if (ev.key === "Escape") setErr("");
  }
  function handleConfirmKey(ev) {
    try { setCapsOn(!!ev.getModifierState?.("CapsLock")); } catch {""}
    if ((ev.altKey || ev.metaKey) && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      setShowConfirm((v) => !v);
    }
    if (ev.key === "Escape") setErr("");
  }

  async function handleResend() {
    if (!unverifiedEmail) return;
    try {
      setResendBusy(true);
      await api("/api/auth/resend-verification", {
        method: "POST",
        body: { email: unverifiedEmail },
      });
      setResendOk(true);
    } catch {""}
    finally { setResendBusy(false); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    if (offline) { setErr("Ești offline. Verifică conexiunea la internet."); return; }

    setErr("");
    setResendOk(false);
    setUnverifiedEmail("");
    setLoading(true);
    try {
      const consents = [];
      if (tosAccepted && legal?.tos) consents.push({ type: "tos", version: legal.tos.version, checksum: legal.tos.checksum });
      if (privacyAcknowledged && legal?.privacy) consents.push({ type: "privacy_ack", version: legal.privacy.version, checksum: legal.privacy.checksum });
      if (marketingOptIn) consents.push({ type: "marketing_email_optin", version: "1.0.0" });

      const body = {
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        name: fullName || undefined,
        asVendor,
        consents,
      };

      const res = await api("/api/auth/signup", {
        method: "POST",
        headers: { "Idempotency-Key": idemRef.current },
        body,
      });

      // ✉️ email verification flow
      if (res?.status === "pending_verification") {
        try { sessionStorage.setItem("onboarding.intent", asVendor ? "vendor" : ""); } catch {""}
        const next = res?.next || `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`;
        window.location.assign(next);
        return;
      }

      // fallback (dacă backendul n-a fost actualizat încă)
      if (asVendor) {
        try {
          const ticket = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
          const payload = { ts: Date.now(), intent: "vendor" };
          sessionStorage.setItem(OB_TICKET_PREFIX + ticket, JSON.stringify(payload));
          const next = res?.next || "/onboarding";
          window.location.assign(appendTicket(next, ticket));
          return;
        } catch {""}
      }

      window.location.assign(res?.next || (asVendor ? "/onboarding" : "/desktop"));
    } catch (e2) {
      console.error("Register error:", e2);
      const msg =
        (e2?.status === 409 && (e2?.data?.error === "email_exists_unverified"
          ? "Există deja un cont cu acest email, dar nu este confirmat."
          : "Acest email este deja folosit.")) ||
        e2?.data?.message ||
        e2?.message ||
        "Înregistrarea a eșuat.";
      setErr(msg);
      setUnverifiedEmail(e2?.data?.error === "email_exists_unverified" ? (email.trim().toLowerCase()) : "");
      try {
        liveRef.current?.focus?.();
        if (e2?.status === 409) {
          document.getElementById("reg-email")?.focus();
        } else {
          pwRef.current?.focus();
          pwRef.current?.select?.();
        }
      } catch {""}
    } finally {
      setLoading(false);
    }
  }

  const pwType = (showPw || peekPw) ? "text" : "password";
  const confirmType = (showConfirm || peekConfirm) ? "text" : "password";
  const showPwToggle = pwFocused || password.length > 0;
  const showConfirmToggle = confirmFocused || confirm.length > 0;

  const form = (
    <form className={styles.body} onSubmit={onSubmit} noValidate>
      <div ref={liveRef} tabIndex={-1} aria-live="polite" aria-atomic="true" className={styles.srOnly} />
      {offline && <div className={styles.error} role="status">Ești offline — verifică rețeaua.</div>}
      {legalError && <div className={styles.legalNotice} role="status">{legalError}</div>}

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={asVendor}
          onChange={(e)=> {
            setAsVendor(e.target.checked);
            try { sessionStorage.setItem("onboarding.intent", e.target.checked ? "vendor" : ""); } catch {""}
          }}
        />
        Înscrie-mă ca partener Artfest (ofer servicii/vând produse pe platformă)
      </label>

      <div className={styles.nameRow}>
        <label className={styles.nameCol}>
          <span className={styles.srOnly}>Prenume</span>
          <input
            className={styles.field}
            value={firstName}
            onChange={(e)=>setFirstName(e.target.value)}
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
            onChange={(e)=>setLastName(e.target.value)}
            placeholder="Nume"
            autoComplete="family-name"
            required
          />
        </label>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.srOnly} htmlFor="reg-email">Email</label>
        <input
          id="reg-email"
          className={styles.field}
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
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
            {emailExists === true && <small className={styles.error} role="alert">Acest email este deja folosit.</small>}
          </div>
        )}
      </div>

      <div>
        <div className={`${styles.inputGroup} ${showPwToggle ? styles.hasToggle : ""}`}>
          <input
            ref={pwRef}
            className={styles.field}
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
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
              aria-label={(showPw || peekPw) ? "Ascunde parola" : "Afișează parola"}
              aria-pressed={showPw || peekPw}
              onClick={() => setShowPw((v)=>!v)}
              onMouseDown={(e)=>{ e.preventDefault(); setPeekPw(true); }}
              onMouseUp={()=>setPeekPw(false)}
              onMouseLeave={()=>setPeekPw(false)}
              onTouchStart={()=>{ setPeekPw(true); try { pwRef.current?.focus({ preventScroll: true }); } catch {""} }}
              onTouchEnd={()=>setPeekPw(false)}
              onTouchCancel={()=>setPeekPw(false)}
            >
              {(showPw || peekPw) ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          )}
        </div>

        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={score}>
          <div className={styles.bar} style={{ width: `${(score/5)*100}%` }} />
        </div>
        <small id="pw-hint" className={styles.hint}>
          Recomandat: minim 8 caractere și o combinație de litere mari/mici, cifre și simboluri.
        </small>
        {capsOn && pwFocused && <div className={styles.capsHint}>Atenție: CapsLock este activ.</div>}
      </div>

      <div>
        <div className={`${styles.inputGroup} ${showConfirmToggle ? styles.hasToggle : ""}`}>
          <input
            ref={confirmRef}
            className={styles.field}
            value={confirm}
            onChange={(e)=>setConfirm(e.target.value)}
            onKeyUp={handleConfirmKey}
            onKeyDown={handleConfirmKey}
            onFocus={() => setConfirmFocused(true)}
            onBlur={() => setConfirmFocused(false)}
            type={confirmType}
            placeholder="Confirmă parola"
            required
            autoComplete="new-password"
            aria-invalid={confirm.length > 0 && !pwMatches}
            aria-label="Confirmă parola"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {showConfirmToggle && (
            <button
              type="button"
              className={styles.togglePw}
              aria-label={(showConfirm || peekConfirm) ? "Ascunde confirmarea" : "Afișează confirmarea"}
              aria-pressed={showConfirm || peekConfirm}
              onClick={() => setShowConfirm((v)=>!v)}
              onMouseDown={(e)=>{ e.preventDefault(); setPeekConfirm(true); }}
              onMouseUp={()=>setPeekConfirm(false)}
              onMouseLeave={()=>setPeekConfirm(false)}
              onTouchStart={()=>{ setPeekConfirm(true); try { confirmRef.current?.focus({ preventScroll: true }); } catch {""} }}
              onTouchEnd={()=>setPeekConfirm(false)}
              onTouchCancel={()=>setPeekConfirm(false)}
            >
              {(showConfirm || peekConfirm) ? <EyeOff size={18}/> : <Eye size={18}/>}
            </button>
          )}
        </div>
        {!pwMatches && confirm.length > 0 && (
          <div className={styles.error} role="alert">Parolele nu coincid.</div>
        )}
        {capsOn && confirmFocused && <div className={styles.capsHint}>Atenție: CapsLock este activ.</div>}
      </div>

      {/* LEGAL */}
      <div className={styles.legalGroup}>
        <label className={styles.legalRow}>
          <input type="checkbox" checked={tosAccepted} onChange={(e)=>setTosAccepted(e.target.checked)} required />
          <span>
            Accept{" "}
            <a className={styles.legalLink} href={"/termenii-si-conditiile"} target="_blank" rel="noopener noreferrer">
              Termenii și Condițiile
            </a>.
          </span>
        </label>

        <label className={styles.legalRow}>
          <input type="checkbox" checked={privacyAcknowledged} onChange={(e)=>setPrivacyAcknowledged(e.target.checked)} required />
          <span>
            Confirm că am citit{" "}
            <a className={styles.legalLink} href={"/confidentialitate"} target="_blank" rel="noopener noreferrer">
              Politica de confidențialitate
            </a>.
          </span>
        </label>

        <label className={styles.legalRow}>
          <input type="checkbox" checked={marketingOptIn} onChange={(e)=>setMarketingOptIn(e.target.checked)} />
          <span className={styles.legalMuted}>Accept să primesc noutăți și oferte prin email/SMS (opțional).</span>
        </label>
      </div>

      <button className={styles.primaryBtn} disabled={loading || !canSubmit} aria-busy={loading ? "true" : "false"}>
        {loading ? "Se înregistrează…" : "Creează cont"}
      </button>

      {err && <div className={styles.error} role="alert">{err}</div>}

      {unverifiedEmail && (
        <div className={styles.info} role="status" style={{marginTop:8}}>
          <div style={{marginBottom:8}}>
            Nu găsești emailul de confirmare? Îl putem retrimite către <strong>{unverifiedEmail}</strong>.
          </div>
          {!resendOk ? (
            <button type="button" className={styles.primaryBtn} onClick={handleResend} disabled={resendBusy}>
              {resendBusy ? "Se retrimite…" : "Trimite din nou emailul de confirmare"}
            </button>
          ) : (
            <div>Gata! Verifică inboxul (și Spam/Promo).</div>
          )}
        </div>
      )}
    </form>
  );

  if (inModal) return form;

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
