import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import Register from "../Register/Register";
import styles from "./Login.module.css";

/**
 * Un singur component:
 *  - în PAGINĂ (inModal = false): afișează taburi Login / Înregistrare și randă conținutul aferent.
 *  - în MODAL (inModal = true): NU afișează taburi; doar formularul Login.
 *      Butonul "Creează cont" din footer apelează onSwitchToRegister (navbar comută tabul extern).
 */
export default function Login({
  inModal = false,
  onLoggedIn,
  redirectTo = "/desktop",
  onSwitchToRegister, // folosit doar când inModal=true (modalul din navbar controlează taburile lui)
}) {
  // === Tab (doar în pagina standalone)
  const [tab, setTab] = useState("login");

  useEffect(() => {
    if (inModal) return; // în modal nu gestionăm taburi interne
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("auth");
      setTab(t === "register" ? "register" : "login");
    } catch {/* no-op */}
  }, [inModal]);

  // === State formular login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const { user } = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      onLoggedIn?.(user);
      window.location.assign(redirectTo);
    } catch (e2) {
      setErr(e2?.message || "Autentificarea a eșuat.");
    } finally {
      setLoading(false);
    }
  }

  // === Helpers
  const showTabs = !inModal;

  return (
    <section
      className={`${styles.wrap} ${inModal ? styles.wrapModal : ""}`}
      aria-labelledby={inModal ? undefined : "login-title"}
    >
      {/* Header — doar în pagină */}
      {!inModal && (
        <header className={styles.header}>
          <h1 id="login-title" className={styles.title}>
            Conectează-te sau creează cont
          </h1>
          <p className={styles.subtitle}>Intră în cont pentru a continua.</p>
        </header>
      )}

      {/* Tab bar — identic vizual cu cel din modal navbar, dar intern aici */}
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

      {/* === Conținut taburi === */}

      {/* LOGIN (în modal: singurul randat) */}
      {(inModal || tab === "login") && (
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
              inputMode="email"
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

            {/* În MODAL, lăsăm navbar-ul să comute tabul extern via prop */}
            {inModal && onSwitchToRegister ? (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={onSwitchToRegister}
              >
                Creează cont
              </button>
            ) : (
              // În pagină, comutăm tabul intern
              !inModal && (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setTab("register")}
                >
                  Creează cont
                </button>
              )
            )}
          </div>
        </form>
      )}

      {/* REGISTER — doar în pagină (în modal e controlat de Navbar) */}
      {!inModal && tab === "register" && (
        <div className={styles.card} role="tabpanel" aria-label="Înregistrare">
          <Register inModal={false} defaultAsVendor={false} />
        </div>
      )}
    </section>
  );
}
