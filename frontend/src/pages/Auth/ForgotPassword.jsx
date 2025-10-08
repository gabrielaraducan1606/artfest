import { useState } from "react";
import { api } from "../../lib/api";
import styles from "./Login/Login.module.css"; // reutilizăm card-ul

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email } });
      setSent(true);
    } catch (e) {
      setErr(e?.message || "Nu am putut trimite emailul acum");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Recuperare parolă</h1>
        <p className={styles.subtitle}>Introdu adresa ta de email.</p>
      </header>

      {sent ? (
        <div className={styles.card}>
          <p>✅ Dacă adresa există, ți-am trimis un link de resetare.</p>
          <a className={styles.link} href="/">Înapoi la prima pagină</a>
        </div>
      ) : (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              id="email"
              className={styles.input}
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              placeholder="nume@exemplu.ro"
              required
            />
          </div>

          {err && <div className={styles.error} role="alert">{err}</div>}

          <button className={styles.primaryBtn} disabled={loading}>
            {loading ? "Se trimite…" : "Trimite link-ul"}
          </button>
        </form>
      )}
    </section>
  );
}
