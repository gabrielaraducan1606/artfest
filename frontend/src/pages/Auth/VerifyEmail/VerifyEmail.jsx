import { useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./VerifyEmail.module.css";

export default function VerifyEmail() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const email = params.get("email") || "";
  const urlIntent = (params.get("intent") || "").toLowerCase();

  const [code, setCode] = useState("");
  const [state, setState] = useState("waiting"); // waiting | verifying | resending | resent
  const [err, setErr] = useState("");

  const isBusy = state === "verifying" || state === "resending";
  const canVerify = /^\d{6}$/.test(code) && !isBusy;

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

      await api("/api/auth/resend-verification", {
        method: "POST",
        body: { email },
      });

      setState("resent");
      setCode("");
    } catch (e) {
      setErr(e?.data?.message || "Nu am putut retrimite codul.");
      setState("waiting");
    }
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <h2 className={styles.title}>Confirmă emailul</h2>

        <p className={styles.text}>
          Ți-am trimis un cod de 6 cifre la <strong>{email || "adresa ta de email"}</strong>.
        </p>

        <div className={styles.field}>
          <label htmlFor="verification-code" className={styles.label}>
            Cod de confirmare
          </label>

          <input
            id="verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            value={code}
            onChange={(e) => {
              setErr("");
              if (state === "resent") setState("waiting");
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
              setErr("");
              if (state === "resent") setState("waiting");
              setCode(pasted);
            }}
            placeholder="000000"
            className={styles.input}
            disabled={isBusy}
            aria-invalid={!!err}
            aria-describedby={err ? "verification-error" : undefined}
          />
        </div>

        {err && (
          <div id="verification-error" className={styles.error} role="alert">
            {err}
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            onClick={verify}
            disabled={!canVerify}
          >
            {state === "verifying" ? "Se verifică…" : "Confirmă"}
          </button>

          <button
            type="button"
            className={styles.btnSecondary}
            onClick={resend}
            disabled={state === "resending"}
          >
            {state === "resending" ? "Se retrimite…" : "Trimite din nou codul"}
          </button>
        </div>

        {state === "resent" && (
          <div className={styles.info} role="status">
            Gata! Verifică inbox-ul.
          </div>
        )}

        <p className={styles.hint}>
          Verifică și Spam/Promotions dacă nu găsești emailul.
        </p>
      </div>
    </section>
  );
}