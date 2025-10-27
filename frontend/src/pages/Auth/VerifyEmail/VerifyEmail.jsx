import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./VerifyEmail.module.css";

export default function VerifyEmail() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const email = params.get("email") || "";

  const [state, setState] = useState(token ? "verifying" : "waiting");
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) return;
      try {
        await api("/api/auth/verify-email", { method: "POST", body: { token } });
        if (!active) return;
        const intent = sessionStorage.getItem("onboarding.intent");
        window.location.assign(intent === "vendor" ? "/onboarding" : "/desktop");
      } catch (e) {
        if (!active) return;
        setState("waiting");
        setErr(e?.data?.message || "Link invalid sau expirat. Poți cere un link nou mai jos.");
      }
    })();
    return () => { active = false; };
  }, [token]);

  async function resend() {
    try {
      setErr("");
      setState("resending");
      await api("/api/auth/resend-verification", { method: "POST", body: { email } });
      setState("resent");
    } catch (e) {
      setErr(e?.data?.message || "Nu am putut retrimite emailul.");
      setState("waiting");
    }
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        {state === "verifying" ? (
          <h2>Se verifică adresa de email…</h2>
        ) : (
          <>
            <h2>Verifică-ți emailul</h2>
            <p>Ți-am trimis un link de activare la <strong>{email || "adresa ta de email"}</strong>.</p>
            <ol className={styles.list}>
              <li>Deschide căsuța poștală (verifică și Spam/Promotions).</li>
              <li>Apasă pe <em>„Activează contul”</em> din email.</li>
            </ol>
            {err && <div className={styles.error}>{err}</div>}
            <button className={styles.btn} onClick={resend} disabled={state === "resending"}>
              {state === "resending" ? "Se retrimite…" : "Trimite din nou emailul"}
            </button>
            {state === "resent" && <div className={styles.info}>Gata! Verifică-ți din nou inbox-ul.</div>}
          </>
        )}
      </div>
    </section>
  );
}
