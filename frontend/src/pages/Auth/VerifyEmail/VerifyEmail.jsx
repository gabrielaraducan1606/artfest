import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./VerifyEmail.module.css";

export default function VerifyEmail() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const email = params.get("email") || "";
  const urlIntent = (params.get("intent") || "").toLowerCase(); // "vendor" | ""

  const [code, setCode] = useState("");
  const [state, setState] = useState("waiting"); // waiting | verifying | resending | resent
  const [err, setErr] = useState("");

  const isBusy = state === "verifying" || state === "resending";
  const canVerify = /^\d{6}$/.test(code) && state === "waiting";

  async function verify() {
    if (!email) {
      setErr("Lipsește adresa de email din URL. Revino la pagina de înregistrare și încearcă din nou.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setErr("Introdu un cod valid (6 cifre).");
      return;
    }

    try {
      setErr("");
      setState("verifying");

      const r = await api("/api/auth/verify-email", {
        method: "POST",
        body: { email, code },
      });

      const intent = (sessionStorage.getItem("onboarding.intent") || urlIntent || "").toLowerCase();
      const next = r?.next || (intent === "vendor" ? "/onboarding" : "/desktop");

      window.location.assign(next);
    } catch (e) {
      setState("waiting");
      setErr(e?.data?.message || "Cod invalid sau expirat. Poți cere unul nou mai jos.");
    }
  }

  async function resend() {
    if (!email) {
      setErr("Lipsește adresa de email din URL. Revino la pagina de înregistrare și încearcă din nou.");
      return;
    }

    try {
      setErr("");
      setState("resending");
      await api("/api/auth/resend-verification", { method: "POST", body: { email } });
      setState("resent");
    } catch (e) {
      setErr(e?.data?.message || "Nu am putut retrimite codul.");
      setState("waiting");
    }
  }

  // Auto verify când ai 6 cifre
  useEffect(() => {
    if (state !== "waiting") return;
    if (/^\d{6}$/.test(code)) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state]);

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <h2>Confirmă emailul</h2>

        <p>
          Ți-am trimis un cod de 6 cifre la <strong>{email || "adresa ta de email"}</strong>.
        </p>

        <div className={styles.field}>
          <label>Cod de confirmare</label>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setErr("");
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            placeholder="000000"
            className={styles.input}
            disabled={isBusy}
          />
        </div>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.actions}>
          <button className={styles.btn} onClick={verify} disabled={!canVerify}>
            {state === "verifying" ? "Se verifică…" : "Confirmă"}
          </button>

          <button
            className={styles.btnSecondary}
            onClick={resend}
            disabled={state === "resending"}
            type="button"
          >
            {state === "resending" ? "Se retrimite…" : "Trimite din nou codul"}
          </button>
        </div>

        {state === "resent" && <div className={styles.info}>Gata! Verifică inbox-ul.</div>}

        <p className={styles.hint}>Verifică și Spam/Promotions dacă nu găsești emailul.</p>
      </div>
    </section>
  );
}
