import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import styles from "./Login/Login.module.css";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("token") || "";
    setToken(t);
  }, []);

  const minLen = 6;
  const lengthOk = pwd.length >= minLen;
  const matchOk = pwd && pwd2 && pwd === pwd2;
  const canSubmit = useMemo(() => !!token && lengthOk && matchOk && !loading, [token, lengthOk, matchOk, loading]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    if (!lengthOk) return setErr(`Parola trebuie să aibă cel puțin ${minLen} caractere.`);
    if (!matchOk) return setErr("Parolele nu se potrivesc.");

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
        (e?.data?.error === "same_as_current" && "Parola nouă nu poate fi identică cu parola curentă.") ||
        (e?.data?.error === "password_reused" && "Nu poți reutiliza una dintre ultimele parole.") ||
        e?.message ||
        "Nu am putut reseta parola.";
      setErr(serverMsg);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <section className={styles.wrap}>
        <div className={styles.card}>
          <p>Link invalid. Cere un nou link de resetare.</p>
          <a className={styles.link} href="/reset-parola">Înapoi</a>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
  <h1 className={styles.title}>Setează o parolă nouă</h1>
  <p className={styles.subtitle}>
    Alege o parolă nouă, diferită de cea actuală și de parolele folosite anterior.
  </p>
</header>


      {ok ? (
        <div className={styles.card}>
          <p>✅ Parola a fost resetată cu succes.</p>
          <a className={styles.link} href="/autentificare">Autentifică-te</a>
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
              placeholder="••••••••"
              minLength={minLen}
              required
            />
            {!lengthOk && pwd.length > 0 && <small>Minim {minLen} caractere.</small>}
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
              <div className={styles.error} role="alert">Parolele nu se potrivesc.</div>
            )}
          </div>

          {err && <div className={styles.error} role="alert">{err}</div>}

          <button className={styles.primaryBtn} disabled={!canSubmit}>
            {loading ? "Se salvează…" : "Resetează parola"}
          </button>
        </form>
      )}
    </section>
  );
}
