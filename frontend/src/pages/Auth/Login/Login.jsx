import { useState } from "react";
import { api } from "../../../lib/api";
import styles from "./Login.module.css";

/**
 * Folosește același component în pagină sau în modal.
 */
export default function Login({
  inModal = false,
  onLoggedIn,
  redirectTo = "/desktop",
  onSwitchToRegister,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      onLoggedIn?.(user);
      window.location.href = redirectTo;
    } catch (e) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className={`${styles.wrap} ${inModal ? styles.wrapModal : ""}`}
      aria-labelledby={inModal ? undefined : "login-title"}
    >
      {!inModal && (
        <header className={styles.header}>
          <h1 id="login-title" className={styles.title}>Autentificare</h1>
          <p className={styles.subtitle}>Intră în cont pentru a continua.</p>
        </header>
      )}

      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <div className={styles.fieldGroup}>
          <label htmlFor="email" className={styles.label}>Email</label>
          <input
            id="email"
            name="email"
            autoComplete="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nume@exemplu.ro"
            type="email"
            required
          />
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor="password" className={styles.label}>Parolă</label>
          <input
            id="password"
            name="password"
            autoComplete="current-password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            type="password"
            required
            minLength={6}
          />
        </div>

        {err && (
          <div className={styles.error} role="alert">
            {err}
          </div>
        )}

        <button className={styles.primaryBtn} disabled={loading}>
          {loading ? "Se conectează…" : "Intră"}
        </button>

        <div className={styles.footerRow}>
          <a className={styles.link} href="/reset-parola">Ai uitat parola?</a>
          {onSwitchToRegister && (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={onSwitchToRegister}
            >
              Creează cont
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
