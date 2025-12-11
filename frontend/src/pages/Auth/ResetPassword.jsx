// src/pages/ResetPassword.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import styles from "./Login/Login.module.css";

export default function ResetPassword() {
  const [token, setToken] = useState("");

  // --- state resetare parolă (cu token) ---
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // --- state forgot password (fără token) ---
  const [email, setEmail] = useState("");
  const [fpOk, setFpOk] = useState(false);
  const [fpErr, setFpErr] = useState("");
  const [fpLoading, setFpLoading] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("token") || "";
    setToken(t);
  }, []);

  const minLen = 8;

  const lengthOk = pwd.length >= minLen;
  const matchOk = pwd && pwd2 && pwd === pwd2;

  // scor de complexitate 0..5 (similar cu Register / Settings)
  const score = useMemo(() => {
    const len = pwd.length >= minLen ? 1 : 0;
    const lower = /[a-z]/.test(pwd) ? 1 : 0;
    const upper = /[A-Z]/.test(pwd) ? 1 : 0;
    const digit = /\d/.test(pwd) ? 1 : 0;
    const symbol = /[^A-Za-z0-9]/.test(pwd) ? 1 : 0;
    return len + lower + upper + digit + symbol;
  }, [pwd, minLen]);

  const [capsOn, setCapsOn] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);

  const canSubmit = useMemo(
    () => !!token && lengthOk && matchOk && score >= 3 && !loading,
    [token, lengthOk, matchOk, score, loading]
  );

  function handlePwKey(ev) {
    try {
      setCapsOn(!!ev.getModifierState?.("CapsLock"));
    } catch {
      // ignorăm
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    if (!lengthOk) {
      return setErr(`Parola trebuie să aibă cel puțin ${minLen} caractere.`);
    }
    if (!matchOk) {
      return setErr("Parolele nu se potrivesc.");
    }
    if (score < 3) {
      return setErr(
        "Parola este prea slabă. Folosește o combinație de litere mari/mici, cifre și simboluri."
      );
    }

    setLoading(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, newPassword: pwd },
      });
      setOk(true);
    } catch (e) {
      const serverMsg =
        e?.data?.message ||
        (e?.data?.error === "same_as_current" &&
          "Parola nouă nu poate fi identică cu parola curentă.") ||
        (e?.data?.error === "password_reused" &&
          "Nu poți reutiliza una dintre ultimele parole.") ||
        (e?.data?.error === "weak_password" &&
          `Parola este prea slabă sau prea scurtă. Trebuie să aibă cel puțin ${minLen} caractere.`) ||
        e?.message ||
        "Nu am putut reseta parola.";
      setErr(serverMsg);
    } finally {
      setLoading(false);
    }
  }

  // ====== FORGOT PASSWORD (fără token) ======
  const canAskLink = email.trim().length > 0 && !fpLoading;

  async function onForgotSubmit(e) {
    e.preventDefault();
    setFpErr("");
    setFpOk(false);

    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@") || !normalized.includes(".")) {
      setFpErr("Te rugăm să introduci un email valid.");
      return;
    }

    setFpLoading(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email: normalized },
      });
      // backend răspunde generic
      setFpOk(true);
    } catch (e) {
      const msg =
        e?.data?.message ||
        (e?.data?.error === "too_many_requests" &&
          (e?.data?.message ||
            "Ai cerut recent un link de resetare. Mai încearcă în câteva minute.")) ||
        e?.message ||
        "Nu am putut trimite linkul de resetare.";
      setFpErr(msg);
    } finally {
      setFpLoading(false);
    }
  }

  // ================== RENDER ==================

  // 1) NU avem token => ecran „Am uitat parola” (cerere link)
  if (!token) {
    return (
      <section className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Am uitat parola</h1>
          <p className={styles.subtitle}>
            Introdu adresa ta de email și îți vom trimite un link pentru a-ți
            reseta parola.
          </p>
        </header>

        <form className={styles.card} onSubmit={onForgotSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Email</label>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="exemplu@domeniu.ro"
              required
            />
          </div>

          {fpErr && (
            <div className={styles.error} role="alert">
              {fpErr}
            </div>
          )}

          {fpOk && (
            <div className={styles.success}>
              ✅ Dacă există un cont cu acest email, a fost trimis un link de
              resetare.
            </div>
          )}

          <button className={styles.primaryBtn} disabled={!canAskLink}>
            {fpLoading ? "Se trimite…" : "Trimite link de resetare"}
          </button>

          <p style={{ marginTop: 12, fontSize: 14 }}>
            Îți amintești parola?{" "}
            <a className={styles.link} href="/autentificare">
              Mergi la autentificare
            </a>
          </p>
        </form>
      </section>
    );
  }

  // 2) Avem token => ecran „Setează o parolă nouă”
  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Setează o parolă nouă</h1>
        <p className={styles.subtitle}>
          Alege o parolă nouă, diferită de cea actuală și de parolele folosite
          anterior.
        </p>
      </header>

      {ok ? (
        <div className={styles.card}>
          <p>✅ Parola a fost resetată cu succes.</p>
          <a className={styles.link} href="/autentificare">
            Autentifică-te
          </a>
        </div>
      ) : (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Parolă nouă</label>
            <input
              className={styles.input}
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyUp={handlePwKey}
              onKeyDown={handlePwKey}
              onFocus={() => setPwFocused(true)}
              onBlur={() => setPwFocused(false)}
              placeholder="••••••••"
              minLength={minLen}
              required
            />
            {!lengthOk && pwd.length > 0 && (
              <small>Minim {minLen} caractere.</small>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Confirmă parola</label>
            <input
              className={styles.input}
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              placeholder="••••••••"
              minLength={minLen}
              required
            />
            {pwd2.length > 0 && !matchOk && (
              <div className={styles.error} role="alert">
                Parolele nu se potrivesc.
              </div>
            )}
          </div>

          {pwd && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
              Complexitate parolă:{" "}
              {score <= 2 ? "slabă" : score === 3 ? "medie" : "puternică"}.
              Recomandat: litere mari/mici, cifre și simboluri.
            </div>
          )}

          {capsOn && pwFocused && (
            <div className={styles.error} role="status">
              CapsLock este activ – ai grijă la literele mari.
            </div>
          )}

          {err && (
            <div className={styles.error} role="alert">
              {err}
            </div>
          )}

          <button className={styles.primaryBtn} disabled={!canSubmit}>
            {loading ? "Se salvează…" : "Resetează parola"}
          </button>
        </form>
      )}
    </section>
  );
}
