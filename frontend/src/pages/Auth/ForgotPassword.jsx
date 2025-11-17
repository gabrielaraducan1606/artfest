// src/pages/ForgotPassword.jsx
import { useEffect, useMemo, useState, useId } from "react";
import { api } from "../../lib/api";
import styles from "./Login/Login.module.css";

export default function ForgotPassword() {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailExists, setEmailExists] = useState(null); // null necunoscut, true/false
  const [checking, setChecking] = useState(false);

  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const emailValid = useMemo(() => /\S+@\S+\.\S+/.test(email), [email]);

  useEffect(() => {
    setErr("");
    if (!emailValid) {
      setEmailExists(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setChecking(true);
        const res = await api(`/api/auth/exists?email=${encodeURIComponent(email)}`);
        setEmailExists(!!res?.exists);
      } catch {
        setEmailExists(null);
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [email, emailValid]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!emailValid) return setErr("Te rugăm introdu un email valid.");
    if (emailExists === false) return setErr("Nu există niciun cont cu acest email.");
    setLoading(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (e) {
      if (e?.status === 429 || e?.data?.error === "too_many_requests") {
        setErr(e?.data?.message || "Ai cerut recent un link. Mai încearcă în câteva minute.");
      } else {
        setErr(e?.message || "Nu am putut trimite emailul acum");
      }
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = emailValid && !loading && !checking && emailExists !== false;

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Recuperare parolă</h1>
        <p className={styles.subtitle}>Introdu adresa ta de email.</p>
      </header>

      {sent ? (
        <div className={styles.card}>
          <p>✅ Dacă adresa de email este înregistrată în sistemul nostru, un mesaj cu instrucțiuni de resetare a parolei a fost trimis către tine.</p>
          <a className={styles.link} href="/">Înapoi la prima pagină</a>
        </div>
      ) : (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor={emailId} className={styles.label}>Email</label>
            <input
              id={emailId}
              name="email"
              className={styles.input}
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              placeholder="nume@exemplu.ro"
              required
              aria-invalid={emailTouched && !emailValid}
              aria-describedby="email-help"
            />
            {email && checking && <small id="email-help">Se verifică…</small>}
            {emailTouched && email && emailValid && emailExists === false && (
              <div className={styles.error} role="alert">Nu există cont cu acest email.</div>
            )}
          </div>

          {err && <div className={styles.error} role="alert">{err}</div>}

          <button className={styles.primaryBtn} disabled={!canSubmit}>
            {loading ? "Se trimite…" : "Trimite link-ul"}
          </button>
        </form>
      )}
    </section>
  );
}
