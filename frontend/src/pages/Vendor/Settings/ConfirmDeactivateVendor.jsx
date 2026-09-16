// src/pages/Vendor/Settings/ConfirmDeactivateVendor.jsx
//
// Pasul 2 al fluxului de ștergere cont vânzător (audit 2026-09-16) -
// pagina LIPSĂ care cauza bug-ul raportat: emailul de confirmare
// trimitea către /vendor/settings/confirm-deactivate, dar nicio rută
// frontend nu exista, deci POST .../deactivate/confirm nu era
// NICIODATĂ apelat - contul nu se ștergea niciodată efectiv.
//
// Mirror STRUCTURAL de ResetPassword.jsx (același stil, Login.module.css) -
// dar auto-declanșat (nu e un formular, doar un link de confirmare).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import styles from "../../Auth/Login/Login.module.css";

export default function ConfirmDeactivateVendor() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  // "loading" | "success" | "error"
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  // Apelăm confirmarea O SINGURĂ dată per încărcare de pagină (evită
  // dublu-apel din re-render/StrictMode) - cerință explicită "fără
  // loop".
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const url = new URL(window.location.href);
    const token = (url.searchParams.get("token") || "").trim();

    if (!token) {
      setStatus("error");
      setErrorMessage("Linkul de confirmare este invalid.");
      return;
    }

    (async () => {
      try {
        await api("/api/vendor/settings/account/deactivate/confirm", {
          method: "POST",
          body: { token },
        });

        /*
         * Sesiunea NU trebuie să rămână activă după succes - logout
         * server-side (clear cookie) + refresh al contextului de auth
         * (me devine null). Best-effort: chiar dacă logout-ul eșuează
         * din motive de rețea, tokenVersion a fost deja incrementat în
         * transacția de confirmare - sesiunea curentă tot devine
         * invalidă la următorul request (enforceTokenVersion).
         */
        try {
          await api("/api/auth/logout", { method: "POST" });
        } catch {
          // ignorăm - vezi comentariul de mai sus
        }

        if (typeof refresh === "function") {
          try {
            await refresh();
          } catch {
            // ignorăm
          }
        }

        setStatus("success");
      } catch (e) {
        const code = e?.data?.error || e?.code;

        const message =
          code === "invalid_token" || code === "token_expired"
            ? "Linkul de confirmare este invalid sau a expirat."
            : code === "not_a_vendor"
              ? "Acest cont nu mai este asociat unui magazin vendor."
              : code === "unauthenticated" || e?.status === 401
                ? "Trebuie să fii autentificat cu contul de vânzător pentru a confirma ștergerea. Autentifică-te din nou și accesează linkul din email."
                : e?.data?.message ||
                  e?.message ||
                  "Nu am putut confirma ștergerea contului. Încearcă din nou.";

        setStatus("error");
        setErrorMessage(message);
      }
    })();
  }, [refresh]);

  // Redirect automat la succes, dar DUPĂ ce mesajul a fost vizibil
  // câteva secunde - nu ascundem confirmarea instant.
  useEffect(() => {
    if (status !== "success") return undefined;

    const t = setTimeout(() => {
      navigate("/", { replace: true });
    }, 3500);

    return () => clearTimeout(t);
  }, [status, navigate]);

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Ștergere cont vânzător</h1>
        <p className={styles.subtitle}>
          {status === "loading" && "Se procesează ștergerea contului…"}
          {status === "success" &&
            "Contul tău de vânzător a fost șters/dezactivat."}
          {status === "error" && "Nu am putut finaliza operațiunea."}
        </p>
      </header>

      <div className={styles.card}>
        {status === "loading" && <p>Te rugăm așteaptă, nu închide pagina…</p>}

        {status === "success" && (
          <>
            <p>✅ Contul tău de vânzător a fost șters/dezactivat.</p>
            <p style={{ fontSize: 13, color: "#6b7280" }}>
              Vei fi redirecționat automat către pagina principală.
            </p>
            <a className={styles.link} href="/">
              Mergi acum la pagina principală
            </a>
          </>
        )}

        {status === "error" && (
          <>
            <div className={styles.error} role="alert">
              {errorMessage}
            </div>
            <a className={styles.link} href="/">
              Mergi la pagina principală
            </a>
          </>
        )}
      </div>
    </section>
  );
}
