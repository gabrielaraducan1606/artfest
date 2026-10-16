// src/pages/Vendor/Fair/FairRulesDraftPage.jsx
//
// /targ-artfest/regulament-draft - draftul de lucru al regulamentului Târgului
// Artfest, DOAR pentru citire (vendor sau Admin autentificat).
// NU este documentul oficial: nu e termsUrl, nu se acceptă și nu se salvează
// ca termsVersion. Versiunea oficială are adresa /targ-artfest/regulament/v<versiune>.

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./FairPage.module.css";

const VENDOR_DRAFT_API = "/api/vendor/artfest-fair/rules-draft";
const ADMIN_DRAFT_API = "/api/admin/artfest-fair/rules-draft";

export default function FairRulesDraftPage() {
  const [state, setState] = useState({ loading: true, error: "", draft: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let draft;
        try {
          draft = await api(VENDOR_DRAFT_API);
        } catch (err) {
          // Adminul nu e vendor: același draft, prin ruta Admin
          if (err?.status !== 403) throw err;
          draft = await api(ADMIN_DRAFT_API);
        }
        if (!cancelled) setState({ loading: false, error: "", draft });
      } catch (err) {
        if (cancelled) return;
        const error =
          err?.status === 401
            ? "Autentifică-te în contul tău de vânzător pentru a citi draftul regulamentului."
            : err?.status === 403
              ? "Draftul regulamentului este disponibil doar pentru vânzători."
              : err?.data?.message || "Nu am putut încărca draftul regulamentului.";
        setState({ loading: false, error, draft: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Se încarcă…</p>
      </main>
    );
  }

  if (!state.draft) {
    return (
      <main className={styles.page}>
        <div className={styles.errorBox} role="alert">
          {state.error}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.errorBox} role="note">
        <strong>DRAFT – versiune de lucru{state.draft.draftVersion ? ` (${state.draft.draftVersion})` : ""}.</strong>{" "}
        Acesta NU este regulamentul oficial al Târgului Artfest și nu este documentul acceptat la înscriere. Textul se
        poate schimba până la publicarea versiunii oficiale.
      </div>
      <article dangerouslySetInnerHTML={{ __html: state.draft.html }} />
    </main>
  );
}
