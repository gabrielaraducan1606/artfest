import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./Register.module.css";

const OB_TICKET_PARAM = "obpf";
const OB_TICKET_PREFIX = "onboarding.ticket.";

// --- utils ---
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

// --- hook: legal meta (tos, privacy) ---
function useLegalMeta(types = []) {
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(!!types.length);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!types.length) return;
      setLoading(true);
      setError("");
      try {
        const qs = encodeURIComponent(types.join(","));
        // ✅ folosim wrapperul api() — respectă VITE_API_URL în dev/prod
        const arr = await api(`/api/legal?types=${qs}`);
        if (!active) return;
        const map = {};
        for (const d of arr || []) map[d.type] = d;
        setMeta(map);
      } catch (e) {
        console.error("Legal meta error:", e);
        setError("Nu am putut încărca informațiile legale.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.join(",")]);

  return { meta, loading, error };
}

export default function Register({ defaultAsVendor = false, inModal = false }) {
  // fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [asVendor, setAsVendor] = useState(defaultAsVendor);
  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");

  // consents
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  // ui
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // legal meta
  const { meta: legal /*, loading: legalLoading, error: legalError */ } = useLegalMeta(["tos", "privacy"]);

  const idemRef = useRef(
    globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  );

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
    password.length >= 8 &&
    score >= 3 &&
    pwMatches &&
    tosAccepted &&
    privacyAcknowledged &&
    (!asVendor || displayName.trim());

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit || loading) return;

    setErr("");
    setLoading(true);
    try {
      // assemble consents for audit
      const consents = [];
      if (tosAccepted && legal?.tos) {
        consents.push({ type: "tos", version: legal.tos.version, checksum: legal.tos.checksum });
      }
      if (privacyAcknowledged && legal?.privacy) {
        consents.push({ type: "privacy_ack", version: legal.privacy.version, checksum: legal.privacy.checksum });
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
        displayName: displayName.trim() || undefined,
        city: city.trim() || undefined,
        consents,
      };

      const res = await api("/api/auth/signup", {
        method: "POST",
        headers: { "Idempotency-Key": idemRef.current },
        body,
      });

      if (asVendor) {
        try {
          const ticket = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
          const payload = { displayName: (displayName || "").trim(), city: (city || "").trim(), ts: Date.now() };
          sessionStorage.setItem(OB_TICKET_PREFIX + ticket, JSON.stringify(payload));
          const next = res?.next || "/onboarding";
          window.location.assign(appendTicket(next, ticket));
          return;
        } catch { /* noop */ }
      }

      window.location.assign(res?.next || (asVendor ? "/onboarding" : "/desktop"));
    } catch (e2) {
      console.error("Register error:", e2);
      const msg =
        (e2?.status === 409 && "Acest email este deja folosit.") ||
        e2?.data?.message ||
        e2?.message ||
        "Înregistrarea a eșuat.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  const form = (
    <form className={styles.body} onSubmit={onSubmit} noValidate>
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

      <input
        className={styles.field}
        value={email}
        onChange={(e)=>setEmail(e.target.value)}
        type="email"
        placeholder="Email"
        required
        autoComplete="email"
        aria-label="Email"
      />

      <div>
        <div className={styles.inputGroup}>
          <input
            className={styles.field}
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            type="password"
            placeholder="Parolă (min 8)"
            required
            autoComplete="new-password"
            aria-describedby="pw-hint"
            aria-label="Parolă"
          />
        </div>

        <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={score}>
          <div className={styles.bar} style={{ width: `${(score/5)*100}%` }} />
        </div>
        <small id="pw-hint" className={styles.hint}>
          Recomandat: minim 8 caractere și o combinație de litere mari/mici, cifre și simboluri.
        </small>
      </div>

      <div>
        <div className={styles.inputGroup}>
          <input
            className={styles.field}
            value={confirm}
            onChange={(e)=>setConfirm(e.target.value)}
            type="password"
            placeholder="Confirmă parola"
            required
            autoComplete="new-password"
            aria-invalid={confirm.length > 0 && !pwMatches}
            aria-label="Confirmă parola"
          />
        </div>
        {!pwMatches && confirm.length > 0 && (
          <div className={styles.error} role="alert">Parolele nu coincid.</div>
        )}
      </div>

      <label className={styles.checkRow}>
        <input type="checkbox" checked={asVendor} onChange={(e)=>setAsVendor(e.target.checked)} />
        Înscrie-mă ca partener Artfest (ofer servicii/vând produse pe platformă)
      </label>

      {asVendor && (
        <div className={styles.vendorBox}>
          <input
            className={styles.field}
            value={displayName}
            onChange={(e)=>setDisplayName(e.target.value)}
            placeholder="Nume afișat (firmă/brand)"
            required={asVendor}
            autoComplete="organization"
            aria-label="Nume afișat"
          />
          <input
            className={styles.field}
            value={city}
            onChange={(e)=>setCity(e.target.value)}
            placeholder="Oraș (ex: București)"
            autoComplete="address-level2"
            aria-label="Oraș"
          />
        </div>
      )}

      {/* LEGAL */}
      <div className={styles.legalGroup}>
        <label className={styles.legalRow}>
          <input
            type="checkbox"
            checked={tosAccepted}
            onChange={(e)=>setTosAccepted(e.target.checked)}
            required
          />
          <span>
            Accept{" "}
            <a className={styles.legalLink}
               href={legal?.tos?.url || "/termenii-si-conditiile"}
               target="_blank" rel="noopener noreferrer">
              Termenii și Condițiile
              {legal?.tos?.version ? ` (v${legal.tos.version})` : ""}
            </a>.
          </span>
        </label>

        <label className={styles.legalRow}>
          <input
            type="checkbox"
            checked={privacyAcknowledged}
            onChange={(e)=>setPrivacyAcknowledged(e.target.checked)}
            required
          />
          <span>
            Confirm că am citit{" "}
            <a className={styles.legalLink}
               href={legal?.privacy?.url || "/confidentialitate"}
               target="_blank" rel="noopener noreferrer">
              Politica de confidențialitate
              {legal?.privacy?.version ? ` (v${legal.privacy.version})` : ""}
            </a>{" "}
            și înțeleg că datele necesare vor fi transmise curierilor pentru livrare/retur.
          </span>
        </label>

        <label className={styles.legalRow}>
          <input
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e)=>setMarketingOptIn(e.target.checked)}
          />
          <span className={styles.legalMuted}>
            Accept să primesc noutăți și oferte prin email/SMS (opțional).
          </span>
        </label>
      </div>

      <button className={styles.primaryBtn} disabled={loading || !canSubmit}>
        {loading ? "Se înregistrează…" : "Creează cont"}
      </button>

      {err && <div className={styles.error} role="alert">{err}</div>}
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
